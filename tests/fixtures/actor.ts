// 테스트 공용 Actor fixture — Actor 형이 바뀌면 이 파일만 고친다(SP1 R2 대응).
// 기본 Actor 는 워크스페이스 WS 의 member 이며 아는 프로젝트가 없다 — 어떤 pid 든 roleIn 은 null(존재 은닉).
// 프로젝트를 '같은 워크스페이스의 viewer' 로 보이게 하려면 projectWorkspace 를 넘긴다.
import type { Actor, ProjectActorView, ProjectRole } from '@/lib/domain/authz'

export const WS = 'ws-1'
export function makeActor(over: Partial<Actor> = {}): Actor {
  return {
    userId: 'u1', isSuperuser: false,
    workspaceRoles: new Map([[WS, 'member']]), projectWorkspace: new Map(),
    projectRoles: new Map(), memberIds: new Map(), rosterTeams: new Map(),
    ...over,
  }
}
export function makeSuperuser(over: Partial<Actor> = {}): Actor { return makeActor({ isSuperuser: true, ...over }) }
export function makeAdminActor(projectId: string, over: Partial<Actor> = {}): Actor {
  return makeActor({
    projectWorkspace: new Map([[projectId, WS]]),
    projectRoles: new Map<string, ProjectRole>([[projectId, 'admin']]),
    memberIds: new Map([[projectId, `m-${projectId}`]]),
    ...over,
  })
}
export function makeMemberActor(projectId: string, teamCodes: string[] = [], over: Partial<Actor> = {}): Actor {
  return makeActor({
    projectWorkspace: new Map([[projectId, WS]]),
    projectRoles: new Map<string, ProjectRole>([[projectId, 'member']]),
    memberIds: new Map([[projectId, `m-${projectId}`]]),
    rosterTeams: new Map(teamCodes.length ? [[projectId, { teamIds: teamCodes.map(c => `t-${c}`), teamCodes }]] : []),
    ...over,
  })
}
export function makeProjectActorView(over: Partial<ProjectActorView> = {}): ProjectActorView {
  return {
    userId: 'u1', isSuperuser: false, workspaceId: WS, workspaceRole: 'member',
    projectRole: null, memberId: null, rosterTeamIds: [], rosterTeamCodes: [], primaryTeamCode: null,
    ...over,
  }
}
