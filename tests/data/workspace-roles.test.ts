import { beforeEach, describe, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ from: vi.fn(), eq: vi.fn(), range: vi.fn(), order: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: async () => ({ from: h.from }) }))
import { getWorkspaceRoleMap } from '@/lib/data/workspaceRoles'
beforeEach(() => {
  vi.clearAllMocks()
  const q = { select: vi.fn(() => q), eq: h.eq, order: h.order, range: h.range }
  h.from.mockReturnValue(q); h.eq.mockReturnValue(q); h.order.mockReturnValue(q)
})
describe('명단 실효 역할의 워크스페이스 한정 조회', () => {
  it('서버 응답이 작아도 모든 행을 읽고 각 쪽에서 workspace 필터를 유지한다', async () => {
    h.range.mockResolvedValueOnce({ data: [{user_id:'a',role:'admin'}, {user_id:'b',role:'member'}], count:3, error:null })
      .mockResolvedValueOnce({ data:[{user_id:'c',role:'member'}], count:3, error:null })
    expect(await getWorkspaceRoleMap('workspace-a')).toEqual({ ok:true, map:new Map([['a','admin'],['b','member'],['c','member']]) })
    expect(h.from).toHaveBeenCalledWith('workspace_members')
    expect(h.eq.mock.calls).toEqual([['workspace_id','workspace-a'],['workspace_id','workspace-a']])
    expect(h.order.mock.calls).toEqual([['user_id'],['user_id']])
    expect(h.range.mock.calls[1][0]).toBe(2)
  })
  it('조회 실패는 빈 역할 맵으로 위장하지 않는다', async () => {
    h.range.mockResolvedValue({ data:null,error:{message:'down'},count:null })
    expect(await getWorkspaceRoleMap('workspace-a')).toMatchObject({ok:false})
  })
})
