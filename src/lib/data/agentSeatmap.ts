// 좌석표 조회 — 서버 전용(service_role). 프로젝트 필터는 항상 seatmapProjectIds 로 건다.
// 실패는 throw 한다(에러 3원칙: 조회 실패를 데이터 없음으로 위장하지 않는다).
// 단 agents 모듈 판정 실패(설정 조회·손상)는 그 프로젝트의 층을 뺀다 — 로그는 [requireModule](스펙 §3 modules.* fail-closed, P13).
import { createAdminClient } from '@/lib/supabase/admin'
import { personOf } from '@/lib/data/memberSelect'
import type { AdminClient } from '@/lib/minutes/externalApi'
import { isProjectAdmin, type Actor } from '@/lib/domain/authz'
import { seatmapProjectIds } from '@/lib/authz/agentsAccess'
import { projectsWithModule } from '@/lib/modules/gate'
import { WATCHER_TTL_MS } from '@/lib/domain/seatState'
import {
  assembleSeatmap, type ItemRow, type MemberRow, type OrderRow, type PredecessorRow, type ProjectRow, type ReportRow, type ReviewRow, type Seatmap, type SeatmapRows, type SeatmapScope, type SeatmapViewer, type WatcherRow,
} from '@/lib/domain/seatmap'

/** DONE(approved) 은 최근 7일 것만 층에 접어 둔다. */
export const DONE_WINDOW_MS = 7 * 24 * 3600_000
/** 보고 말풍선 재료의 창 — 하루 넘은 보고는 말풍선으로 띄울 일이 없다. */
const REPORT_WINDOW_MS = 24 * 3600_000

const ORDER_COLS = 'id, project_id, wbs_item_id, status, claimed_by, claimed_by_user_id, claimed_at, created_at, updated_at, last_heartbeat_at, heartbeat_phase, heartbeat_agent, heartbeat_note, heartbeat_model, resume_requested_at, resume_requested_host'
const ITEM_COLS = 'id, project_id, code, name, parent_id, actual_pct, assignee_member_id, tags, depends, model'

function must<T>(what: string, r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(`[seatmap] ${what} 조회 실패: ${r.error.message}`)
  return (r.data ?? []) as T
}

/** 조상 사슬을 뿌리까지 올라가며 모은다(최대 12단 — 순환·이상 데이터 방어).
 *  구역 라벨은 부모 1단만 쓰지만 서브트리 관리자 판정은 strict 조상 전체를 봐야 한다(스튜디오 v7 결재). */
async function fetchAncestors(admin: AdminClient, seedIds: string[]): Promise<ItemRow[]> {
  const out = new Map<string, ItemRow>()
  let frontier = seedIds
  for (let depth = 0; depth < 12 && frontier.length > 0; depth++) {
    const rows = must<ItemRow[]>('조상 항목', await admin.from('wbs_items').select(ITEM_COLS).in('id', frontier))
    for (const r of rows) out.set(r.id, r)
    frontier = [...new Set(rows.map(r => r.parent_id).filter((x): x is string => x !== null && !out.has(x)))]
  }
  return [...out.values()]
}

