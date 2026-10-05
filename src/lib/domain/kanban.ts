import type { ComputedItem, Status, TeamCode } from '@/lib/domain/types'
import { teamSlotFor, type TeamColorRef } from '@/lib/domain/teamColor'
import {
  STAGE_LABEL_KO, STAGE_NONE_LABEL_KO,
} from '@/lib/domain/stageLabels'
import {
  type ApprovalStepDef, DEFAULT_APPROVAL_STEPS,
} from '@/lib/domain/approvalSteps'

/** 칸반 컬럼 — leaf(말단) 작업 카드 묶음. */
export type KanbanColumn = {
  key: string
  title: string
  count: number
  cards: ComputedItem[]
  accentDot?: string
  subtitle?: string
}

const STATUS_ORDER: Status[] = ['not_started', 'in_progress', 'delayed', 'done']

// 순수 도메인 모듈 — JSX(shared.tsx)에 의존하지 않도록 표현 메타를 로컬로 둔다(팀 색은 순수 모듈 teamColor).
const STATUS_LABEL: Record<Status, string> = {
  not_started: '시작전', in_progress: '진행중', delayed: '지연', done: '완료',
}
const STATUS_DOT: Record<Status, string> = {
  not_started: 'bg-pending', in_progress: 'bg-progress', delayed: 'bg-delayed', done: 'bg-done',
}

/** 말단(자식 없는) 노드 수집 — pure. */
function leavesOf(items: ComputedItem[]): ComputedItem[] {
  const out: ComputedItem[] = []
  const walk = (ns: ComputedItem[]) => ns.forEach(n => { if (!n.children.length) out.push(n); walk(n.children) })
  walk(items)
  return out
}

/** Phase별 — 최상위 phase(root) 1개당 컬럼 1개, 카드 = 해당 phase의 말단 작업들. */
export function groupByPhase(items: ComputedItem[]): KanbanColumn[] {
  return items.map(root => {
    const cards = leavesOf([root])
    return { key: root.id, title: root.name, count: cards.length, cards, accentDot: STATUS_DOT[root.status] }
  })
}

/** 담당자별 — 활성 팀 컬럼 + 미배정. leaf는 primary 담당팀마다 들어가고,
 *  primary가 없거나 전부 컬럼 밖 팀(비활성 등)이면 미배정으로 흡수한다(카드 유실 금지).
 *  colorTeams = 화면 색 슬롯을 정할 팀(SP4 D3 — 화면은 그 범위의 활성 팀, 봇 도구는 넘기지 않는다 = 중립) */
export function groupByOwner(items: ComputedItem[], teams: readonly TeamCode[], colorTeams: readonly TeamColorRef[] = []): KanbanColumn[] {
  const leaves = leavesOf(items)
  const buckets: Record<string, ComputedItem[]> = { 미배정: [] }
  for (const team of teams) buckets[team] = []
  for (const leaf of leaves) {
    const primaries = [...new Set(leaf.owners.filter(o => o.kind === 'primary').map(o => o.team))]
    const known = primaries.filter(t => t in buckets)
    if (known.length === 0) buckets['미배정'].push(leaf)
    else known.forEach(team => buckets[team].push(leaf))
  }
  const cols: KanbanColumn[] = teams.map(team => ({
    key: team, title: team, count: buckets[team].length, cards: buckets[team], accentDot: teamSlotFor(team, colorTeams).bar,
  }))
  cols.push({ key: '미배정', title: '미배정', count: buckets['미배정'].length, cards: buckets['미배정'], accentDot: 'bg-pending' })
  return cols
}

/** 상태별 — 시작전/진행중/지연/완료. leaf.status 기준. (상태는 계산값) */
export function groupByStatus(items: ComputedItem[]): KanbanColumn[] {
  const leaves = leavesOf(items)
  return STATUS_ORDER.map(status => {
    const cards = leaves.filter(leaf => leaf.status === status)
    return { key: status, title: STATUS_LABEL[status], count: cards.length, cards, accentDot: STATUS_DOT[status] }
  })
}

