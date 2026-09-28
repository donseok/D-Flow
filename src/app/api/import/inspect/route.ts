import { NextRequest, NextResponse } from 'next/server'
import { requireProjectAdmin } from '@/lib/authz'
import { denyStatus } from '@/lib/authz/errors'
import { detectWorkbook } from '@/lib/excel/detect'
import type { ExcelProfile } from '@/lib/excel/profile'
import { ConfigUnavailableError } from '@/lib/settings/errors'
import { getProjectConfig, type ProjectConfig } from '@/lib/settings/projectConfig'
import { isUuidLike } from '@/lib/domain/agentWork'
import { compareProfiles } from '@/lib/domain/importWizard'

/**
 * 임포트 마법사 1단계 — 업로드된 워크북을 감지만 하고 아무것도 쓰지 않는다(§6.2, DB 쓰기 0).
 * 판정 대상 프로젝트가 본문에 있어 폼을 먼저 읽는다 — 파싱·DB 접근은 가드 통과 후에만 한다.
 */
export async function POST(req: NextRequest) {
  const form = await req.formData()
  const file = form.get('file') as File | null
  const projectId = String(form.get('projectId') ?? '')
  if (!file || !projectId) return NextResponse.json({ error: '파일/프로젝트 누락' }, { status: 400 })
  // agent-loop 교훈 — 비 UUID 를 그대로 흘리면 가드·쿼리가 엉뚱한 에러로 새어나간다. 가드보다 먼저 막는다.
  if (!isUuidLike(projectId)) {
    return NextResponse.json({ error: '프로젝트 식별자 형식이 올바르지 않습니다' }, { status: 400 })
  }

  const g = await requireProjectAdmin(projectId)
  // 가드 실패 → 401·403·404(타 워크스페이스·미존재 — 존재 은닉), 그 밖(권한 조회 실패)은 서버 사정이라 500(재시도 가능).
  if (!g.ok) return NextResponse.json({ error: g.error }, { status: denyStatus(g.error) })

  const detected = detectWorkbook(await file.arrayBuffer())
  if (!detected.ok) return NextResponse.json({ error: detected.error }, { status: 400 })

  let cfg: ProjectConfig
  try { cfg = await getProjectConfig(projectId) } catch (e) {
    // 3원칙 — 조회 실패를 기본값(savedProfile:null)으로 위장하지 않는다. 본문은 고정 문구, PostgREST 사유는 서버 로그에만.
    if (e instanceof ConfigUnavailableError) { console.error('[import/inspect] 프로젝트 설정 조회 실패:', e.message); return NextResponse.json({ error: '프로젝트 설정을 확인할 수 없습니다.' }, { status: 503 }) }
    throw e
  }

  // 감지 결과를 그대로 반환에 쓰되, warnings 는 아래서 덧붙일 수 있어 얕은 복제로 원본 배열을 보존한다.
  const detection = { ...detected.result, warnings: [...detected.result.warnings] }

  // 저장 양식은 해석기의 키 상태로 판정한다 — set 이면 이미 검증된 값, 기본값(null)이면 없음(정상, 경고 아님).
  const profileState = cfg.keys['wbs.excel_profile']
  let savedProfile: ExcelProfile | null = null
  if (profileState.status === 'set' && profileState.value !== null) savedProfile = profileState.value
  else if (profileState.status === 'invalid') {
    // 손상을 조용히 null 로만 넘기면 사실이 묻힌다 — 침묵 무시 금지. 사유는 서버 로그에(해석기도 키당 한 줄 남긴다).
    console.error('[import/inspect] 저장된 양식이 손상됨:', profileState.error)
    detection.warnings.push('저장된 프로파일이 손상됨')
  }

  // 저장 양식과 이 파일의 구조가 다르면 알린다(Task 1b) — 저장 양식으로 읽으면 열이 밀려 틀린 값이 쓰인다.
  // 마법사는 같은 판정(compareProfiles)으로 감지 결과를 기본 선택으로 둔다. 저장 양식이 없거나 손상이면 null.
  const profileMismatch = savedProfile ? compareProfiles(savedProfile, detection.profile) : null

  return NextResponse.json({ ok: true, detection, savedProfile, profileMismatch })
}