/** excludeProjectIds — 전체(null) 조회에서 뺄 프로젝트(모듈이 꺼진 층). 주문 조회에만 걸면 나머지는 주문의 프로젝트로 따라 좁혀진다 */
export async function fetchSeatmapRows(
  admin: AdminClient, projectIds: string[] | null, nowMs: number, opts: { excludeProjectIds?: readonly string[] } = {},
): Promise<SeatmapRows> {
  const empty: SeatmapRows = { orders: [], items: [], parents: [], reviews: [], watchers: [], projects: [], members: [], predecessors: [] }
  if (projectIds !== null && projectIds.length === 0) return empty

  const doneSince = new Date(nowMs - DONE_WINDOW_MS).toISOString()
  let q = admin.from('agent_work_orders').select(ORDER_COLS)
    .or(`status.in.(ready,claimed,reported),and(status.eq.approved,updated_at.gte.${doneSince})`)
  if (projectIds !== null) q = q.in('project_id', projectIds)
  if (opts.excludeProjectIds?.length) q = q.not('project_id', 'in', `(${opts.excludeProjectIds.join(',')})`)
  const orders = must<OrderRow[]>('주문', await q.order('created_at', { ascending: false }).limit(2000))
  if (orders.length === 0) return empty

  const itemIds = [...new Set(orders.map(o => o.wbs_item_id).filter((x): x is string => !!x))]
  const orderIds = orders.map(o => o.id)
  const projIds = [...new Set(orders.map(o => o.project_id))]

  // 층 프로젝트 행은 항목과 함께 먼저 읽는다 — 감시자를 그 워크스페이스로 좁히려면 workspace_id 가 필요하다.
  const [items, floorProjects] = await Promise.all([
    itemIds.length
      ? admin.from('wbs_items').select(ITEM_COLS).in('id', itemIds).then(r => must<ItemRow[]>('항목', r))
      : Promise.resolve([] as ItemRow[]),
    admin.from('projects').select('id, name, workspace_id').in('id', projIds)
      .then(r => must<Array<ProjectRow & { workspace_id: string }>>('프로젝트', r)),
  ])
  const projects: ProjectRow[] = floorProjects.map(p => ({ id: p.id, name: p.name }))
  // 감시자는 층 프로젝트들의 워크스페이스로 좁힌다 — 프로젝트 없는(project_id null) 감시자는 워크스페이스 단위라,
  // 필터가 없으면 다른 워크스페이스의 팀장이 모든 층에 떠 보인다(SP2 §4.2). 워크스페이스를 모르면 조회하지 않는다.
  const floorWorkspaceIds = [...new Set(floorProjects.map(p => p.workspace_id))]
  const parentIds = [...new Set(items.map(i => i.parent_id).filter((x): x is string => !!x))]
  // 보고 말풍선 — 점유·보고 중 주문의 최근 하루치만. 말풍선은 주문마다 마지막 한 줄이면 된다.
  const liveIds = orders.filter(o => o.status === 'claimed' || o.status === 'reported').map(o => o.id)
  const [parents, reviews, watchers, members, reports] = await Promise.all([
    parentIds.length ? fetchAncestors(admin, parentIds) : Promise.resolve([] as ItemRow[]),
    admin.from('agent_work_reports').select('id, work_order_id, review_action, review_note, created_at')
      .in('work_order_id', orderIds).eq('kind', 'completion').then(r => must<ReviewRow[]>('완료 보고', r)),
    floorWorkspaceIds.length
      ? admin.from('agent_watchers').select('id, user_id, project_id, agent, host, slots, busy, until_label, last_seen_at')
        .in('workspace_id', floorWorkspaceIds)
        .gte('last_seen_at', new Date(nowMs - WATCHER_TTL_MS).toISOString()).then(r => must<WatcherRow[]>('감시자', r))
      : Promise.resolve([] as WatcherRow[]),
    // 로스터는 담당자 이름·PAT 계정 매칭 재료(착수 대기 사유 §2). 층 프로젝트 범위로만.
    admin.from('project_members').select('id, project_id, people!inner(display_name, user_id)').in('project_id', projIds)
      .then(r => must<Array<Record<string, unknown>>>('로스터', r).map(toSeatMember)),
    liveIds.length
      ? admin.from('agent_work_reports').select('work_order_id, kind, summary, created_at')
        .in('work_order_id', liveIds).gte('created_at', new Date(nowMs - REPORT_WINDOW_MS).toISOString())
        .order('created_at', { ascending: false }).limit(500).then(r => must<ReportRow[]>('최근 보고', r))
      : Promise.resolve([] as ReportRow[]),
  ])
  // 선행 항목 — ready 주문 항목의 depends 만 모아 프로젝트 안 external_ref 로 1회, 그 id 의 approved 주문 1회. ref 가 없으면 0회.
  // 승인 주문은 위 주문 조회(7일 창)에 없을 수 있어 따로 본다 — 오래전 승인된 선행을 미충족으로 말하면 화면이 거짓말한다.
  const readyItemIds = new Set(orders.filter(o => o.status === 'ready').map(o => o.wbs_item_id))
  const refs = [...new Set(items.filter(i => readyItemIds.has(i.id)).flatMap(i => i.depends ?? []))]
  let predecessors: PredecessorRow[] = []
  if (refs.length) {
    const found = must<Array<Omit<PredecessorRow, 'order_approved'>>>('선행 항목',
      await admin.from('wbs_items').select('id, project_id, external_ref, code, name, stage, actual_pct').in('project_id', projIds).in('external_ref', refs))
    const approved = found.length
      ? must<Array<{ wbs_item_id: string }>>('선행 승인 주문',
        await admin.from('agent_work_orders').select('wbs_item_id').in('wbs_item_id', found.map(p => p.id)).eq('status', 'approved'))
      : []
    const ok = new Set(approved.map(a => a.wbs_item_id))
    predecessors = found.map(p => ({ ...p, order_approved: ok.has(p.id) }))
  }
  return { orders, items, parents, reviews, watchers, projects, members, predecessors, reports }
}

/** 명단 행(people 임베드) → 층 조립기가 쓰는 평평한 행. 이름·계정은 people 이 정본이다. */
function toSeatMember(r: Record<string, unknown>): MemberRow {
  const pe = personOf(r)
  return { id: r.id as string, project_id: r.project_id as string, user_id: pe?.user_id ?? null, name: pe?.display_name ?? '' }
}

/**
 * 내 로스터 행 id — 접근 가능 프로젝트(null = 전체)의 활성 명단 행 중 people.user_id 가 나이고 인물이 활성인 행.
 * scope=assigned(src/lib/agent/assignee.ts myMemberIds)와 같은 축 — 결재 어포던스가 서버 가드와 어긋나지 않게. 실패는 throw.
 */