/** 진척 버킷 키(파생 status 아님 — 원시 실적% 기준). */
export type ProgressBucket = 'not_started' | 'in_progress' | 'done'

/** 실적% → 버킷. 0·null·음수=시작전, 100 이상=완료, 그 사이=진행중. */
export function bucketOf(pct: number | null): ProgressBucket {
  const v = pct ?? 0
  if (v <= 0) return 'not_started'
  if (v >= 100) return 'done'
  return 'in_progress'
}

const PROGRESS_ORDER: ProgressBucket[] = ['not_started', 'in_progress', 'done']
const PROGRESS_LABEL: Record<ProgressBucket, string> = {
  not_started: '시작전', in_progress: '진행중', done: '완료',
}
const PROGRESS_DOT: Record<ProgressBucket, string> = {
  not_started: 'bg-pending', in_progress: 'bg-progress', done: 'bg-done',
}

/** 진척 3단 — 시작전(0%)/진행중(1~99%)/완료(100%). leaf.rolledActualPct 기준. */
export function groupByProgress(items: ComputedItem[]): KanbanColumn[] {
  const leaves = leavesOf(items)
  return PROGRESS_ORDER.map(bucket => {
    const cards = leaves.filter(leaf => bucketOf(leaf.rolledActualPct) === bucket)
    return { key: bucket, title: PROGRESS_LABEL[bucket], count: cards.length, cards, accentDot: PROGRESS_DOT[bucket] }
  })
}

export const FLOW_STAGE_KEYS = ['none', 'as', 'ip', 'im', 'xx'] as const
export type FlowStageKey = (typeof FLOW_STAGE_KEYS)[number]

const FLOW_STAGE_DOT: Record<FlowStageKey, string> = {
  none: 'bg-pending',
  as: 'bg-brand',
  ip: 'bg-progress',
  im: 'bg-warning',
  xx: 'bg-done',
}

export function formatApprovalStepsSubtitle(steps?: readonly ApprovalStepDef[] | null): string {
  if (!steps || steps.length === 0) return '1단계 승인 (검토)'
  const stepNames = steps.map((s, i) => s.label || (s.code === 'review' ? '검토' : `${i + 1}단계`)).join(' → ')
  return `${steps.length}단계 승인 (${stepNames})`
}

/** 흐름별 — 5단계: 미착수(none), 할당됨(as), 작업 중(ip), 검수 대기(im), 완료(xx). */
export function groupByFlow(
  items: ComputedItem[],
  stageLabels?: Readonly<Partial<Record<string, string>>> | null,
  approvalSteps?: readonly ApprovalStepDef[] | null,
): KanbanColumn[] {
  const leaves = leavesOf(items)
  const buckets: Record<FlowStageKey, ComputedItem[]> = {
    none: [], as: [], ip: [], im: [], xx: [],
  }
  for (const leaf of leaves) {
    const s = leaf.stage
    if (s === 'as') buckets.as.push(leaf)
    else if (s === 'ip') buckets.ip.push(leaf)
    else if (s === 'im') buckets.im.push(leaf)
    else if (s === 'xx') buckets.xx.push(leaf)
    else buckets.none.push(leaf)
  }

  const defaultTitles: Record<FlowStageKey, string> = {
    none: STAGE_NONE_LABEL_KO,
    as: STAGE_LABEL_KO.as,
    ip: STAGE_LABEL_KO.ip,
    im: STAGE_LABEL_KO.im,
    xx: STAGE_LABEL_KO.xx,
  }

  return FLOW_STAGE_KEYS.map(key => {
    const title = stageLabels?.[key] || defaultTitles[key]
    const cards = buckets[key]
    const col: KanbanColumn = {
      key,
      title,
      count: cards.length,
      cards,
      accentDot: FLOW_STAGE_DOT[key],
    }
    if (key === 'im') {
      col.subtitle = formatApprovalStepsSubtitle(approvalSteps ?? DEFAULT_APPROVAL_STEPS)
    }
    return col
  })
}

