/**
 * 위젯 강화(2026-10-10)로 더한 홈 위젯의 로더 — 서버 전용, 세션 클라이언트 + RLS(service_role 없음). portal.ts 의 로더와 같은 규칙을 따른다:
 * ① 그 모듈이 effective 이고 화면에서 볼 수 있는 프로젝트만 조회 인자에 싣는다(portalScope.on — 꺼진 모듈·비공개 프로젝트의 행은 읽지 않는다)
 * ② 같은 요청의 원천을 공유한다(내 업무 원천 loadMyWorkSources·프로젝트 행 — React cache) — 위젯을 여럿 올려도 왕복이 위젯 수만큼 늘지 않는다
 * ③ 조회 실패는 던지거나 { ok: false } — 홈이 safe() 로 받아 그 위젯만 실패 카드로 그린다. 일부 실패는 partial(받은 행과 함께 알린다)
 * ④ 건수 상한을 둔다(위젯은 요약이다 — 전체는 '전체 보기' 화면).
 * 프로젝트를 가로지르는 화면이라 판정 기준·어휘는 제품 기본을 쓴다(커밋 f6f26431 의 결정) — 근태 유형만 프로젝트 어휘를 읽는다(휴가인지의 판정이 유형에 달렸다).
 */
import { isProjectAdmin, isProjectMember, type Actor } from '@/lib/domain/authz'
import { todayIn, weekKeyOf, weekPeriodOf } from '@/lib/domain/calendar'
import { addDaysIso } from '@/lib/domain/dates'
import { DEFAULT_DUE_SOON_DAYS } from '@/lib/domain/dashboard'
import { expandMeetings, sortOccurrences } from '@/lib/domain/meetings'
import { compareKoreanName } from '@/lib/domain/nameSort'
import type { ProjectLifecycleStatus } from '@/lib/domain/project-status'
import { requireCalendar } from '@/lib/calendar/load'
import { getMyMeetings } from '@/lib/data/meetings'
import { getProjectRows, loadMyWorkSources, portalChunks, portalScope } from '@/lib/data/portal'
import { meetingHref, weeklyHref, wikiTopicHref, wbsItemHref } from '@/lib/ai/chat/deep-links'
import { KO_LOCALE } from '@/lib/i18n/format'
import type { Translate } from '@/lib/i18n/translate'
import { compareMyWork, type MyWorkKind, type MyWorkRow } from '@/lib/portal/myWork'
import { getProjectCalendars, getProjectVocabs } from '@/lib/settings/projectConfig'
import { getWorkspaceConfig } from '@/lib/settings/workspaceConfig'
import { DEFAULT_SEVERITIES, type AttendanceTypeDef } from '@/lib/settings/vocab'
import type { createServerClient } from '@/lib/supabase/server'

type Db = Awaited<ReturnType<typeof createServerClient>>
type Opts = { client?: Db; now?: Date; t?: Translate; limit?: number }
type Fail = { ok: false; error: string }
const cap = (n: number | undefined, dflt: number, max: number) => Math.min(Math.max(1, n ?? dflt), max)
/** 내가 명단에 있거나 관리자인 프로젝트 — '내 프로젝트'를 말하는 위젯(진척·변경·근태·주간보고·에이전트)의 범위 */
const mine = (actor: Actor, pids: readonly string[]) => pids.filter((p) => isProjectMember(actor, p) || isProjectAdmin(actor, p))
/** 조회 결과를 행 배열로 — 오류는 던진다. 임베드(to-one)는 생성 타입이 배열로 추론하므로 호출부가 적은 행 꼴로 좁힌다(portal.ts 의 관례) */
const must = <T extends unknown[]>(label: string, r: { data: unknown; error: { message: string } | null }): T => {
  if (r.error) throw new Error(`${label} 조회 실패: ${r.error.message}`)
  return (r.data ?? []) as T
}

// ── 지연·임박 작업 ─────────────────────────────────────────────────────────────────────────────────────────────────

export type DueKind = 'overdue' | 'soon'
export type DueWorkRow = MyWorkRow & { dueKind: DueKind }
/**
 * 내 담당 작업·이슈 가운데 기한이 지났거나 임박한 것 — 내 업무와 같은 원천(왕복 0). '임박' = 그 프로젝트의 오늘부터 제품 기본 기준(7일) 안
 * (프로젝트마다 다른 dashboard.due_soon_days 는 그 프로젝트 화면의 기준이다 — 가로지르는 화면은 기본 기준). 지연(오래된 순) → 임박(가까운 순).
 */
