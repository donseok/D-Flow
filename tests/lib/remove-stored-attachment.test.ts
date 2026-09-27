// 세 첨부 삭제 경로의 공용 도우미 — 객체 삭제 1건이면 행 삭제, 0건이면 RPC attachment_object_exists 로 '없음'과 '읽을 수 없음'을
// 가른다. 없음 → 행 삭제, 있음·확인 실패 → 행 유지(fail-closed). DB 오류 원문은 응답에 싣지 않는다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ERR_OBJECT_REMOVE, ERR_ROW_REMOVE, removeStoredAttachment } from '@/lib/attachments/removeStoredAttachment'

type R = { data: unknown; error: { message: string } | null }
function fakeDb(o: { removed?: R; exists?: R; deleted?: R } = {}) {
  const calls: string[] = []
  const remove = vi.fn(async (paths: string[]) => {
    calls.push(`remove:${paths.join(',')}`)
    return o.removed ?? { data: [{ name: paths[0] }], error: null }
  })
  const rpc = vi.fn(async (fn: string, args: unknown) => {
    calls.push(`rpc:${fn}:${JSON.stringify(args)}`)
    return o.exists ?? { data: false, error: null }
  })
  const del: Record<string, unknown> = {}
  del.eq = vi.fn(() => del)
  del.select = vi.fn(async () => { calls.push('row.delete'); return o.deleted ?? { data: [{ id: 'a1' }], error: null } })
  const from = vi.fn((table: string) => { calls.push(`table:${table}`); return { delete: vi.fn(() => del) } })
  const storageFrom = vi.fn((bucket: string) => { calls.push(`bucket:${bucket}`); return { remove } })
  return { db: { from, rpc, storage: { from: storageFrom } } as never, calls }
}
const IN = { kind: 'minute' as const, id: 'a1', filePath: 'ws/w/p/_/minute-files/m/a.pdf', tag: 'test' }

let spy: ReturnType<typeof vi.spyOn>
beforeEach(() => { spy = vi.spyOn(console, 'error').mockImplementation(() => {}) })
afterEach(() => { spy.mockRestore() })

describe('removeStoredAttachment', () => {
  it('객체 1건 삭제 → 행 삭제, RPC 는 부르지 않는다', async () => {
    const f = fakeDb()
    expect(await removeStoredAttachment(f.db, IN)).toEqual({ ok: true })
    expect(f.calls).toEqual(['bucket:minutes', `remove:${IN.filePath}`, 'table:minute_files', 'row.delete'])
  })
  it('0건 + 객체가 정말 없음(RPC false) → 행만 지운다', async () => {
    const f = fakeDb({ removed: { data: [], error: null }, exists: { data: false, error: null } })
    expect(await removeStoredAttachment(f.db, IN)).toEqual({ ok: true })
    expect(f.calls).toContain(`rpc:attachment_object_exists:${JSON.stringify({ p_kind: 'minute', p_id: 'a1' })}`)
    expect(f.calls.at(-1)).toBe('row.delete')
  })
  it('0건 + 객체가 남아 있음(RPC true, 삭제 권한 불일치) → 행을 남기고 실패', async () => {
    const f = fakeDb({ removed: { data: [], error: null }, exists: { data: true, error: null } })
    expect(await removeStoredAttachment(f.db, IN)).toEqual({ ok: false, error: ERR_OBJECT_REMOVE })
    expect(f.calls).not.toContain('row.delete')
    expect(spy).toHaveBeenCalled()
  })
  it.each([
    ['RPC 오류', { data: null, error: { message: 'ATTACHMENT_FORBIDDEN' } }],
    ['RPC 응답이 boolean 아님', { data: null, error: null }],
  ])('0건 + %s → 행을 남기고 실패(fail-closed)', async (_l, exists) => {
    const f = fakeDb({ removed: { data: [], error: null }, exists })
    expect(await removeStoredAttachment(f.db, IN)).toEqual({ ok: false, error: ERR_OBJECT_REMOVE })
    expect(f.calls).not.toContain('row.delete')
  })
  it('Storage 오류 → RPC·행 삭제 없이 실패', async () => {
    const f = fakeDb({ removed: { data: null, error: { message: 'storage down' } } })
    expect(await removeStoredAttachment(f.db, IN)).toEqual({ ok: false, error: ERR_OBJECT_REMOVE })
    expect(f.calls.some((c) => c.startsWith('rpc:'))).toBe(false)
    expect(f.calls).not.toContain('row.delete')
  })
  it.each([
    ['0행', { data: [], error: null }],
    ['오류(원문을 싣지 않는다)', { data: null, error: { message: 'db boom' } }],
  ])('행 삭제 %s → 기록 삭제 실패', async (_l, deleted) => {
    const f = fakeDb({ deleted })
    const res = await removeStoredAttachment(f.db, IN)
    expect(res).toEqual({ ok: false, error: ERR_ROW_REMOVE })
  })
  it.each([
    ['deliverable', 'deliverables', 'deliverable_attachments'],
    ['issue', 'issue-attachments', 'issue_attachments'],
    ['minute', 'minutes', 'minute_files'],
  ] as const)('kind %s → 버킷 %s·표 %s', async (kind, bucket, table) => {
    const f = fakeDb()
    await removeStoredAttachment(f.db, { ...IN, kind })
    expect(f.calls).toContain(`bucket:${bucket}`)
    expect(f.calls).toContain(`table:${table}`)
  })
})
