import { describe, it, expect } from 'vitest'
import {
  roleIn, isProjectAdmin, isProjectMember, isAnyProjectAdmin, hasAnyProjectRole, adminProjectIds,
  toProjectActorView, actorFromView, canSeeProject, workspaceRoleIn, isWorkspaceAdmin, isWorkspaceMember,
  isAdminAccessRole, hasProjectRoleInWorkspace, adminWorkspaceIdList, workspaceAdminVerdict,
  isHiddenProject, ACCESS_ROLE, WORKSPACE_ROLE,
} from '@/lib/domain/authz'
import { makeActor, makeAdminActor, makeMemberActor, makeSuperuser } from '../fixtures/actor'

const W = 'ws-1', P = 'proj-1', Q = 'proj-2', X = 'proj-other-ws'
const inWs = { projectWorkspace: new Map([[P, W], [Q, W]]) }

describe('roleIn', () => {
  it('비로그인은 null', () => { expect(roleIn(null, P)).toBe(null) })
  it('플랫폼 관리자는 pid 가 무엇이든 superuser', () => {
    expect(roleIn(makeSuperuser(), P)).toBe('superuser'); expect(roleIn(makeSuperuser(), null)).toBe('superuser')
  })
  it('pid null 은 superuser 외 viewer(fail-closed)', () => { expect(roleIn(makeAdminActor(P), null)).toBe('viewer') })
  it('타 워크스페이스·미존재 프로젝트는 null(존재 은닉)', () => {
    expect(roleIn(makeAdminActor(P, inWs), X)).toBe(null)
  })
  it('워크스페이스 관리자는 명단 행 없이도 admin — 명단에 member 로 있어도 admin', () => {
    const wsAdmin = makeActor({ ...inWs, workspaceRoles: new Map([[W, 'admin']]) })
    expect(roleIn(wsAdmin, P)).toBe('admin')
    const demotedOnRoster = makeMemberActor(P, [], { ...inWs, workspaceRoles: new Map([[W, 'admin']]) })
    expect(roleIn(demotedOnRoster, P)).toBe('admin')
  })
  it('명단 행의 access_role, 없으면 viewer', () => {
    expect(roleIn(makeAdminActor(P, inWs), P)).toBe('admin')
    expect(roleIn(makeMemberActor(P, [], inWs), P)).toBe('member')
    expect(roleIn(makeActor(inWs), Q)).toBe('viewer')
  })
})
describe('workspaceRoleIn / isWorkspaceAdmin', () => {
  it('소속 없음 null, member, admin, superuser', () => {
    // fixture 기본값이 WS 의 member 라 '소속 없음'은 빈 Map 을 명시한다.
    expect(workspaceRoleIn(makeActor({ workspaceRoles: new Map() }), W)).toBe(null)
    expect(workspaceRoleIn(makeActor({ workspaceRoles: new Map([[W, 'member']]) }), W)).toBe('member')
    expect(isWorkspaceAdmin(makeActor({ workspaceRoles: new Map([[W, 'admin']]) }), W)).toBe(true)
    expect(workspaceRoleIn(makeSuperuser(), W)).toBe('superuser')
  })
})
describe('canSeeProject', () => {
  it('비공개는 역할 보유자·워크스페이스 관리자·플랫폼 관리자만', () => {
    const priv = { id: P, is_private: true }
    expect(canSeeProject(makeActor(inWs), priv)).toBe(false)
    expect(canSeeProject(makeMemberActor(P, [], inWs), priv)).toBe(true)
    expect(canSeeProject(makeActor({ ...inWs, workspaceRoles: new Map([[W, 'admin']]) }), priv)).toBe(true)
    expect(canSeeProject(makeSuperuser(), priv)).toBe(true)
  })
})
describe('adminProjectIds / isAnyProjectAdmin', () => {
  it('워크스페이스 관리자는 그 워크스페이스 프로젝트 전부가 관리 대상', () => {
    const a = makeActor({ ...inWs, workspaceRoles: new Map([[W, 'admin']]) })
    expect(new Set(adminProjectIds(a))).toEqual(new Set([P, Q]))
    expect(isAnyProjectAdmin(a)).toBe(true)
    expect(hasAnyProjectRole(a)).toBe(true)
  })
})
describe('adminWorkspaceIdList — 회의록 폴더 관리 판정의 클라이언트 미러', () => {
  it('관리자인 워크스페이스만 — 프로젝트 명단 관리자는 들어가지 않는다(0006)', () => {
    expect(adminWorkspaceIdList(makeActor({ workspaceRoles: new Map([[W, 'admin'], ['ws-2', 'member']]) }))).toEqual([W])
    expect(adminWorkspaceIdList(makeAdminActor(P, inWs))).toEqual([])
    expect(adminWorkspaceIdList(null)).toEqual([])
  })
})
describe('hasProjectRoleInWorkspace', () => {
  const W2 = 'ws-2', R = 'proj-in-w2'
  it('워크스페이스 관리자는 명단 없이 true, 다른 워크스페이스 관리자는 false', () => {
    expect(hasProjectRoleInWorkspace(makeActor({ workspaceRoles: new Map([[W, 'admin']]) }), W)).toBe(true)
    expect(hasProjectRoleInWorkspace(makeActor({ workspaceRoles: new Map([[W2, 'admin']]) }), W)).toBe(false)
  })
  it('그 워크스페이스 프로젝트의 명단 권한이면 true, 다른 워크스페이스 명단 권한은 false', () => {
    expect(hasProjectRoleInWorkspace(makeMemberActor(P, [], inWs), W)).toBe(true)
    const other = makeMemberActor(R, [], { projectWorkspace: new Map([[R, W2]]), workspaceRoles: new Map([[W, 'member'], [W2, 'member']]) })
    expect(hasProjectRoleInWorkspace(other, W)).toBe(false)
  })
  it('null 워크스페이스·비로그인은 fail-closed, 플랫폼 관리자는 true', () => {
    expect(hasProjectRoleInWorkspace(makeMemberActor(P, [], inWs), null)).toBe(false)
    expect(hasProjectRoleInWorkspace(null, W)).toBe(false)
    expect(hasProjectRoleInWorkspace(makeSuperuser(), W)).toBe(true)
  })
})
describe('ProjectActorView 왕복', () => {
  it('팀 배열·대표 팀·memberId 가 보존된다', () => {
    const a = makeMemberActor(P, ['ERP', 'MES'], { ...inWs, memberIds: new Map([[P, 'm1']]) })
    const v = toProjectActorView(a, P)!
    expect(v.rosterTeamCodes).toEqual(['ERP', 'MES']); expect(v.primaryTeamCode).toBe('ERP'); expect(v.memberId).toBe('m1')
    expect(v.workspaceId).toBe(W)
    const back = actorFromView(v, P)!
    expect(roleIn(back, P)).toBe('member'); expect(back.rosterTeams.get(P)?.teamCodes).toEqual(['ERP', 'MES'])
  })
})