export async function getDueWork(workspaceId: string, actor: Actor, opts: Opts = {}):
  Promise<{ ok: true; rows: DueWorkRow[]; overdue: number; soon: number; partial: boolean } | Fail> {
  const s = await loadMyWorkSources(workspaceId, actor, opts.client, opts.now)
  if (s.fatal) return { ok: false, error: s.fatal }
  const all: DueWorkRow[] = []
  for (const r of [...s.rows.wbs, ...s.rows.issue]) {
    const today = s.todays.get(r.projectId) ?? null
    if (!r.due || today === null) continue
    if (r.due < today) all.push({ ...r, dueKind: 'overdue' })
    else if (r.due <= addDaysIso(today, DEFAULT_DUE_SOON_DAYS)) all.push({ ...r, dueKind: 'soon' })
  }
  all.sort((a, b) => (a.dueKind === b.dueKind ? compareMyWork(a, b) : a.dueKind === 'overdue' ? -1 : 1))
  const kinds: MyWorkKind[] = ['wbs', 'issue']
  return {
    ok: true, rows: all.slice(0, cap(opts.limit, 8, 20)), overdue: all.filter((r) => r.dueKind === 'overdue').length,
    soon: all.filter((r) => r.dueKind === 'soon').length, partial: kinds.some((k) => s.failedKinds.includes(k)),
  }
}

// ── 내 이슈 ────────────────────────────────────────────────────────────────────────────────────────────────────────

const SEVERITY_RANK = new Map(DEFAULT_SEVERITIES.map((d) => [d.code, d.rank]))
/** 내가 담당인 미해결 이슈 — 내 업무의 이슈 원천 그대로(왕복 0). 심각도 높은 순(제품 기본 등급 — 모르는 code 는 뒤) → 기한 → id */
export async function getMyIssues(workspaceId: string, actor: Actor, opts: Opts = {}):
  Promise<{ ok: true; rows: MyWorkRow[]; total: number; partial: boolean } | Fail> {
  const s = await loadMyWorkSources(workspaceId, actor, opts.client, opts.now)
  if (s.fatal) return { ok: false, error: s.fatal }
  const rank = (r: MyWorkRow) => SEVERITY_RANK.get(r.severity ?? '') ?? 99
  const rows = [...s.rows.issue].sort((a, b) => rank(a) - rank(b) || compareMyWork(a, b))
  return { ok: true, rows: rows.slice(0, cap(opts.limit, 8, 20)), total: rows.length, partial: s.failedKinds.includes('issue') }
}

// ── 프로젝트 진척 ──────────────────────────────────────────────────────────────────────────────────────────────────

export interface ProgressSummaryRow {
  id: string; name: string; status: ProjectLifecycleStatus; statusReason: string
  /** 완료 잎 비율(0~100, 정수). null = 잎이 없거나 진척을 읽지 못했다 */
  pct: number | null; done: number; total: number; overdueOpen: number | null; nextDue: string | null
}
const STATUS_ORDER: Record<ProjectLifecycleStatus, number> = { overdue: 0, active: 1, unknown: 2, ready: 3, done: 4 }
/**
 * 내가 속한 프로젝트의 진척 — 프로젝트 목록과 같은 계산(잎 완료 수·지난 미완·다음 기한, 요청 범위 공유). 지연 → 진행 중 → 시작 전 → 완료 순,
 * 같은 상태 안에서는 진척이 낮은 것부터(먼저 봐야 할 것이 위). 가중 진척·SPI 는 프로젝트 대시보드가 정본이다 — 여기서는 다시 계산하지 않는다.
 */
export async function getProjectProgress(workspaceId: string, actor: Actor, opts: Opts = {}):
  Promise<{ ok: true; rows: ProgressSummaryRow[]; total: number } | Fail> {
  const res = await getProjectRows(workspaceId, actor, { client: opts.client, now: opts.now, t: opts.t, limit: 50 })
  if (!res.ok) return res
  const own = new Set(mine(actor, res.rows.map((p) => p.id)))
  const rows: ProgressSummaryRow[] = res.rows.filter((p) => own.has(p.id)).map((p) => ({
    id: p.id, name: p.name, status: p.status, statusReason: p.statusReason, done: p.progress?.done ?? 0, total: p.progress?.total ?? 0,
    pct: p.progress && p.progress.total > 0 ? Math.floor((p.progress.done / p.progress.total) * 100) : null,
    overdueOpen: p.overdueOpen ?? null, nextDue: p.nextDue,
  }))
  rows.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || (a.pct ?? 101) - (b.pct ?? 101) || a.name.localeCompare(b.name, KO_LOCALE))
  return { ok: true, rows: rows.slice(0, cap(opts.limit, 6, 20)), total: rows.length }
}

