import { NextRequest, NextResponse } from 'next/server'
import { getComputedWbs } from '@/lib/data/wbs'
import { listProjectsWithState } from '@/app/actions/project'
import { buildWorkbookWithProfile } from '@/lib/excel/exportWithProfile'
import { deriveStandardExcelProfile, resolveTeamColumns } from '@/lib/excel/standardProfile'
import type { ExcelProfile } from '@/lib/excel/profile'
import { activeCodes } from '@/lib/domain/teams'
import { projectTeams, TeamsUnavailableError } from '@/lib/teams/source'
import { todayIn } from '@/lib/domain/calendar'
import { ConfigKeyError, ConfigUnavailableError, configStatus } from '@/lib/settings/errors'
import { getProjectConfig, type ProjectConfig } from '@/lib/settings/projectConfig'
import { valueOf } from '@/lib/settings/registry'
import { exportHolidayRows } from '@/lib/domain/holidayImport'
import { configFailureResponse, jsonError } from '@/lib/api/http'
import { requireProjectMember } from '@/lib/authz'
import { denyStatus } from '@/lib/authz/errors'
import type { FieldDef } from '@/lib/domain/customFields'
import { engineFor } from '@/lib/report/engine'
import { scanFormTemplate } from '@/lib/report/engine/scan'
import { FORM_FORMAT, FormRenderError, formatLocation } from '@/lib/report/engine/types'
import { buildWbsExportCatalog, wbsExportKpi } from '@/lib/report/catalog/wbsExportBuild'
import { FormTemplateLoadError, loadFormTemplate } from '@/lib/report/forms/loadTemplate'
import { loadReportProject } from '@/lib/report/forms/project'
import { catalogRoots } from '@/lib/report/forms/roots'
import { requireCalendar } from '@/lib/calendar/load'
import type { ProjectSettingValue } from '@/lib/settings/registry'

// 손상 안내는 설정 화면의 '저장된 양식 비우기'로 — 마법사 재저장은 가져오기를 다시 해야 해서, 막힌 파일로 덮어쓸 위험이 있다.
const errProfileCorrupt = (detail: string) => `저장된 엑셀 양식이 손상되었습니다: ${detail} — 설정 화면의 "저장된 양식 비우기"로 양식을 비우세요.`
const ERR_TEAMS = '프로젝트 팀을 확인할 수 없습니다.'
const ERR_BUILD = '엑셀 파일을 만들지 못했습니다.'

