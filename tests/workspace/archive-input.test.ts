// 워크스페이스 보관(0056)의 순수 판정 — 사유 입력 규칙(화면·액션·RPC 가 같은 규칙), 목록 정렬, service_role 순회가 쓰는 보관 집합.
import { describe, expect, it, vi } from 'vitest'
import { activeFirst, checkArchiveReason, WORKSPACE_ARCHIVE_REASON_MAX } from '@/lib/workspace/archiveInput'
import { archivedWorkspaceIds } from '@/lib/workspace/archived'

describe('checkArchiveReason — 사유는 선택이다', () => {
  it('비움·공백뿐·null·undefined 는 null', () => {
    for (const raw of ['', '   ', '\n\t', null, undefined]) expect(checkArchiveReason(raw), JSON.stringify(raw)).toEqual({ ok: true, reason: null })
  })
  it('앞뒤 공백을 다듬는다 — 안쪽 줄바꿈은 그대로 둔다', () => {
    expect(checkArchiveReason('  계약 종료\n후속 없음  ')).toEqual({ ok: true, reason: '계약 종료\n후속 없음' })
  })
  it('다듬은 길이가 상한(500)을 넘으면 거부한다 — 잘라 저장하지 않는다. 글자 수는 코드 포인트로 센다', () => {
    expect(WORKSPACE_ARCHIVE_REASON_MAX).toBe(500)
    expect(checkArchiveReason('가'.repeat(500))).toEqual({ ok: true, reason: '가'.repeat(500) })
    expect(checkArchiveReason('가'.repeat(501))).toEqual({ ok: false, code: 'reason_too_long' })
    expect(checkArchiveReason(` ${'가'.repeat(500)} `)).toMatchObject({ ok: true })   // 다듬은 뒤의 길이로 본다
    expect(checkArchiveReason('😀'.repeat(500))).toMatchObject({ ok: true })          // 이모지 한 글자를 둘로 세지 않는다(DB char_length 와 같다)
  })
  it('문자열이 아닌 입력은 거부한다', () => {
    for (const raw of [42, {}, [], true]) expect(checkArchiveReason(raw), JSON.stringify(raw)).toEqual({ ok: false, code: 'reason_too_long' })
  })
})

describe('activeFirst — 목록은 활성 먼저', () => {
  it('보관된 행을 뒤로 보내고 각 묶음 안의 순서는 그대로 둔다', () => {
    const rows = [{ id: 'a', archivedAt: '2026-10-01' }, { id: 'b', archivedAt: null }, { id: 'c', archivedAt: '2026-09-01' }, { id: 'd', archivedAt: null }]
    expect(activeFirst(rows).map((r) => r.id)).toEqual(['b', 'd', 'a', 'c'])
    expect(rows.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd'])   // 원본을 바꾸지 않는다
  })
})

describe('archivedWorkspaceIds — service_role 순회가 건너뛸 대상', () => {
  function db(pages: Array<{ data: Array<{ id: string }> | null; error?: { message: string } | null; count?: number | null }>) {
    const calls: Array<[string, unknown[]]> = []
    const b: Record<string, unknown> = {}
    for (const k of ['select', 'not', 'order']) b[k] = (...args: unknown[]) => { calls.push([k, args]); return b }
    b.range = async (...args: unknown[]) => { calls.push(['range', args]); const p = pages.shift()!; return { error: null, ...p } }
    const from = vi.fn(() => b)
    return { client: { from } as never, from, calls }
  }
  it('archived_at 이 찬 워크스페이스의 id 집합 — 끝까지 읽는다(count 대조)', async () => {
    const d = db([{ data: [{ id: 'w1' }, { id: 'w2' }], count: 3 }, { data: [{ id: 'w3' }], count: 3 }])
    expect([...await archivedWorkspaceIds(d.client)].sort()).toEqual(['w1', 'w2', 'w3'])
    expect(d.from).toHaveBeenCalledWith('workspaces')
    expect(d.calls).toContainEqual(['not', ['archived_at', 'is', null]])
  })
  it('없으면 빈 집합', async () => {
    expect((await archivedWorkspaceIds(db([{ data: [], count: 0 }]).client)).size).toBe(0)
  })
  it('조회 실패·잘림은 던진다 — "보관된 워크스페이스 없음"으로 읽지 않는다', async () => {
    await expect(archivedWorkspaceIds(db([{ data: null, error: { message: 'down' } }]).client)).rejects.toThrow('down')
    await expect(archivedWorkspaceIds(db([{ data: [{ id: 'w1' }], count: null }]).client)).rejects.toThrow()
  })
})
