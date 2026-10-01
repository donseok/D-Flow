import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { denyStatus } from '@/lib/authz/errors'
import { requireModule } from '@/lib/modules/gate'
import { getComputedWbs } from '@/lib/data/wbs'
import { getProjectRoster } from '@/lib/data/members'
import { getAttendanceRecords } from '@/lib/data/attendance'
import { getProjectMeetingData } from '@/lib/data/meetings'
import { getAnnouncements } from '@/lib/data/announcements'
import { listProjectsWithState } from '@/app/actions/project'
import { buildWeeklyReportModel } from '@/lib/report/weekly'
import { buildReportWorkbook } from '@/lib/report/excel'
import { buildWeeklyNarrative } from '@/lib/report/narrative'
import { fillWeeklyTemplate, fillSheetTemplate } from '@/lib/report/templateFill'
import { mondayIso, sheetWeekMeta } from '@/lib/report/week'
import { buildSheetSections, sheetLineText } from '@/lib/report/sheetNarrative'
import { getWeeklySheet } from '@/lib/data/weeklySheet'
import { ALL_CELLS, hasContent, type WeeklyArea } from '@/lib/domain/weeklySheet'
import { briefToExtraSlide, type ExtraNarrativeSlide } from '@/lib/report/aiComment'
import { loadProjectFacts } from '@/lib/ai/projectFacts'
import { briefFactsHash, buildBriefFacts } from '@/lib/ai/brief'
import { getAiBrief } from '@/lib/data/aiBriefs'
import { projectTeams } from '@/lib/teams/source'
import { activeCodes } from '@/lib/domain/teams'
import { ConfigKeyError, ConfigUnavailableError, configStatus } from '@/lib/settings/errors'
import { getProjectConfig } from '@/lib/settings/projectConfig'
import { loadDisplayBranding } from '@/lib/settings/displayBranding'
import { valueOf } from '@/lib/settings/registry'
import { seoulStamp } from '@/lib/domain/dates'

// exceljs·템플릿 zip 읽기(fs)는 Node 전용 → Edge 런타임 금지.
export const runtime = 'nodejs'

/** 현재 시각(Asia/Seoul). 포맷 정본은 domain/dates.seoulStamp. */
const seoulNow = (): string => seoulStamp(new Date())

const FORMATS = {
  xlsx: {
    ext: 'xlsx',
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  },
  pptx: {
    ext: 'pptx',
    type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  },
} as const

type ReportProject = { id: string; name: string; description?: string | null; start_date?: string | null; end_date?: string | null }

/**
 * 대상은 호출자가 볼 수 있는 프로젝트여야 한다(RLS + canSeeProject 목록) — /api/export 와 같은 순서·문구로 다른 조회보다 먼저
 * 판정한다(판정 전에 데이터 조회를 시작하지 않는다). 목록 조회 실패는 '없는 프로젝트'가 아니다(500).
 */
async function resolveReportProject(projectId: string): Promise<{ ok: true; project: ReportProject } | { ok: false; res: NextResponse }> {
  const { projects, degraded } = await listProjectsWithState()
  const project = (projects as ReportProject[]).find(p => p.id === projectId)
  if (project) return { ok: true, project }
  if (degraded) return { ok: false, res: NextResponse.json({ error: '프로젝트 목록을 확인할 수 없습니다.' }, { status: 500 }) }
  return { ok: false, res: NextResponse.json({ error: '프로젝트를 찾을 수 없습니다.' }, { status: 404 }) }
}

/**
 * 현황 보고서를 Excel/PPT로 내보낸다(읽기 전용 — /api/export와 동일, 로그인 사용자 누구나).
 * 데이터 페치는 RLS가 적용돼 권한이 자동 반영된다. 화면 모달과 동일한 buildReportModel 사용.
 */
