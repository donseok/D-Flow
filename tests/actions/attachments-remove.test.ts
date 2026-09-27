import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// 산출물 첨부 삭제 — Storage remove 는 RLS 가 막아도 오류 없이 빈 배열을 돌려준다. 0건을 성공으로 읽고 행을 지우면 고아 객체가
// 남는다. 객체 1건 삭제를 확인한 뒤에만 행을 지우고, 행 삭제도 .select('id') 로 확인한다(회의록 removeMinuteFile 과 같은 규칙,
// T18 리뷰 carry l).
const { requireProjectMember, resolveProjectId, createServerClient } = vi.hoisted(() => ({
  requireProjectMember: vi.fn(), resolveProjectId: vi.fn(), createServerClient: vi.fn(),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getSession: vi.fn(async () => ({ id: 'u1' })) }))
vi.mock('@/lib/authz', () => ({ requireProjectMember, resolveProjectId }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient }))

import { removeAttachment } from '@/app/actions/attachments'
import { makeAdminActor } from '../fixtures/actor'

const PID = 'p1'
const PATH = 'ws/w/p/p1/deliverables/i1/1-a.pdf'

function sb(opts: {
  removed?: { data: unknown[] | null; error: { message: string } | null }
  deleted?: { data: { id: string }[] | null; error: { message: string } | null }
}) {
  const calls: string[] = []
  const remove = vi.fn(async (paths: string[]) => {
    calls.push('storage.remove'); void paths
    return opts.removed ?? { data: [{ name: PATH }], error: null }
  })
  const deleteSelect = vi.fn(async (cols: string) => {
    calls.push(`meta.delete.select(${cols})`)
    return opts.deleted ?? { data: [{ id: 'att-1' }], error: null }
  })
  const table = {
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'att-1', file_path: PATH, wbs_item_id: 'i1' }, error: null }) }) }),
    delete: () => ({ eq: () => ({ select: deleteSelect }) }),
  }
  createServerClient.mockResolvedValue({
    from: () => table, storage: { from: () => ({ remove }) }, rpc: vi.fn(async () => ({ data: true, error: null })),
  } as never)
  return { calls, remove, deleteSelect }
}

let errSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.clearAllMocks()
  resolveProjectId.mockResolvedValue({ ok: true, projectId: PID })
  requireProjectMember.mockResolvedValue({ ok: true, actor: makeAdminActor(PID) })
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => errSpy.mockRestore())

describe('removeAttachment — Storage·행 삭제 결과 확인', () => {
  it('객체 1건을 지운 뒤 행을 지우고, 지워진 행을 select 로 확인한다', async () => {
    const f = sb({})
    expect(await removeAttachment('att-1')).toEqual({ ok: true })
    expect(f.calls).toEqual(['storage.remove', 'meta.delete.select(id)'])
  })

  it('Storage 가 0건을 지웠으면(RLS 거부) 행을 남기고 실패 — 로그를 남긴다', async () => {
    const f = sb({ removed: { data: [], error: null } })
    const res = await removeAttachment('att-1')
    expect(res.ok).toBe(false)
    expect(f.deleteSelect).not.toHaveBeenCalled()
    expect(errSpy).toHaveBeenCalled()
  })

  it('Storage 삭제 오류면 행을 남기고 실패', async () => {
    const f = sb({ removed: { data: null, error: { message: 'storage down' } } })
    expect((await removeAttachment('att-1')).ok).toBe(false)
    expect(f.deleteSelect).not.toHaveBeenCalled()
    expect(errSpy).toHaveBeenCalled()
  })

  it('행 삭제가 0건이면(RLS·경합) 성공으로 둔갑시키지 않는다', async () => {
    sb({ deleted: { data: [], error: null } })
    expect((await removeAttachment('att-1')).ok).toBe(false)
    expect(errSpy).toHaveBeenCalled()
  })
})
