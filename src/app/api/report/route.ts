import { NextRequest, NextResponse } from 'next/server'
import { requireProjectMember } from '@/lib/authz'
import { denyStatus } from '@/lib/authz/errors'
import { configFailureResponse, jsonError } from '@/lib/api/http'
import { requireModule } from '@/lib/modules/gate'
import { getComputedWbs } from '@/lib/data/wbs'
import { getProjectRoster } from '@/lib/data/members'
import { getAttendanceRecords } from '@/lib/data/attendance'
import { getProjectMeetingData } from '@/lib/data/meetings'
import { getAnnouncements } from '@/lib/data/announcements'
import { getWeeklySheet } from '@/lib/data/weeklySheet'
import { buildWeeklyReportModel } from '@/lib/report/weekly'
import { buildWeeklyNarrative } from '@/lib/report/narrative'
import { briefToExtraSlide } from '@/lib/report/aiComment'
import { loadProjectFacts } from '@/lib/ai/projectFacts'
import { briefFactsHash, buildBriefFacts } from '@/lib/ai/brief'
import { getAiBrief } from '@/lib/data/aiBriefs'
import { projectTeams } from '@/lib/teams/source'
import { activeCodes } from '@/lib/domain/teams'
import { requireCalendar } from '@/lib/calendar/load'
import { isValidIsoDate } from '@/lib/domain/validate'
import { getProjectConfig } from '@/lib/settings/projectConfig'
import { valueOf, type ProjectSettingValue } from '@/lib/settings/registry'
import { stampIn } from '@/lib/domain/calendar'
import { engineFor } from '@/lib/report/engine'
import { scanFormTemplate } from '@/lib/report/engine/scan'
import { FORM_FORMAT, FormRenderError, formatLocation, type FormKind } from '@/lib/report/engine/types'
import { buildWeeklyCatalog, aiCommentItem, weeklyCatalogSections } from '@/lib/report/catalog/weeklyBuild'
import { FormTemplateLoadError, loadFormTemplate } from '@/lib/report/forms/loadTemplate'
import { loadReportProject } from '@/lib/report/forms/project'
import { catalogRoots, needsWeeklyModel } from '@/lib/report/forms/roots'
import { weeklyReference } from '@/lib/report/forms/reference'
import type { CatalogModel } from '@/lib/report/catalog/types'
import type { WeeklyReportModel } from '@/lib/report/weekly'
import { serverTranslator } from '@/lib/i18n/server'

// 양식 zip 읽기(fs·Storage)는 Node 전용.
export const runtime = 'nodejs'

const MIME = {
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
} as const

const AI_STALE = 'srv.api.report.aiBriefingMissingOutDate'

/**
 * 주간 양식 출력 (정본 §4.8). source 분기는 없다.
 * format 이 weekly_report_pptx|xlsx 를 고르고, 활성 양식 또는 기본 파일을 engine.render 한다.
 */
