import { describe, it, expect } from 'vitest'
import { makeActor, makeAdminActor, makeMemberActor, makeSuperuser, WS } from './actor'
import { roleIn } from '@/lib/domain/authz'

describe('actor fixture', () => {
  it('기본값은 워크스페이스 멤버일 뿐 아는 프로젝트가 없다 — 어떤 pid 든 null(존재 은닉)', () => {
    expect(roleIn(makeActor(), 'p1')).toBe(null)
    expect(makeActor().workspaceRoles.get(WS)).toBe('member')
  })
  it('projectWorkspace 를 주면 같은 워크스페이스의 조회 전용(viewer)', () => {
    expect(roleIn(makeActor({ projectWorkspace: new Map([['p1', WS]]) }), 'p1')).toBe('viewer')
  })
  it('makeAdminActor 는 그 프로젝트에서만 admin', () => {
    expect(roleIn(makeAdminActor('p1'), 'p1')).toBe('admin')
    expect(roleIn(makeAdminActor('p1'), 'p2')).toBe(null)
    expect(makeAdminActor('p1').memberIds.get('p1')).toBe('m-p1')
  })
  it('makeMemberActor 는 명단 팀을 싣는다', () => {
    const a = makeMemberActor('p1', ['ERP'])
    expect(roleIn(a, 'p1')).toBe('member')
    expect(a.rosterTeams.get('p1')?.teamCodes).toEqual(['ERP'])
  })
  it('makeSuperuser', () => {
    expect(roleIn(makeSuperuser(), null)).toBe('superuser')
  })
  it('override 가 기본값을 덮는다', () => {
    expect(makeActor({ userId: 'x' }).userId).toBe('x')
  })
})