export async function fetchMyMemberIds(
  admin: AdminClient, who: { userId: string }, projectIds: string[] | null,
): Promise<string[]> {
  if (projectIds !== null && projectIds.length === 0) return []
  let q = admin.from('project_members').select('id, people!inner(user_id, active)')
    .eq('people.user_id', who.userId).eq('active', true).eq('people.active', true)
  if (projectIds !== null) q = q.in('project_id', projectIds)
  return must<Array<{ id: string }>>('로스터', await q).map(m => m.id)
}

export interface SeatmapOptions { projectId?: string }

/**
 * 층 목록 — projectId 가 있으면 접근 가능 범위와 교집합(슈퍼유저는 그대로 [projectId]).
 * 범위 밖이면 [] 라 조회가 일어나지 않는다. 페이지 게이트를 통과했어도 여기서 다시 좁힌다(fail-closed).
 */
export function seatmapFloorIds(actor: Actor, projectId?: string): string[] | null {
  const ids = seatmapProjectIds(actor)
  if (projectId === undefined) return ids
  if (ids === null) return [projectId]
  return ids.includes(projectId) ? [projectId] : []
}

export async function getSeatmap(actor: Actor, nowMs = Date.now(), scope: SeatmapScope = 'mine', opts: SeatmapOptions = {}): Promise<Seatmap> {
  const admin = createAdminClient()
  // agents 모듈이 꺼진 프로젝트의 층은 싣지 않는다(스펙 §4.2 — 목록형 응답은 행을 뺀다). 층 목록이 있으면 조회 전에 좁힌다.
  const floor = seatmapFloorIds(actor, opts.projectId)
  let projectIds = floor === null ? null : await projectsWithModule(floor, 'agents', { client: admin })
  let rows = await fetchSeatmapRows(admin, projectIds, nowMs)
  if (projectIds === null) {
    // 전체(플랫폼 관리자)면 한 번 읽은 층을 판정해 꺼진 것이 섞였을 때만 그것을 빼고 다시 읽는다(모두 켜졌으면 지금과 같은 한 번).
    // 켜진 것으로 좁히지 않고 꺼진 것을 빼는 이유: 주문 상한(2000)에 밀려 첫 조회에 없던 켜진 프로젝트가 빈자리를 채우게.
    // 다시 읽어 처음 보는 프로젝트가 나오면 그것도 판정하고, 또 꺼진 것이 있으면 판정을 마친 켜진 목록으로 좁혀 끝낸다(조회는 많아야 세 번).
    const seen = rows.projects.map((p) => p.id)
    const on = new Set(await projectsWithModule(seen, 'agents', { client: admin }))
    if (on.size < seen.length) {
      rows = await fetchSeatmapRows(admin, null, nowMs, { excludeProjectIds: seen.filter((id) => !on.has(id)) })
      const fresh = rows.projects.map((p) => p.id).filter((id) => !seen.includes(id))
      const freshOn = fresh.length ? await projectsWithModule(fresh, 'agents', { client: admin }) : []
      if (freshOn.length < fresh.length) { projectIds = [...on, ...freshOn]; rows = await fetchSeatmapRows(admin, projectIds, nowMs) }
    }
  }
  // 결재 어포던스 재료는 범위와 무관하게 싣는다 — 전체 보기에서도 버튼 노출은 서버 가드와 같은 축이어야 한다.
  // 로스터 조회가 던지면 그대로 올린다(조회 실패를 권한 없음으로 위장하지 않는다).
  const memberIds = new Set(await fetchMyMemberIds(admin, { userId: actor.userId }, projectIds))
  const viewer: SeatmapViewer = {
    userId: actor.userId,
    memberIds,
    adminProjectIds: new Set(rows.projects.filter(p => isProjectAdmin(actor, p.id)).map(p => p.id)),
  }
  if (scope === 'all') return assembleSeatmap(rows, nowMs, { viewer })
  return assembleSeatmap(rows, nowMs, { mine: { userId: actor.userId, memberIds }, viewer })
}

export interface ProjectOffice { projectName: string | null; seatmap: Seatmap }

/** 프로젝트 스튜디오 — 이름 + 이 프로젝트 층 하나. 프로젝트가 없으면 projectName null(페이지가 notFound 로 보낸다). */
export async function getProjectOffice(actor: Actor, projectId: string, nowMs = Date.now(), scope: SeatmapScope = 'mine'): Promise<ProjectOffice> {
  const admin = createAdminClient()
  const [project, seatmap] = await Promise.all([
    admin.from('projects').select('id, name').eq('id', projectId).maybeSingle().then(r => {
      if (r.error) throw new Error(`[seatmap] 프로젝트 조회 실패: ${r.error.message}`)
      return r.data as { id: string; name: string } | null
    }),
    getSeatmap(actor, nowMs, scope, { projectId }),
  ])
  return { projectName: project?.name ?? null, seatmap }
}