// ── 이번 주 일정 ───────────────────────────────────────────────────────────────────────────────────────────────────

export interface WeekItem { kind: 'wbs' | 'issue' | 'meeting'; id: string; title: string; projectName: string; time: string | null; href: string }
export interface WeekDay { date: string; label: string; isToday: boolean; items: WeekItem[] }
const dayLabel = (iso: string) => new Intl.DateTimeFormat(KO_LOCALE, { timeZone: 'UTC', month: 'numeric', day: 'numeric', weekday: 'short' }).format(new Date(`${iso}T00:00:00Z`))
/**
 * 이번 주(워크스페이스 달력의 시간대·주 시작)의 내 회의와 마감 — 날짜별. 마감은 내 업무 원천(왕복 0), 회의는 그 주 범위 한 번.
 * rows 는 항목 전부(0건 판정용), days 는 그 주의 모든 날(빈 날 포함 — 화면이 항목 있는 날만 그린다). 회의·마감 한쪽의 실패는 partial.
 * 워크스페이스 달력을 못 읽으면 실패 — 다른 주를 지어내지 않는다.
 */
export async function getWeekSchedule(workspaceId: string, actor: Actor, opts: Opts = {}):
  Promise<{ ok: true; rows: WeekItem[]; days: WeekDay[]; partial: boolean } | Fail> {
  const now = opts.now ?? new Date()
  const scope = await portalScope(workspaceId, actor, opts.client)
  const cal = requireCalendar(await getWorkspaceConfig(workspaceId, { client: scope.c }))
  const today = todayIn(cal.timezone, now)
  const { start, endExclusive } = weekPeriodOf(cal.weekStart, weekKeyOf(cal.weekStart, today))
  const last = addDaysIso(endExclusive, -1)
  const byDate = new Map<string, WeekItem[]>()
  const put = (date: string, item: WeekItem) => byDate.set(date, [...(byDate.get(date) ?? []), item])
  let partial = scope.failed

  const s = await loadMyWorkSources(workspaceId, actor, opts.client, opts.now)
  if (s.fatal) return { ok: false, error: s.fatal }
  if (s.failedKinds.includes('wbs') || s.failedKinds.includes('issue')) partial = true
  for (const r of [...s.rows.wbs, ...s.rows.issue].sort(compareMyWork)) {
    if (!r.due || r.due < start || r.due > last) continue
    put(r.due, { kind: r.kind as 'wbs' | 'issue', id: r.id, title: r.title, projectName: r.projectName, time: null, href: r.href })
  }
  const meetingOn = new Set(scope.on('meetings'))
  if (meetingOn.size) {
    const res = await getMyMeetings(workspaceId, start, last)
    if (!res.ok) { console.error('[portal] 이번 주 일정 — 회의 조회 실패(마감만 그린다)', workspaceId); partial = true } else {
      const occ = expandMeetings(res.meetings.filter((m) => m.isMine && meetingOn.has(m.projectId)), res.exceptions, start, last)
      const dates = [...new Set(occ.map((o) => o.occurrenceDate))]
      for (const d of dates) for (const o of sortOccurrences(occ.filter((x) => x.occurrenceDate === d))) {
        put(d, { kind: 'meeting', id: o.occurrenceId, title: o.title, projectName: o.projectName ?? '', time: o.startTime ?? null, href: meetingHref(o.projectId, o.seriesId, o.occurrenceDate) })
      }
    }
  }
  const days: WeekDay[] = []
  for (let d = start; d < endExclusive; d = addDaysIso(d, 1)) {
    // 한 날 안에서는 회의(시각 순) 먼저, 그다음 마감 — 시각이 있는 일이 위
    const items = [...(byDate.get(d) ?? [])].sort((a, b) => Number(a.kind !== 'meeting') - Number(b.kind !== 'meeting'))
    days.push({ date: d, label: dayLabel(d), isToday: d === today, items })
  }
  return { ok: true, rows: days.flatMap((d) => d.items), days, partial }
}