export async function GET(req: NextRequest) {
  if (!(await getSession())) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })

  const projectId = req.nextUrl.searchParams.get('projectId')
  const format = req.nextUrl.searchParams.get('format')
  if (!projectId) return NextResponse.json({ error: '프로젝트 누락' }, { status: 400 })
  if (format !== 'xlsx' && format !== 'pptx') {
    return NextResponse.json({ error: 'format은 xlsx 또는 pptx여야 합니다' }, { status: 400 })
  }

  // ── 주간업무 시트 PPT (source=sheet): WBS 모델 페치를 우회하고 시트 rows만 사용 ──
  const source = req.nextUrl.searchParams.get('source')
  if (source === 'sheet') {
    if (format !== 'pptx') return NextResponse.json({ error: '시트 보고서는 pptx만 지원합니다' }, { status: 400 })
    const week = req.nextUrl.searchParams.get('week')
    if (!week || !/^\d{4}-\d{2}-\d{2}$/.test(week)) {
      return NextResponse.json({ error: 'week(YYYY-MM-DD)가 필요합니다' }, { status: 400 })
    }
    const weekStart = mondayIso(week) // 임의 날짜 → 월요일 정규화(스펙 §7)
    const target = await resolveReportProject(projectId)
    if (!target.ok) return target.res
    // 주간업무 시트만 weekly 관문(P4) — 기본 갈래(WBS 화면의 현황 보고서)는 core 라 부르지 않는다
    const mod = await requireModule({ projectId }, 'weekly')
    if (!mod.ok) return NextResponse.json({ error: mod.error }, { status: denyStatus(mod.error) })
    const { project } = target
    // 페이지·머리는 프로젝트의 주간 영역이 정한다 — 설정 조회 실패는 기본 갈래와 같은 503(영역 없이 시트를 그리지 않는다)
    let areas: WeeklyArea[]
    try { areas = (await getProjectConfig(projectId)).areas.weekly_section } catch (e) {
      if (e instanceof ConfigUnavailableError) {
        console.error('[report] 프로젝트 설정 조회 실패(시트 갈래):', e.message)
        return NextResponse.json({ error: '프로젝트 설정을 확인할 수 없습니다.' }, { status: 503 })
      }
      throw e
    }
    const sheet = await getWeeklySheet(projectId, weekStart)   // 읽기만 한다(W16)
    if (!sheet || !sheet.rows.some(r => hasContent(r, ALL_CELLS))) {
      return NextResponse.json({ error: '해당 주차에 작성된 내용이 없습니다' }, { status: 400 })
    }
    const wk = sheetWeekMeta(weekStart)
    // 보이는 영역마다 1페이지(활성 영역 → 내용 있는 비활성 영역, D32) — 각 페이지에 그 영역의 실적·계획·이슈·이벤트를 함께 싣는다.
    const body = await fillSheetTemplate(
      buildSheetSections(sheet.rows, areas),
      { meta: { prevWeekRange: wk.thisRange, weekRange: wk.nextRange } }, // 좌=금주실적, 우=차주계획
      { labels: { left: '금주실적', right: '차주계획' }, lineFormatter: sheetLineText },
    )
    const filename = `${project.name}_주간업무_${wk.weekTag}_${weekStart}.pptx`.replace(/[^\w가-힣.\-]+/g, '_')
    return new NextResponse(body as unknown as ArrayBuffer, { // Buffer 단독 타입 → 기존 반환부(route.ts:74)의 ArrayBuffer|Buffer 유니온과 달리 unknown 경유 필요
      headers: {
        'Content-Type': FORMATS.pptx.type,
        'Content-Disposition': `attachment; filename="report.pptx"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Cache-Control': 'no-store',
      },
    })
  }

  const target = await resolveReportProject(projectId)
  if (!target.ok) return target.res
  const { project } = target

  // 설정 조회는 같은 배치에서 돌리되 결과로 받는다 — throw 하면 Promise.all 전체가 500 이 되어 '설정 확인 불가'(503)와 구분되지 않는다.
  const [{ items, today }, roster, attendance, meetRes, annRes, cfgRes, teamsRes] = await Promise.all([
    getComputedWbs(projectId), getProjectRoster(projectId), getAttendanceRecords(projectId),
    getProjectMeetingData(projectId), getAnnouncements(projectId),
    getProjectConfig(projectId).then((cfg) => ({ ok: true as const, cfg }), (e: unknown) => ({ ok: false as const, e })),
    projectTeams(projectId).then((teams) => ({ ok: true as const, teams }), (e: unknown) => ({ ok: false as const, e })),
  ])
  if (!cfgRes.ok) {
    if (cfgRes.e instanceof ConfigUnavailableError) {
      console.error('[report] 프로젝트 설정 조회 실패:', cfgRes.e.message)
      return NextResponse.json({ error: '프로젝트 설정을 확인할 수 없습니다.' }, { status: 503 })
    }
    throw cfgRes.e
  }
  if (!teamsRes.ok) {
    console.error('[report] 프로젝트 팀 조회 실패:', { projectId }, teamsRes.e)
    return NextResponse.json({ error: '프로젝트 팀을 확인할 수 없습니다.' }, { status: 503 })
  }
  let levelLabels: string[]
  try { levelLabels = valueOf(cfgRes.cfg, 'core.level_labels') } catch (e) {
    if (e instanceof ConfigKeyError) return NextResponse.json({ error: e.message }, { status: configStatus(e.code) })
    throw e
  }
  // 명단·회의·공지를 못 읽었으면 '멤버·회의·공지 없는 보고서' 를 내려보내지 않는다(3원칙 ① — 조회 실패를 데이터 없음으로 위장하지 않는다).
  if (!roster.ok) {
    console.error(`[report] 명단 조회 실패로 보고서를 만들지 않는다: project=${projectId}`)
    return NextResponse.json({ error: roster.error }, { status: 503 })
  }
  if (!meetRes.ok) {
    console.error(`[report] 회의 조회 실패로 보고서를 만들지 않는다: project=${projectId}`)
    return NextResponse.json({ error: meetRes.error }, { status: 503 })
  }
  if (!annRes.ok) {
    console.error(`[report] 공지 조회 실패로 보고서를 만들지 않는다: project=${projectId}`)
    return NextResponse.json({ error: annRes.error }, { status: 503 })
  }
  const members = roster.rows

  const model = buildWeeklyReportModel(items, project, today, {
    members, attendance, generatedAt: seoulNow(),
    meetings: meetRes.meetings, meetingExceptions: meetRes.exceptions, announcements: annRes.rows,
    teams: activeCodes(teamsRes.teams), levelLabels,
  })
  const meta = FORMATS[format]

  // ── AI 코멘트 슬라이드(ai=1, pptx 전용) — LLM 0콜: 캐시된 주간 브리핑을 읽기만 한다.
  // 신선도는 팩트 해시 재계산으로 서버가 최종 판정 — stale 캐시로 조용한 구식 코멘트 PPT 를
  // 만드는 대신 409 로 정직하게 실패한다(UI 체크박스는 평시 게이트일 뿐, URL 직접 호출 방어).
  // loadProjectFacts 가 WBS 를 한 번 더 읽지만 온디맨드 다운로드 경로라 수용(코드 단일화 우선).
  let extra: ExtraNarrativeSlide | undefined
  if (format === 'pptx' && req.nextUrl.searchParams.get('ai') === '1') {
    let src: Awaited<ReturnType<typeof loadProjectFacts>>
    try {
      src = await loadProjectFacts(projectId)
    } catch (e) {
      // 근거 로더는 조회 실패(진척 이력·회의·팀)를 throw 로 올린다 — 명단·공지·회의처럼 503 으로 사유를 돌려준다.
      console.error('[report] AI 브리핑 근거 조회 실패:', { projectId }, e)
      return NextResponse.json({ error: 'AI 브리핑 근거를 불러오지 못했습니다.' }, { status: 503 })
    }
    const facts = src ? buildBriefFacts(src) : null
    const row = facts ? await getAiBrief(projectId, 'weekly', facts.todayWbs) : null
    const fresh = !!row && !!facts && row.status === 'ready' && row.inputHash === briefFactsHash(facts)
    if (!fresh || !row) {
      return NextResponse.json(
        { error: 'AI 브리핑이 없거나 최신이 아닙니다. 리포트 화면의 AI 브리핑 생성 버튼으로 먼저 생성하세요.' },
        { status: 409 },
      )
    }
    extra = briefToExtraSlide(
      { headline: row.headline, bodyMd: row.bodyMd },
      row.updatedAt ? seoulStamp(row.updatedAt) : seoulNow(),
    )
  }

  // pptx는 번들된 템플릿(.pptx)의 slide2 표 셀만 교체 — 내용이 넘치면 동일 디자인의 연속 슬라이드 추가.
  const body = format === 'xlsx'
    ? await buildReportWorkbook(model, (await loadDisplayBranding(cfgRes.cfg.workspaceId)).productName)
    : await fillWeeklyTemplate(buildWeeklyNarrative(model), model, extra ? { extra } : {})

  // 파일명: {프로젝트명}_{월기준 몇째주}_{기준일} (예: 샘플 프로젝트_7월1주차_2026-07-04)
  const filename = `${project.name}_${model.meta.weekTag}_${today}.${meta.ext}`.replace(/[^\w가-힣.\-]+/g, '_')

  return new NextResponse(body as ArrayBuffer, {
    headers: {
      'Content-Type': meta.type,
      'Content-Disposition': `attachment; filename="report.${meta.ext}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Cache-Control': 'no-store',
    },
  })
}
