import { describe, it, expect } from 'vitest'
import { makeActor, makeAdminActor, makeMemberActor, makeSuperuser } from './actor'
import { roleIn } from '@/lib/domain/authz'

describe('actor fixture', () => {
  it('기본값은 어느 프로젝트에서도 viewer', () => {
    expect(roleIn(makeActor(), 'p1')).toBe('viewer')
  })
  it('makeAdminActor 는 그 프로젝트에서만 admin', () => {
    expect(roleIn(makeAdminActor('p1'), 'p1')).toBe('admin')
    expect(roleIn(makeAdminActor('p1'), 'p2')).toBe('viewer')
  })
  it('makeMemberActor 는 명단 팀을 싣는다', () => {
    const a = makeMemberActor('p1', ['ERP'])
    expect(roleIn(a, 'p1')).toBe('member')
    expect(a.rosterTeams.get('p1')).toBeTruthy()
  })
  it('makeSuperuser', () => {
    expect(roleIn(makeSuperuser(), null)).toBe('superuser')
  })
  it('override 가 기본값을 덮는다', () => {
    expect(makeActor({ userId: 'x' }).userId).toBe('x')
  })
})
