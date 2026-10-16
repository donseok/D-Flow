import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeProjectConfig } from '../helpers/projectConfigFixture'
import { makeMemberActor } from '../fixtures/actor'
const h = vi.hoisted(() => ({ config: vi.fn(), client: vi.fn(), update: vi.fn(), member: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/settings/projectConfig', () => ({ getProjectConfig: h.config }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: h.client }))
vi.mock('@/lib/authz', () => ({ requireProjectMember: h.member, requireProjectAdmin: vi.fn() }))
vi.mock('@/lib/ai/index/enqueueChange', () => ({ enqueueIndexChange: vi.fn() }))
vi.mock('@/lib/supabase/adminFor', () => ({ adminFor: () => ({ admin: { from: () => ({ update: () => ({ in: async () => ({ error: null }) }) }) } }) }))
import { saveWeeklyCell, saveWeeklyCells } from '@/app/actions/weekly'
function client(cells = { this_delivery: '이전 내용', next_delivery: '계획' }) {
  const b = {
    select: vi.fn(() => b), eq: vi.fn(() => b), in: vi.fn(() => b),
    update: h.update.mockImplementation(() => b),
    maybeSingle: async () => ({ data: { id: 'r', report_id: 'rep', updated_at: '2026-10-17T00:00:00Z', cells }, error: null }),
    then: (resolve: (v: unknown) => void) => resolve({ data: [{ id: 'r', area_id: 'a', report_id: 'rep' }], error: null }),
  }
  h.client.mockResolvedValue({ from: () => b })
  return b
}
beforeEach(() => {
  vi.clearAllMocks()
  h.member.mockResolvedValue({ ok: true, actor: makeMemberActor('p1', []) })
  h.config.mockResolvedValue(makeProjectConfig({ 'weekly.columns': [{ id: 'delivery', label: '산출물', carryOver: true }] }))
  client()
})
describe('configured weekly cell writes', () => {
  it('updates one dynamic cell while preserving other JSON cells', async () => {
    expect(await saveWeeklyCell('p1', 'r', 'this_delivery', '새 내용', '이전 내용')).toEqual({ ok: true })
    expect(h.update).toHaveBeenCalledWith({ cells: { this_delivery: '새 내용', next_delivery: '계획' } })
  })
  it('returns a conflict instead of overwriting a changed cell', async () => {
    expect(await saveWeeklyCell('p1', 'r', 'this_delivery', '새 내용', '오래된 내용')).toMatchObject({ ok: false, conflict: true, latest: '이전 내용' })
    expect(h.update).not.toHaveBeenCalled()
  })
  it('uses one row CAS for a dynamic batch even without expected values', async () => {
    expect(await saveWeeklyCells('p1', [{ rowId: 'r', cellKey: 'this_delivery', content: '실적' }, { rowId: 'r', cellKey: 'next_delivery', content: '새 계획' }])).toEqual({ ok: true })
    expect(h.update).toHaveBeenCalledTimes(1)
    expect(h.update).toHaveBeenCalledWith({ cells: { this_delivery: '실적', next_delivery: '새 계획' } })
  })
  it('rejects removed/default and unknown items before touching a row', async () => {
    expect(await saveWeeklyCell('p1', 'r', 'this_content', 'x')).toMatchObject({ ok: false })
    expect(await saveWeeklyCells('p1', [{ rowId: 'r', cellKey: 'next_ghost', content: 'x' }])).toMatchObject({ ok: false })
    expect(h.client).not.toHaveBeenCalled()
  })
  it('does not save when project settings cannot be read', async () => {
    h.config.mockRejectedValue(new Error('offline'))
    expect(await saveWeeklyCell('p1', 'r', 'this_delivery', 'x')).toMatchObject({ ok: false })
    expect(h.update).not.toHaveBeenCalled()
  })
})
