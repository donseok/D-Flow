import { describe, it, expect } from 'vitest'
import { isWorkspaceAdminRole, WORKSPACE_ROLE_LABEL } from '@/lib/domain/authz'

describe('workspace_members.role 원시값 판정', () => {
  it('admin 만 관리자, 그 밖(member·빈 값·알 수 없는 값)은 아니다 — fail-closed', () => {
    expect(isWorkspaceAdminRole('admin')).toBe(true)
    expect(isWorkspaceAdminRole('member')).toBe(false)
    expect(isWorkspaceAdminRole(null)).toBe(false)
    expect(isWorkspaceAdminRole(undefined)).toBe(false)
    expect(isWorkspaceAdminRole('ADMIN')).toBe(false)
  })
  it('표시 라벨은 두 역할 모두 있다', () => {
    expect(WORKSPACE_ROLE_LABEL).toEqual({ admin: '관리자', member: '멤버' })
  })
})
