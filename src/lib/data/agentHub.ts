// 에이전트 허브 조회 — 서버 전용(service_role). 1차 5건 병렬 + 2차(감시자·살아 있는 주문의 완료 보고) 병렬.
// 실패는 throw 한다(에러 3원칙: 조회 실패를 데이터 없음으로 위장하지 않는다).
import { loadQueueApprovals } from '@/lib/agent/approvalState'
import { loadPredecessorGate } from '@/lib/agent/predecessorGate'
import { adminFor } from '@/lib/supabase/adminFor'
import type { AdminClient } from '@/lib/minutes/externalApi'
import { WATCHER_TTL_MS } from '@/lib/domain/seatState'
import type { OrderRow, WatcherRow } from '@/lib/domain/seatmap'
import { DONE_WINDOW_MS } from '@/lib/data/agentSeatmap'
import { personOf } from '@/lib/data/memberSelect'
import { requireModule } from '@/lib/modules/gate'
import {
  assembleAgentHub, type AgentHub, type AgentHubRows, type HubItemRow, type HubMemberRow, type HubReportRow,
} from '@/lib/domain/agentHub'

export const HUB_ITEM_COLS = 'id, project_id, parent_id, code, name, sort_order, milestone, dev_workflow, tags, assignee_member_id, agent_prompt, actual_pct, stage, external_ref, depends'
const ORDER_COLS = 'id, project_id, wbs_item_id, status, claimed_by, claimed_by_user_id, claimed_at, created_at, updated_at, last_heartbeat_at, heartbeat_phase, heartbeat_agent, heartbeat_note'
const REPORT_COLS = 'id, work_order_id, percent, summary, links, agent, review_action, review_note, created_at'
const WATCHER_COLS = 'id, user_id, project_id, agent, host, slots, busy, until_label, last_seen_at'

function must<T>(what: string, r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(`[agent-hub] ${what} 조회 실패: ${r.error.message}`)
  return (r.data ?? []) as T
}

/** 명단 행(people 임베드) → 허브 조립기가 쓰는 평평한 행. 이름·계정은 people 이 정본이고, active 는 명단 행·인물 모두 활성일 때만. */
function toHubMember(r: Record<string, unknown>): HubMemberRow {
  const pe = personOf(r)
  return { id: r.id as string, name: pe?.display_name ?? '', user_id: pe?.user_id ?? null, active: r.active === true && pe?.active === true }
}