// 프로파일 라운드트립(form 없음·expand)은 그대로다(정본 §4.8). 가드는 requireProjectMember.
// form=1 만 wbs_export_xlsx 양식 렌더. wbs 는 core 라 requireModule 은 두지 않는다.
export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get('projectId')
  if (!projectId) return NextResponse.json({ error: '프로젝트 누락' }, { status: 400 })
  const guard = await requireProjectMember(projectId)
  if (!guard.ok) return jsonError(guard.error, denyStatus(guard.error))
  if (req.nextUrl.searchParams.get('form') === '1') return exportForm(projectId)

  // 대상은 호출자가 볼 수 있는 프로젝트여야 한다(RLS + canSeeProject 목록) — 팀·WBS 를 읽기 전에 판정한다.
  // 목록 조회 실패는 '없는 프로젝트'가 아니다(500).
  const { projects, degraded } = await listProjectsWithState()
  const project = (projects as { id: string; name: string }[]).find(p => p.id === projectId)
  if (!project) {
    if (degraded) return NextResponse.json({ error: '프로젝트 목록을 확인할 수 없습니다.' }, { status: 500 })
    return NextResponse.json({ error: '프로젝트를 찾을 수 없습니다.' }, { status: 404 })
  }
  const name = project.name
  let cfg: ProjectConfig
  try { cfg = await getProjectConfig(projectId) } catch (e) {
    // 3원칙 — 조회 실패를 '양식 없음'이나 기본 라벨로 위장하지 않는다. 본문은 고정 문구 — 사유는 서버 로그에만.
    if (e instanceof ConfigUnavailableError) { console.error('[export] 프로젝트 설정 조회 실패:', e.message); return NextResponse.json({ error: '프로젝트 설정을 확인할 수 없습니다.' }, { status: 503 }) }
    throw e
  }
  // 본문에 기계 코드(code)를 싣는다 — 422·409 가 단계 이름 손상·부재(CONFIG_*)와 양식 손상(PROFILE_CORRUPT) 두 뜻을 갖는다(exportFailureKey).
  let levelLabels: string[]
  try { levelLabels = valueOf(cfg, 'core.level_labels') } catch (e) {
    if (e instanceof ConfigKeyError) return NextResponse.json({ error: e.message, code: e.code, key: e.key }, { status: configStatus(e.code) })
    throw e
  }

  // 추가 축 열의 머리(core.extra_axis_label) — 비었거나 손상이면 기본 낱말로 낸다(표시 전용 — 내보내기를 막지 않는다. 감지기는 기본 낱말을 늘 안다)
  const extraAxisState = cfg.keys['core.extra_axis_label']
  if (extraAxisState.status === 'invalid') console.error('[export] 추가 축 이름 손상 — 기본 머리로 낸다:', extraAxisState.error)
  const extraAxisLabel = extraAxisState.status === 'set' ? extraAxisState.value : null

  const expand = req.nextUrl.searchParams.get('expand') === '1'
  // 저장 양식의 판정은 해석기의 키 상태로 한다 — set 이면 이미 validateProfile 을 통과한 값이다. 손상은 오류로 알린다(폴백 없음).
  const profileState = cfg.keys['wbs.excel_profile']
  if (profileState.status === 'invalid') {
    console.error('[export] 저장된 양식이 손상됨:', profileState.error)
    return NextResponse.json({ error: errProfileCorrupt(profileState.error), code: 'PROFILE_CORRUPT' }, { status: 422 })
  }
  const saved = profileState.status === 'set' && profileState.value !== null ? profileState.value : null

  // getComputedWbs 는 정렬용 팀(projectTeams)을 먼저 읽는다 — 팀 원천 실패는 아래 표준 분기와 같은 503 이다(A2-2 리뷰 보안 P3 — 이 줄이 try 밖이라
  // 본문 없는 500 이 나 문서화한 계약이 닿지 않았다. 저장 양식 경로도 같다)
  let wbs: Awaited<ReturnType<typeof getComputedWbs>>
  try {
    wbs = await getComputedWbs(projectId)
  } catch (e) {
    // 달력 손상 → 422 CALENDAR_INVALID·키, 설정 조회 실패 → 503 — 세 라우트 같은 꼴(A-3 리뷰 P3·A-4 리뷰 N5)
    const failed = configFailureResponse(e, 'export(WBS)')
    if (failed) return failed
    if (!(e instanceof TeamsUnavailableError)) throw e
    console.error('[export] 프로젝트 팀 조회 실패(WBS):', e.message, e.cause)
    return NextResponse.json({ error: ERR_TEAMS, code: 'TEAMS_UNAVAILABLE' }, { status: 503 })
  }
  const { items } = wbs
  const hol = exportHolidayRows(cfg.holidays)    // 휴무만·이름 유지(SP5 D7 — Excel 왕복은 off 만). 원천은 해석기의 날짜 예외
  let profile: ExcelProfile
  let layout: 'standard' | 'saved'
  if (saved) {
    profile = saved
    layout = 'saved'
  } else {
    // 표준 — 활성 프로젝트 팀 코드 뒤에 트리 담당에 처음 나온 팀(비활성 포함)을 등장 순으로(계획 P8). 팀 원천 실패는 503 — 빈 팀 열로 내지 않는다.
    const fieldDefsState = cfg.keys['fields.wbs_item']
    const customFields = fieldDefsState && (fieldDefsState.status === 'set' || fieldDefsState.status === 'default')
      ? (fieldDefsState.value as FieldDef[])
      : []
    try {
      profile = deriveStandardExcelProfile(
        resolveTeamColumns(items, activeCodes(await projectTeams(projectId))),
        levelLabels,
        customFields,
      )
    } catch (e) {
      if (!(e instanceof TeamsUnavailableError)) throw e
      console.error('[export] 프로젝트 팀 조회 실패:', e.message, e.cause)
      return NextResponse.json({ error: ERR_TEAMS, code: 'TEAMS_UNAVAILABLE' }, { status: 503 })
    }
    layout = 'standard'
  }
  // 표준은 깊은 WBS 를 마지막 계층 열로 접고(옛 빌더와 같다), 저장 양식은 거부한다(그 문구의 처방 '저장된 양식 비우기'는 저장 양식에만 맞다 — D16).
  const fieldDefsState = cfg.keys['fields.wbs_item']
  const customFieldDefs = fieldDefsState && (fieldDefsState.status === 'set' || fieldDefsState.status === 'default')
    ? (fieldDefsState.value as FieldDef[])
    : []
  const built = buildWorkbookWithProfile(items, profile, hol, {
    expandSubActs: expand,
    levelLabels,
    deep: layout === 'standard' ? 'fold' : 'reject',
    ...(customFieldDefs.length > 0 ? { customFieldDefs } : {}),
    ...(extraAxisLabel ? { extraAxisLabel } : {}),
  }, name)
  if (!built.ok) {
    if (layout === 'standard') {
      console.error('[export] 표준 양식 생성 거부(결함):', built.error)
      return NextResponse.json({ error: ERR_BUILD }, { status: 500 })
    }
    // 저장 양식의 명시적 미지원(아웃라인+펼침)·양식보다 깊은 WBS — 무증상 오파싱 대신 400 과 사유.
    return NextResponse.json({ error: built.error }, { status: 400 })
  }
  // 파일명 날짜 = 그 프로젝트 tz 의 오늘(SP5 계획 D-22d) — getComputedWbs 가 이미 판독한 달력
  const today = todayIn(wbs.calendar.timezone, new Date())
  const filename = `WBS_${name}_${today}.xlsx`.replace(/[^\w가-힣.\-]+/g, '_')

  return new NextResponse(built.buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="wbs_export.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Cache-Control': 'no-store',
      'X-Excel-Layout': layout,
    },
  })
}

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/** 양식 출력 (정본 §4.8 form=1). 프로파일 라운드트립은 이 함수를 타지 않는다. */
async function exportForm(projectId: string): Promise<NextResponse> {
  try {
    const cfg = await getProjectConfig(projectId)
    const setting = valueOf(cfg, 'forms.wbs_export_xlsx')
    const calendar = requireCalendar(cfg)
    const loaded = await loadFormTemplate(projectId, 'wbs_export_xlsx', setting.template_id)
    const scanned = await scanFormTemplate(loaded.bytes, FORM_FORMAT.wbs_export_xlsx)
    const roots = catalogRoots(scanned.placeholders, setting.mapping)
    const project = await loadReportProject(projectId)
    if (!project) return jsonError('프로젝트를 찾을 수 없습니다.', 404)

    const needsItems = roots.has('wbs_items') || roots.has('kpi') || roots.has('holidays')
    const levelLabels = roots.has('wbs_items') || usesLevelLabels(scanned.placeholders, setting.mapping)
      ? valueOf(cfg, 'core.level_labels')
      : []
    let wbs: Awaited<ReturnType<typeof getComputedWbs>> | null = null
    if (needsItems) {
      try {
        wbs = await getComputedWbs(projectId)
      } catch (error) {
        const failed = configFailureResponse(error, 'export(form)')
        if (failed) return failed
        if (!(error instanceof TeamsUnavailableError)) throw error
        console.error('[export] 프로젝트 팀 조회 실패(WBS):', error.message, error.cause)
        return NextResponse.json({ error: ERR_TEAMS, code: 'TEAMS_UNAVAILABLE' }, { status: 503 })
      }
    }
    let teams: { code: string; name: string; color: string }[] | undefined
    if (roots.has('teams')) {
      try {
        teams = (await projectTeams(projectId)).map((team) => ({ code: team.code, name: team.name, color: team.color }))
      } catch (error) {
        if (!(error instanceof TeamsUnavailableError)) throw error
        console.error('[export] 프로젝트 팀 조회 실패:', error.message, error.cause)
        return NextResponse.json({ error: ERR_TEAMS, code: 'TEAMS_UNAVAILABLE' }, { status: 503 })
      }
    }
    const fieldKeys = roots.has('custom') ? activeFieldKeys(valueOf(cfg, 'fields.wbs_item')) : []
    const names = new Map((cfg.holidays).filter((row) => row.kind === 'off').map((row) => [row.date, row.name]))
    const today = wbs ? wbs.today : todayIn(calendar.timezone, new Date())
    const model = buildWbsExportCatalog({
      project: roots.has('project') || roots.has('wbs_items') ? { ...project, levelLabels } : undefined,
      items: roots.has('wbs_items') ? wbs!.items : undefined,
      today: wbs?.today,
      teams,
      holidays: roots.has('holidays') ? (wbs!.holidays).map((date) => ({ date, name: names.get(date) ?? '' })) : undefined,
      kpi: roots.has('kpi') ? wbsExportKpi(wbs!.items, wbs!.today, wbs!.calendar, levelLabels) : undefined,
      fieldKeys,
    })
    const body = await engineFor('xlsx').render(loaded.bytes, model, setting.mapping, setting.options)
    const filename = `WBS_${project.name}_${today}.xlsx`.replace(/[^\w가-힣.\-]+/g, '_')
    return new NextResponse(body as unknown as ArrayBuffer, {
      headers: {
        'Content-Type': XLSX,
        'Content-Disposition': `attachment; filename="wbs_export.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Cache-Control': 'no-store',
        'X-Form-Template': loaded.source,
      },
    })
  } catch (error) {
    if (error instanceof FormRenderError) {
      const location = error.location ? formatLocation(error.location) : undefined
      console.error('[export] 양식 렌더 실패', error.code, location, error.token, error.message)
      return NextResponse.json(
        { error: error.message, code: error.code, ...(location ? { location } : {}), ...(error.token ? { token: error.token } : {}) },
        { status: 422, headers: { 'Cache-Control': 'no-store' } },
      )
    }
    if (error instanceof FormTemplateLoadError) {
      console.error('[export] 양식 파일을 읽지 못했다', error.message)
      return jsonError(error.message, 500)
    }
    const failed = configFailureResponse(error, 'export(form)')
    if (failed) return failed
    console.error('[export] 양식 출력 실패', error instanceof Error ? error.message : error)
    return jsonError('엑셀 파일을 만들지 못했습니다.', 500)
  }
}

function activeFieldKeys(fields: ProjectSettingValue<'fields.wbs_item'>): string[] {
  return fields.filter((field) => field.active).sort((a, b) => a.sort - b.sort).map((field) => field.key)
}

function usesLevelLabels(placeholders: { token: string; path: string; scope: string[] }[], mapping: Record<string, string>): boolean {
  return placeholders.some((placeholder) => {
    const path = mapping[[...placeholder.scope, placeholder.token].join('/')] ?? mapping[placeholder.token] ?? placeholder.path
    return path === 'project.level_labels' || path.startsWith('project.level_labels.')
  })
}
