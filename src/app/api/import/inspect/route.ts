import { NextRequest, NextResponse } from 'next/server'
import { requireProjectAdmin } from '@/lib/authz'
import { denyStatus } from '@/lib/authz/errors'
import { detectWorkbook } from '@/lib/excel/detect'
import type { ExcelProfile } from '@/lib/excel/profile'
import { ConfigUnavailableError } from '@/lib/settings/errors'
import { getProjectConfig, type ProjectConfig } from '@/lib/settings/projectConfig'
import { isUuidLike } from '@/lib/domain/agentWork'
import { compareProfiles } from '@/lib/domain/importWizard'
import { skippedHolidaysOf } from '@/lib/domain/holidayImport'
import { parseWithProfile, readHolidaysFromBuffer } from '@/lib/excel/parseWithProfile'
import { isXlsxBuffer } from '@/lib/excel/sheetRows'
import { resolveTeamRef } from '@/lib/domain/teamName'
import { TeamsUnavailableError, projectTeams } from '@/lib/teams/source'
import { withSuggestedCustomColumns } from '@/lib/excel/customColumns'
import { createServerClient } from '@/lib/supabase/server'
import { serverTranslator } from '@/lib/i18n/server'
import { fill } from '@/lib/i18n/translate'

/**
 * 임포트 마법사 1단계 — 업로드된 워크북을 감지만 하고 아무것도 쓰지 않는다(§6.2, DB 쓰기 0).
 * 판정 대상 프로젝트가 본문에 있어 폼을 먼저 읽는다 — 파싱·DB 접근은 가드 통과 후에만 한다.
 */
