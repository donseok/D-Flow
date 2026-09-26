import { describe, it, expect, vi, beforeEach } from 'vitest'

// service_role 클라이언트는 가짜로 — adminFor 는 스코프 값을 검사하고 그 값을 그대로 돌려주는지만 본다.
const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn(() => ({ fake: 'admin' })) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))

import { adminFor } from '@/lib/supabase/adminFor'

const WID = '11111111-1111-4111-8111-111111111111'
const PID = '22222222-2222-4222-8222-222222222222'

beforeEach(() => vi.clearAllMocks())

describe('adminFor', () => {
  it('워크스페이스 스코프 — 스코프 값과 admin 을 함께 돌려준다', () => {
    const r = adminFor({ workspaceId: WID })
    expect(r).toEqual({ workspaceId: WID, admin: { fake: 'admin' } })
    expect(mocks.createAdminClient).toHaveBeenCalledTimes(1)
  })

  it('프로젝트 스코프 — 스코프 값과 admin 을 함께 돌려준다', () => {
    expect(adminFor({ projectId: PID })).toEqual({ projectId: PID, admin: { fake: 'admin' } })
  })

  it('id 가 uuid 가 아니면 throw — 클라이언트를 만들지 않는다(fail-closed)', () => {
    expect(() => adminFor({ projectId: 'x' })).toThrow('adminFor')
    expect(() => adminFor({ workspaceId: '' })).toThrow('adminFor')
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })

  it('스코프 키가 없으면 throw', () => {
    expect(() => adminFor({} as never)).toThrow('adminFor')
    expect(() => adminFor({ workspaceId: null } as never)).toThrow('adminFor')
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })
})
