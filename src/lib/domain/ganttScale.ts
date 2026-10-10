/**
 * 간트 타임라인 스케일 계산 (순수 함수). WBS·간트 통합 시트와 전용 간트 뷰가 공유한다.
 * 입력은 계획 일자 목록(ISO 'YYYY-MM-DD')과 기준일·일당 픽셀. DB/DOM 의존 없음.
 */
import { isWorkingDay, weekKeyOf, type WeekStartRule } from './calendar'
import type { DayCal } from './progress'
import type { MilestonePoint, MilestoneStatus } from './dashboard'

export interface GanttScale {
  days: string[]
  rangeStart: string
  rangeEnd: string
  months: { ym: string; label: string; left: number; width: number }[]
  weeks: { label: string; sub: string; left: number; width: number }[]
  ganttW: number
  /** 날짜 → 타임라인 좌측 오프셋(px) */
  xOf: (date: string) => number
  /** 비근무일(요일 규칙·휴무 예외 — 특정일 근무는 근무일) */
  isOffDay: (date: string) => boolean
  /** 기준일 세로선 위치(px). 날짜 범위가 기준일을 항상 포함하므로 정상 입력이면 항상 존재한다. */
  todayX: number | null
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** 간트 주 머리의 한 칸 — 축의 날짜 배열에서 몇 번째 날부터 며칠인가 */
export interface GanttWeekSpan { label: string; sub: string; startIndex: number; length: number }

/**
 * 간트의 주 머리(W01·W02 …) — **프로젝트의 주 시작 설정(calendar.week_start)이 정한 주**로 끊는다(사용자 테스트 BUG-16).
 * 예전에는 축의 첫날부터 7일씩 끊어, 축이 토요일에 시작하면 모든 주가 토요일에 시작했다(주간보고의 주와 어긋났다).
 * 축은 주 중간에서 시작할 수 있으므로 첫 칸·끝 칸은 7일보다 짧을 수 있다. 번호는 축에서 보이는 순서(W01 = 축의 첫 주),
 * 부제는 그 칸의 첫날(M/D)이다. 주 키는 주간보고와 같은 함수(weekKeyOf)라 과도기 주(6·8일)도 같은 경계로 끊긴다.
 */
export function ganttWeekSpans(days: readonly string[], weekStart: readonly WeekStartRule[]): GanttWeekSpan[] {
  const out: GanttWeekSpan[] = []
  let key: string | null = null
  days.forEach((d, i) => {
    const k = weekKeyOf(weekStart, d)
    if (k === key) { out[out.length - 1].length++; return }
    key = k
    out.push({ label: 'W' + String(out.length + 1).padStart(2, '0'), sub: `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`, startIndex: i, length: 1 })
  })
  return out
}

/** weekStart 를 주면 주 머리가 그 설정의 주로 끊긴다(ganttWeekSpans). 생략하면 축 첫날부터 7일씩(옛 동작 — 설정을 모르는 호출부) */
export function buildGanttScale(dates: string[], today: string, dayPx: number, cal: DayCal, weekStart?: readonly WeekStartRule[]): GanttScale {
  const valid = dates.filter(Boolean)
  // WBS 첫 화면에서 기준일을 항상 보여 줄 수 있도록 일정 밖이어도 축에 포함한다.
  const axisDates = [...valid, today]
  const rangeStart = axisDates.reduce((a, b) => (a < b ? a : b))
  const rangeEnd = axisDates.reduce((a, b) => (a > b ? a : b))

  const start = new Date(rangeStart + 'T00:00:00Z')
  const end = new Date(rangeEnd + 'T00:00:00Z')
  const days: string[] = []
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) days.push(iso(d))

  const xOf = (date: string) =>
    ((new Date(date + 'T00:00:00Z').getTime() - start.getTime()) / 86_400_000) * dayPx
  const isOffDay = (d: string) => !isWorkingDay(d, cal)
  const ganttW = days.length * dayPx