export async function fetchAgentHubRows(admin: AdminClient, projectId: string, nowMs: number): Promise<AgentHubRows> {
  const doneSince = new Date(nowMs - DONE_WINDOW_MS).toISOString()
  const [items, agentRow, orders, members, projects, agentsOn] = await Promise.all([
    admin.from('wbs_items').select(HUB_ITEM_COLS).eq('project_id', projectId).then(r => must<HubItemRow[]>('항목', r)),
    admin.from('agent_projects').select('enabled').eq('project_id', projectId).maybeSingle().then(r => {
      if (r.error) throw new Error(`[agent-hub] 등록 조회 실패: ${r.error.message}`)
      return r.data ? { enabled: (r.data as { enabled: boolean }).enabled === true } : null
    }),
    admin.from('agent_work_orders').select(ORDER_COLS).eq('project_id', projectId)
      .or(`status.in.(ready,claimed,reported),and(status.eq.approved,updated_at.gte.${doneSince})`)
      .order('created_at', { ascending: false }).limit(2000).then(r => must<OrderRow[]>('주문', r)),
    // 비활성 행도 싣는다 — 담당자 이름 표시는 계속돼야 한다. '나' 판정은 myMemberIdsOf 가 active 로 거른다.
    admin.from('project_members').select('id, active, people!inner(display_name, user_id, active)').eq('project_id', projectId)
      .then(r => must<Array<Record<string, unknown>>>('로스터', r).map(toHubMember)),
    admin.from('projects').select('id, name, workspace_id').eq('id', projectId)
      .then(r => must<Array<{ id: string; name: string; workspace_id: string }>>('프로젝트', r)),
    // 두 원천 AND(스펙 §4.4)의 두 번째 방어선 — 허브 페이지·액션은 이미 agents 관문으로 닫혔다. 판정 실패는 꺼짐(fail-closed)
    requireModule({ projectId }, 'agents', { client: admin }).then((r) => r.ok),
  ])
  const agentProject = agentRow ? { enabled: agentRow.enabled && agentsOn } : null
  const project = projects[0] ?? null
  // 감시자는 이 프로젝트의 워크스페이스로 좁힌다 — 프로젝트 없는(project_id null) 감시자는 워크스페이스 단위라,
  // 필터가 없으면 다른 워크스페이스의 팀장이 이 허브에 떠 있는 것으로 보인다(SP2 §4.2). 워크스페이스를 알려면
  // 프로젝트 행이 필요해 2차로 간다. 프로젝트가 없으면 전역으로 넓히지 않고 조회하지 않는다.
  // 완료 보고는 주문 id 로만 거를 수 있어 2차로 간다(PostgREST 에 project_id 조인이 없다). 살아 있는 주문이 없으면 생략.
  const liveIds = orders.filter(o => o.status === 'ready' || o.status === 'claimed' || o.status === 'reported').map(o => o.id)
  const [watchers, reports] = await Promise.all([
    project
      ? admin.from('agent_watchers').select(WATCHER_COLS).eq('workspace_id', project.workspace_id)
        .gte('last_seen_at', new Date(nowMs - WATCHER_TTL_MS).toISOString()).then(r => must<WatcherRow[]>('감시자', r))
      : Promise.resolve([] as WatcherRow[]),
    liveIds.length
      ? admin.from('agent_work_reports').select(REPORT_COLS).in('work_order_id', liveIds).eq('kind', 'completion')
        .then(r => must<HubReportRow[]>('완료 보고', r))
      : Promise.resolve([] as HubReportRow[]),
  ])
  // 선행 승인 여부 — 위임 항목의 depends 가 가리키는 항목 id 로 approved 주문을 1회(주문 조회는 7일 창이라 오래전 승인이 빠진다). 선행이 없으면 생략.
  const refs = new Set(items.filter(i => (i.tags ?? []).includes('agent')).flatMap(i => i.depends ?? []))
  const predIds = items.filter(i => i.external_ref !== null && refs.has(i.external_ref)).map(i => i.id)
  const approvedItemIds = predIds.length
    ? must<Array<{ wbs_item_id: string }>>('선행 승인 주문', await admin.from('agent_work_orders').select('wbs_item_id').in('wbs_item_id', predIds).eq('status', 'approved')).map(r => r.wbs_item_id)
    : []
  // 선행 기준(SP5b D21) — 착수 대기 사유가 claim 게이트와 같은 기준으로 말하게. 판독 실패는 throw(허브 오류 — 위장 금지)
  const gate = await loadPredecessorGate(admin, projectId)
  return { project: project && { id: project.id, name: project.name }, agentProject, items, orders, reports, watchers, members, approvedItemIds, gate }
}

export async function getAgentHub(projectId: string, viewer: { userId: string; isAdmin: boolean }, nowMs = Date.now()): Promise<AgentHub> {
  // 호출부(페이지·허브 액션)가 requireProjectMember(projectId) 를 통과한 뒤다 — 조회는 전부 이 projectId 로 좁힌다.
  const { admin } = adminFor({ projectId })
  const rows = await fetchAgentHubRows(admin, projectId, nowMs)
  const hub = assembleAgentHub(rows, nowMs, { userId: viewer.userId, isAdmin: viewer.isAdmin })
  // SP5b W1 — 결재 대기열의 대기 단계(n/m·라벨·expectedStep). 큐가 비면 읽지 않는다. 판독 실패는 로그 + 표시 없음(승인은 서버가 다시 판정)
  const itemIds = hub.queue.map((q) => q.itemId).filter((x): x is string => x !== null)
  if (itemIds.length === 0) return hub
  const approvals = await loadQueueApprovals(admin, projectId, itemIds)
  return {
    ...hub,
    queue: hub.queue.map((q) => {
      const a = q.itemId ? approvals.get(q.itemId) : undefined
      return a ? { ...q, approval: { step: a.step, index: a.index, total: a.total, label: a.label } } : q
    }),
  }
}