// ── 최근 변경 ──────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ChangeRow { id: string; itemId: string; itemName: string; projectId: string; projectName: string; field: string; oldValue: string | null; newValue: string | null; at: string; href: string }
/** 화면이 라벨을 아는 필드만(WBS 상세의 변경 이력과 같은 목록 + 단계·명세) — 사용자 정의 필드 로그(custom:…)는 요약에 싣지 않는다 */
export const CHANGE_FIELDS = ['actual_pct', 'weight', 'created', 'name', 'planned_start', 'planned_end', 'deliverable', 'biz', 'dependency', 'stage', 'spec'] as const
const CHANGE_WINDOW_DAYS = 14
/**
 * 내 프로젝트의 최근 WBS 변경(최근 14일, 최신 순) — change_logs 를 항목의 프로젝트로 거른다(조각마다 상한만큼 읽고 메모리에서 합쳐 자른다).
 * 기간 창을 두는 까닭: 이력은 지워지지 않고 쌓인다 — 창이 없으면 변경이 뜸한 프로젝트 묶음에서 정렬이 표 전체를 훑는다.
 */
export async function getRecentChanges(workspaceId: string, actor: Actor, opts: Opts = {}):
  Promise<{ ok: true; rows: ChangeRow[]; partial: boolean } | Fail> {
  const scope = await portalScope(workspaceId, actor, opts.client)
  const pids = mine(actor, scope.on('wbs'))
  if (!pids.length) return { ok: true, rows: [], partial: false }
  const limit = cap(opts.limit, 8, 20)
  const since = new Date((opts.now ?? new Date()).getTime() - CHANGE_WINDOW_DAYS * 86_400_000).toISOString()
  type R = { id: number; field: string; old_value: string | null; new_value: string | null; at: string
    wbs_items: { id: string; name: string; project_id: string; projects: { name: string } | null } | null }
  const got = (await Promise.all(portalChunks(pids).map(async (ids) => must<R[]>('최근 변경', await scope.c.from('change_logs')
    .select('id, field, old_value, new_value, at, wbs_items!inner(id, name, project_id, projects!inner(name))')
    .in('wbs_items.project_id', ids).in('field', [...CHANGE_FIELDS]).gte('at', since)
    .order('at', { ascending: false }).order('id', { ascending: false }).limit(limit))))).flat()
  got.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : b.id - a.id))
  return { ok: true, partial: false, rows: got.slice(0, limit).flatMap((r) => (r.wbs_items ? [{
    id: String(r.id), itemId: r.wbs_items.id, itemName: r.wbs_items.name, projectId: r.wbs_items.project_id, projectName: r.wbs_items.projects?.name ?? '',
    field: r.field, oldValue: r.old_value, newValue: r.new_value, at: r.at, href: wbsItemHref(r.wbs_items.project_id, r.wbs_items.id),
  }] : [])) }
}

// ── 팀 근태 오늘 ───────────────────────────────────────────────────────────────────────────────────────────────────

export interface AttendanceTodayRow { id: string; name: string; type: string; typeLabel: string | null; projectId: string; projectName: string }
const ATTENDANCE_ROWS_MAX = 200
/**
 * 내 프로젝트 사람들의 오늘 근태 가운데 자리에 없는 것(휴가·출장·재택·결근 — 그 프로젝트 근태 유형의 counts_as 가 work 가 아닌 것).
 * '오늘'은 프로젝트마다 그 시간대. 유형 어휘를 못 읽은 프로젝트는 걸러낼 근거가 없어 그 프로젝트의 기록을 모두 싣고 code 를 그대로 보인다(typeLabel null).
 * 한 사람이 여러 프로젝트에 같은 유형으로 적혀 있으면 한 번만 보인다. 이름 가나다순.
 */
