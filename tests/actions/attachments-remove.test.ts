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
  /** 존재 확인 RPC(attachment_object_exists) 결과 — 기본은 객체가 남아 있음(true). */
  exists?: { data: unknown; error: { message: string } | null }
}) {
  const calls: string[] = []
  /** 도우미(removeStoredAttachment)에 닿은 값 — 어느 버킷의 어느 경로를 지우고, 어느 행을 묻고 지웠는지. */
  const seen = {
    removed: [] as Array<{ bucket: string; paths: string[] }>,
    rpc: [] as unknown[][],
    deleted: [] as Array<{ table: string; eq: unknown[] }>,
  }
  const remove = (bucket: string) => vi.fn(async (paths: string[]) => {
    calls.push('storage.remove'); seen.removed.push({ bucket, paths })
    return opts.removed ?? { data: [{ name: PATH }], error: null }
  })
  const deleteSelect = vi.fn(async (cols: string) => {
    calls.push(`meta.delete.select(${cols})`)
    return opts.deleted ?? { data: [{ id: 'att-1' }], error: null }
  })
  const table = (name: string) => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'att-1', file_path: PATH, wbs_item_id: 'i1' }, error: null }) }) }),
    delete: () => ({ eq: (...eq: unknown[]) => { seen.deleted.push({ table: name, eq }); return { select: deleteSelect } } }),
  })
  createServerClient.mockResolvedValue({
    from: table, storage: { from: (bucket: string) => ({ remove: remove(bucket) }) },
    rpc: vi.fn(async (...args: unknown[]) => { seen.rpc.push(args); return opts.exists ?? { data: true, error: null } }),
  } as never)
  return { calls, seen, deleteSelect }
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

  // 호출부가 종류·id·경로를 잘못 넘기면 다른 버킷에서 지우고 다른 행을 묻고 지운다 — 가짜가 아무 값이나 받으면 드러나지 않는다.
  it('도우미에 넘기는 값 — 산출물 버킷·표, 그 행의 file_path, 존재 확인과 행 삭제는 첨부 id(항목 id 가 아니다)로', async () => {
    const f = sb({ removed: { data: [], error: null }, exists: { data: false, error: null } })
    expect(await removeAttachment('att-1')).toEqual({ ok: true })
    expect(f.seen).toEqual({
      removed: [{ bucket: 'deliverables', paths: [PATH] }],
      rpc: [['attachment_object_exists', { p_kind: 'deliverable', p_id: 'att-1' }]],
      deleted: [{ table: 'deliverable_attachments', eq: ['id', 'att-1'] }],
    })
  })

  it('행 삭제가 0건이면(RLS·경합) 성공으로 둔갑시키지 않는다', async () => {
    sb({ deleted: { data: [], error: null } })
    expect((await removeAttachment('att-1')).ok).toBe(false)
    expect(errSpy).toHaveBeenCalled()
  })
})
