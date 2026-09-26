import { describe, it, expect } from 'vitest'
import { prefsWorkspaceId } from '@/lib/prefs/prefsWorkspace'

// from('workspace_members').select().eq().order().order().limit().maybeSingle() 체인 — 호출 인자를 기록한다.
function fakeDb(result: { data: unknown; error: { message: string } | null }) {
  const calls: { method: string; args: unknown[] }[] = []
  const chain: Record<string, (...args: unknown[]) => unknown> = {}
  for (const m of ['select', 'eq', 'order', 'limit']) {
    chain[m] = (...args: unknown[]) => { calls.push({ method: m, args }); return chain }
  }
  chain.maybeSingle = async () => { calls.push({ method: 'maybeSingle', args: [] }); return result }
  const db = { from: (table: string) => { calls.push({ method: 'from', args: [table] }); return chain } }
  return { db: db as never, calls }
}

describe('prefsWorkspaceId', () => {
  it('행이 있으면 그 workspace_id', async () => {
    const { db } = fakeDb({ data: { workspace_id: 'ws-1' }, error: null })
    await expect(prefsWorkspaceId(db, 'u1')).resolves.toBe('ws-1')
  })
  it('소속이 없으면 null', async () => {
    const { db } = fakeDb({ data: null, error: null })
    await expect(prefsWorkspaceId(db, 'u1')).resolves.toBe(null)
  })
  it('조회 실패는 reject — 데이터 없음으로 위장하지 않는다', async () => {
    const { db } = fakeDb({ data: null, error: { message: 'boom' } })
    await expect(prefsWorkspaceId(db, 'u1')).rejects.toThrow('boom')
  })
  it('내 소속을 가장 먼저 가입한 순(created_at → workspace_id 오름차순)으로 1건 요청한다', async () => {
    const { db, calls } = fakeDb({ data: { workspace_id: 'ws-1' }, error: null })
    await prefsWorkspaceId(db, 'u1')
    expect(calls.map(c => [c.method, ...c.args])).toEqual([
      ['from', 'workspace_members'],
      ['select', 'workspace_id'],
      ['eq', 'user_id', 'u1'],
      ['order', 'created_at', { ascending: true }],
      ['order', 'workspace_id', { ascending: true }],
      ['limit', 1],
      ['maybeSingle'],
    ])
  })
})
