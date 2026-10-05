/**
 * WBS 내보내기 카탈로그 (정본 §4.5.3·§4.5.4).
 * 로더는 getComputedWbs·getProjectConfig. kpi 는 주간 모델과 같은 정의(buildWeeklyReportModel).
 */
import type { FieldValue } from '@/lib/domain/customFields'
import { round1, weightToPct } from '@/lib/domain/format'
import type { WorkCalendar } from '@/lib/domain/calendar'
import type { Status, ComputedItem } from '@/lib/domain/types'
import { buildWeeklyReportModel } from '../weekly'
import type { WeeklyCatalogKpi, WbsExportCatalogItem, WbsExportCatalogModel } from './types'

const STATUS_LABEL: Record<Status, string> = {
  not_started: '시작전', in_progress: '진행중', delayed: '지연', done: '완료',
}

const EMPTY_KPI: WeeklyCatalogKpi = {
  plan: 0, actual: 0, variance: 0, total: 0, done: 0, in_progress: 0, not_started: 0, delayed: 0,
  done_this_week: 0, done_ratio: 0, in_progress_ratio: 0, delayed_ratio: 0, phase_count: 0, total_leaves: 0,
}

function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000)
}

function delayDays(node: ComputedItem, today: string): number {
  return node.status !== 'done' && node.plannedEnd && today > node.plannedEnd ? daysBetween(node.plannedEnd, today) : 0
}

/** 주간 WBS 플랫과 같은 담당 문구. */
function ownerText(owners: ComputedItem['owners']): string {
  if (!owners.length) return '-'
  const primary = owners.filter((owner) => owner.kind === 'primary').map((owner) => owner.team)
  const support = owners.filter((owner) => owner.kind === 'support').map((owner) => `(${owner.team})`)
  return [...primary, ...support].join(' ')
}

function customValue(value: FieldValue | undefined): string | string[] {
  if (value == null) return ''
  if (Array.isArray(value)) return value.map(String)
  return String(value)
}

function flatten(items: readonly ComputedItem[]): ComputedItem[] {
  const out: ComputedItem[] = []
  const walk = (node: ComputedItem) => {
    out.push(node)
    for (const child of node.children) walk(child)
  }
  for (const root of items) walk(root)
  return out
}

export function wbsExportKpi(items: readonly ComputedItem[], today: string, calendar: WorkCalendar, levelLabels: readonly string[]): WeeklyCatalogKpi {
  const model = buildWeeklyReportModel([...items], { name: '' }, today, {
    teams: [], calendar, levelLabels: [...levelLabels], meetings: [], announcements: [], attendance: [],
  })
  return {
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
  }
}

export function buildWbsExportCatalog(input: {
  project?: { name: string; start_date: string | null; end_date: string | null; levelLabels: readonly string[] }
  items?: readonly ComputedItem[]
  today?: string
  teams?: readonly { code: string; name: string; color: string }[]
  holidays?: readonly { date: string; name: string }[]
  kpi?: WeeklyCatalogKpi
  fieldKeys?: readonly string[]
}): WbsExportCatalogModel {
  const names = new Map((input.teams ?? []).map((team) => [team.code, team.name]))
  const labels = input.project?.levelLabels ?? []
  const today = input.today ?? ''
  const keys = input.fieldKeys ?? []
  let no = 0
  const wbs_items: WbsExportCatalogItem[] = input.items ? flatten(input.items).map((node) => {
    no += 1
    const custom: Record<string, string | string[]> = {}
    for (const key of keys) custom[key] = customValue(node.custom?.[key])
    return {
      no,
      depth: node.depth,
      level_label: labels[node.depth] ?? '',
      code: node.code,
      name: node.name,
      deliverable: node.deliverable ?? '',
      owner_text: ownerText(node.owners),
      owners: node.owners.map((owner) => ({
        team_code: owner.team,
        team_name: names.get(owner.team) ?? '',
        kind: owner.kind,
      })),
      weight_pct: node.weight == null ? null : weightToPct(node.weight),
      planned_pct: round1(node.plannedPct),
      actual_pct: round1(node.rolledActualPct),
      gap: round1(node.plannedPct - node.rolledActualPct),
      planned_start: node.plannedStart ?? '',
      planned_end: node.plannedEnd ?? '',
      delay_days: today ? delayDays(node, today) : 0,
      status: node.status,
      status_label: STATUS_LABEL[node.status],
      custom,
    }
  }) : []
  return {
    project: {
      name: input.project?.name ?? '',
      start_date: input.project?.start_date ?? '',
      end_date: input.project?.end_date ?? '',
      level_labels: [...labels],
    },
    wbs_items,
    teams: (input.teams ?? []).map((team) => ({ code: team.code, name: team.name, color: team.color })),
    holidays: [...(input.holidays ?? [])],
    kpi: input.kpi ?? EMPTY_KPI,
  }
}

