
// D37 — 명단 화면과 roleIn 이 같은 단계 함수를 쓴다. 동치표: 모든 wsRole × accessRole 에서 roleIn(actor) = inheritedProjectRole
import { describe, expect, it } from 'vitest'
import { effectiveRoleOfRow, inheritedProjectRole, roleIn, type Actor } from '@/lib/domain/authz'

const W = 'w1', P = 'p1'
const actorOf = (ws: 'admin' | 'member' | null, pr: 'admin' | 'member' | null): Actor => ({
  userId: 'u', isSuperuser: false, projectWorkspace: new Map([[P, W]]),
  workspaceRoles: new Map(ws ? [[W, ws]] : []), projectRoles: new Map(pr ? [[P, pr]] : []), memberIds: new Map(),
} as unknown as Actor)

describe('inheritedProjectRole = roleIn ⑤⑥', () => {
  for (const ws of ['admin', 'member', null] as const) for (const pr of ['admin', 'member', null] as const) {
    it(`ws=${ws} access=${pr}`, () => { expect(roleIn(actorOf(ws, pr), P)).toBe(inheritedProjectRole(ws, pr)) })
  }
  it('값', () => {
    expect(inheritedProjectRole('admin', null)).toBe('admin'); expect(inheritedProjectRole('member', 'member')).toBe('member')
    expect(inheritedProjectRole(null, null)).toBe('viewer')
  })
})

describe('effectiveRoleOfRow', () => {
  const ws = new Map([['ua', 'admin' as const], ['um', 'member' as const]])
  it('워크스페이스 관리자인 명단 member → 실효 관리자 + 상속', () => {
    expect(effectiveRoleOfRow({ kind: 'account', userId: 'ua', accessRole: 'member' }, ws)).toEqual({ kind: 'role', role: 'admin', inherited: true })
  })
  it('명단 admin 이 워크스페이스 관리자이기도 하면 상속 표시는 하지 않는다(명단만으로도 관리자)', () => {
    expect(effectiveRoleOfRow({ kind: 'account', userId: 'ua', accessRole: 'admin' }, ws)).toEqual({ kind: 'role', role: 'admin', inherited: false })
  })
  it('나머지는 명단 역할 그대로(null = 조회 전용), 배지 없음', () => {
    expect(effectiveRoleOfRow({ kind: 'account', userId: 'um', accessRole: null }, ws)).toEqual({ kind: 'role', role: 'viewer', inherited: false })
  })
  it('계정 없는 외부 인력 → external, 워크스페이스 역할 조회 실패 → unknown', () => {
    expect(effectiveRoleOfRow({ kind: 'external', userId: null, accessRole: null }, ws)).toEqual({ kind: 'external' })
    expect(effectiveRoleOfRow({ kind: 'account', userId: 'um', accessRole: 'member' }, null)).toEqual({ kind: 'unknown' })
  })
})