export async function getAttendanceToday(workspaceId: string, actor: Actor, opts: Opts = {}):
  Promise<{ ok: true; rows: AttendanceTodayRow[]; total: number; partial: boolean } | Fail> {
  const scope = await portalScope(workspaceId, actor, opts.client)
  const all = mine(actor, scope.on('attendance'))
  if (!all.length) return { ok: true, rows: [], total: 0, partial: scope.failed }
  const todays = await scope.todays(all, opts.now ?? new Date())
  const known = all.filter((p) => (todays.get(p) ?? null) !== null)
  if (!known.length) return { ok: false, error: '오늘 근태를 불러오지 못했습니다.' }
  const byToday = new Map<string, string[]>()
  for (const p of known) { const d = todays.get(p) as string; byToday.set(d, [...(byToday.get(d) ?? []), p]) }
  type R = { id: string; project_id: string; type: string; projects: { name: string } | null
    project_members: { person_id: string; people: { display_name: string } | null } | null }
  const [vocabs, got] = await Promise.all([
    getProjectVocabs(known, 'attendance.types', { client: scope.c }),
    Promise.all([...byToday].flatMap(([today, pids]) => portalChunks(pids).map(async (ids) => must<R[]>('오늘 근태', await scope.c.from('attendance_records')
      .select('id, project_id, type, projects!inner(name), project_members!inner(person_id, people!inner(display_name))')
      .in('project_id', ids).eq('date', today).order('id').limit(ATTENDANCE_ROWS_MAX))))).then((x) => x.flat()),
  ])
  const seen = new Set<string>()
  const rows: AttendanceTodayRow[] = []
  let vocabMissing = false
  for (const r of got) {
    const vocab = vocabs.get(r.project_id) ?? null
    if (vocab === null) vocabMissing = true
    const def: AttendanceTypeDef | undefined = vocab?.find((d) => d.code === r.type)
    if (def && def.counts_as === 'work') continue
    const key = `${r.project_members?.person_id ?? r.id}:${r.type}`
    if (seen.has(key)) continue
    seen.add(key)
    rows.push({ id: r.id, name: r.project_members?.people?.display_name ?? '', type: r.type, typeLabel: def?.label ?? null, projectId: r.project_id, projectName: r.projects?.name ?? '' })
  }
  rows.sort((a, b) => compareKoreanName(a.name, b.name))
  return { ok: true, rows: rows.slice(0, cap(opts.limit, 10, 30)), total: rows.length, partial: scope.failed || known.length < all.length || vocabMissing || got.length >= ATTENDANCE_ROWS_MAX }
}

// ── 에이전트 현황 ──────────────────────────────────────────────────────────────────────────────────────────────────

export type AgentCountKey = 'claimed' | 'reported' | 'ready'
export interface AgentCountRow { key: AgentCountKey; count: number }
/** 내 프로젝트의 에이전트 작업 수 — 일하는 중(claimed)·결정 대기(reported)·대기(ready). 행을 읽지 않고 수만 센다(head count) */
export async function getAgentsStatus(workspaceId: string, actor: Actor, opts: Opts = {}):
  Promise<{ ok: true; rows: AgentCountRow[]; projects: number; partial: boolean } | Fail> {
  const scope = await portalScope(workspaceId, actor, opts.client)
  const pids = mine(actor, scope.on('agents'))
  if (!pids.length) return { ok: true, rows: [], projects: 0, partial: scope.failed }
  const keys: AgentCountKey[] = ['claimed', 'reported', 'ready']
  const counts = await Promise.all(keys.map(async (key) => {
    const parts = await Promise.all(portalChunks(pids).map(async (ids) => {
      const { count, error } = await scope.c.from('agent_work_orders').select('id', { count: 'exact', head: true }).in('project_id', ids).eq('status', key)
      if (error || typeof count !== 'number') throw new Error(`에이전트 작업 수 조회 실패: ${error?.message ?? 'count 없음'}`)
      return count
    }))
    return { key, count: parts.reduce((a, b) => a + b, 0) }
  }))
  return { ok: true, rows: counts, projects: pids.length, partial: scope.failed }
}

// ── 주간보고 현황 ──────────────────────────────────────────────────────────────────────────────────────────────────

export interface WeeklyStatusRow { projectId: string; projectName: string; weekStart: string; written: boolean; updatedAt: string | null; href: string }
/**
 * 내 프로젝트의 이번 주 주간보고 — 그 프로젝트 달력(시간대·주 시작 규칙)의 이번 주 문서가 있는지. 문서가 없는 프로젝트가 위.
 * 달력을 못 읽은 프로젝트는 주를 지어내지 않고 빼며 partial. 문서는 여기서 만들지 않는다(생성은 주간보고 화면의 RPC 한 길).
 */
