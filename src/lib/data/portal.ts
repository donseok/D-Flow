/**
 * 포털·셸 로더 v0(스펙 §5.9, D20·D39·D40) — 서버 전용, 세션 클라이언트 + RLS(service_role 없음). 원천마다 그 모듈이 effective 인
 * 그 워크스페이스 프로젝트만 읽는다(effectiveModulesMany — 상수 왕복). 여러 프로젝트에 걸친 조회는 끝까지 읽는다(fetchAllPages — D51).
 * 원천 하나의 실패는 failedKinds(전체 실패 아님).
 * '오늘'은 그 데이터가 속한 범위의 tz(SP5 과제 32 — merge 리뷰 P2): 프로젝트 데이터(작업·이슈 기한·회의·공지 게시 기간)는 프로젝트 tz
 * (셸 공지 배지·프로젝트 화면과 같은 판정), 프로젝트 상태(셸 전환기·홈의 프로젝트 행)는 워크스페이스 tz(전체 프로젝트 화면의 상태 배지와 같은 판정).
 * 시각은 함수마다 opts.now(없으면 new Date() 한 번 — 홈 페이지는 세 로더에 같은 now 를 넘긴다, 계획 P8). 달력을 못 읽은 범위는 오늘을 지어내지 않는다.
 * 정렬·커서는 원천마다 끝까지 읽은 뒤 메모리에서 한다(myWork.ts — 기한 null 이 섞인 키셋을 PostgREST 필터로 쓰지 않는다).
 * v1(SP3b UI-3 과제 9): 요약·업무·검토 위젯이 원천 넷을 한 번만 읽는다(loadMyWorkSources — React cache, 인자 동일성 — 홈은 같은 client·now 를
 * 넘긴다, W8). 범위(모듈 판정·가시성)도 요청 범위로 공유한다(scopeOf). 비공개(볼 수 없는) 프로젝트는 요약·다가오는 회의·최근 회의록·프로젝트 행
 * 어디서도 원천 인자에 들지 않는다(canSeeProject).
 */
import { cache } from 'react'
import { createServerClient } from '@/lib/supabase/server'
import { fetchAllPages, type PageResult } from '@/lib/data/paging'
import { getMyMeetings } from '@/lib/data/meetings'
import { filterApprovable } from '@/lib/domain/approvable'
import { loadQueueApprovals } from '@/lib/agent/approvalState'
import type { AdminClient } from '@/lib/minutes/externalApi'
import { effectiveModulesMany } from '@/lib/modules/effectiveMany'
import { effectiveModules } from '@/lib/modules/effective'
import { canSeeProject, isProjectAdmin, isProjectMember, type Actor } from '@/lib/domain/authz'
import { todayIn } from '@/lib/domain/calendar'
import { requireCalendar } from '@/lib/calendar/load'
import { getProjectTimezones } from '@/lib/settings/projectConfig'
import { getWorkspaceConfig } from '@/lib/settings/workspaceConfig'
import { expandMeetings, sortOccurrences } from '@/lib/domain/meetings'
import { addDaysIso } from '@/lib/domain/dates'
import { projectLifecycleStatus, type ProjectLifecycleStatus } from '@/lib/domain/project-status'
import { DEFAULT_ISSUE_STATUSES } from '@/lib/settings/vocab'

/** 이슈 범주 → 표시(SP5b — 지금까지 원 code 'open' 이 그대로 보였다). 포털은 프로젝트를 가로지르므로 범주 라벨로 그린다 */
const issueCategoryLabel = (category: string) => DEFAULT_ISSUE_STATUSES.find((d) => d.code === category)?.label ?? category
import { meetingHref, wbsItemHref } from '@/lib/ai/chat/deep-links'
import { getWorkspacePrefs } from '@/app/actions/preferences'
import { CORE_MODULES, WORKSPACE_SCOPED, type ModuleId } from '@/lib/modules/defaults'
import { MY_WORK_KINDS, compareMyWork, mergeMyWork, openLeafIds, type MyWorkKind, type MyWorkRow } from '@/lib/portal/myWork'
import { isDueToday, summarize, type PortalSummary } from '@/lib/portal/summary'
import { projectProgressMap, statusReason } from '@/lib/portal/projectProgress'

type Db = Awaited<ReturnType<typeof createServerClient>>
type Opts = { client?: Db; now?: Date }
const LIMIT_MAX = 50
/** in() 목록 한 번에 실을 id 수 — 요청 URL 길이 상한 안에 두려고 나눠 묻는다 */
const IN_CHUNK = 200
const OPEN_ISSUE = ['open', 'in_progress', 'on_hold'] as const
const page = <T,>(label: string, build: (from: number, to: number) => unknown) =>
  fetchAllPages<T>(label, build as (from: number, to: number) => PromiseLike<PageResult<T>>)