  const months: GanttScale['months'] = []
  days.forEach((d, i) => {
    const ym = d.slice(0, 7)
    const last = months[months.length - 1]
    if (last && last.ym === ym) last.width += dayPx
    else months.push({ ym, label: `${Number(d.slice(5, 7))}월`, left: i * dayPx, width: dayPx })
  })

  const weeks: GanttScale['weeks'] = weekStart
    ? ganttWeekSpans(days, weekStart).map(w => ({ label: w.label, sub: w.sub, left: w.startIndex * dayPx, width: w.length * dayPx }))
    : []
  for (let i = 0; !weekStart && i < days.length; i += 7) {
    const w = Math.min(7, days.length - i)
    const dd = days[i]
    weeks.push({
      label: 'W' + String(weeks.length + 1).padStart(2, '0'),
      sub: `${Number(dd.slice(5, 7))}/${Number(dd.slice(8, 10))}`,
      left: i * dayPx,
      width: w * dayPx,
    })
  }

  const todayX =
    days.length && today >= rangeStart && today <= rangeEnd ? xOf(today) + dayPx / 2 : null

  return { days, rangeStart, rangeEnd, months, weeks, ganttW, xOf, isOffDay, todayX }
}

/**
 * sticky 열에 가리지 않도록 기준일을 실제 타임라인 가시 영역의 중앙에 놓는 초기 scrollLeft.
 * timelineLeft/dateX는 스크롤 콘텐츠 좌표이고, frozenWidth만큼은 뷰포트 왼쪽을 계속 가린다.
 */
export function centeredTimelineScrollLeft({
  timelineLeft,
  dateX,
  frozenWidth,
  viewportWidth,
  scrollWidth,
}: {
  timelineLeft: number
  dateX: number
  frozenWidth: number
  viewportWidth: number
  scrollWidth: number
}): number {
  if (viewportWidth <= 0 || scrollWidth <= viewportWidth) return 0
  const occludedWidth = Math.min(Math.max(0, frozenWidth), viewportWidth)
  const visibleTimelineWidth = viewportWidth - occludedWidth
  const target = timelineLeft + dateX - occludedWidth - visibleTimelineWidth / 2
  return Math.min(Math.max(0, scrollWidth - viewportWidth), Math.max(0, target))
}

/* ── 간트 마일스톤 세로 기준선 — 같은 날짜는 마커 1개로 병합, 라벨 칩은 위/아래 2단 교차 배치 ── */
export interface GanttMilestoneMarker {
  date: string
  status: MilestoneStatus
  names: string[]
  dday: number
  tier: 0 | 1
}

const MS_STATUS_PRIORITY: readonly MilestoneStatus[] = ['overdue', 'upcoming', 'done']

export function groupGanttMilestones(points: readonly MilestonePoint[]): GanttMilestoneMarker[] {
  const byDate = new Map<string, MilestonePoint[]>()
  for (const pt of points) {
    const group = byDate.get(pt.date)
    if (group) group.push(pt)
    else byDate.set(pt.date, [pt])
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, group], i) => ({
      date,
      status: MS_STATUS_PRIORITY.find(s => group.some(g => g.status === s)) ?? 'done',
      names: group.map(g => g.name),
      dday: group[0].dday,
      tier: (i % 2) as 0 | 1,
    }))
}

/** 트리에서 모든 계획 일자를 평탄 수집 */
export function collectPlannedDates(
  items: { plannedStart: string | null; plannedEnd: string | null; children: unknown[] }[],
): string[] {
  const out: string[] = []
  const walk = (ns: typeof items) =>
    ns.forEach(n => {
      if (n.plannedStart) out.push(n.plannedStart)
      if (n.plannedEnd) out.push(n.plannedEnd)
      walk((n.children as typeof items) ?? [])
    })
  walk(items)
  return out
}
