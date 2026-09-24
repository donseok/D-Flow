// 테스트 공용 Actor fixture — Actor 형이 바뀌면 이 파일만 고친다(SP1 R2 대응).
import type { Actor, ProjectActorView, ProjectRole } from '@/lib/domain/authz'

export function makeActor(over: Partial<Actor> = {}): Actor {
  return {
    userId: 'u1', teamCode: null, teamId: null, isSuperuser: false,
    projectRoles: new Map(), rosterTeams: new Map(),
    ...over,
  }
}
export function makeSuperuser(over: Partial<Actor> = {}): Actor {
  return makeActor({ isSuperuser: true, ...over })
}
export function makeAdminActor(projectId: string, over: Partial<Actor> = {}): Actor {
  return makeActor({ projectRoles: new Map<string, ProjectRole>([[projectId, 'admin']]), ...over })
}
export function makeMemberActor(projectId: string, teamCodes: string[] = [], over: Partial<Actor> = {}): Actor {
  const roster = new Map<string, { teamId: string; teamCode: string }>()
  if (teamCodes[0]) roster.set(projectId, { teamId: `t-${teamCodes[0]}`, teamCode: teamCodes[0] })
  return makeActor({
    projectRoles: new Map<string, ProjectRole>([[projectId, 'member']]),
    rosterTeams: roster,
    ...over,
  })
}
export function makeProjectActorView(over: Partial<ProjectActorView> = {}): ProjectActorView {
  return {
    userId: 'u1', teamCode: null, teamId: null, isSuperuser: false,
    projectRole: null, rosterTeamId: null, rosterTeamCode: null,
    ...over,
  }
}