export async function getWeeklyReportStatus(workspaceId: string, actor: Actor, opts: Opts = {}):
  Promise<{ ok: true; rows: WeeklyStatusRow[]; partial: boolean } | Fail> {
  const scope = await portalScope(workspaceId, actor, opts.client)
  const all = mine(actor, scope.on('weekly'))
  if (!all.length) return { ok: true, rows: [], partial: scope.failed }
  const now = opts.now ?? new Date()
  const cals = await getProjectCalendars(all, { client: scope.c })
  const weekOf = new Map<string, string>()
  for (const p of all) { const cal = cals.get(p) ?? null; if (cal) weekOf.set(p, weekKeyOf(cal.weekStart, todayIn(cal.timezone, now))) }
  const known = [...weekOf.keys()]
  if (!known.length) return { ok: false, error: '주간보고 현황을 불러오지 못했습니다.' }
  const weeks = [...new Set(weekOf.values())]
  type P = { id: string; name: string }
  type W = { project_id: string; week_start: string; updated_at: string }
  const [projects, reports] = await Promise.all([
    Promise.all(portalChunks(known).map(async (ids) => must<P[]>('프로젝트 이름', await scope.c.from('projects').select('id, name').in('id', ids)))).then((x) => x.flat()),
    Promise.all(portalChunks(known).map(async (ids) => must<W[]>('주간보고 문서', await scope.c.from('weekly_reports')
      .select('project_id, week_start, updated_at').in('project_id', ids).in('week_start', weeks)))).then((x) => x.flat()),
  ])
  const doc = new Map(reports.map((r) => [`${r.project_id}|${r.week_start}`, r]))
  const rows: WeeklyStatusRow[] = projects.map((p) => {
    const week = weekOf.get(p.id) as string
    const d = doc.get(`${p.id}|${week}`)
    return { projectId: p.id, projectName: p.name, weekStart: week, written: !!d, updatedAt: d?.updated_at ?? null, href: weeklyHref(p.id, week) }
  })
  rows.sort((a, b) => Number(a.written) - Number(b.written) || a.projectName.localeCompare(b.projectName, KO_LOCALE))
  return { ok: true, rows: rows.slice(0, cap(opts.limit, 10, 30)), partial: scope.failed || known.length < all.length }
}

// ── 위키 최근 문서 ─────────────────────────────────────────────────────────────────────────────────────────────────

export interface WikiRecentRow { id: string; title: string; projectId: string; projectName: string; changedAt: string; href: string }
/**
 * 위키가 켜진(볼 수 있는) 프로젝트의 최근 바뀐 문서 + 답을 기다리는 질문 수. 질문 수를 못 세면 null(0 으로 그리지 않는다) — 문서 목록은 그대로 그린다.
 */
export async function getWikiRecent(workspaceId: string, actor: Actor, opts: Opts = {}):
  Promise<{ ok: true; rows: WikiRecentRow[]; openQuestions: number | null; partial: boolean } | Fail> {
  const scope = await portalScope(workspaceId, actor, opts.client)
  const pids = scope.on('wiki')
  if (!pids.length) return { ok: true, rows: [], openQuestions: 0, partial: scope.failed }
  const limit = cap(opts.limit, 6, 20)
  type R = { id: string; title: string; project_id: string; last_changed_at: string; projects: { name: string } | null }
  const [topics, questions] = await Promise.all([
    Promise.all(portalChunks(pids).map(async (ids) => must<R[]>('위키 문서', await scope.c.from('wiki_topics')
      .select('id, title, project_id, last_changed_at, projects!inner(name)').in('project_id', ids)
      .order('last_changed_at', { ascending: false }).order('id').limit(limit)))).then((x) => x.flat()),
    Promise.all(portalChunks(pids).map(async (ids) => {
      const { count, error } = await scope.c.from('wiki_questions').select('id', { count: 'exact', head: true }).in('project_id', ids).eq('status', 'open')
      if (error || typeof count !== 'number') throw new Error(error?.message ?? 'count 없음')
      return count
    })).then((x) => x.reduce((a, b) => a + b, 0) as number | null, (e: unknown) => {
      console.error('[portal] 위키 — 답 없는 질문 수 조회 실패(수를 그리지 않는다)', workspaceId, e instanceof Error ? e.message : e)
      return null
    }),
  ])
  topics.sort((a, b) => (a.last_changed_at < b.last_changed_at ? 1 : a.last_changed_at > b.last_changed_at ? -1 : a.id < b.id ? -1 : 1))
  return { ok: true, openQuestions: questions, partial: scope.failed || questions === null, rows: topics.slice(0, limit).map((r) => ({
    id: r.id, title: r.title, projectId: r.project_id, projectName: r.projects?.name ?? '', changedAt: r.last_changed_at, href: wikiTopicHref(r.project_id, r.id),
  })) }
}