export async function GET(req: NextRequest) {
  const t = await serverTranslator()
  const projectId = req.nextUrl.searchParams.get('projectId')
  const format = req.nextUrl.searchParams.get('format')
  if (!projectId) return jsonError(t('err.projectMissing'), 400)
  if (format !== 'xlsx' && format !== 'pptx') return jsonError(t('srv.api.report.formatMustXlsxPptx'), 400)

  const guard = await requireProjectMember(projectId)
  if (!guard.ok) return jsonError(guard.error, denyStatus(guard.error))
  const mod = await requireModule({ projectId }, 'weekly')
  if (!mod.ok) return jsonError(mod.error, denyStatus(mod.error))

  const kind: FormKind = format === 'pptx' ? 'weekly_report_pptx' : 'weekly_report_xlsx'
  const weekRaw = req.nextUrl.searchParams.get('week')
  const ai = req.nextUrl.searchParams.get('ai') === '1'

  try {
    const cfg = await getProjectConfig(projectId)
    const setting = valueOf(cfg, format === 'pptx' ? 'forms.weekly_report_pptx' : 'forms.weekly_report_xlsx')
    const calendar = requireCalendar(cfg)
    const loaded = await loadFormTemplate(projectId, kind, setting.template_id)
    const scanned = await scanFormTemplate(loaded.bytes, FORM_FORMAT[kind])
    const roots = catalogRoots(scanned.placeholders, setting.mapping)
    const areas = cfg.areas.weekly_section
    if (weekRaw && (!/^\d{4}-\d{2}-\d{2}$/.test(weekRaw) || !isValidIsoDate(weekRaw))) {
      return jsonError(t('srv.api.report.weekYyyyMmDdRequired'), 400)
    }
    if (roots.has('sections') && areas.length === 0) return jsonError(t('srv.api.report.setupRequired'), 409)
    // week 가 없으면 프로젝트 달력의 이번 주다(weeklyReference). 화면의 요약 PPT·엑셀 버튼은 week 없이 부른다 — 예전엔 여기서 400 이라
    // 기본 양식(sections 자리표시자)으로는 그 버튼들이 받아지지 않았다.

    const project = await loadReportProject(projectId)
    if (!project) return jsonError(t('err.projectNotFound'), 404)

    const wantsModel = needsWeeklyModel(roots)
    const wbs = wantsModel || roots.has('sections') ? await getComputedWbs(projectId) : null
    const ref = wbs ? weeklyReference(calendar, wbs.today, weekRaw) : null

    let weeklyModel: WeeklyReportModel | undefined
    if (wantsModel && wbs) {
      const built = await loadWeeklyModel(projectId, cfg, project, ref!.today, wbs)
      if (!built.ok) return built.res
      weeklyModel = built.model
    }

    let sections: ReturnType<typeof weeklyCatalogSections> | undefined
    if (roots.has('sections')) {
      const sheet = await getWeeklySheet(projectId, ref!.weekStart)
      const fieldKeys = roots.has('custom') ? activeFieldKeys(valueOf(cfg, 'fields.weekly_row')) : []
      sections = weeklyCatalogSections(sheet?.rows ?? [], areas, fieldKeys)
    }

    let aiComment: ReturnType<typeof aiCommentItem>[] | undefined
    if (roots.has('ai_comment') && ai) {
      const fresh = await loadFreshBrief(projectId, calendar.timezone)
      if (!fresh.ok) return fresh.res
      aiComment = [aiCommentItem(fresh.extra)]
    }

    const model = buildWeeklyCatalog({
      model: weeklyModel,
      narrative: weeklyModel ? buildWeeklyNarrative(weeklyModel) : undefined,
      calendar,
      sections,
      aiComment,
    }) satisfies CatalogModel
    const body = await engineFor(format).render(loaded.bytes, model, setting.mapping, setting.options)
    const filename = reportFilename(project.name, weeklyModel, format)
    return new NextResponse(body as unknown as ArrayBuffer, {
      headers: {
        'Content-Type': MIME[format],
        'Content-Disposition': `attachment; filename="report.${format}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Cache-Control': 'no-store',
        'X-Form-Template': loaded.source,
      },
    })
  } catch (error) {
    if (error instanceof FormRenderError) {
      const location = error.location ? formatLocation(error.location) : undefined
      console.error('[report] 양식 렌더 실패', error.code, location, error.token, error.message)
      return NextResponse.json(
        { error: error.message, code: error.code, ...(location ? { location } : {}), ...(error.token ? { token: error.token } : {}) },
        { status: 422, headers: { 'Cache-Control': 'no-store' } },
      )
    }
    if (error instanceof FormTemplateLoadError) {
      console.error('[report] 양식 파일을 읽지 못했다', error.message)
      return jsonError(error.message, 500)
    }
    const failed = configFailureResponse(error, 'report')
    if (failed) return failed
    console.error('[report] 보고서 생성 실패', error instanceof Error ? error.message : error)
    return jsonError(t('srv.api.report.couldNotBuildReport'), 500)
  }
}

function activeFieldKeys(fields: ProjectSettingValue<'fields.weekly_row'>): string[] {
  return fields.filter((field) => field.active).sort((a, b) => a.sort - b.sort).map((field) => field.key)
}

function reportFilename(name: string, model: WeeklyReportModel | undefined, ext: 'pptx' | 'xlsx'): string {
  const tag = model ? `${model.meta.weekTag}_${model.meta.today}` : 'report'
  return `${name}_${tag}.${ext}`.replace(/[^\w가-힣.\-]+/g, '_')
}

async function loadWeeklyModel(
  projectId: string,
  cfg: Awaited<ReturnType<typeof getProjectConfig>>,
  project: { name: string; description: string | null; start_date: string | null; end_date: string | null },
  today: string,
  wbs: Awaited<ReturnType<typeof getComputedWbs>>,
): Promise<{ ok: true; model: WeeklyReportModel } | { ok: false; res: NextResponse }> {
  const t = await serverTranslator()
  const [roster, attendance, meetRes, annRes, teamsRes] = await Promise.all([
    getProjectRoster(projectId),
    getAttendanceRecords(projectId),
    getProjectMeetingData(projectId),
    getAnnouncements(projectId),
    projectTeams(projectId).then((teams) => ({ ok: true as const, teams }), (e: unknown) => ({ ok: false as const, e })),
  ])
  if (!teamsRes.ok) {
    console.error('[report] 프로젝트 팀 조회 실패:', { projectId }, teamsRes.e)
    return { ok: false, res: jsonError(t('err.couldNotVerifyProjectTeams'), 503) }
  }
  if (!roster.ok) {
    console.error(`[report] 명단 조회 실패로 보고서를 만들지 않는다: project=${projectId}`)
    return { ok: false, res: jsonError(roster.error, 503) }
  }
  if (!meetRes.ok) {
    console.error(`[report] 회의 조회 실패로 보고서를 만들지 않는다: project=${projectId}`)
    return { ok: false, res: jsonError(meetRes.error, 503) }
  }
  if (!annRes.ok) {
    console.error(`[report] 공지 조회 실패로 보고서를 만들지 않는다: project=${projectId}`)
    return { ok: false, res: jsonError(annRes.error, 503) }
  }
  let levelLabels: string[]
  let attendanceTypes: ProjectSettingValue<'attendance.types'>
  try {
    levelLabels = valueOf(cfg, 'core.level_labels')
    attendanceTypes = valueOf(cfg, 'attendance.types')
  } catch (error) {
    const failed = configFailureResponse(error, 'report')
    if (failed) return { ok: false, res: failed }
    throw error
  }
  const now = new Date()
  const model = buildWeeklyReportModel(wbs.items, project, today, {
    members: roster.rows,
    attendance,
    generatedAt: stampIn(wbs.calendar.timezone, now),
    meetings: meetRes.meetings,
    meetingExceptions: meetRes.exceptions,
    announcements: annRes.rows,
    teams: activeCodes(teamsRes.teams),
    levelLabels,
    calendar: wbs.calendar,
    attendanceTypes,
  })
  return { ok: true, model }
}

async function loadFreshBrief(
  projectId: string,
  timeZone: string,
): Promise<{ ok: true; extra: ReturnType<typeof briefToExtraSlide> } | { ok: false; res: NextResponse }> {
  const t = await serverTranslator()
  let src: Awaited<ReturnType<typeof loadProjectFacts>>
  try {
    src = await loadProjectFacts(projectId)
  } catch (error) {
    console.error('[report] AI 브리핑 근거 조회 실패:', { projectId }, error)
    return { ok: false, res: jsonError(t('srv.api.report.couldNotLoadAiBriefing'), 503) }
  }
  const facts = src ? buildBriefFacts(src) : null
  const row = facts ? await getAiBrief(projectId, 'weekly', facts.todayWbs) : null
  const fresh = !!row && !!facts && row.status === 'ready' && row.inputHash === briefFactsHash(facts)
  if (!fresh || !row) return { ok: false, res: jsonError(t(AI_STALE), 409) }
  const stamp = stampIn(timeZone, row.updatedAt || new Date())
  return { ok: true, extra: briefToExtraSlide({ headline: row.headline, bodyMd: row.bodyMd }, stamp) }
}

