import type { WeeklyColumn } from '@/lib/domain/weeklyColumns'
import { weeklyField } from '@/lib/domain/weeklySheet'
/**
 * 주간 카탈로그 객체 (정본 §4.5.1·§4.5.4).
 * 모델·서술·시트는 루트가 있을 때만 채운다. 없는 루트는 빈 값이다.
 */
import { isoDowOf, nextWeekKey, prevWeekKey, weekDisplayDays, weekLabelOf, type WorkCalendar } from '@/lib/domain/calendar'
import type { FieldValue } from '@/lib/domain/customFields'
import { weightToPct } from '@/lib/domain/format'
import type { Status } from '@/lib/domain/types'
import { ALL_CELLS, hasContent, orderAreas, type WeeklyArea, type WeeklyCells, type WeeklySheetRow } from '@/lib/domain/weeklySheet'
import { cellLines, sheetLineText } from '../sheetNarrative'
import { subLineText } from '../xml'
import type { ExtraNarrativeSlide } from '../aiComment'
import type { NarrativeGroup, NarrativeModel } from '../narrative'
import type { LeaveRow, WeeklyReportModel } from '../weekly'
import type {
  WeeklyCatalogAiCommentItem,
  WeeklyCatalogModel,
  WeeklyCatalogSection,
  WeeklyCatalogTask,
  WeeklyCatalogLeaveItem,
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
  columns?: readonly WeeklyColumn[],
): WeeklyCatalogSection[] {
  if (columns) {
    const base = weeklyCatalogSections(rows, areas, fieldKeys)
    return base.flatMap(section => columns.map(column => {
      const area = areas.find(a => a.code === section.code)!
      const own = rows.filter(r => r.areaId === area.id)
      return { ...section, name: `${section.name} · ${column.label}`,
        this_content: joined(own, weeklyField(`this_${column.id}`), false),
        next_content: joined(own, weeklyField(`next_${column.id}`), false),
        this_issue: [], next_issue: [],
      }
    }))
  }
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

/** 업무 건 나누기용 줄 — 빈 줄 경계는 남기고(연속 빈 줄은 하나), 탭은 공백 넷, 사람이 적은 들여쓰기는 그대로 */
function rawLines(text: string): string[] {
  return cellLines(text.replace(/\t/g, '    '))
}

/** 건의 시작 줄 — 들여쓰기 한 칸 이하에서 "[" 로 시작하는 줄("[생산계획] …") */
function isTitleLine(line: string): boolean {
  return /^\s?\[/.test(line)
}

/** 빈 줄 또는 "[분류] 제목" 줄에서 건을 나눈다. 앞뒤 빈 줄은 버린다. */
export function splitTaskBlocks(text: string): string[][] {
  const blocks: string[][] = []
  let block: string[] = []
  const flush = () => {
    while (block.length && block[block.length - 1].trim() === '') block.pop()
    if (block.length) blocks.push(block)
    block = []
  }
  for (const line of rawLines(text)) {
    if (line.trim() === '') { flush(); continue }
    if (isTitleLine(line) && block.length) flush()
    block.push(line)
  }
  flush()
  return blocks
}

const titleKey = (block: readonly string[]): string => (block[0] ?? '').replace(/\s+/g, ' ').trim()

function tagged(block: readonly string[], area: string): string[] {
  if (!block.length || block[0].trimStart().startsWith('[')) return [...block]
  return [`[${area}] ${block[0].trimStart()}`, ...block.slice(1)]
}

/**
 * 영역 글을 업무 건으로 나눠 금주·차주를 묶는다 — 같은 제목(첫 줄)의 금주 건과 차주 건이 한 항목이고,
 * 짝이 없는 금주 건은 차주가 비고, 짝이 없는 차주 건은 그 영역의 끝에 금주 없이 붙는다. 글이 없는 영역은 건이 없다.
 * 작성 항목(weekly.columns)이 있으면 첫 항목의 칸을 쓴다(sections 의 "영역 · 항목" 과 달리 건은 항목으로 늘리지 않는다).
 */
export function weeklyCatalogTasks(
  rows: readonly WeeklySheetRow[],
  areas: readonly WeeklyArea[],
  columns?: readonly WeeklyColumn[],
): WeeklyCatalogTask[] {
  const first = columns?.[0]
  const thisField = first ? weeklyField(`this_${first.id}`) : 'thisContent'
  const nextField = first ? weeklyField(`next_${first.id}`) : 'nextContent'
  const text = (own: readonly WeeklySheetRow[], field: keyof WeeklyCells) =>
    own.map((row) => String(row[field] ?? '')).filter((value) => value.trim() !== '').join('\n\n')
  const ordered = orderAreas(areas)
  const out: WeeklyCatalogTask[] = []
  for (const area of ordered) {
    const own = rows.filter((row) => row.areaId === area.id)
    const thisBlocks = splitTaskBlocks(text(own, thisField))
    const nextBlocks = splitTaskBlocks(text(own, nextField))
    if (!area.active && !thisBlocks.length && !nextBlocks.length) continue
    const used = new Set<number>()
    const push = (thisBlock: string[], nextBlock: string[]) => out.push({
      code: area.code,
      area: area.name,
      title: titleKey(thisBlock.length ? thisBlock : nextBlock),
      this_content: thisBlock,
      next_content: nextBlock,
      this_tagged: tagged(thisBlock, area.name),
      next_tagged: tagged(nextBlock, area.name),
    })
    for (const block of thisBlocks) {
      const key = titleKey(block)
      const match = nextBlocks.findIndex((candidate, index) => !used.has(index) && titleKey(candidate) === key)
      if (match >= 0) used.add(match)
      push(block, match >= 0 ? nextBlocks[match] : [])
    }
    nextBlocks.forEach((block, index) => { if (!used.has(index)) push([], block) })
  }
  return out
}

const pad2 = (n: string) => n.padStart(2, '0')
/** 'YYYY-MM-DD' 표시 요일 목록 → 'YYYY.MM.DD~YYYY.MM.DD' · 'MM/DD~MM/DD'. 비면 '' */
function ranges(days: readonly string[]): { ymd: string; mmdd: string } {
  if (!days.length) return { ymd: '', mmdd: '' }
  const [a, b] = [days[0], days[days.length - 1]].map((d) => d.split('-'))
  return {
    ymd: `${a[0]}.${pad2(a[1])}.${pad2(a[2])}~${b[0]}.${pad2(b[1])}.${pad2(b[2])}`,
    mmdd: `${pad2(a[1])}/${pad2(a[2])}~${pad2(b[1])}/${pad2(b[2])}`,
  }
}

/** 표시 요일 칸의 날짜(일) — 'week_day1'…'week_day7' 꼴로, 칸이 모자라면 '' */
type DayKey<P extends string> = `${P}${1 | 2 | 3 | 4 | 5 | 6 | 7}`
function dayFields<P extends 'week_day' | 'next_week_day'>(prefix: P, days: readonly string[]): Record<DayKey<P>, string> {
  return Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((n) => [`${prefix}${n}`, days[n - 1] ? String(Number(days[n - 1].slice(8, 10))) : ''])) as Record<DayKey<P>, string>
}

/** 날짜 목록 → '10/07', '10/12 ~ 14', '10/30 ~ 11/02' — 표시 요일에서 이어진 날은 묶는다 */
export function leaveDatesText(dates: readonly string[], days: readonly string[]): string {
  const idx = dates.map((d) => days.indexOf(d)).filter((i) => i >= 0).sort((a, b) => a - b)
  const runs: number[][] = []
  for (const i of idx) {
    const last = runs[runs.length - 1]
    if (last && last[last.length - 1] === i - 1) last.push(i)
    else runs.push([i])
  }
  const md = (d: string) => `${d.slice(5, 7)}/${d.slice(8, 10)}`
  return runs.map((run) => {
    const a = days[run[0]]
    const b = days[run[run.length - 1]]
    if (a === b) return md(a)
    return a.slice(5, 7) === b.slice(5, 7) ? `${md(a)} ~ ${b.slice(8, 10)}` : `${md(a)} ~ ${md(b)}`
  }).join(', ')
}

function leaveItems(rows: readonly LeaveRow[], days: readonly string[]): WeeklyCatalogLeaveItem[] {
  return rows.map((row) => {
    const cells = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((n) => [`d${n}`, row.perDay[n - 1] ? row.typeShort : '']))
    return {
      team: row.team, kind: row.typeLabel, member: row.memberName, title: row.title,
      dates: leaveDatesText(row.dates, days), note: '', ...cells,
    } as WeeklyCatalogLeaveItem
  })
}