const chunks = <T,>(xs: readonly T[]): T[][] => Array.from({ length: Math.ceil(xs.length / IN_CHUNK) }, (_, i) => xs.slice(i * IN_CHUNK, (i + 1) * IN_CHUNK))
const overdue = (due: string | null, today: string): number | null => {
  if (!due || due >= today) return null
  return Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`)) / 86_400_000)
}
const errMsg = (e: unknown) => (e instanceof Error ? e.message : e)

/** 프로젝트마다 그 tz 의 오늘. null = 그 프로젝트의 달력을 못 읽음(해석기가 로그). 설정 조회 오류는 throw — 호출부가 원천 실패로 받는다 */
async function projectTodays(client: Db, pids: readonly string[], now: Date): Promise<Map<string, string | null>> {
  const tzs = await getProjectTimezones(pids, { client })
  return new Map(pids.map((p) => { const tz = tzs.get(p) ?? null; return [p, tz === null ? null : todayIn(tz, now)] }))
}

/** 워크스페이스 tz 의 오늘 — 프로젝트 상태용. 설정 조회 실패·달력 손상은 null + 로그(목록 전체를 막지 않는다 — 상태만 모름) */
async function workspaceToday(client: Db, workspaceId: string, now: Date): Promise<string | null> {
  try {
    return todayIn(requireCalendar(await getWorkspaceConfig(workspaceId, { client })).timezone, now)
  } catch (e) {
    console.error('[portal] 워크스페이스 달력을 읽지 못해 프로젝트 상태를 모름으로 둔다', workspaceId, errMsg(e))
    return null
  }
}

/** 그 워크스페이스의 프로젝트 — actor.projectWorkspace 가 정본(조회 없음, 다른 워크스페이스 프로젝트는 여기서 빠진다) */
const projectsIn = (actor: Actor, workspaceId: string) => [...actor.projectWorkspace].filter(([, w]) => w === workspaceId).map(([p]) => p)
const myMemberIdsIn = (actor: Actor, pids: readonly string[]) => pids.map((p) => actor.memberIds.get(p)).filter((x): x is string => !!x)

/** 모듈별 effective 프로젝트. core 모듈은 판정 없이 전부(꺼질 수 없다), 비core 는 판정에 성공해 켜진 것만(실패는 fail-closed + failed) */
async function moduleProjects(workspaceId: string, pids: string[], client: Db): Promise<{ on: (m: ModuleId) => string[]; failed: boolean }> {
  return modsOf(pids, await effectiveModulesMany(workspaceId, pids, { client }))
}
function modsOf(pids: readonly string[], many: { sets: ReadonlyMap<string, ReadonlySet<ModuleId>>; failed: readonly string[] }) {
  return { on: (m: ModuleId) => (CORE_MODULES.includes(m) ? [...pids] : pids.filter((p) => many.sets.get(p)?.has(m))), failed: many.failed.length > 0 }
}

/**
 * 화면에서 볼 수 있는 프로젝트(canSeeProject — 비공개 프로젝트는 명단·워크스페이스 관리자만, 0070 의미). 프로젝트를 가로지르는 목록은 모두 이 거르기를 거친다
 * (공지 RLS 같은 읽기 정책은 비공개를 거르지 않는다 — 비공개는 앱 층 화면 숨김). 조회 실패는 throw — 호출부가 원천 실패로 받는다(숨길 것을 못 숨기느니 막는다).
 */
async function visibleProjectIds(client: Db, actor: Actor, pids: readonly string[]): Promise<Set<string>> {
  const rows = (await Promise.all(chunks(pids).map((ids) => page<{ id: string; is_private: boolean | null }>('프로젝트 가시성', (f, t) => client.from('projects')
    .select('id, is_private', { count: 'exact' }).in('id', ids).order('id').range(f, t))))).flat()
  return new Set(rows.filter((p) => canSeeProject(actor, p)).map((p) => p.id))
}

/**
 * 요청 범위의 판정 묶음(v1) — 그 워크스페이스 프로젝트·여러 프로젝트 모듈 판정·가시성을 한 번만(React cache — 인자 동일성). 실패는 던진다(호출부가
 * 자기 실패 관례로 받는다 — 거부된 프라미스도 메모된다). client 는 넘긴 것(테스트·홈의 공유) 또는 그 묶음이 만든 세션 클라이언트.
 */
const scopeOf = cache(async (workspaceId: string, actor: Actor, client: Db | undefined) => {
  const c = client ?? (await createServerClient())
  const pids = projectsIn(actor, workspaceId)
  if (!pids.length) return { c, pids, many: { sets: new Map<string, ReadonlySet<ModuleId>>(), failed: [] as string[] }, visible: new Set<string>() }
  const [many, visible] = await Promise.all([effectiveModulesMany(workspaceId, pids, { client: c }), visibleProjectIds(c, actor, pids)])
  return { c, pids, many, visible }
})

async function wbsRows(client: Db, actor: Actor, pids: string[], todays: ReadonlyMap<string, string | null>): Promise<MyWorkRow[]> {
  if (!myMemberIdsIn(actor, pids).length) return []
  type R = { id: string; name: string; project_id: string; planned_end: string | null; actual_pct: number | null; projects: { name: string } | null }
  // 프로젝트 id 목록도 나눠 묻는다(요청 URL 길이) — 명단 id 는 프로젝트마다 하나라 같은 조각의 프로젝트에서 고른다
  const items = (await Promise.all(chunks(pids).map((ids) => {
    const mine = myMemberIdsIn(actor, ids)
    return mine.length ? page<R>('내 담당 작업', (f, t) => client.from('wbs_items')
      .select('id, name, project_id, planned_end, actual_pct, projects!inner(name)', { count: 'exact' })
      .in('project_id', ids).in('assignee_member_id', mine).order('id').range(f, t)) : Promise.resolve([] as R[])
  }))).flat()
  if (!items.length) return []
  const kids = (await Promise.all(chunks(items.map((i) => i.id)).map((ids) => page<{ parent_id: string }>('내 담당 작업의 하위', (f, t) => client.from('wbs_items')
    .select('parent_id', { count: 'exact' }).in('parent_id', ids).order('id').range(f, t))))).flat()
  const open = openLeafIds(items, new Set(kids.map((k) => k.parent_id)))
  return items.filter((i) => open.has(i.id)).map((i) => ({
    kind: 'wbs', id: i.id, title: i.name, projectId: i.project_id, projectName: i.projects?.name ?? '',
    due: i.planned_end, overdueDays: overdue(i.planned_end, todays.get(i.project_id) as string), status: i.actual_pct === null ? '미착수' : `${Number(i.actual_pct)}%`,
    href: wbsItemHref(i.project_id, i.id),
  }))
}

async function issueRows(client: Db, actor: Actor, pids: string[], todays: ReadonlyMap<string, string | null>): Promise<MyWorkRow[]> {
  if (!pids.length || !myMemberIdsIn(actor, pids).length) return []
  type R = { issue_id: string; issues: { id: string; title: string; status: string; due_date: string | null; project_id: string; projects: { name: string } | null } | null }
  const rows = (await Promise.all(chunks(pids).map((ids) => {
    const mine = myMemberIdsIn(actor, ids)
    return mine.length ? page<R>('내 담당 이슈', (f, t) => client.from('issue_assignees')
      .select('issue_id, issues!inner(id, title, status, due_date, project_id, projects!inner(name))', { count: 'exact' })
      .in('project_id', ids).in('member_id', mine).in('issues.status', [...OPEN_ISSUE]).order('issue_id').order('member_id').range(f, t)) : Promise.resolve([] as R[])
  }))).flat()
  const seen = new Set<string>()
  return rows.flatMap((r) => (r.issues && !seen.has(r.issues.id) && seen.add(r.issues.id) ? [{
    kind: 'issue' as const, id: r.issues.id, title: r.issues.title, projectId: r.issues.project_id, projectName: r.issues.projects?.name ?? '',
    due: r.issues.due_date, overdueDays: overdue(r.issues.due_date, todays.get(r.issues.project_id) as string), status: issueCategoryLabel(r.issues.status), href: `/p/${r.issues.project_id}/issues?focus=${r.issues.id}`,
  }] : []))
}

/**
 * 내가 승인할 수 있는 보고됨 주문(D40) — 결재 배지(getPendingApprovalCount)와 같은 축: 관리자는 전부, 멤버는 서브트리 판정, 조회 전용은 없음.
 * 주문 1왕복(리프 이름·프로젝트 이름 임베드), 관리자가 아닌 멤버 프로젝트가 남으면 그 프로젝트들의 항목 트리 1왕복(최대 2).
 */
async function approvalRows(client: Db, actor: Actor, pids: string[]): Promise<MyWorkRow[]> {
  const eligible = pids.filter((p) => isProjectAdmin(actor, p) || isProjectMember(actor, p))
  if (!eligible.length) return []
  type O = { id: string; project_id: string; wbs_item_id: string | null; claimed_by_user_id: string | null; created_at: string
    wbs_items: { name: string } | null; projects: { name: string } | null }
  const orders = (await Promise.all(chunks(eligible).map((ids) => page<O>('결재 대기 주문', (f, t) => client.from('agent_work_orders')
    .select('id, project_id, wbs_item_id, claimed_by_user_id, created_at, wbs_items(name), projects!inner(name)', { count: 'exact' })
    .in('project_id', ids).eq('status', 'reported').order('id').range(f, t))))).flat()
  if (!orders.length) return []
  const need = [...new Set(orders.map((o) => o.project_id))]
  const treeFor = need.filter((p) => !isProjectAdmin(actor, p))
  type I = { id: string; parent_id: string | null; assignee_member_id: string | null; project_id: string }
  const items = (await Promise.all(chunks(treeFor).map((ids) => page<I>('결재 대기 항목 트리', (f, t) => client.from('wbs_items')
    .select('id, parent_id, assignee_member_id, project_id', { count: 'exact' }).in('project_id', ids).order('id').range(f, t))))).flat()
  // 대기 승인 단계(SP5b S20 — 결재 배지와 같은 셈). 세션 클라이언트라 RLS 안에서만 읽는다. 판독 실패는 로그 + 현행 셈(loadQueueApprovals 의 계약)
  const stepsByProject = new Map(await Promise.all(need.map(async (pid) => [pid, Object.fromEntries(await loadQueueApprovals(
    client as unknown as AdminClient, pid, [...new Set(orders.filter((o) => o.project_id === pid && o.wbs_item_id !== null).map((o) => o.wbs_item_id as string))],
  ))] as const)))
  const out: MyWorkRow[] = []
  for (const pid of need) {
    const own = actor.memberIds.get(pid)
    const viewer = { isAdmin: isProjectAdmin(actor, pid), memberIds: own ? [own] : [], userId: actor.userId }
    for (const o of filterApprovable(orders.filter((x) => x.project_id === pid), items.filter((i) => i.project_id === pid), viewer, stepsByProject.get(pid))) {
      out.push({ kind: 'approval', id: o.id, title: o.wbs_items?.name ?? '에이전트 작업 보고', projectId: pid, projectName: o.projects?.name ?? '',
        due: null, overdueDays: null, status: '검토 대기', href: `/p/${pid}/agents` })
    }
  }
  return out
}

/** 오늘 회의 — 프로젝트마다 그 tz 의 오늘(todays 는 오늘을 아는 프로젝트만). 아는 오늘들의 최소~최대로 한 번 읽고 프로젝트마다 그 날짜만 남긴다 */
async function meetingRows(workspaceId: string, todays: ReadonlyMap<string, string | null>): Promise<MyWorkRow[]> {
  const days = [...todays.values()].filter((d): d is string => d !== null).sort()
  if (!days.length) return []
  const res = await getMyMeetings(workspaceId, days[0], days[days.length - 1])   // 꺼진 모듈·비공개(명단 밖) 프로젝트의 행은 로더가 뺀다(FA1) — 아래 거르기는 방어로 남긴다
  if (!res.ok) throw new Error(res.error)
  return expandMeetings(res.meetings.filter((m) => m.isMine), res.exceptions, days[0], days[days.length - 1])
    .filter((o) => todays.get(o.projectId) === o.occurrenceDate).map((o) => ({
    kind: 'meeting', id: o.occurrenceId, title: o.title, projectId: o.projectId, projectName: o.projectName ?? '',
    due: o.occurrenceDate, overdueDays: null, status: o.startTime ?? '종일', href: meetingHref(o.projectId, o.seriesId, o.occurrenceDate),
  }))
}

const SOURCE_MODULE: Record<MyWorkKind, ModuleId> = { wbs: 'wbs', issue: 'issues', approval: 'agents', meeting: 'meetings' }

export interface MyWorkSources {
  rows: Record<MyWorkKind, MyWorkRow[]>; failedKinds: MyWorkKind[]
  /** 모듈·가시성 판정 실패 — 그리지 않는다(비공개 프로젝트 이름을 샐 수 있다) */
  fatal: string | null
  /** 볼 수 있는 프로젝트(canSeeProject)·프로젝트마다 그 tz 의 오늘(판정 R1 — 요약의 오늘 마감·업무 위젯이 같은 값을 쓴다) */
  visible: ReadonlySet<string>; todays: ReadonlyMap<string, string | null>
}
const EMPTY_ROWS = (): Record<MyWorkKind, MyWorkRow[]> => ({ wbs: [], issue: [], approval: [], meeting: [] })

/**
 * 원천 넷을 한 번 읽는다(W8) — 요약·업무 위젯·검토 위젯이 같은 요청에서 공유한다(React cache, 인자 동일성: 홈은 같은 client·now 를 넘긴다).
 * 원천 하나의 실패는 failedKinds, 모듈·가시성 판정 실패는 fatal. 프로젝트 tz 판독이 실패하면 오늘이 필요한 원천(작업·이슈·회의)은 실패로.
 */
export const loadMyWorkSources = cache(async (workspaceId: string, actor: Actor, client: Db | undefined, now: Date | undefined): Promise<MyWorkSources> => {
  if (!projectsIn(actor, workspaceId).length) return { rows: EMPTY_ROWS(), failedKinds: [], fatal: null, visible: new Set(), todays: new Map() }
  let sc: Awaited<ReturnType<typeof scopeOf>>
  // 모듈 판정과 가시성(비공개 거르기)을 함께 — 둘 다 못 읽으면 내 업무를 그리지 않는다(비공개 프로젝트 이름을 샐 수 있다)
  try { sc = await scopeOf(workspaceId, actor, client) } catch (e) {
    console.error('[portal] 모듈·가시성 판정 실패', workspaceId, errMsg(e))
    return { rows: EMPTY_ROWS(), failedKinds: [], fatal: '내 업무를 불러오지 못했습니다.', visible: new Set(), todays: new Map() }
  }
  const { c, visible } = sc
  const mods = modsOf(sc.pids, sc.many)
  const failedKinds: MyWorkKind[] = []
  // 프로젝트마다 그 tz 의 오늘(기한·오늘 회의). 판독 자체가 실패하면 오늘이 필요한 원천은 모두 실패로(전체 실패는 아니다 — 결재 대기는 오늘이 필요 없다)
  let todays: Map<string, string | null>
  try { todays = await projectTodays(c, [...visible], now ?? new Date()) } catch (e) {
    console.error('[portal] 프로젝트 시간대 판독 실패 — 오늘이 필요한 원천을 실패로', workspaceId, errMsg(e))
    todays = new Map()
  }
  const run = async (kind: MyWorkKind): Promise<MyWorkRow[]> => {
    // 일부 프로젝트의 판정 실패 — 비core 원천은 그 프로젝트 행이 빠졌을 수 있다고 알린다(core 는 판정과 무관하게 읽는다)
    if (mods.failed && !CORE_MODULES.includes(SOURCE_MODULE[kind])) failedKinds.push(kind)
    let on = mods.on(SOURCE_MODULE[kind]).filter((p) => visible.has(p))
    if (!on.length) return []                                          // 어디서도 effective 가 아니면 조회하지 않는다(D39)
    if (kind !== 'approval') {
      // 오늘을 모르는 프로젝트는 그 원천에서 뺀다 — 지연 일수·오늘 회의를 지어내지 않고(3원칙 ①) 빠졌음을 알린다
      const known = on.filter((p) => (todays.get(p) ?? null) !== null)
      if (known.length < on.length) failedKinds.push(kind)
      on = known
      if (!on.length) return []
    }
    try {
      if (kind === 'wbs') return await wbsRows(c, actor, on, todays)
      if (kind === 'issue') return await issueRows(c, actor, on, todays)
      if (kind === 'approval') return await approvalRows(c, actor, on)
      return await meetingRows(workspaceId, new Map(on.map((p) => [p, todays.get(p) ?? null])))
    } catch (e) {
      console.error('[portal] 원천 실패', kind, workspaceId, errMsg(e))
      failedKinds.push(kind)
      return []
    }
  }
  const [wbs, issue, approval, meeting] = await Promise.all(MY_WORK_KINDS.map(run))
  return { rows: { wbs, issue, approval, meeting }, failedKinds: [...new Set(failedKinds)], fatal: null, visible, todays }
})

/** 내 업무 — dueToday 면 작업·이슈 가운데 기한이 그 프로젝트의 오늘인 행만(합치기 전에 거른다 — W7·R1) */
export async function getMyWork(workspaceId: string, actor: Actor, opts: { kinds?: MyWorkKind[]; cursor?: string | null; limit?: number; dueToday?: boolean } & Opts = {}):
  Promise<{ ok: true; rows: MyWorkRow[]; nextCursor: string | null; failedKinds: MyWorkKind[] } | { ok: false; error: string }> {
  const kinds = (opts.kinds?.length ? opts.kinds : MY_WORK_KINDS).filter((k) => MY_WORK_KINDS.includes(k))
  const limit = Math.min(Math.max(1, opts.limit ?? 20), LIMIT_MAX)
  const s = await loadMyWorkSources(workspaceId, actor, opts.client, opts.now)
  if (s.fatal) return { ok: false, error: s.fatal }
  const sources = kinds.map((k) => (opts.dueToday ? s.rows[k].filter((r) => isDueToday(r, s.todays)) : s.rows[k]))
  return { ok: true, ...mergeMyWork(sources, opts.cursor ?? null, limit), failedKinds: s.failedKinds.filter((k) => kinds.includes(k)) }
}

/** 요약 수치 셋(스펙 §6.1) — 업무 위젯과 같은 원천(왕복이 늘지 않는다). 검토 칸은 홈이 검토자에게만 그린다 */
export async function getPortalSummary(workspaceId: string, actor: Actor, opts: Opts = {}): Promise<PortalSummary> {
  return summarize(await loadMyWorkSources(workspaceId, actor, opts.client, opts.now))
}

/** 검토 위젯 행(D40 — 내가 승인할 수 있는 보고됨 주문, 최대 20) — 같은 원천. 원천 실패는 0건으로 위장하지 않는다 */
export async function getReviewRows(workspaceId: string, actor: Actor, opts: { limit?: number } & Opts = {}):
  Promise<{ ok: true; rows: MyWorkRow[] } | { ok: false; error: string }> {
  const s = await loadMyWorkSources(workspaceId, actor, opts.client, opts.now)
  if (s.fatal) return { ok: false, error: s.fatal }
  if (s.failedKinds.includes('approval')) return { ok: false, error: '검토 대기를 불러오지 못했습니다.' }
  return { ok: true, rows: [...s.rows.approval].sort(compareMyWork).slice(0, Math.min(Math.max(1, opts.limit ?? 20), 20)) }
}

/**
 * 셸 배지의 검토 대기 수 — 셸 경로(/api/shell)가 자주 부르므로 원천 하나(결재 대기)만 읽는 가벼운 판을 둔다(홈은 요약의 검토 칸을 쓴다).
 * null = 조회 실패(0 으로 위장하지 않는다 — D34·D40)
 */
export async function countMyReview(workspaceId: string, actor: Actor, opts: Opts = {}): Promise<number | null> {
  try {
    const client = opts.client ?? (await createServerClient())
    const pids = projectsIn(actor, workspaceId)
    if (!pids.length) return 0
    const mods = await moduleProjects(workspaceId, pids, client)
    if (mods.failed) { console.error('[portal] 검토 대기 수 — 일부 프로젝트의 모듈 판정 실패(수를 모른다)', workspaceId); return null }
    return (await approvalRows(client, actor, mods.on('agents'))).length
  } catch (e) {
    console.error('[portal] 검토 대기 수 실패', workspaceId, errMsg(e))
    return null
  }
}

export type WorkspaceModuleSets =
  | { ok: true; sets: Map<string, ReadonlySet<ModuleId>>; union: Set<ModuleId>; partial: boolean }
  | { ok: false; error: string }
/**
 * 홈 노출 식의 모듈 합집합(스펙 §6.1, W10) — 볼 수 있는 프로젝트들의 effective 모듈 합 ∪ 워크스페이스 층 모듈(회의록 등 — 워크스페이스 범위 판정,
 * 회의록 화면 관문 requireModulePage({ workspaceId }, 'minutes') 와 같은 판정. 접근 가능한 프로젝트가 0개여도 워크스페이스 회의록은 있다 — R9 ③).
 * 판정 실패는 ok:false(합집합을 비우지 않는다 — 페이지가 모듈 위젯을 실패 카드로). 판정에 실패한 프로젝트의 모듈은 합집합에 넣지 않고 partial.
 * React cache — 인자 동일성으로 메모되므로 옵션 객체가 아니라 클라이언트를 셋째 인자로 받는다.
 */
export const workspaceModuleSets = cache(async (workspaceId: string, actor: Actor, client?: Db): Promise<WorkspaceModuleSets> => {
  try {
    const sc = await scopeOf(workspaceId, actor, client)
    const ws = await effectiveModules({ workspaceId }, { client: sc.c })
    const sets = new Map<string, ReadonlySet<ModuleId>>()
    const union = new Set<ModuleId>([...ws].filter((m) => WORKSPACE_SCOPED.has(m)))
    for (const [pid, set] of sc.many.sets) {
      if (!sc.visible.has(pid) || sc.many.failed.includes(pid)) continue
      sets.set(pid, set)
      set.forEach((m) => union.add(m))
    }
    return { ok: true, sets, union, partial: sc.many.failed.some((p) => sc.visible.has(p)) }
  } catch (e) {
    console.error('[portal] 모듈 합집합 실패', workspaceId, errMsg(e))
    return { ok: false, error: '모듈 상태를 확인하지 못했습니다.' }
  }
})

export interface UpcomingRow { id: string; title: string; projectId: string; projectName: string; date: string; startTime: string | null; href: string }
/**
 * 다가오는 회의(W9) — 내가 참석자인 회차, 그 프로젝트의 오늘부터 days(기본 30)일, 날짜 → 종일 먼저 → 시각 → 제목 순. 회의가 effective 이고 볼 수 있는
 * 프로젝트만(로더 getMyMeetings 도 꺼진 모듈·명단 밖 비공개를 빼지만 여기서 다시 거른다). 오늘을 모르는 프로젝트는 빼고 partial
 */
export async function getUpcomingMeetings(workspaceId: string, actor: Actor, opts: { limit?: number; days?: number } & Opts = {}):
  Promise<{ ok: true; rows: UpcomingRow[]; partial: boolean } | { ok: false; error: string }> {
  try {
    if (!projectsIn(actor, workspaceId).length) return { ok: true, rows: [], partial: false }
    const sc = await scopeOf(workspaceId, actor, opts.client)
    const mods = modsOf(sc.pids, sc.many)
    const on = mods.on('meetings').filter((p) => sc.visible.has(p))
    if (!on.length) return { ok: true, rows: [], partial: mods.failed }
    const span = Math.min(Math.max(1, opts.days ?? 30), 90)
    const todays = await projectTodays(sc.c, on, opts.now ?? new Date())
    const known = on.filter((p) => (todays.get(p) ?? null) !== null)
    const partial = mods.failed || known.length < on.length
    if (known.length < on.length) console.error('[portal] 다가오는 회의 — 달력을 못 읽은 프로젝트는 뺐다', workspaceId)
    if (!known.length) return { ok: false, error: '다가오는 회의를 불러오지 못했습니다.' }
    const days = known.map((p) => todays.get(p) as string).sort()
    const from = days[0], to = addDaysIso(days[days.length - 1], span)
    const res = await getMyMeetings(workspaceId, from, to)
    if (!res.ok) throw new Error(res.error)
    const ok = new Set(known)
    const inWindow = (pid: string, d: string) => { const t = todays.get(pid) as string; return d >= t && d <= addDaysIso(t, span) }
    const occ = expandMeetings(res.meetings.filter((m) => m.isMine && ok.has(m.projectId)), res.exceptions, from, to)
      .filter((o) => ok.has(o.projectId) && inWindow(o.projectId, o.occurrenceDate))
    const byDate = new Map<string, typeof occ>()
    for (const o of occ) byDate.set(o.occurrenceDate, [...(byDate.get(o.occurrenceDate) ?? []), o])
    const sorted = [...byDate.keys()].sort().flatMap((d) => sortOccurrences(byDate.get(d)!))
    const rows = sorted.slice(0, Math.min(Math.max(1, opts.limit ?? 5), 20)).map((o) => ({
      id: o.occurrenceId, title: o.title, projectId: o.projectId, projectName: o.projectName ?? '', date: o.occurrenceDate, startTime: o.startTime ?? null,
      href: meetingHref(o.projectId, o.seriesId, o.occurrenceDate),
    }))
    return { ok: true, rows, partial }
  } catch (e) {
    console.error('[portal] 다가오는 회의 실패', workspaceId, errMsg(e))
    return { ok: false, error: '다가오는 회의를 불러오지 못했습니다.' }
  }
}

export interface RecentDoc { id: string; title: string; date: string | null; projectName: string | null; updatedAt: string }
/**
 * 최근 회의록(스펙 §6.1 recent_docs) — 그 워크스페이스·보관 안 됨, 최신 수정 순. 워크스페이스 회의록(프로젝트·회의 없음)은 워크스페이스 범위에서
 * 회의록이 켜졌을 때, 프로젝트 회의록은 볼 수 있고 회의록이 effective 인 프로젝트의 것만. 프로젝트 칸이 비고 회의로 연결된 옛 행은 회의의 프로젝트로
 * 판정한다(회의록 목록의 dropHidden 과 같은 규칙) — 비공개 프로젝트의 회의록은 조회 인자에도 들지 않는다. 묶음마다 상한만큼 묻고 메모리에서 합쳐 자른다.
 */
export async function getRecentDocuments(workspaceId: string, actor: Actor, opts: { limit?: number } & Opts = {}):
  Promise<{ ok: true; rows: RecentDoc[] } | { ok: false; error: string }> {
  try {
    const sc = await scopeOf(workspaceId, actor, opts.client)
    // 판정 실패로 빠진 프로젝트가 있으면 최신 목록인지 알 수 없다. 숨긴 프로젝트의 실패는 이 목록과 무관하다.
    if (sc.many.failed.some((pid) => sc.visible.has(pid))) throw new Error('프로젝트의 회의록 모듈 상태를 확인하지 못했습니다.')
    const ws = await effectiveModules({ workspaceId }, { client: sc.c })
    const wsOn = ws.has('minutes')
    const projOn = modsOf(sc.pids, sc.many).on('minutes').filter((p) => sc.visible.has(p))
    if (!wsOn && !projOn.length) return { ok: true, rows: [] }
    const limit = Math.min(Math.max(1, opts.limit ?? 5), 20)
    type R = { id: string; title: string; minute_date: string | null; updated_at: string; project_id: string | null
      projects: { name: string } | null; meetings: { project_id: string; projects: { name: string } | null } | null }
    // 열 이름은 리터럴로(minutes 열 단위 SELECT 불변식 — H2-c). 회의로 연결된 옛 행만 회의를 inner 로 묶어 그 회의의 프로젝트로 거른다
    const plain = () => sc.c.from('minutes').select('id, title, minute_date, updated_at, project_id, projects(name), meetings(project_id, projects(name))')
      .eq('workspace_id', workspaceId).is('archived_at', null)
    const linked = () => sc.c.from('minutes').select('id, title, minute_date, updated_at, project_id, projects(name), meetings!inner(project_id, projects(name))')
      .eq('workspace_id', workspaceId).is('archived_at', null)
    const run = async (q: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<R[]> => {
      const { data, error } = await q
      if (error) throw new Error(error.message)
      return (data ?? []) as R[]
    }
    const tasks: Promise<R[]>[] = []
    if (wsOn) tasks.push(run(plain().is('project_id', null).is('meeting_id', null).order('updated_at', { ascending: false }).order('id').limit(limit)))
    for (const ids of chunks(projOn)) {
      tasks.push(run(plain().in('project_id', ids).order('updated_at', { ascending: false }).order('id').limit(limit)))
      tasks.push(run(linked().is('project_id', null).in('meetings.project_id', ids).order('updated_at', { ascending: false }).order('id').limit(limit)))
    }
    const seen = new Set<string>()
    const rows = (await Promise.all(tasks)).flat().filter((r) => !seen.has(r.id) && !!seen.add(r.id))
    rows.sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : a.id < b.id ? -1 : 1))
    return { ok: true, rows: rows.slice(0, limit).map((r) => ({ id: r.id, title: r.title, date: r.minute_date, updatedAt: r.updated_at,
      projectName: r.projects?.name ?? r.meetings?.projects?.name ?? null })) }
  } catch (e) {
    console.error('[portal] 최근 회의록 실패', workspaceId, errMsg(e))
    return { ok: false, error: '최근 회의록을 불러오지 못했습니다.' }
  }
}

export interface ShellProject { id: string; name: string; status: ProjectLifecycleStatus; isAdmin: boolean }
type PRow = { id: string; name: string; start_date: string | null; end_date: string | null; is_private: boolean | null }

/** 셸용 가벼운 목록(전환기·즐겨찾기 교차) — 1왕복. 상태는 진척 없이 계산(종료일 지난 프로젝트는 'unknown' — 셸은 그 칩을 중립으로 그린다) */
export const listWorkspaceProjects = cache(async (workspaceId: string, actor: Actor | null, opts: Opts = {}):
  Promise<{ ok: true; rows: ShellProject[] } | { ok: false; error: string }> => {
  try {
    const client = opts.client ?? (await createServerClient())
    const rows = await page<PRow>('워크스페이스 프로젝트', (f, t) => client.from('projects')
      .select('id, name, start_date, end_date, is_private', { count: 'exact' }).eq('workspace_id', workspaceId).order('name').order('id').range(f, t))
    const today = await workspaceToday(client, workspaceId, opts.now ?? new Date())   // 못 읽으면 상태만 모름(목록은 그린다)
    return { ok: true, rows: rows.filter((p) => canSeeProject(actor, p)).map((p) => ({
      id: p.id, name: p.name, status: today === null ? 'unknown' : projectLifecycleStatus(p.start_date, p.end_date, today, null), isAdmin: isProjectAdmin(actor, p.id),
    })) }
  } catch (e) {
    console.error('[portal] 셸 프로젝트 목록 실패', workspaceId, errMsg(e))
    return { ok: false, error: '프로젝트 목록을 불러오지 못했습니다.' }
  }
})

export interface ProjectRow {
  id: string; name: string; description: string | null; status: ProjectLifecycleStatus; statusReason: string
  startDate: string | null; endDate: string | null; isFavorite: boolean
  /** 완료 잎/전체 잎(W5). null = 잎 조회 실패(모름) */
  progress: { done: number; total: number } | null
  /** 오늘 이후 미완 잎의 가장 이른 기한(워크스페이스 오늘 기준). 오늘을 모르면 null */
  nextDue: string | null
}
type PRowV1 = PRow & { description: string | null }
type LeafRow = { id: string; parent_id: string | null; project_id: string; actual_pct: number | null; planned_end: string | null }

/**
 * 프로젝트 행 v1(W5·W6) — 상태의 '오늘'은 워크스페이스 tz(판정 R1 — 전체 프로젝트 화면의 상태 배지와 같은 판정). 진척은 그 워크스페이스의 볼 수 있는
 * 프로젝트 잎만 끝까지 읽는다(.range — 전역 완료 조회 getProjectsCompletion 은 1,000행에서 잘리고 범위가 넓다). 즐겨찾기 표시를 위해 개인 설정을 늘 읽는다.
 */
export async function getProjectRows(workspaceId: string, actor: Actor, opts: { q?: string; status?: ProjectLifecycleStatus; favoritesOnly?: boolean; cursor?: string | null; limit?: number } & Opts = {}):
  Promise<{ ok: true; rows: ProjectRow[]; nextCursor: string | null } | { ok: false; error: string }> {
  const limit = Math.min(Math.max(1, opts.limit ?? 20), LIMIT_MAX)
  try {
    const client = opts.client ?? (await createServerClient())
    const [rows, prefs, today] = await Promise.all([
      page<PRowV1>('프로젝트 행', (f, t) => {
        let q = client.from('projects').select('id, name, description, start_date, end_date, is_private', { count: 'exact' }).eq('workspace_id', workspaceId)
        if (opts.q?.trim()) q = q.ilike('name', `%${opts.q.trim().replace(/[%_*\\]/g, (c) => `\\${c}`)}%`)
        return q.order('name').order('id').range(f, t)
      }),
      // 개인 설정은 표시용(즐겨찾기 별) — 못 읽으면 별 없이 그리되, 즐겨찾기만 거르는 요청은 빈 목록으로 위장하지 않고 실패로(3원칙 ①)
      getWorkspacePrefs(workspaceId, { strict: true }).then((p) => p, (e: unknown) => { console.error('[portal] 프로젝트 행 — 개인 설정 조회 실패', workspaceId, errMsg(e)); return null }),
      workspaceToday(client, workspaceId, opts.now ?? new Date()),
    ])
    // 상태로 거르는데 오늘을 모르면 모든 행이 '모름'이라 거른 결과가 빈 목록으로 위장된다 — 실패로 알린다(3원칙 ①)
    if (today === null && opts.status) return { ok: false, error: '프로젝트를 불러오지 못했습니다.' }
    if (prefs === null && opts.favoritesOnly) return { ok: false, error: '즐겨찾기를 불러오지 못했습니다.' }
    const visible = rows.filter((p) => canSeeProject(actor, p))
    const ids = visible.map((p) => p.id)
    let leaves: LeafRow[] | null = []
    if (ids.length) {
      try {
        leaves = (await Promise.all(chunks(ids).map((part) => page<LeafRow>('프로젝트 진척', (f, t) => client.from('wbs_items')
          .select('id, parent_id, project_id, actual_pct, planned_end', { count: 'exact' }).in('project_id', part).order('id').range(f, t))))).flat()
      } catch (e) {
        console.error('[portal] 프로젝트 진척 실패(진척·종료 판정을 모름으로)', workspaceId, errMsg(e))
        leaves = null
      }
    }
    const progress = leaves === null ? null
      : projectProgressMap(leaves.map((i) => ({ id: i.id, parentId: i.parent_id, projectId: i.project_id, actualPct: i.actual_pct, plannedEnd: i.planned_end })), today)
    const fav = new Set(prefs?.favoriteProjectIds ?? [])
    const all: ProjectRow[] = visible.map((p) => {
      const pr = progress ? progress[p.id] ?? null : null
      const status: ProjectLifecycleStatus = today === null ? 'unknown'
        : projectLifecycleStatus(p.start_date, p.end_date, today, progress === null ? null : (pr ?? { hasWbs: false, allDone: false }))
      return {
        id: p.id, name: p.name, description: p.description ?? null, startDate: p.start_date, endDate: p.end_date, isFavorite: fav.has(p.id), status,
        statusReason: today === null ? '오늘 날짜(워크스페이스 시간대)를 확인하지 못했습니다' : statusReason(status, pr),
        progress: pr ? { done: pr.done, total: pr.total } : (progress === null ? null : { done: 0, total: 0 }), nextDue: pr?.nextDue ?? null,
      }
    }).filter((p) => (!opts.status || p.status === opts.status) && (!opts.favoritesOnly || p.isFavorite))
    const start = opts.cursor ? all.findIndex((p) => p.id === opts.cursor) + 1 : 0
    const slice = all.slice(start, start + limit)
    return { ok: true, rows: slice, nextCursor: start + limit < all.length ? slice[slice.length - 1].id : null }
  } catch (e) {
    console.error('[portal] 프로젝트 행 실패', workspaceId, errMsg(e))
    return { ok: false, error: '프로젝트를 불러오지 못했습니다.' }
  }
}

/**
 * 그 워크스페이스 프로젝트의 게시 중 공지 — announcements 가 effective 이고 화면에서 볼 수 있는(비공개는 명단·워크스페이스 관리자만) 프로젝트만
 * (D20 — 티커를 지우는 UI-2b 의 대체 표면). partial = 모듈 판정이 일부 프로젝트에서 실패해 그 프로젝트의 공지가 빠졌을 수 있다(S2 — 화면이 알린다).
 * 거르기는 조회 전에 한다 — 숨길 프로젝트의 공지가 상한 행을 차지해 보일 공지가 줄지 않게.
 */
export async function getWorkspaceAnnouncements(workspaceId: string, actor: Actor, opts: { limit?: number } & Opts = {}):
  Promise<{ ok: true; rows: { id: string; title: string; projectId: string; projectName: string; isPinned: boolean; createdAt: string }[]; partial: boolean } | { ok: false; error: string }> {
  try {
    if (!projectsIn(actor, workspaceId).length) return { ok: true, rows: [], partial: false }
    const sc = await scopeOf(workspaceId, actor, opts.client)                 // 홈의 다른 위젯과 판정·가시성을 공유한다(요청 범위)
    const { c: client, visible } = sc
    const mods = modsOf(sc.pids, sc.many)
    if (mods.failed) console.error('[portal] 공지 — 일부 프로젝트의 모듈 판정 실패(그 프로젝트 공지는 빠질 수 있다)', workspaceId)
    const all = mods.on('announcements').filter((p) => visible.has(p))
    if (!all.length) return { ok: true, rows: [], partial: mods.failed }
    // 게시 기간의 '오늘' = 프로젝트마다 그 tz(셸 공지 배지 getUnreadAnnouncementCount 와 같은 판정). 오늘을 모르는 프로젝트는 묻지 않고 partial
    const todays = await projectTodays(client, all, opts.now ?? new Date())
    const on = all.filter((p) => (todays.get(p) ?? null) !== null)
    const partial = mods.failed || on.length < all.length
    if (on.length < all.length) console.error('[portal] 공지 — 달력을 못 읽은 프로젝트의 공지는 뺐다', workspaceId, all.filter((p) => !on.includes(p)))
    if (!on.length) return { ok: true, rows: [], partial }
    const limit = Math.min(Math.max(1, opts.limit ?? 5), 20)
    type A = { id: string; title: string; project_id: string; is_pinned: boolean; created_at: string; projects: { name: string } | null }
    // 같은 오늘을 쓰는 프로젝트끼리 묶고(대개 한두 묶음), 묶음마다 id 목록을 나눠 묻는다(각 조각이 상한만큼) — 메모리에서 합쳐 자른다(정렬 키는 DB 와 같다: 고정 → 최신 → id)
    const byToday = new Map<string, string[]>()
    for (const p of on) { const d = todays.get(p) as string; byToday.set(d, [...(byToday.get(d) ?? []), p]) }
    const got = (await Promise.all([...byToday].flatMap(([today, pids]) => chunks(pids).map(async (ids) => {
      const { data, error } = await client.from('announcements')
        .select('id, title, project_id, is_pinned, created_at, projects!inner(name)')
        .in('project_id', ids).or(`publish_from.is.null,publish_from.lte.${today}`).or(`publish_to.is.null,publish_to.gte.${today}`)
        .order('is_pinned', { ascending: false }).order('created_at', { ascending: false }).order('id').limit(limit)
      if (error) throw new Error(error.message)
      return (data ?? []) as unknown as A[]
    })))).flat()
    got.sort((x, y) => Number(y.is_pinned) - Number(x.is_pinned) || (x.created_at < y.created_at ? 1 : x.created_at > y.created_at ? -1 : 0) || (x.id < y.id ? -1 : 1))
    return { ok: true, partial, rows: got.slice(0, limit).map((a) => ({ id: a.id, title: a.title, projectId: a.project_id, projectName: a.projects?.name ?? '', isPinned: a.is_pinned, createdAt: a.created_at })) }
  } catch (e) {
    console.error('[portal] 공지 실패', workspaceId, errMsg(e))
    return { ok: false, error: '공지를 불러오지 못했습니다.' }
  }
}
