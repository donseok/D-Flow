import type { AdminClient } from '@/lib/minutes/externalApi'

/**
 * 이 프로젝트에서 '나'인 명단 행 id — 계정 연결 정본(people.user_id)만 본다(SP1: 이메일 폴백 매칭 폐지).
 * 활성 명단 행·활성 인물만 — 빠진 사람이 담당자로 착수·위임·승인하지 못하게 buildActor 와 같은 축으로 판정한다.
 * scope=assigned·claim 배정 제한·위임·서브트리 관리자·결재가 공유하는 "이게 내 배정인지" 판정 재료.
 * 조회 실패는 위장하지 않고 throw — 배정 판정은 보안 재료라 "빈 결과"로 삼키면 사칭을 못 잡는다.
 */
export async function myMemberIds(
  admin: AdminClient,
  args: { userId: string; projectId: string },
): Promise<string[]> {
  const { data, error } = await admin
    .from('project_members').select('id, people!inner(user_id, active)')
    .eq('project_id', args.projectId).eq('people.user_id', args.userId)
    .eq('active', true).eq('people.active', true)
  if (error) throw new Error(`로스터 조회 실패: ${error.message}`)
  return [...new Set(((data ?? []) as Array<{ id: string }>).map(m => m.id))]
}

type AncestorRow = { id: string; parent_id: string | null; assignee_member_id: string | null }

/** 승인 판정 재료 — 한 번의 wbs_items 읽기로 조상 판정과 리프 담당자를 함께 돌려준다(추가 왕복 없음). */
export interface SubtreeStanding {
  /** strict 조상 중 담당자가 나인 노드가 있다(= 종전 isSubtreeManager). */
  manager: boolean
  /** 대상 항목 행이 이 프로젝트 조회 결과에 있다. false 면 승인 판정은 거부한다(fail-closed). */
  leafFound: boolean
  /** 대상 항목 자신의 담당자(명단 행 id). 미배정이면 null. */
  leafAssigneeMemberId: string | null
}

/**
 * 서브트리 관리자 판정(트랙 B, 2026-09-15) — 대상 항목의 **strict 조상**(부모·조부모…루트,
 * 자신 제외) 중 어느 노드의 assignee_member_id 가 myMemberIds 와 교집합이 있으면 manager.
 * strict 조상은 정의상 전부 비리프이므로 "비리프 담당자" 조건은 이 정의로 자동 충족된다.
 * 리프 자신의 담당자는 조상 판정에 넣지 않는다. 자기 완료 승인 금지는 requireCompletionApprover
 * (subtreeManager.ts)가 leafAssigneeMemberId 와 주문의 claim 계정으로 시행한다.
 *
 * 한 번의 왕복으로 프로젝트 전체 wbs_items(id, parent_id, assignee_member_id)를 읽고 메모리에서
 * parent_id 체인을 루트까지 걷는다. with recursive CTE 를 안 쓰는 이유: supabase-js(PostgREST)
 * 는 raw SQL 실행 경로가 없어 CTE 는 DB 함수(RPC)가 있어야 하는데 그건 마이그레이션이고 이번
 * 범위는 마이그레이션 금지다. 대신 이 프로젝트에 이미 있는 관례(setWbsAssigneeCascade,
 * wbsAssign.ts — 하위 트리를 이 방식으로 한 번에 읽어 메모리에서 순회)를 조상 방향으로 그대로
 * 쓴다. project_id 로 필터하므로 프로젝트 경계 확인도 이 한 조회가 겸하고, visited Set 으로
 * parent_id 순환(데이터 오류)에도 무한루프 없이 종료한다.
 *
 * 조회 실패는 위장하지 않고 throw — 호출부가 fail-closed 로 거부해야 한다(myMemberIds 와 동일 계약).
 */
export async function subtreeStanding(
  admin: AdminClient,
  args: { itemId: string; projectId: string; myMemberIds: readonly string[] },
): Promise<SubtreeStanding> {
  const { data, error } = await admin
    .from('wbs_items').select('id, parent_id, assignee_member_id').eq('project_id', args.projectId)
  if (error) throw new Error(`조상 조회 실패: ${error.message}`)
  const byId = new Map(((data ?? []) as AncestorRow[]).map(r => [r.id, r]))
  const leaf = byId.get(args.itemId)
  const mine = new Set(args.myMemberIds)
  const visited = new Set<string>()
  let manager = false
  let cur = leaf?.parent_id ?? null
  while (cur !== null && !visited.has(cur)) {
    visited.add(cur)
    const row = byId.get(cur)
    if (!row) break // parent_id 가 이 프로젝트 조회 결과 밖 — 데이터 이상, 더 올라가지 않는다(fail-closed 방향).
    if (row.assignee_member_id && mine.has(row.assignee_member_id)) { manager = true; break }
    cur = row.parent_id
  }
  return { manager, leafFound: leaf !== undefined, leafAssigneeMemberId: leaf?.assignee_member_id ?? null }
}

/** 서브트리 관리자인가 — subtreeStanding 의 manager. 명단 행이 없으면 조회 없이 false. 조회 실패는 throw(같은 계약). */
export async function isSubtreeManager(
  admin: AdminClient,
  args: { itemId: string; projectId: string; myMemberIds: readonly string[] },
): Promise<boolean> {
  if (args.myMemberIds.length === 0) return false
  return (await subtreeStanding(admin, args)).manager
}