// ── 기존 케이스(SP0 판정 계약) — 새 Actor 형으로 이식. P·Q 는 같은 워크스페이스(W)의 프로젝트다. ──
const superuser = makeSuperuser()
const admin = makeAdminActor(P, inWs)
const member = makeMemberActor(P, [], inWs)
const viewer = makeActor(inWs)

describe('roleIn — 기존 계약', () => {
  it('슈퍼유저는 어느 프로젝트에서도 superuser', () => {
    expect(roleIn(superuser, P)).toBe('superuser')
    expect(roleIn(superuser, Q)).toBe('superuser')
  })
  it('관리자는 지정된 프로젝트에서만 admin, 같은 워크스페이스의 다른 프로젝트에서는 viewer', () => {
    expect(roleIn(admin, P)).toBe('admin')
    expect(roleIn(admin, Q)).toBe('viewer')
  })
  it('멤버는 지정된 프로젝트에서만 member', () => {
    expect(roleIn(member, P)).toBe('member')
    expect(roleIn(member, Q)).toBe('viewer')
  })
  it('역할이 없으면 viewer', () => {
    expect(roleIn(viewer, P)).toBe('viewer')
  })
  // 프로젝트 미지정 대상(예: project_id 가 null 인 회의록)은 프로젝트로 판정할 수 없다.
  it('projectId 가 null 이면 슈퍼유저 외 전원 viewer', () => {
    expect(roleIn(superuser, null)).toBe('superuser')
    expect(roleIn(admin, null)).toBe('viewer')
    expect(roleIn(member, null)).toBe('viewer')
  })
  it('워크스페이스 멤버 등급은 승계하지 않는다 — admin 만 승계', () => {
    expect(roleIn(makeActor({ ...inWs, workspaceRoles: new Map([[W, 'member']]) }), P)).toBe('viewer')
  })
})

