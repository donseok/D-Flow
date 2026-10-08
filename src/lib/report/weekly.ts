import type {
  Announcement, AttendanceRecord, AttendanceType, ComputedItem, Meeting, MeetingException, MeetingOccurrence,
  ProjectMember, Status, TeamCode,
} from '@/lib/domain/types'
import { overallProgress, weightOf } from '@/lib/domain/rollup'
import { round1 } from '@/lib/domain/format'
import { FALLBACK_LEVEL_LABELS } from '@/lib/domain/levelSettings'
import { expandMeetings, sortOccurrences } from '@/lib/domain/meetings'
import {
  isoDowOf, nextWeekKey, prevWeekKey, weekDisplayDays, weekKeyOf, weekPeriodOf, ymdIn, type WorkCalendar,
} from '@/lib/domain/calendar'
import { addDaysIso } from '@/lib/domain/dates'
import { mdOf, weekLabelTexts } from './week'
import { vocabShort, type AttendanceTypeDef } from '@/lib/settings/vocab'

/* ============================================================================
 * 주간 공정보고 모델 — 주간보고(PPT)·공정보고(Excel)가 공유하는 단일 출처.
 * 화면이 아니라 내보내기 전용. 모든 집계·분류·정렬·주차 계산을 이 순수 모듈에 모은다.
 * 데이터 매핑: 담당자=owners(팀), 상태 5종(대기/진행중/지연/완료/보류=0),
 * 금주 실적=진행중 leaf, 차주 계획=차주 기간과 겹치는 미완료 leaf, 워크로드=팀별, 근태=members+attendance.
 * ========================================================================== */

/** ISO 요일(1=월…7=일) → 한 글자 라벨(보고서 서식 — 한국어 고정, 지원 제한 §2.9.2) */
const DOW_LABEL = ['월', '화', '수', '목', '금', '토', '일'] as const
const dayLabelsOf = (days: readonly string[]): string[] => days.map(d => DOW_LABEL[isoDowOf(d) - 1])

export interface WeeklyMeta {
  projectName: string
  description: string | null
  generatedAt: string        // '2026-06-30 13:20'
  today: string              // 'YYYY-MM-DD'
  isoYear: number
  isoWeek: number            // 27 (ISO 주차 — 메타 보존용)
  weekTag: string            // '7월1주차' (파일명용 — weekLabelTexts)
  weekLabel: string          // '2026년 7월 1주차 (6/29~7/3)' (보고서 — weekLabelTexts.reportLabel)
  weekRange: string          // 표시 요일 범위 '6/29~7/3'
  nextWeekRange: string      // 차주 표시 요일 범위
  weekStart: string          // 그 주 키(프로젝트 규칙 — 월요일 고정이 아니다)
  weekEnd: string            // 그 주 기간의 마지막 날(과도기 주는 6·8일 기간의 끝)
  weekDays: string[]         // 표시 요일(기간 안 근무일, 0이면 기간 전체 — 1~8칸: 일→월 과도기 주는 8일이라 같은 요일이 두 번 나올 수 있다)
  weekDayLabels: string[]    // weekDays 의 요일 라벨('월'…)
  nextWeekStart: string
  nextWeekDays: string[]
  nextWeekDayLabels: string[]
  prevWeekStart: string      // 지난 주 키
  prevWeekDays: string[]
  prevWeekRange: string
  totalLeaves: number
  phaseCount: number
  /** 1레벨 단계 이름(프로젝트 설정 core.level_labels 의 첫 값) — 보고서 문구가 'Phase' 로 박히지 않게 */
  topLevelLabel: string
}

export interface WeeklyKpi {
  actual: number
  planned: number
  variance: number           // actual - planned (음수=미달)
  total: number
  done: number
  inProgress: number
  notStarted: number
  onHold: number             // D-Flow 미지원 → 0
  delayed: number
  doneThisWeek: number
  doneRatio: number          // done/total %
  inProgressRatio: number
  delayedRatio: number
  nextWeekPlanCount: number
  maxDelayDays: number
}

