/**
 * 주간 카탈로그 객체 (정본 §4.5.1·§4.5.4).
 * 모델·서술·시트는 루트가 있을 때만 채운다. 없는 루트는 빈 값이다.
 */
import { isoDowOf, weekLabelOf, type WorkCalendar } from '@/lib/domain/calendar'
import type { FieldValue } from '@/lib/domain/customFields'
import { weightToPct } from '@/lib/domain/format'
import type { Status } from '@/lib/domain/types'
import { ALL_CELLS, hasContent, orderAreas, type WeeklyArea, type WeeklyCells, type WeeklySheetRow } from '@/lib/domain/weeklySheet'
import { cellLines, sheetLineText } from '../sheetNarrative'
import { subLineText } from '../xml'
import type { ExtraNarrativeSlide } from '../aiComment'
import type { NarrativeGroup, NarrativeModel } from '../narrative'
import type { WeeklyReportModel } from '../weekly'
import type {
  WeeklyCatalogAiCommentItem,
  WeeklyCatalogModel,
  WeeklyCatalogSection,
} from './types'

const STATUS_LABEL: Record<Status, string> = {
  not_started: '시작전', in_progress: '진행중', delayed: '지연', done: '완료',
}

function textLines(text: string, dropBlank: boolean): string[] {
  const lines = cellLines(text)
  return (dropBlank ? lines.filter((line) => line.trim() !== '') : lines)
    .map((line) => (line.trim() === '' ? '' : sheetLineText(line)))
}

function joined(rows: readonly WeeklySheetRow[], field: keyof WeeklyCells, dropBlank: boolean): string[] {
  const parts = rows.map((row) => textLines(row[field] ?? '', dropBlank)).filter((part) => part.length > 0)
  const out: string[] = []
  parts.forEach((part, index) => {
    if (index > 0) out.push('')
    out.push(...part)
  })
  return out
}

function customCell(value: FieldValue | undefined): string {
  if (value == null) return ''
  return Array.isArray(value) ? value.map(String).join('\n') : String(value)
}

/** 활성 구분 전부(빈 구분 포함) 뒤에, 내용이 있는 비활성 구분을 sort_order 순으로 붙인다. */
export function weeklyCatalogSections(
  rows: readonly WeeklySheetRow[],
  areas: readonly WeeklyArea[],
  fieldKeys: readonly string[],
): WeeklyCatalogSection[] {
  const ordered = orderAreas(areas)
  const active = ordered.filter((area) => area.active)
  const inactive = ordered.filter((area) => !area.active && rows.some((row) => row.areaId === area.id && hasContent(row, ALL_CELLS)))
  return [...active, ...inactive].map((area) => {
    const own = rows.filter((row) => row.areaId === area.id)
    const custom: Record<string, string[]> = {}
    for (const key of fieldKeys) custom[key] = own.map((row) => customCell(row.custom?.[key]))
    return {
      code: area.code,
      name: area.name,
      this_content: joined(own, 'thisContent', false),
      next_content: joined(own, 'nextContent', false),
      this_issue: joined(own, 'thisIssue', true),
      next_issue: joined(own, 'nextIssue', true),
      custom,
    }
  })
}

function groupsOf(groups: NarrativeGroup[]): WeeklyCatalogModel['wbs_groups']['curr'] {
  return groups.map((group) => ({ title: group.phase, num: group.num, lines: group.items.map(subLineText) }))
}

export function aiCommentItem(extra: ExtraNarrativeSlide): WeeklyCatalogAiCommentItem {
  const side = (cell: ExtraNarrativeSlide['left']) => cell.groups.map((group) => ({ title: group.phase, lines: group.items }))
  return {
    left_title: extra.left.title,
    right_title: extra.right.title,
    left: side(extra.left),
    right: side(extra.right),
  }
}