/** 리프 id → 조상 이름 배열(루트→부모 순, 카드 breadcrumb 용). */
export function leafPaths(items: ComputedItem[]): Map<string, string[]> {
  const map = new Map<string, string[]>()
  const walk = (ns: ComputedItem[], path: string[]) => {
    for (const n of ns) {
      if (!n.children.length) map.set(n.id, path)
      else walk(n.children, [...path, n.name])
    }
  }
  walk(items, [])
  return map
}

/** 두 'YYYY-MM-DD' 사이 캘린더 일수(to - from). 칸반 마감신호 전용(자기완결). */
function dayDiff(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  return Math.round((b - a) / 86400000)
}

export type DueSignal =
  | { kind: 'overdue'; days: number }
  | { kind: 'due'; days: number }
  | null

/** 마감 신호(순수). 완료면 없음, 기한 경과+미완=overdue, 그 외=due(남은 일수). today·plannedEnd는 'YYYY-MM-DD'. */
export function dueSignal(plannedEnd: string | null, cur: number, today: string): DueSignal {
  if (!plannedEnd || cur >= 100) return null
  const d = dayDiff(today, plannedEnd)
  return d < 0 ? { kind: 'overdue', days: -d } : { kind: 'due', days: d }
}

/**
 * 렌즈: 'myTeam'=담당 팀(primary/support)이 내 팀 중 하나라도 걸리는 리프만, 'all'=전체.
 * 내 팀은 이 프로젝트 명단의 팀 전부(한 사람 여러 팀 — 0003). 팀이 없으면 전체.
 */
export function lensCards(leaves: ComputedItem[], lens: 'myTeam' | 'all', myTeams: readonly string[]): ComputedItem[] {
  if (lens === 'all' || myTeams.length === 0) return leaves
  const mine = new Set(myTeams)
  return leaves.filter(leaf => leaf.owners.some(o => mine.has(o.team)))
}

export interface QuickFilters {
  overdue: boolean
  dueThisWeek: boolean
  inProgress: boolean
  notStarted: boolean
}

/**
 * 빠른 필터 — 다중 선택. 서로 다른 갈래끼리는 AND, 같은 갈래 안에서는 OR(패싯 검색과 같은 규칙).
 * overdue=파생 지연, dueThisWeek=오늘~+6일 마감, inProgress·notStarted=실적% 버킷(한 갈래).
 * 버킷을 AND로 묶으면 '진행중+미착수'가 서로 배타적이라 결과가 항상 0건이 된다 — 켤 수는 있는데
 * 보드가 비어버리는 막다른 조합이 생기므로, 같은 갈래는 합집합으로 본다.
 */
export function applyQuickFilters(leaves: ComputedItem[], f: QuickFilters, today: string): ComputedItem[] {
  const buckets: ProgressBucket[] = []
  if (f.inProgress) buckets.push('in_progress')
  if (f.notStarted) buckets.push('not_started')
  return leaves.filter(leaf => {
    if (f.overdue && leaf.status !== 'delayed') return false
    if (buckets.length > 0 && !buckets.includes(bucketOf(leaf.rolledActualPct))) return false
    if (f.dueThisWeek) {
      if (!leaf.plannedEnd) return false
      const d = dayDiff(today, leaf.plannedEnd)
      if (d < 0 || d > 6) return false
    }
    return true
  })
}

/** 정렬(원본 불변): 지연 우선 → 계획종료 오름차순(null 뒤) → 이름(ko). */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- today는 시그니처 일관성용(현재 미사용)
export function sortCards(cards: ComputedItem[], _today: string): ComputedItem[] {
  return [...cards].sort((a, b) => {
    const ad = a.status === 'delayed' ? 0 : 1
    const bd = b.status === 'delayed' ? 0 : 1
    if (ad !== bd) return ad - bd
    if (a.plannedEnd !== b.plannedEnd) {
      if (!a.plannedEnd) return 1
      if (!b.plannedEnd) return -1
      return a.plannedEnd < b.plannedEnd ? -1 : 1
    }
    return a.name.localeCompare(b.name, 'ko')
  })
}