export interface WeeklyPhase {
  name: string
  weightPct: number          // 점유율
  plannedPct: number
  actualPct: number
  gap: number                // 계획 - 실적 (양수=미달)
  doneCount: number
  totalCount: number
  delayedCount: number
  status: Status
}

export interface WeeklyTaskRow {
  name: string
  phaseName: string
  ownerText: string
  status: Status
  actualPct: number
}

export interface PhasePlanActual {
  phaseName: string
  plannedPct: number
  actualPct: number
  prevWeek: WeeklyTaskRow[]
  thisWeek: WeeklyTaskRow[]
  nextWeek: WeeklyTaskRow[]
}

export interface WorkloadRow {
  name: string               // 팀
  perDay: number[]           // weekDays 와 같은 칸(표시 요일마다 하나)
  total: number
  note: string               // 여유/적정/과부하
}

export interface IssueRow {
  grade: '높음' | '중간' | '낮음'
  content: string
  action: string
}

export interface AttendanceRow {
  memberName: string
  perDay: (string | null)[]  // weekDays 와 같은 칸의 근태 약칭 또는 null(정상)
  count: number              // 특이 근태 일수
}

export interface WeeklyAttendance {
  thisWeek: AttendanceRow[]
  nextWeek: AttendanceRow[]
}

export interface MeetingRow {
  date: string               // '7/6(월)'
  dateIso: string            // 'YYYY-MM-DD' — 같은 회의의 반복 회차를 날짜 구간으로 병합할 때 사용(narrative)
  time: string               // '14:00~15:00' 또는 '종일'
  title: string
  location: string           // 없으면 '-'
  attendeeCount: number
}
export interface WeeklyMeetings {
  thisWeek: MeetingRow[]
  nextWeek: MeetingRow[]
  total: number              // 금주+차주 회의 수 (0이면 PPT 회의일정 페이지 생략)
}

/** 이슈 0건일 때 모델에 넣는 대체 문구 — 화면 표기(Excel·봇)는 유지하되, PPT(narrative)는
 *  이 문구를 걸러 이슈 셀을 빈칸으로 둔다(사용자 요청: 특이 이슈 없으면 따로 작성 금지). */
export const NO_ISSUE_TEXT = '특이 이슈 없음 — 계획대로 진행 중'

export interface AnnouncementRow {
  date: string               // 게시일 'YYYY-MM-DD'(그 프로젝트 시간대의 날짜)
  title: string
}
export interface WeeklyAnnouncements {
  prevWeek: AnnouncementRow[]
  thisWeek: AnnouncementRow[]
  total: number              // 전주+금주 공지 수 (PPT에서는 주요 이벤트 목록에 '[공지]'로 실림)
}

export interface WbsFlatRow {
  no: number
  levelLabel: string
  depth: number
  name: string
  deliverable: string
  ownerText: string
  weight: number | null
  plannedStart: string | null
  plannedEnd: string | null
  plannedPct: number
  actualPct: number
  gap: number
  delayDays: number
  status: Status
}

export interface DevStatusRow {
  no: number
  phaseName: string
  parentName: string         // Activity(상위 task) 또는 '-'
  name: string
  deliverable: string
  ownerText: string
  weight: number | null
  plannedStart: string | null
  plannedEnd: string | null
  plannedPct: number
  actualPct: number
  delayDays: number
  status: Status
  note: string
}

export interface WeeklyReportModel {
  meta: WeeklyMeta
  kpi: WeeklyKpi
  phases: WeeklyPhase[]
  planActual: PhasePlanActual[]
  workload: WorkloadRow[]
  issues: IssueRow[]
  attendance: WeeklyAttendance
  meetings: WeeklyMeetings
  announcements: WeeklyAnnouncements
  wbs: WbsFlatRow[]
  dev: DevStatusRow[]
  devOwnerSummary: string
}