export function buildWeeklyCatalog(input: {
  model?: WeeklyReportModel
  narrative?: NarrativeModel
  calendar?: WorkCalendar
  sections?: WeeklyCatalogSection[]
  aiComment?: WeeklyCatalogAiCommentItem[]
}): WeeklyCatalogModel {
  const model = input.model
  const narrative = input.narrative
  const label = model && input.calendar ? weekLabelOf(input.calendar.weekStart, model.meta.weekStart) : null
  const emptyReport = {
    project_name: '', week_label: '', week_tag: '', week_year: 0, week_month: 0, week_ordinal: 0,
    week_end: '', week_days: [], week_range: '', prev_week_range: '', next_week_range: '',
    week_start: '', today: '', generated_at: '', description: '',
  }
  return {
    report: model ? {
      project_name: model.meta.projectName,
      week_label: model.meta.weekLabel,
      week_tag: model.meta.weekTag,
      week_year: label?.year ?? 0,
      week_month: label?.month ?? 0,
      week_ordinal: label?.ordinal ?? 0,
      week_end: model.meta.weekEnd,
      week_days: model.meta.weekDays.map((date) => ({ date, dow: isoDowOf(date) })),
      week_range: model.meta.weekRange,
      prev_week_range: model.meta.prevWeekRange,
      next_week_range: model.meta.nextWeekRange,
      week_start: model.meta.weekStart,
      today: model.meta.today,
      generated_at: model.meta.generatedAt,
      description: model.meta.description ?? '',
    } : emptyReport,
    kpi: model ? {
      plan: model.kpi.planned,
      actual: model.kpi.actual,
      variance: model.kpi.variance,
      total: model.kpi.total,
      done: model.kpi.done,
      in_progress: model.kpi.inProgress,
      not_started: model.kpi.notStarted,
      delayed: model.kpi.delayed,
      done_this_week: model.kpi.doneThisWeek,
      done_ratio: model.kpi.doneRatio,
      in_progress_ratio: model.kpi.inProgressRatio,
      delayed_ratio: model.kpi.delayedRatio,
      phase_count: model.meta.phaseCount,
      total_leaves: model.meta.totalLeaves,
    } : {
      plan: 0, actual: 0, variance: 0, total: 0, done: 0, in_progress: 0, not_started: 0, delayed: 0,
      done_this_week: 0, done_ratio: 0, in_progress_ratio: 0, delayed_ratio: 0, phase_count: 0, total_leaves: 0,
    },
    sections: input.sections ?? [],
    wbs_groups: {
      prev: narrative ? groupsOf(narrative.prev) : [],
      curr: narrative ? groupsOf(narrative.curr) : [],
    },
    issues: narrative?.issues ?? [],
    issues_detail: model ? model.issues.map((issue) => ({ grade: issue.grade, content: issue.content, action: issue.action })) : [],
    events: narrative?.events ?? [],
    meetings: model ? {
      this_week: model.meetings.thisWeek.map(meetingOf),
      next_week: model.meetings.nextWeek.map(meetingOf),
      total: model.meetings.total,
    } : { this_week: [], next_week: [], total: 0 },
    announcements: model ? {
      prev_week: model.announcements.prevWeek.map((row) => ({ date: row.date, title: row.title })),
      this_week: model.announcements.thisWeek.map((row) => ({ date: row.date, title: row.title })),
    } : { prev_week: [], this_week: [] },
    attendance: model ? {
      this_week: model.attendance.thisWeek.map(attendanceOf),
      next_week: model.attendance.nextWeek.map(attendanceOf),
    } : { this_week: [], next_week: [] },
    phases: model ? model.phases.map((phase) => ({
      name: phase.name,
      weight_pct: phase.weightPct,
      planned_pct: phase.plannedPct,
      actual_pct: phase.actualPct,
      gap: phase.gap,
      done_count: phase.doneCount,
      total_count: phase.totalCount,
      delayed_count: phase.delayedCount,
      status: phase.status,
      status_label: STATUS_LABEL[phase.status],
    })) : [],
    plan_actual: model ? model.planActual.map((phase) => ({
      phase_name: phase.phaseName,
      planned_pct: phase.plannedPct,
      actual_pct: phase.actualPct,
      prev_week: phase.prevWeek.map(taskOf),
      this_week: phase.thisWeek.map(taskOf),
      next_week: phase.nextWeek.map(taskOf),
    })) : [],
    workload: model ? model.workload.map((row) => ({
      name: row.name, per_day: row.perDay, total: row.total, note: row.note,
    })) : [],
    wbs_rows: model ? model.wbs.map((row) => ({
      no: row.no,
      level_label: row.levelLabel,
      depth: row.depth,
      name: row.name,
      deliverable: row.deliverable,
      owner_text: row.ownerText,
      weight_pct: row.weight == null ? null : weightToPct(row.weight),
      planned_start: row.plannedStart ?? '',
      planned_end: row.plannedEnd ?? '',
      planned_pct: row.plannedPct,
      actual_pct: row.actualPct,
      gap: row.gap,
      delay_days: row.delayDays,
      status: row.status,
      status_label: STATUS_LABEL[row.status],
    })) : [],
    ai_comment: input.aiComment ?? [],
  }
}

function meetingOf(row: WeeklyReportModel['meetings']['thisWeek'][number]) {
  return {
    date: row.date, date_iso: row.dateIso, time: row.time, title: row.title,
    location: row.location, attendee_count: row.attendeeCount,
  }
}

function attendanceOf(row: WeeklyReportModel['attendance']['thisWeek'][number]) {
  return { member_name: row.memberName, per_day: row.perDay.map((cell) => cell ?? ''), count: row.count }
}

function taskOf(row: WeeklyReportModel['planActual'][number]['thisWeek'][number]) {
  return { name: row.name, owner_text: row.ownerText, status_label: STATUS_LABEL[row.status], actual_pct: row.actualPct }
}
