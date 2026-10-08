import type { AdminClient } from '@/lib/minutes/externalApi'
import { orderPriorityFromLabel } from '@/lib/domain/agentWork'
import { emitNotification } from '@/lib/notify/emit'
import { moduleState, requireModule } from '@/lib/modules/gate'

/**
 * §2.8 재정의(2026-08-13): dev_workflow ON 인 리프에는 주문이 존재한다 — 배정은 조건이 아니다.
 * 멱등: 활성 주문(ready/claimed/reported) 부분 유니크(0077)가 DB 보증, 여기는 선행조회 + 23505 수렴.
 * 발행 조건: agents 모듈(프로젝트 설정 modules.enabled — 유일한 원천, SP7 에서 등록 표를 지웠다) · 리프 · 호출부가 관리자 권한 경로.
 * agentsOn — 호출자가 이미 모듈을 판정했으면(백필) 넘겨 리프마다의 판정을 건너뛴다.
 */
export async function ensureOrderForWorkflowLeaf(
  admin: AdminClient,
  args: { projectId: string; wbsItemId: string; actorUserId: string; instructions?: string; agentsOn?: boolean },
): Promise<
  | { ok: true; created: boolean; reason?: 'not_agent_project' | 'not_leaf' | 'active_exists' | 'not_workflow' }
  | { ok: false; error: string }
> {
  const { projectId, wbsItemId, actorUserId } = args

  // Step 1: agents 모듈 게이트 — 호출자가 한 번 판정했으면(백필·위임) 건너뛴다. 판정 실패는 발행하지 않는다(fail-closed)
  const agentsOn = args.agentsOn ?? (await requireModule({ projectId }, 'agents', { client: admin })).ok
  if (!agentsOn) return { ok: true, created: false, reason: 'not_agent_project' }

  // Step 2: 항목 조회 — priority 라벨과 설명 정보, 담당자 ID, dev_workflow 게이트.
  // 주문 priority = 항목 priority 라벨의 정수 매핑(계약 v2.0: critical=100/high=50/medium=10/low=0).
  // 수용 기준은 주문에 복제하지 않는다 — 정본은 wbs_items.acceptance jsonb 이고 claim/show 응답이 실어 나른다(결정 B).
  const { data: item, error: itemErr } = await admin
    .from('wbs_items')
    .select('name, priority, external_ref, assignee_member_id, dev_workflow')
    .eq('id', wbsItemId)
    .maybeSingle()
  if (itemErr) return { ok: false, error: `항목 조회 실패: ${itemErr.message}` }
  const row = item as
    | {
        name: string
        priority: string | null
        external_ref: string | null
        assignee_member_id: string | null
        dev_workflow: boolean | null
      }
    | null
  // 3원칙 — 항목 없음을 "미도입"으로 위장하지 않는다(최종 리뷰 F3).
  if (!row) return { ok: false, error: '항목 없음' }
  if (row.dev_workflow !== true) return { ok: true, created: false, reason: 'not_workflow' }

  // Step 3: 리프 검증 — 자식 없어야 함
  const { data: child, error: childErr } = await admin
    .from('wbs_items')
    .select('id')
    .eq('parent_id', wbsItemId)
    .limit(1)
    .maybeSingle()
  if (childErr) return { ok: false, error: `하위 항목 확인 실패: ${childErr.message}` }
  if (child) return { ok: true, created: false, reason: 'not_leaf' }

  // Step 4: 활성 주문 확인 — ready/claimed/reported 상태의 주문 존재 확인
  const { data: active, error: activeErr } = await admin
    .from('agent_work_orders')
    .select('id')
    .eq('wbs_item_id', wbsItemId)
    .in('status', ['ready', 'claimed', 'reported'])
    .limit(1)
    .maybeSingle()
  if (activeErr) return { ok: false, error: `활성 주문 확인 실패: ${activeErr.message}` }
  if (active) return { ok: true, created: false, reason: 'active_exists' }

  // Step 5: 주문 발행 시도
  const { data: orderData, error } = await admin
    .from('agent_work_orders')
    .insert({
      project_id: projectId,
      wbs_item_id: wbsItemId,
      instructions: args.instructions?.trim() || `${row.external_ref ?? ''} ${row.name}`.trim(),
      priority: orderPriorityFromLabel(row.priority),
      created_by: actorUserId,
    })
    .select('id')
    .single()

  if (error) {
    // 부분 유니크 경합 — 다른 트리거가 먼저 발행했다. 멱등 no-op.
    if ((error as { code?: string }).code === '23505') {
      return { ok: true, created: false, reason: 'active_exists' }
    }
    return { ok: false, error: error.message }
  }

  // 실제 생성 성공 — 알림 발행 (fire-and-forget, 본 로직 실패로 이어지지 않음)
  const orderId = (orderData as { id: string }).id
  if (row.assignee_member_id) {
    emitNotification({
      type: 'work.order_created',
      projectId,
      entityType: 'agent_order',
      entityId: orderId,
      payload: {
        title: row.name,
        detail: '작업 주문이 발행되었습니다',
        href: `/p/${projectId}/wbs`,
      },
      recipientMemberIds: [row.assignee_member_id],
      dedupeKey: `order_created:${wbsItemId}:${orderId}`,
    }).catch(() => {
      // 알림 실패는 로깅만 하고 본 로직에 영향을 주지 않음
    })
  }

  return { ok: true, created: true }
}

/**
 * 소급 발행(백필) — agents 모듈이 켜지는 시점(설정 저장)에 dev_workflow=true 항목 전부에 주문 보장을 1회 돈다.
 * 업로드가 모듈을 켜기보다 먼저였어도(리허설 실측 2026-08-24: orders_created 0 인 채 침묵) 주문이 존재하게.
 * 리프·활성 주문 판정은 ensureOrderForWorkflowLeaf 안에 있으므로 여기는 후보 나열만 한다.
 * 개별 실패는 모아서 돌려주고 멈추지 않는다 — 한 항목 때문에 나머지 백필이 사라지면 안 된다.
 */
export async function backfillProjectOrders(
  admin: AdminClient,
  args: { projectId: string; actorUserId: string },
): Promise<{ ok: true; created: number; failed: string[] } | { ok: false; error: string }> {
  // 모듈 판정은 한 번(루프 안 판정 비용 — map-agents J8). 꺼짐이면 발행 0, 판정 불가면 오류로 돌려 호출부가 보이게(3원칙)
  const state = await moduleState({ projectId: args.projectId }, 'agents', { client: admin })
  if (state === 'off') return { ok: true, created: 0, failed: [] }
  if (state === 'unknown') return { ok: false, error: '에이전트 모듈 설정을 확인하지 못했습니다.' }
  const { data: items, error } = await admin
    .from('wbs_items').select('id').eq('project_id', args.projectId).eq('dev_workflow', true)
  if (error) return { ok: false, error: `백필 대상 조회 실패: ${error.message}` }
  let created = 0
  const failed: string[] = []
  for (const it of (items ?? []) as Array<{ id: string }>) {
    const r = await ensureOrderForWorkflowLeaf(admin, { projectId: args.projectId, wbsItemId: it.id, actorUserId: args.actorUserId, agentsOn: true })
    if (!r.ok) { failed.push(it.id); console.error('[backfill] 주문 보장 실패:', it.id, r.error); continue }
    if (r.created) created += 1
  }
  return { ok: true, created, failed }
}