export interface ReportProject {
  name: string
  description?: string | null
  start_date?: string | null
  end_date?: string | null
}

/* ── 날짜/주차 유틸 (UTC 기반, 타임존 무관) ── */
export function parseUTC(d: string): Date {
  const [y, m, day] = d.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, day))
}
export function fmtUTC(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}
export function addDays(d: Date, n: number): Date {
  const x = new Date(d)
  x.setUTCDate(x.getUTCDate() + n)
  return x
}
/** 공지 게시일 'YYYY-MM-DD'(프로젝트 tz). publishFrom 은 이미 그 날짜(date-only), 없으면 createdAt(instant)을 프로젝트 tz 로 날짜화한다.
 *  UTC 슬라이스로 자르면 tz 자정 전후 공지가 하루 앞 주차로 오분류된다. */
function announcedOn(a: Announcement, timezone: string): string {
  if (a.publishFrom) return a.publishFrom.slice(0, 10)
  const t = Date.parse(a.createdAt)
  return Number.isNaN(t) ? '' : ymdIn(timezone, new Date(t))
}
/** ISO-8601 주차 번호. */
function isoWeek(d: Date): { year: number; week: number } {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const dayNr = (d.getUTCDay() + 6) % 7 // 월=0
  t.setUTCDate(t.getUTCDate() - dayNr + 3) // 그 주 목요일
  const firstThu = new Date(Date.UTC(t.getUTCFullYear(), 0, 4))
  const firstDayNr = (firstThu.getUTCDay() + 6) % 7
  firstThu.setUTCDate(firstThu.getUTCDate() - firstDayNr + 3)
  const week = 1 + Math.round((t.getTime() - firstThu.getTime()) / (7 * 86_400_000))
  return { year: t.getUTCFullYear(), week }
}
const DOW_KR = ['일', '월', '화', '수', '목', '금', '토'] as const
/** 'YYYY-MM-DD' → 'M/D(요일)' (회의일정·공지 표기용 — narrative의 이벤트 목록이 공유). */
export function mdDow(iso: string): string {
  const d = parseUTC(iso)
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${DOW_KR[d.getUTCDay()]})`
}
function diffDays(fromIso: string, toIso: string): number {
  return Math.round((parseUTC(toIso).getTime() - parseUTC(fromIso).getTime()) / 86_400_000)
}
/** [aStart,aEnd] 와 [bStart,bEnd] 기간이 겹치는가 (양끝 포함). */
function overlaps(aStart: string | null, aEnd: string | null, bStart: string, bEnd: string): boolean {
  const s = aStart ?? aEnd
  const e = aEnd ?? aStart
  if (!s || !e) return false
  return s <= bEnd && e >= bStart
}

const STATUS_KR: Record<Status, string> = {
  not_started: '대기', in_progress: '진행중', delayed: '지연', done: '완료',
}
export function statusKr(s: Status): string {
  return STATUS_KR[s]
}

function ownersText(owners: ComputedItem['owners']): string {
  if (!owners.length) return '-'
  const primary = owners.filter(o => o.kind === 'primary').map(o => o.team)
  const support = owners.filter(o => o.kind === 'support').map(o => o.team)
  return [...primary, ...support.map(t => `(${t})`)].join(' ')
}

/** 가중치 정규화 → 합 100 (마지막 항목에 잔차 보정). */
function normalizeWeights(weights: number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0) || 1
  const raw = weights.map(w => (w / total) * 100)
  const out = raw.map(Math.round)
  const diff = 100 - out.reduce((a, b) => a + b, 0)
  if (out.length) out[out.length - 1] += diff
  return out
}

interface LeafCtx {
  node: ComputedItem
  rootName: string
  parentName: string | null
}

export function buildWeeklyReportModel(
  items: ComputedItem[],
  project: ReportProject,
  today: string,
  opts: {
    members?: ProjectMember[]; attendance?: AttendanceRecord[]; generatedAt?: string
    /** 그 프로젝트의 근태 유형(설정 attendance.types — SP5 B4). 근태 기록을 넘기면 필수 — 약칭·'평상 근무' 판정의 원천 */
    attendanceTypes?: readonly AttendanceTypeDef[]
    meetings?: Meeting[]; meetingExceptions?: MeetingException[]
    announcements?: Announcement[]
    /** 팀별 워크로드·미완료 요약 대상(활성 팀) — 호출처가 팀 마스터에서 주입한다(필수). */
    teams: readonly TeamCode[]
    /** depth→라벨 매핑(프로젝트 설정). 기본은 기존 3레벨 표기와 동일 — 무인자 호출은 바이트 불변. */
    levelLabels?: readonly string[]
    /** 그 프로젝트의 달력(SP5 A — 필수) — 주 키·기간·표시 요일·공지 날짜의 tz. 호출처가 getComputedWbs(…).calendar 를 넘긴다 */
    calendar: WorkCalendar
  },
): WeeklyReportModel {
  const reportTeams = opts.teams
  const levelLabels = opts.levelLabels ?? FALLBACK_LEVEL_LABELS
  const roots = items
  const members = opts.members ?? []
  const attendance = opts.attendance ?? []

  // ── 주차(SP5 A — 키·기간·이웃은 달력 모듈, 서식은 weekLabelTexts) ──
  const cal = opts.calendar
  const todayD = parseUTC(today)
  const { year: isoYear, week: isoWeekNum } = isoWeek(todayD)        // ISO 주차 — 메타 보존용(월요일 정의 그대로)
  const weekStart = weekKeyOf(cal.weekStart, today)
  const weekEnd = addDaysIso(weekPeriodOf(cal.weekStart, weekStart).endExclusive, -1)
  const nextWeekStart = nextWeekKey(cal.weekStart, weekStart)
  const nextWeekEnd = addDaysIso(weekPeriodOf(cal.weekStart, nextWeekStart).endExclusive, -1)
  const prevWeekStart = prevWeekKey(cal.weekStart, weekStart)
  const prevWeekEnd = addDaysIso(weekStart, -1)
  const texts = weekLabelTexts(cal, weekStart)
  const weekTag = texts.weekTag
  const weekDays = weekDisplayDays(cal, weekStart)
  const nextWeekDays = weekDisplayDays(cal, nextWeekStart)
  const prevWeekDays = weekDisplayDays(cal, prevWeekStart)
  const rangeOf = (days: readonly string[]) => `${mdOf(days[0])}~${mdOf(days[days.length - 1])}`
  const weekRange = texts.range
  const nextWeekRange = rangeOf(nextWeekDays)
  const prevWeekRange = rangeOf(prevWeekDays)

  // ── leaf 수집(루트/부모 문맥 포함) ──
  const leaves: LeafCtx[] = []
  const walk = (node: ComputedItem, rootName: string, parentName: string | null) => {
    if (!node.children.length) {
      leaves.push({ node, rootName, parentName })
      return
    }
    for (const c of node.children) walk(c, rootName, node.name)
  }
  for (const r of roots) walk(r, r.name, null)
  const leafNodes = leaves.map(l => l.node)

  const delayDaysOf = (n: ComputedItem): number =>
    n.status !== 'done' && n.plannedEnd && today > n.plannedEnd ? diffDays(n.plannedEnd, today) : 0

  // ── KPI / 상태 카운트 ──
  const cnt = { done: 0, in_progress: 0, delayed: 0, not_started: 0 } as Record<Status, number>
  for (const n of leafNodes) cnt[n.status]++
  const total = leafNodes.length
  // 공정율은 대시보드와 동일한 도메인 롤업 정밀도(소수 1자리)를 유지한다 — 엑셀 수치 셀 전용.
  // PPT·AI 어시스턴트에 그대로 실리는 이슈 문구는 아래에서 기존 정수 표기로 생성(현상유지).
  const overall = overallProgress(roots)
  const actual = overall.actual
  const planned = overall.planned
  const doneThisWeek = leafNodes.filter(
    n => n.status === 'done' && n.plannedEnd && n.plannedEnd >= weekStart && n.plannedEnd <= weekEnd,
  ).length
  const nextWeekLeaves = leaves.filter(
    l => l.node.status !== 'done' && overlaps(l.node.plannedStart, l.node.plannedEnd, nextWeekStart, nextWeekEnd),
  )
  const prevWeekLeaves = leaves.filter(
    l => l.node.status !== 'not_started' && overlaps(l.node.plannedStart, l.node.plannedEnd, prevWeekStart, prevWeekEnd),
  )
  const maxDelayDays = leafNodes.reduce((m, n) => Math.max(m, delayDaysOf(n)), 0)
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0)

  const kpi: WeeklyKpi = {
    actual, planned, variance: round1(actual - planned),
    total, done: cnt.done, inProgress: cnt.in_progress, notStarted: cnt.not_started, onHold: 0, delayed: cnt.delayed,
    doneThisWeek,
    doneRatio: pct(cnt.done), inProgressRatio: pct(cnt.in_progress), delayedRatio: pct(cnt.delayed),
    nextWeekPlanCount: nextWeekLeaves.length,
    maxDelayDays,
  }

  // ── Phase별 ── 점유율은 루트 가중치 정규화
  const rootWeights = roots.map(r => weightOf(r.weight))
  const weightPcts = normalizeWeights(rootWeights)
  const leavesUnderRoot = (rootName: string) => leaves.filter(l => l.rootName === rootName).map(l => l.node)
  const phases: WeeklyPhase[] = roots.map((r, i) => {
    const sub = leavesUnderRoot(r.name)
    return {
      name: r.name,
      weightPct: weightPcts[i] ?? 0,
      plannedPct: round1(r.plannedPct),
      actualPct: round1(r.rolledActualPct),
      gap: round1(r.plannedPct - r.rolledActualPct),
      doneCount: sub.filter(n => n.status === 'done').length,
      totalCount: sub.length,
      delayedCount: sub.filter(n => n.status === 'delayed').length,
      status: r.status,
    }
  })

  // ── 공정 실적 및 계획 (Phase별 금주 진행중 / 차주 예정) ──
  const toTaskRow = (l: LeafCtx): WeeklyTaskRow => ({
    name: l.node.name, phaseName: l.rootName, ownerText: ownersText(l.node.owners),
    status: l.node.status, actualPct: round1(l.node.rolledActualPct),
  })
  const planActual: PhasePlanActual[] = roots.map(r => ({
    phaseName: r.name,
    plannedPct: round1(r.plannedPct),
    actualPct: round1(r.rolledActualPct),
    prevWeek: prevWeekLeaves.filter(l => l.rootName === r.name).map(toTaskRow),
    thisWeek: leaves.filter(l => l.rootName === r.name && l.node.status === 'in_progress').map(toTaskRow),
    nextWeek: nextWeekLeaves.filter(l => l.rootName === r.name).map(toTaskRow),
  }))

  // ── 담당자(팀)별 워크로드 — 요일별 진행 작업 수 ──
  const workload: WorkloadRow[] = reportTeams.map(team => {
    const perDay = weekDays.map(day =>
      leafNodes.filter(
        n => n.status !== 'done' && n.owners.some(o => o.team === team) &&
          n.plannedStart && n.plannedEnd && n.plannedStart <= day && day <= n.plannedEnd,
      ).length,
    )
    const totalLoad = perDay.reduce((a, b) => a + b, 0)
    const peak = Math.max(0, ...perDay)
    const note = peak <= 3 ? '여유' : peak <= 6 ? '적정' : '과부하'
    return { name: team, perDay, total: totalLoad, note }
  })

  // ── 이슈 / 리스크 (자동) ──
  const issues: IssueRow[] = []
  if (cnt.delayed > 0) issues.push({ grade: '높음', content: `지연 작업 ${cnt.delayed}건 발생 — 조속한 조치 필요`, action: '(미작성)' })
  if (maxDelayDays > 0) issues.push({ grade: '높음', content: `최대 지연일수 ${maxDelayDays}일 — 일정 재조정 검토 필요`, action: '(미작성)' })
  // 이슈 문구는 PPT(narrative→주간 카탈로그 issues)·AI 어시스턴트가 그대로 인용 → 정수 기반 현상유지.
  const actualInt = Math.round(actual)
  const plannedInt = Math.round(planned)
  if (actualInt < plannedInt) issues.push({ grade: '중간', content: `계획 대비 실적 ${plannedInt - actualInt}%p 미달`, action: '(미작성)' })
  if (issues.length === 0) issues.push({ grade: '낮음', content: NO_ISSUE_TEXT, action: '-' })

  // ── 근태 (멤버별, 특이 근태만) ──
  const recByMemberDate = new Map<string, AttendanceType>()
  for (const r of attendance) recByMemberDate.set(`${r.memberId}|${r.date}`, r.type)
  if (attendance.length && !opts.attendanceTypes) throw new Error('[weekly] 근태 기록에는 그 프로젝트의 근태 유형(attendanceTypes)이 필요하다')
  const attTypes = opts.attendanceTypes ?? []
  // 표에서 빼는 '평상 근무' = 등록 선택지인 근무 집계 유형(기본 어휘의 정상근무). 공가처럼 근무로 세지만 선택지 밖인 유형은 특이 근태로 보인다(B4 이전과 같다)
  const ordinary = new Set(attTypes.filter(e => e.counts_as === 'work' && e.selectable).map(e => e.code))
  const buildAttendance = (days: string[]): AttendanceRow[] => {
    const rows: AttendanceRow[] = []
    for (const m of members) {
      const perDay = days.map(day => {
        const t = recByMemberDate.get(`${m.id}|${day}`)
        return t && !ordinary.has(t) ? vocabShort(attTypes, t) : null
      })
      const count = perDay.filter(Boolean).length
      if (count > 0) rows.push({ memberName: m.name, perDay, count })
    }
    return rows
  }
  const attendanceModel: WeeklyAttendance = {
    thisWeek: buildAttendance(weekDays),
    nextWeek: buildAttendance(nextWeekDays),
  }

  // ── 회의일정 (금주/차주) — 반복 회의를 주간 범위로 전개, 취소 회차 제외 ──
  const occ = expandMeetings(opts.meetings ?? [], opts.meetingExceptions ?? [], weekStart, nextWeekEnd)
  const toMeetingRow = (o: MeetingOccurrence): MeetingRow => ({
    date: mdDow(o.occurrenceDate),
    dateIso: o.occurrenceDate,
    time: o.startTime ? (o.endTime ? `${o.startTime}~${o.endTime}` : o.startTime) : '종일',
    title: o.title,
    location: o.location ?? '-',
    attendeeCount: o.attendeeCount,
  })
  const thisWeekMeetings = sortOccurrences(occ.filter(o => o.occurrenceDate >= weekStart && o.occurrenceDate <= weekEnd)).map(toMeetingRow)
  const nextWeekMeetings = sortOccurrences(occ.filter(o => o.occurrenceDate >= nextWeekStart && o.occurrenceDate <= nextWeekEnd)).map(toMeetingRow)
  const meetings: WeeklyMeetings = {
    thisWeek: thisWeekMeetings, nextWeek: nextWeekMeetings, total: thisWeekMeetings.length + nextWeekMeetings.length,
  }

  // ── 공지 (게시일 기준 전주/금주 분류, 날짜 오름차순) ──
  const annRows: AnnouncementRow[] = (opts.announcements ?? [])
    .map(a => ({ date: announcedOn(a, cal.timezone), title: a.title }))
    .filter(r => r.date !== '')
    .sort((x, y) => x.date.localeCompare(y.date))
  const annIn = (from: string, to: string) => annRows.filter(r => r.date >= from && r.date <= to)
  const prevWeekAnn = annIn(prevWeekStart, prevWeekEnd)
  const thisWeekAnn = annIn(weekStart, weekEnd)
  const announcements: WeeklyAnnouncements = {
    prevWeek: prevWeekAnn, thisWeek: thisWeekAnn, total: prevWeekAnn.length + thisWeekAnn.length,
  }

  // ── WBS 플랫(전체 트리, 들여쓰기 depth) ──
  const wbs: WbsFlatRow[] = []
  let no = 0
  const flat = (node: ComputedItem, depth: number) => {
    no++
    wbs.push({
      no, levelLabel: levelLabels[Math.min(depth, levelLabels.length - 1)], depth,
      name: node.name, deliverable: node.deliverable ?? '', ownerText: ownersText(node.owners),
      weight: node.weight, plannedStart: node.plannedStart, plannedEnd: node.plannedEnd,
      plannedPct: round1(node.plannedPct), actualPct: round1(node.rolledActualPct),
      gap: round1(node.plannedPct - node.rolledActualPct), delayDays: delayDaysOf(node), status: node.status,
    })
    for (const c of node.children) flat(c, depth + 1)
  }
  for (const r of roots) flat(r, 0)

  // ── 프로그램 개발현황 (미완료 leaf, 지연일 내림차순) ──
  const incomplete = leaves
    .filter(l => l.node.status !== 'done')
    .sort((a, b) => delayDaysOf(b.node) - delayDaysOf(a.node) || (a.node.plannedEnd ?? '').localeCompare(b.node.plannedEnd ?? ''))
  const dev: DevStatusRow[] = incomplete.map((l, i) => {
    const dd = delayDaysOf(l.node)
    return {
      no: i + 1, phaseName: l.rootName, parentName: l.parentName ?? '-',
      name: l.node.name, deliverable: l.node.deliverable ?? '', ownerText: ownersText(l.node.owners),
      weight: l.node.weight, plannedStart: l.node.plannedStart, plannedEnd: l.node.plannedEnd,
      plannedPct: round1(l.node.plannedPct), actualPct: round1(l.node.rolledActualPct), delayDays: dd, status: l.node.status,
      note: dd > 0 ? `⚠ 계획종료 ${dd}일 경과` : '',
    }
  })
  // 담당자(팀)별 미완료 요약
  const summaryParts = reportTeams.map(team => {
    const own = incomplete.filter(l => l.node.owners.some(o => o.team === team)).map(l => l.node)
    if (!own.length) return null
    const dl = own.filter(n => n.status === 'delayed').length
    const avg = Math.round(own.reduce((s, n) => s + n.rolledActualPct, 0) / own.length)
    return `${team}: ${own.length}건(지연${dl}, 평균${avg}%)`
  }).filter(Boolean)
  const devOwnerSummary = summaryParts.length ? `▣ 담당자별 미완료: ${summaryParts.join(' · ')}` : '▣ 미완료 작업 없음'

  return {
    meta: {
      projectName: project.name, description: project.description ?? null,
      generatedAt: opts.generatedAt ?? `${today} 00:00`, today,
      isoYear, isoWeek: isoWeekNum, weekTag,
      weekLabel: texts.reportLabel,
      weekRange, nextWeekRange, weekStart, weekEnd, weekDays, weekDayLabels: dayLabelsOf(weekDays),
      nextWeekStart, nextWeekDays, nextWeekDayLabels: dayLabelsOf(nextWeekDays),
      prevWeekStart, prevWeekDays, prevWeekRange,
      totalLeaves: total, phaseCount: roots.length, topLevelLabel: levelLabels[0] ?? FALLBACK_LEVEL_LABELS[0],
    },
    kpi, phases, planActual, workload, issues, attendance: attendanceModel, meetings, announcements, wbs, dev, devOwnerSummary,
  }
}