// 승계는 '그 프로젝트의 워크스페이스'에서의 등급만 본다 — 어느 워크스페이스든 admin 이면 승계하는 회귀를 막는다.
describe('워크스페이스 관리자 승계는 워크스페이스 경계를 넘지 않는다', () => {
  const two = makeActor({
    workspaceRoles: new Map([['ws-1', 'admin'], ['ws-2', 'member']]),
    projectWorkspace: new Map([['p-in-1', 'ws-1'], ['p-in-2', 'ws-2']]),
  })
  it('ws-1 admin 은 ws-2 프로젝트에서 admin 이 아니다(viewer)', () => {
    expect(roleIn(two, 'p-in-2')).toBe('viewer')
    expect(isProjectAdmin(two, 'p-in-2')).toBe(false)
    expect(isWorkspaceAdmin(two, 'ws-2')).toBe(false)
    expect(canSeeProject(two, { id: 'p-in-2', is_private: true })).toBe(false)
  })
  it('자기 워크스페이스(ws-1) 프로젝트만 관리 대상', () => {
    expect(roleIn(two, 'p-in-1')).toBe('admin')
    expect(adminProjectIds(two)).toEqual(['p-in-1'])
  })
})

describe('workspaceRoleIn / isWorkspaceAdmin / isWorkspaceMember — 경계', () => {
  it('비로그인은 null·false', () => {
    expect(workspaceRoleIn(null, W)).toBe(null)
    expect(isWorkspaceAdmin(null, W)).toBe(false)
    expect(isWorkspaceMember(null, W)).toBe(false)
  })
  it('워크스페이스 미지정(null/undefined)은 플랫폼 관리자만 true — fail-closed', () => {
    expect(isWorkspaceAdmin(makeActor({ workspaceRoles: new Map([[W, 'admin']]) }), null)).toBe(false)
    expect(isWorkspaceMember(makeActor(), undefined)).toBe(false)
    expect(isWorkspaceAdmin(superuser, null)).toBe(true)
    expect(isWorkspaceMember(superuser, undefined)).toBe(true)
  })
  it('isWorkspaceMember 는 소속 여부, isWorkspaceAdmin 은 admin 만', () => {
    const m = makeActor({ workspaceRoles: new Map([[W, 'member']]) })
    expect(isWorkspaceMember(m, W)).toBe(true)
    expect(isWorkspaceAdmin(m, W)).toBe(false)
    expect(isWorkspaceMember(m, 'ws-other')).toBe(false)
  })
})

describe('isProjectAdmin', () => {
  it('슈퍼유저·해당 프로젝트 관리자만 true', () => {
    expect(isProjectAdmin(superuser, P)).toBe(true)
    expect(isProjectAdmin(admin, P)).toBe(true)
    expect(isProjectAdmin(admin, Q)).toBe(false)
    expect(isProjectAdmin(member, P)).toBe(false)
    expect(isProjectAdmin(viewer, P)).toBe(false)
    expect(isProjectAdmin(null, P)).toBe(false)
  })
  it('타 워크스페이스 프로젝트는 false', () => {
    expect(isProjectAdmin(admin, X)).toBe(false)
  })
})

describe('isAnyProjectAdmin / hasAnyProjectRole — 전역 성격 리소스용', () => {
  it('isAnyProjectAdmin: 슈퍼유저·어느 프로젝트든 관리자면 true', () => {
    expect(isAnyProjectAdmin(superuser)).toBe(true)
    expect(isAnyProjectAdmin(admin)).toBe(true)
    expect(isAnyProjectAdmin(member)).toBe(false)
    expect(isAnyProjectAdmin(viewer)).toBe(false)
    expect(isAnyProjectAdmin(null)).toBe(false)
  })
  it('hasAnyProjectRole: 역할이 하나라도 있으면 true — 조회 전용만 false', () => {
    expect(hasAnyProjectRole(superuser)).toBe(true)
    expect(hasAnyProjectRole(admin)).toBe(true)
    expect(hasAnyProjectRole(member)).toBe(true)
    expect(hasAnyProjectRole(viewer)).toBe(false)
    expect(hasAnyProjectRole(null)).toBe(false)
  })
  it('adminProjectIds: 명단 admin 행만 — 워크스페이스 관리자가 아니면 워크스페이스 전체로 넓어지지 않는다', () => {
    expect(adminProjectIds(admin)).toEqual([P])
    expect(adminProjectIds(member)).toEqual([])
    expect(adminProjectIds(null)).toEqual([])
  })
})

