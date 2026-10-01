import 'server-only'

// 전용 팀이 있는 프로젝트가 이미 참조 중인 공용 팀의 code(SP4 A1 최종 리뷰 보안 P3 — A2 이월 수정 Z4).
// 혼합 상태(⓪ 상속 시절 공용 X 로 담당·명단을 꾸린 뒤 팀 추가 액션으로 첫 전용 팀을 만든 — 전환을 거치지 않은 프로젝트, 스펙 D54 의 한계)는
// DB 가 허용한다(ⓚ). 이 프로젝트에 X 가 든 파일을 가져올 때 X 를 전용 팀으로 새로 등록하면 기존 공용 X 참조와 같은 code·다른 id(D4 분열)가
// 된다. 가져오기 라우트는 여기서 돌려준 code 를 등록하지 않는다 — 가져오기 RPC 는 전용 팀이 없는 code 를 그 워크스페이스 공용 팀으로 잇는다
// (*_command_receipts 의 팀 해석). 참조 = 전환 RPC 가 옮기는 네 곳(담당·명단 팀·영역 팀·수락 전 초대)과 같다.
// 세션이 아니라 프로젝트 스코프 service_role 로 읽는다(라우트는 requireProjectAdmin(pid) 를 통과한 뒤 부른다). 조회 오류는 throw(3원칙 ②).
// 대조는 정확한 code 가 아니라 팀 이름 키(NFKC·trim·소문자 — teamNameKey)다(A2-2 리뷰 보안 P3): 'qa'·'ＱＡ' 를 참조 중인 공용 'QA' 와 다른
// 팀으로 보면 같은 낱말의 전용 팀이 생겨 권한(code 문자열 비교)·봇(키 비교)이 두 팀을 가르지 못한다. 그래서 후보는 그 워크스페이스 공용 팀
// 전부(끝까지 읽기 — workspaceTeams)이고 code 와 이름(개명) 키를 함께 본다. 결과는 요청 code → 참조 중인 공용 팀 code — 같으면 그 공용 팀을
// 잇는 길(등록하지 않는다), 다르면 겹침(호출부가 거부한다). 같은 키의 후보가 여럿이면 정확히 같은 code 를 먼저 본다.
import { adminFor } from '@/lib/supabase/adminFor'
import { workspaceTeams } from '@/lib/teams/source'
import { teamNameKey } from '@/lib/domain/teamName'

type Resp = { data: unknown; error: { message: string } | null }
const check = (label: string, r: Resp) => {
  if (r.error) throw new Error(`[referencedCommon] ${label} 조회 실패: ${r.error.message}`)
  return r.data
}

export async function referencedCommonTeamCodes(
  scope: { projectId: string; workspaceId: string }, codes: readonly string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (codes.length === 0) return out
  const { admin, projectId } = adminFor({ projectId: scope.projectId })
  const commons = await workspaceTeams(scope.workspaceId, { client: admin })
  const referenced = new Map<string, boolean>()
  const isReferenced = async (teamId: string): Promise<boolean> => {
    const known = referenced.get(teamId)
    if (known !== undefined) return known
    const [owners, members, areas, invites] = await Promise.all([
      admin.from('item_owners').select('team_id, wbs_items!inner(project_id)').eq('wbs_items.project_id', projectId).eq('team_id', teamId).limit(1),
      admin.from('project_member_teams').select('team_id, project_members!inner(project_id)').eq('project_members.project_id', projectId)
        .eq('team_id', teamId).limit(1),
      admin.from('area_teams').select('team_id, project_areas!inner(project_id)').eq('project_areas.project_id', projectId).eq('team_id', teamId).limit(1),
      admin.from('project_invites').select('id').eq('project_id', projectId).contains('team_ids', [teamId])
        .is('redeemed_at', null).is('revoked_at', null).limit(1),
    ])
    const hit = [['item_owners', owners], ['project_member_teams', members], ['area_teams', areas], ['project_invites', invites]] as const
    const yes = hit.some(([label, r]) => ((check(label, r as Resp) ?? []) as unknown[]).length > 0)
    referenced.set(teamId, yes)
    return yes
  }
  for (const code of codes) {
    const key = teamNameKey(code)
    const candidates = commons
      .filter((t) => t.code === code || teamNameKey(t.code) === key || teamNameKey(t.name) === key)
      .sort((a, b) => Number(b.code === code) - Number(a.code === code))
    for (const t of candidates) {
      if (await isReferenced(t.id)) { out.set(code, t.code); break }
    }
  }
  return out
}
