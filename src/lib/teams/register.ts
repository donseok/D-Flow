import 'server-only'

// 가져오기의 미등록 팀 등록(스펙 §4.4 #6 — D4·Q36). 늘 그 프로젝트의 전용 팀이고 "이미 있으면 성공"이다 — 사전 조회로 있는 팀을
// 건너뛰고, insert 의 23505(같은 명령의 동시 재전송이 먼저 만든 팀)도 성공으로 본다. 그래서 같은 명령 id 재시도가 팀 단계에서 500 이
// 되지 않고 RPC 의 duplicate 까지 간다. 정규화·예약어는 addProjectTeam 과 같은 normalizeNewTeamCode(A2 가 예약어를 프로젝트 설정까지
// 넓힐 때 같이 바꾼다 — 스펙 §4.2.4). 공용 팀은 만들지 않는다 — 상속 공용 팀 전환은 RPC convert_inherited_teams 몫이고 라우트가 먼저
// 부른다(D54). 팀 행은 각자 커밋된다(트랜잭션 밖 — 실패해도 앞서 만든 팀은 남는다, 지금과 같은 성질).
// 호출부는 requireProjectAdmin(pid) 를 통과한 뒤 부르고 workspaceId 는 그 가드 결과다(teams_guard 가 프로젝트와의 일치를 다시 본다).
// DB 오류 원문은 결과에 싣지 않는다(failWith — 로그로만, 스펙 §4.7).
import { adminFor } from '@/lib/supabase/adminFor'
import { normalizeNewTeamCode } from '@/lib/domain/teams'
import { pickTeamColor } from '@/lib/domain/teamColor'
import { failWith } from '@/lib/errors/dbFail'

export type EnsureTeamsResult =
  | { ok: true; created: string[]; existing: string[] }
  | { ok: false; code: 'INVALID_TEAM_CODE' | 'TEAM_REGISTER_FAILED'; error: string; team: string }

export const ERR_REGISTER_TEAMS = '팀을 등록하지 못했습니다. 잠시 후 다시 시도하세요.'

/** codes 를 그 프로젝트의 전용 팀으로 — 이미 있으면 existing, 새로 만들면 created(정규화한 code, 입력 순·중복 없음) */
export async function ensureProjectTeams(
  scope: { projectId: string; workspaceId: string }, codes: readonly string[],
): Promise<EnsureTeamsResult> {
  // 하나라도 이름이 틀리면 아무것도 만들지 않는다 — 정규화를 DB 보다 먼저 끝낸다
  const wanted: string[] = []
  for (const input of codes) {
    const n = normalizeNewTeamCode(input)
    if (!n.ok) return { ok: false, code: 'INVALID_TEAM_CODE', error: n.error, team: input }
    if (!wanted.includes(n.code)) wanted.push(n.code)
  }
  if (wanted.length === 0) return { ok: true, created: [], existing: [] }

  const { admin, projectId } = adminFor({ projectId: scope.projectId })
  // 쓰기 전 선행 조회 — 실패는 중단(3원칙 ②)
  const have = await admin.from('teams').select('code').eq('project_id', projectId).in('code', wanted)
  if (have.error) {
    return { ok: false, code: 'TEAM_REGISTER_FAILED', error: failWith('teams/register 사전 조회', have.error, ERR_REGISTER_TEAMS), team: wanted[0] }
  }
  const max = await admin.from('teams').select('sort_order').eq('project_id', projectId)
    .order('sort_order', { ascending: false }).limit(1).maybeSingle()
  if (max.error) {
    return { ok: false, code: 'TEAM_REGISTER_FAILED', error: failWith('teams/register 순번 조회', max.error, ERR_REGISTER_TEAMS), team: wanted[0] }
  }

  const present = new Set(((have.data ?? []) as { code: string }[]).map((r) => r.code))
  let next = Number((max.data as { sort_order?: number } | null)?.sort_order ?? -1) + 1
  const created: string[] = []
  const existing: string[] = []
  for (const code of wanted) {
    if (present.has(code)) { existing.push(code); continue }
    const sortOrder = next++
    const ins = await admin.from('teams').insert({
      code, name: code, sort_order: sortOrder, project_id: projectId, workspace_id: scope.workspaceId, color: pickTeamColor(sortOrder),
    })
    if (ins.error) {
      // 같은 프로젝트·같은 code 의 유일 위반 = 다른 요청(같은 명령의 동시 재전송)이 먼저 만들었다 — 이미 있으면 성공
      if (ins.error.code === '23505') { existing.push(code); continue }
      return { ok: false, code: 'TEAM_REGISTER_FAILED', error: failWith('teams/register insert', ins.error, ERR_REGISTER_TEAMS), team: code }
    }
    created.push(code)
  }
  return { ok: true, created, existing }
}