describe('toProjectActorView / actorFromView', () => {
  it('왕복해도 프로젝트 판정이 보존된다', () => {
    for (const a of [superuser, admin, member, viewer]) {
      const restored = actorFromView(toProjectActorView(a, P), P)
      expect(roleIn(restored, P)).toBe(roleIn(a, P))
      expect(isProjectAdmin(restored, P)).toBe(isProjectAdmin(a, P))
      expect(isProjectMember(restored, P)).toBe(isProjectMember(a, P))
    }
  })
  it('워크스페이스 관리자 승계도 왕복에서 보존된다', () => {
    const wsAdmin = makeActor({ ...inWs, workspaceRoles: new Map([[W, 'admin']]) })
    const restored = actorFromView(toProjectActorView(wsAdmin, Q), Q)
    expect(roleIn(restored, Q)).toBe('admin')
  })
  it('다른 프로젝트의 역할은 뷰에 실리지 않는다 — 뷰는 한 프로젝트 스코프다', () => {
    const restored = actorFromView(toProjectActorView(admin, Q), Q)
    expect(roleIn(restored, Q)).toBe('viewer')
    // 뷰는 Q 의 워크스페이스만 싣는다 — P 는 복원 Actor 에게 '모르는 프로젝트'(존재 은닉)
    expect(roleIn(restored, P)).toBe(null)
    expect(isProjectAdmin(restored, P)).toBe(false)
  })
  it('명단 팀이 없으면 빈 배열·대표 팀 null', () => {
    const v = toProjectActorView(viewer, P)!
    expect(v.rosterTeamCodes).toEqual([]); expect(v.rosterTeamIds).toEqual([]); expect(v.primaryTeamCode).toBe(null)
    expect(v.memberId).toBe(null); expect(v.projectRole).toBe(null)
  })
  it('null 은 null', () => {
    expect(toProjectActorView(null, P)).toBe(null)
    expect(actorFromView(null, P)).toBe(null)
  })
})

describe('isProjectMember', () => {
  it('멤버 이상이면 true (관리자·슈퍼유저 포함)', () => {
    expect(isProjectMember(superuser, P)).toBe(true)
    expect(isProjectMember(admin, P)).toBe(true)
    expect(isProjectMember(member, P)).toBe(true)
    expect(isProjectMember(viewer, P)).toBe(false)
    expect(isProjectMember(null, P)).toBe(false)
  })
  it('다른 프로젝트에는 전이되지 않는다', () => {
    expect(isProjectMember(member, Q)).toBe(false)
    expect(isProjectMember(admin, Q)).toBe(false)
  })
})

describe('canSeeProject — 비공개 프로젝트 UI 숨김 (0070)', () => {
  const pub = { id: P, is_private: false }
  const priv = { id: P, is_private: true }
  it('공개 프로젝트는 비로그인 포함 전원에게 보인다 (기존 동작 유지)', () => {
    expect(canSeeProject(null, pub)).toBe(true)
    expect(canSeeProject(viewer, pub)).toBe(true)
  })
  it('is_private 미지정(구 데이터·컬럼 미적용)은 공개로 본다', () => {
    expect(canSeeProject(viewer, { id: P })).toBe(true)
    expect(canSeeProject(viewer, { id: P, is_private: null })).toBe(true)
  })
  it('비공개는 역할 보유자(admin/member)와 슈퍼유저에게만 보인다', () => {
    expect(canSeeProject(superuser, priv)).toBe(true)
    expect(canSeeProject(admin, priv)).toBe(true)
    expect(canSeeProject(member, priv)).toBe(true)
  })
  it('비공개는 viewer·비로그인에게 숨긴다 — fail-closed', () => {
    expect(canSeeProject(viewer, priv)).toBe(false)
    expect(canSeeProject(null, priv)).toBe(false)
  })
  it('다른 프로젝트의 역할로는 볼 수 없다', () => {
    expect(canSeeProject(admin, { id: Q, is_private: true })).toBe(false)
    expect(canSeeProject(member, { id: Q, is_private: true })).toBe(false)
  })
})