/** '김민준 매니저(연차 10/27), 최진혁(반차 10/28 ~ 29)' — 사람이 휴가 표 첫 줄에 적던 꼴 */
function leaveSummary(rows: readonly LeaveRow[], days: readonly string[]): string {
  return rows.map((row) => `${row.memberName}${row.title ? ` ${row.title}` : ''}(${row.typeLabel} ${leaveDatesText(row.dates, days)})`).join(', ')
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
  tasks?: WeeklyCatalogTask[]
  aiComment?: WeeklyCatalogAiCommentItem[]
}): WeeklyCatalogModel {
  const model = input.model
  const narrative = input.narrative
  const label = model && input.calendar ? weekLabelOf(input.calendar.weekStart, model.meta.weekStart) : null
  const cal = input.calendar
  const thisR = model ? ranges(model.meta.weekDays) : ranges([])
  const nextR = model && cal ? ranges(weekDisplayDays(cal, nextWeekKey(cal.weekStart, model.meta.weekStart))) : ranges([])
  const prevR = model && cal ? ranges(weekDisplayDays(cal, prevWeekKey(cal.weekStart, model.meta.weekStart))) : ranges([])
  const emptyReport = {
    project_name: '', week_label: '', week_tag: '', week_year: 0, week_month: 0, week_ordinal: 0,
    week_end: '', week_days: [], week_range: '', prev_week_range: '', next_week_range: '',
    week_range_ymd: '', prev_week_range_ymd: '', next_week_range_ymd: '',
    week_range_mmdd: '', prev_week_range_mmdd: '', next_week_range_mmdd: '',
    ...dayFields('week_day', []), ...dayFields('next_week_day', []),
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
      week_range_ymd: thisR.ymd, prev_week_range_ymd: prevR.ymd, next_week_range_ymd: nextR.ymd,
      week_range_mmdd: thisR.mmdd, prev_week_range_mmdd: prevR.mmdd, next_week_range_mmdd: nextR.mmdd,
      ...dayFields('week_day', model.meta.weekDays), ...dayFields('next_week_day', model.meta.nextWeekDays ?? []),
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
    tasks: input.tasks ?? [],
    leaves: {
      this_week: model ? leaveItems(model.leaves?.thisWeek ?? [], model.meta.weekDays) : [],
      next_week: model ? leaveItems(model.leaves?.nextWeek ?? [], model.meta.nextWeekDays ?? []) : [],
      this_week_summary: model ? leaveSummary(model.leaves?.thisWeek ?? [], model.meta.weekDays) : '',
      next_week_summary: model ? leaveSummary(model.leaves?.nextWeek ?? [], model.meta.nextWeekDays ?? []) : '',
    },
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
