import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getComputedWbs } from '@/lib/data/wbs'
import { listProjectsWithState } from '@/app/actions/project'
import { buildWbsWorkbook } from '@/lib/excel/export'
import { buildWorkbookWithProfile } from '@/lib/excel/exportWithProfile'
import { activeTeamCodesForProjectSync } from '@/lib/teams/master'
import { seoulToday } from '@/lib/domain/dates'
import { ConfigKeyError, ConfigUnavailableError, configStatus } from '@/lib/settings/errors'
import { getProjectConfig, type ProjectConfig } from '@/lib/settings/projectConfig'
import { valueOf } from '@/lib/settings/registry'

const ERR_PROFILE_MISSING = '저장된 엑셀 양식이 없습니다 — 임포트 마법사에서 "이 양식을 프로젝트 기본값으로 저장"을 켜고 다시 가져오세요.'
// 손상 안내는 설정 화면의 '저장된 양식 비우기'로 — 마법사 재저장은 가져오기를 다시 해야 해서, 막힌 파일로 덮어쓸 위험이 있다.
const errProfileCorrupt = (detail: string) => `저장된 엑셀 양식이 손상되었습니다: ${detail} — 설정 화면의 "저장된 양식 비우기"로 양식을 비우세요.`

// 현재 WBS를 xlsx로 내보낸다(읽기 전용 — 로그인 사용자 누구나). 임포트 포맷과 라운드트립.
export async function GET(req: NextRequest) {
  if (!(await getSession())) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })

  const projectId = req.nextUrl.searchParams.get('projectId')
  if (!projectId) return NextResponse.json({ error: '프로젝트 누락' }, { status: 400 })

  // 대상은 호출자가 볼 수 있는 프로젝트여야 한다(RLS + canSeeProject 목록). 다른 워크스페이스 pid 는 RLS 로 WBS 가 빈 결과
  // (오류 없음)라 그대로 가면 xlsx 헤더에 service_role 팀 캐시의 그 프로젝트 팀이 실린다 — 팀 캐시를 읽는 WBS 계산
  // (getComputedWbs 의 정렬)과 팀 헤더보다 먼저 판정한다. 목록 조회 실패는 '없는 프로젝트'가 아니다(500).
  const { projects, degraded } = await listProjectsWithState()
  const project = (projects as { id: string; name: string }[]).find(p => p.id === projectId)
  if (!project) {
    if (degraded) return NextResponse.json({ error: '프로젝트 목록을 확인할 수 없습니다.' }, { status: 500 })
    return NextResponse.json({ error: '프로젝트를 찾을 수 없습니다.' }, { status: 404 })
  }
  const name = project.name
  let cfg: ProjectConfig
  try { cfg = await getProjectConfig(projectId) } catch (e) {
    // 3원칙 — 조회 실패를 '양식 없음'이나 기본 라벨로 위장하지 않는다(import/inspect 라우트와 같은 관례).
    // 본문은 고정 문구 — PostgREST 사유(e.message)는 서버 로그에만 남긴다.
    if (e instanceof ConfigUnavailableError) { console.error('[export] 프로젝트 설정 조회 실패:', e.message); return NextResponse.json({ error: '프로젝트 설정을 확인할 수 없습니다.' }, { status: 503 }) }
    throw e
  }
  let levelLabels: string[]
  try { levelLabels = valueOf(cfg, 'core.level_labels') } catch (e) {
    if (e instanceof ConfigKeyError) return NextResponse.json({ error: e.message }, { status: configStatus(e.code) })
    throw e
  }

  // 저장 양식이 있으면 접기·펼침 모두 그 양식으로 낸다 — 재임포트가 저장 양식을 먼저 고르므로(domain/importWizard.ts:85) 두 버튼이
  // 다른 모양을 내면 설정 화면 파일이 되읽히지 않는다. 손상은 오류로 알린다(폴백 없음 — 에러 3원칙).
  // 저장 양식이 없으면 접기(설정 화면)는 프로젝트 팀·단계로 만드는 기본 레이아웃(buildWbsWorkbook, 바이트 불변),
  // 펼침(마법사 완료 화면)은 펼칠 양식이 없어 409 다(정본 §3.3.1 `wbs.excel_profile` "프로파일 필요, 폴백 없음"). 원본 5팀 LEGACY 는 쓰지 않는다.
  // 두 버튼 모두 fetch 로 받아 오류 본문을 토스트로 보여 준다(downloadWbsExport).
  const expand = req.nextUrl.searchParams.get('expand') === '1'
  // 저장 양식의 판정은 해석기의 키 상태로 한다 — set 이면 이미 validateProfile 을 통과한 값이다(여기서 다시 검증하지 않는다).
  const profileState = cfg.keys['wbs.excel_profile']
  if (profileState.status === 'invalid') {
    console.error('[export] 저장된 양식이 손상됨:', profileState.error)
    return NextResponse.json({ error: errProfileCorrupt(profileState.error) }, { status: 422 })
  }
  const validated = profileState.status === 'set' && profileState.value !== null ? profileState.value : null
  if (!validated && expand) return NextResponse.json({ error: ERR_PROFILE_MISSING }, { status: 409 })

  const { items, holidays } = await getComputedWbs(projectId)
  const hol = holidays.map(d => ({ date: d, name: '' }))
  let buf: ArrayBuffer
  if (validated) {
    const built = buildWorkbookWithProfile(items, validated, hol, { expandSubActs: expand, levelLabels }, name)
    // 명시적 미지원(아웃라인+펼침)·양식보다 깊은 WBS — 무증상 오파싱 대신 400 과 사유.
    if (!built.ok) return NextResponse.json({ error: built.error }, { status: 400 })
    buf = built.buffer
  } else {
    buf = buildWbsWorkbook(items, hol, name, activeTeamCodesForProjectSync(projectId), levelLabels)
  }
  const today = seoulToday()
  const filename = `WBS_${name}_${today}.xlsx`.replace(/[^\w가-힣.\-]+/g, '_')

  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="wbs_export.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Cache-Control': 'no-store',
    },
  })
}