// 관리자 슬롯을 여는 요청인가 — 가드 선택(슈퍼유저 vs 프로젝트 관리자)의 판정을 액션이 문자열로 하지 않게 여기 둔다.
describe('isAdminAccessRole', () => {
  it("'admin' 만 참 — 서버 액션 입력이라 모양을 믿지 않는다", () => {
    expect(isAdminAccessRole('admin')).toBe(true)
    for (const v of ['member', 'viewer', null, undefined, 'ADMIN', ' admin', 1, {}]) expect(isAdminAccessRole(v)).toBe(false)
  })
})
describe('workspaceAdminVerdict', () => {
  it('플랫폼 관리자 ok, 관리자 ok, 멤버 denied, 비소속·null missing(존재 은닉)', () => {
    expect(workspaceAdminVerdict(makeSuperuser(), 'ws-x')).toBe('ok')
    expect(workspaceAdminVerdict(makeActor({ workspaceRoles: new Map([[W, 'admin']]) }), W)).toBe('ok')
    expect(workspaceAdminVerdict(makeActor(), W)).toBe('denied')
    expect(workspaceAdminVerdict(makeActor(), 'ws-other')).toBe('missing')
    expect(workspaceAdminVerdict(makeActor(), null)).toBe('missing')
  })
})
describe('Q2 — 두 워크스페이스·비공개(Review Focus 2)', () => {
  const W2 = 'ws-2', B = 'proj-b'
  const dual = makeActor({ workspaceRoles: new Map([[W, 'admin'], [W2, 'member']]), projectWorkspace: new Map([[P, W], [B, W2]]) })
  it('A 관리자는 A 비공개 프로젝트의 admin 이고 B 프로젝트는 명단대로(viewer)', () => {
    expect(roleIn(dual, P)).toBe('admin'); expect(canSeeProject(dual, { id: P, is_private: true })).toBe(true)
    expect(roleIn(dual, B)).toBe('viewer')
  })
  it('B 에 속하지 않은 A 관리자에게 B 프로젝트는 null', () => {
    expect(roleIn(makeActor({ workspaceRoles: new Map([[W, 'admin']]), projectWorkspace: new Map([[P, W]]) }), B)).toBe(null)
  })
})

// 레이아웃 404 판정(T11 C3) — roleIn 은 플랫폼 관리자에게 pid 가 무엇이든 'superuser' 라 미존재 pid 가 빈 화면으로 샜다.
describe('isHiddenProject', () => {
  it('타 워크스페이스·미존재 프로젝트는 숨긴다', () => {
    expect(isHiddenProject(makeAdminActor(P, inWs), X)).toBe(true)
  })
  it('같은 워크스페이스의 조회 전용(viewer)은 숨기지 않는다', () => {
    expect(isHiddenProject(makeActor(inWs), Q)).toBe(false)
  })
  it('플랫폼 관리자라도 projectWorkspace 에 없는 pid 는 숨긴다 — buildActor 가 전 프로젝트를 싣으므로 없으면 미존재', () => {
    expect(isHiddenProject(makeSuperuser(), P)).toBe(true)
    expect(isHiddenProject(makeSuperuser(inWs), X)).toBe(true)
  })
  it('플랫폼 관리자 + 있는 pid 는 숨기지 않는다(워크스페이스 소속과 무관)', () => {
    expect(isHiddenProject(makeSuperuser({ workspaceRoles: new Map(), ...inWs }), P)).toBe(false)
  })
  it('actor=null 은 숨긴다 — 판정 대상이 없다', () => {
    expect(isHiddenProject(null, P)).toBe(true)
  })
})

// 역할 문자열의 정본 — 호출부는 'admin'·'member' 를 직접 적지 않고 이 상수로 비교한다(M5).
describe('ACCESS_ROLE / WORKSPACE_ROLE', () => {
  it('DB 값(project_members.access_role · workspace_members.role)과 같은 문자열이다', () => {
    expect(ACCESS_ROLE).toEqual({ admin: 'admin', member: 'member' })
    expect(WORKSPACE_ROLE).toEqual({ admin: 'admin', member: 'member' })
  })
})