export async function POST(req: NextRequest) {
  const t = await serverTranslator()
  const form = await req.formData()
  const file = form.get('file') as File | null
  const projectId = String(form.get('projectId') ?? '')
  if (!file || !projectId) return NextResponse.json({ error: t('srv.api.importInspect.fileProjectMissing') }, { status: 400 })
  // agent-loop 교훈 — 비 UUID 를 그대로 흘리면 가드·쿼리가 엉뚱한 에러로 새어나간다. 가드보다 먼저 막는다.
  if (!isUuidLike(projectId)) {
    return NextResponse.json({ error: t('err.projectIdentifierFormatNotValid') }, { status: 400 })
  }

  const g = await requireProjectAdmin(projectId)
  // 가드 실패 → 401·403·404(타 워크스페이스·미존재 — 존재 은닉), 그 밖(권한 조회 실패)은 서버 사정이라 500(재시도 가능).
  if (!g.ok) return NextResponse.json({ error: g.error }, { status: denyStatus(g) })

  const buf = await file.arrayBuffer()
  // 엑셀이 아닌 파일은 1단계에서 끝낸다(BUG-04) — 확장자만 .xlsx 인 글자 파일을 SheetJS 가 CSV 로 읽어 주어, 본문 글자가 열 이름인
  // "양식"으로 2단계까지 갔다. 설정 조회보다 먼저 본다(읽을 수 없는 파일에 DB 를 쓰지 않는다)
  if (!isXlsxBuffer(buf)) return NextResponse.json({ error: t('srv.api.importInspect.notXlsxFile') }, { status: 400 })

  let cfg: ProjectConfig
  try { cfg = await getProjectConfig(projectId) } catch (e) {
    // 3원칙 — 조회 실패를 기본값(savedProfile:null)으로 위장하지 않는다. 본문은 고정 문구, PostgREST 사유는 서버 로그에만.
    if (e instanceof ConfigUnavailableError) { console.error('[import/inspect] 프로젝트 설정 조회 실패:', e.message); return NextResponse.json({ error: t('err.couldNotVerifyProjectSettings') }, { status: 503 }) }
    throw e
  }

  // 감지는 프로젝트 설정을 안다 — 추가 축 이름(core.extra_axis_label)은 그 열의 머리 별칭(내보내기가 그 이름으로 머리를 쓴다), 단계 이름
  // (core.level_labels)은 계층 열 후보(BUG-07 — 머리가 '단계·작업·활동' 인 표준 양식을 자료 모양으로 추정하지 않는다). 이름이 없거나
  // 손상이면 그 선택지 없이 감지한다. 실행 라우트의 대조(detectLikeInspect)가 같은 선택지를 쓴다
  const extraAxisState = cfg.keys['core.extra_axis_label']
  const levelState = cfg.keys['core.level_labels']
  const detected = detectWorkbook(buf, {
    extraAxisLabel: extraAxisState.status === 'set' ? extraAxisState.value : null,
    levelLabels: levelState.status === 'set' || levelState.status === 'default' ? levelState.value : [],
  })
  if (!detected.ok) return NextResponse.json({ error: detected.error }, { status: 400 })

  // 감지 결과를 그대로 반환에 쓰되, warnings 는 아래서 덧붙일 수 있어 얕은 복제로 원본 배열을 보존한다.
  const detection = { ...detected.result, warnings: [...detected.result.warnings] }

  // 저장 양식은 해석기의 키 상태로 판정한다 — set 이면 이미 검증된 값, 기본값(null)이면 없음(정상, 경고 아님).
  const profileState = cfg.keys['wbs.excel_profile']
  let savedProfile: ExcelProfile | null = null
  if (profileState.status === 'set' && profileState.value !== null) savedProfile = profileState.value
  else if (profileState.status === 'invalid') {
    // 손상을 조용히 null 로만 넘기면 사실이 묻힌다 — 침묵 무시 금지. 사유는 서버 로그에(해석기도 키당 한 줄 남긴다).
    console.error('[import/inspect] 저장된 양식이 손상됨:', profileState.error)
    detection.warnings.push(t('srv.api.importInspect.savedProfileCorrupted'))
  }

  // 사용자 정의 필드 열 제안(개정 §3.6.7) — 헤더가 활성 필드의 라벨(공백·대소문자 정규화) 또는 key 와 같으면 그 열을 감지 양식의
  // customColumns 에 싣는다. 제안이 없으면 양식을 건드리지 않는다. 정의 키가 손상이면 제안 없이 경고로 알린다(저장 양식 손상과 같은 관례)
  const fieldState = cfg.keys['fields.wbs_item']
  if (fieldState.status === 'set' || fieldState.status === 'default') {
    detection.profile = withSuggestedCustomColumns(detection.profile, detection.preview.headers, fieldState.value)
  } else if (fieldState.status === 'invalid') {
    console.error('[import/inspect] 추가 필드 설정이 손상됨:', fieldState.error)
    detection.warnings.push(t('srv.api.importInspect.customFieldSettingsCorrupted'))
  }

  // 저장 양식과 이 파일의 구조가 다르면 알린다(Task 1b) — 저장 양식으로 읽으면 열이 밀려 틀린 값이 쓰인다.
  // 마법사는 같은 판정(compareProfiles)으로 감지 결과를 기본 선택으로 둔다. 저장 양식이 없거나 손상이면 null.
  const profileMismatch = savedProfile ? compareProfiles(savedProfile, detection.profile) : null

  // 휴일 충돌 미리보기(SP5 D7) — 감지된 Holiday 시트를 실행과 같은 규칙으로 읽고, 프로젝트의 근무 예외(cfg.holidays — 해석기가 끝까지 읽었다)와
  // 겹치는 날짜를 '건너뜀'으로 미리 보인다. 실행은 사용자가 고른 양식으로 다시 읽으므로 결과 화면(실행 응답)이 최종이다.
  const fileHolidays = readHolidaysFromBuffer(buf, detection.profile.holidaySheetName) ?? []
  const skippedHolidays = skippedHolidaysOf(fileHolidays, cfg.holidays)

  // 새로 만들 팀 미리보기(BUG-10) — 감지 양식으로 읽은 담당 팀 글자 가운데 이 프로젝트의 팀(code·이름, 앞뒤 공백·대소문자 무시)에 없는 것.
  // 실행이 같은 대조(resolveTeamRef)로 최종 판정하고 등록 전에 확인 창을 띄운다 — 여기는 미리 알리는 값이다. 판정하지 못하면(양식으로
  // 읽지 못함·팀 조회 실패) null: '없음'으로 위장하지 않고 화면이 그 사실을 말한다. 건너뛸 행 수(BUG-33)도 같은 읽기에서 나온다
  let newTeams: string[] | null = null
  let skippedRows: number | null = null
  const parsedPreview = parseWithProfile(buf, detection.profile)
  if (parsedPreview.ok) {
    skippedRows = parsedPreview.skippedRows
    try {
      const teams = await projectTeams(projectId)
      const fileTeams = [...new Set(parsedPreview.rows.flatMap((r) => r.owners.map((o) => o.team)))]
      newTeams = fileTeams.filter((name) => resolveTeamRef(name, teams) === null)
    } catch (e) {
      if (!(e instanceof TeamsUnavailableError)) throw e
      console.error('[import/inspect] 팀 조회 실패 — 새 팀 미리보기를 싣지 않는다:', e.message)
    }
  }

  try {
    const sb = await createServerClient()
    const { count: customCount } = await sb
      .from('wbs_items')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .neq('custom', '{}')
    if (customCount && customCount > 0) {
      detection.warnings.push(fill(t('err.customValuesDeleted'), { customCount }))
    }
  } catch {
    // 테스트 환경 또는 세션 없는 조회 등 실패 시에는 기존 감지 결과 보존
  }

  return NextResponse.json({ ok: true, detection, savedProfile, profileMismatch, skippedHolidays, newTeams, skippedRows })
}
