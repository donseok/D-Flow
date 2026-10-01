import 'server-only'

// 전용 팀이 있는 프로젝트가 이미 참조 중인 공용 팀의 code(SP4 A1 최종 리뷰 보안 P3 — A2 이월 수정 Z4).
// 혼합 상태(⓪ 상속 시절 공용 X 로 담당·명단을 꾸린 뒤 팀 추가 액션으로 첫 전용 팀을 만든 — 전환을 거치지 않은 프로젝트, 스펙 D54 의 한계)는
// DB 가 허용한다(ⓚ). 이 프로젝트에 X 가 든 파일을 가져올 때 X 를 전용 팀으로 새로 등록하면 기존 공용 X 참조와 같은 code·다른 id(D4 분열)가
// 된다. 가져오기 라우트는 여기서 돌려준 code 를 등록하지 않는다 — 가져오기 RPC 는 전용 팀이 없는 code 를 그 워크스페이스 공용 팀으로 잇는다
// (*_command_receipts 의 팀 해석). 참조 = 전환 RPC 가 옮기는 네 곳(담당·명단 팀·영역 팀·수락 전 초대)과 같다.
// 세션이 아니라 프로젝트 스코프 service_role 로 읽는다(라우트는 requireProjectAdmin(pid) 를 통과한 뒤 부른다). 조회 오류는 throw(3원칙 ②).
import { adminFor } from '@/lib/supabase/adminFor'

type Resp = { data: unknown; error: { message: string } | null }
const check = (label: string, r: Resp) => {
  if (r.error) throw new Error(`[referencedCommon] ${label} 조회 실패: ${r.error.message}`)
  return r.data
}

export async function referencedCommonTeamCodes(
  scope: { projectId: string; workspaceId: string }, codes: readonly string[],
): Promise<Set<string>> {
  const out = new Set<string>()
  if (codes.length === 0) return out
  const { admin, projectId } = adminFor({ projectId: scope.projectId })
  const candidates = (check('teams', await admin.from('teams').select('id, code')
    .is('project_id', null).eq('workspace_id', scope.workspaceId).in('code', [...codes])) ?? []) as { id: string; code: string }[]
  for (const t of candidates) {
    const [owners, members, areas, invites] = await Promise.all([
      admin.from('item_owners').select('team_id, wbs_items!inner(project_id)').eq('wbs_items.project_id', projectId).eq('team_id', t.id).limit(1),
      admin.from('project_member_teams').select('team_id, project_members!inner(project_id)').eq('project_members.project_id', projectId)
        .eq('team_id', t.id).limit(1),
      admin.from('area_teams').select('team_id, project_areas!inner(project_id)').eq('project_areas.project_id', projectId).eq('team_id', t.id).limit(1),
      admin.from('project_invites').select('id').eq('project_id', projectId).contains('team_ids', [t.id])
        .is('redeemed_at', null).is('revoked_at', null).limit(1),
    ])
    const hit = [['item_owners', owners], ['project_member_teams', members], ['area_teams', areas], ['project_invites', invites]] as const
    if (hit.some(([label, r]) => ((check(label, r as Resp) ?? []) as unknown[]).length > 0)) out.add(t.code)
  }
  return out
}
