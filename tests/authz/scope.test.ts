import { describe, it, expect, vi, afterEach } from 'vitest'
import { readScope } from '@/lib/authz/scope'
import { resolveScopeAdmin } from '@/lib/authz/scopeAdmin'
import { ERR_LOOKUP, ERR_MISSING } from '@/lib/authz/errors'

/** from(table).select(cols).eq('id', id).maybeSingle() 만 흉내낸다 — 요청한 표·컬럼·id 를 기록한다. */
function fakeDb(res: { data: unknown; error: { message: string } | null }) {
  const seen: { table?: string; cols?: string; eq?: unknown[] } = {}
  const db = {
    from: (table: string) => {
      seen.table = table
      return {
        select: (cols: string) => {
          seen.cols = cols
          return { eq: (...args: unknown[]) => { seen.eq = args; return { maybeSingle: async () => res } } }
        },
      }
    },
  }
  return { db: db as never, seen }
}

afterEach(() => { vi.restoreAllMocks() })

describe('readScope', () => {
  it('(a) minutes 는 자기 workspace_id 를 읽고 무프로젝트 행에 projectId null', async () => {
    const { db, seen } = fakeDb({ data: { project_id: null, workspace_id: 'w1' }, error: null })
    expect(await readScope(db, 'minutes', 'mn1', 't')).toEqual({ ok: true, projectId: null, workspaceId: 'w1' })
    expect(seen).toEqual({ table: 'minutes', cols: 'project_id, workspace_id', eq: ['id', 'mn1'] })
  })

  it('(b) 다른 표는 projects!inner 임베드로 워크스페이스를 읽는다 — 객체·배열 모양 둘 다', async () => {
    const obj = fakeDb({ data: { project_id: 'p1', projects: { workspace_id: 'w1' } }, error: null })
    expect(await readScope(obj.db, 'wbs_items', 'i1', 't')).toEqual({ ok: true, projectId: 'p1', workspaceId: 'w1' })
    expect(obj.seen).toEqual({ table: 'wbs_items', cols: 'project_id, projects!inner(workspace_id)', eq: ['id', 'i1'] })
    const arr = fakeDb({ data: { project_id: 'p2', projects: [{ workspace_id: 'w2' }] }, error: null })
    expect(await readScope(arr.db, 'issues', 'x1', 't')).toEqual({ ok: true, projectId: 'p2', workspaceId: 'w2' })
  })

  // 3원칙 ①: 조회 실패를 '대상 없음'으로 위장하지 않는다 — 404 가 아니라 판정 불가.
  it('(c) 조회 실패는 ERR_LOOKUP', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { db } = fakeDb({ data: null, error: { message: 'boom' } })
    expect(await readScope(db, 'meetings', 'm1', 't')).toEqual({ ok: false, error: ERR_LOOKUP, code: 'lookup' })
  })

  it('(d) 행이 없으면 ERR_MISSING', async () => {
    const { db } = fakeDb({ data: null, error: null })
    expect(await readScope(db, 'meetings', 'm1', 't')).toEqual({ ok: false, error: ERR_MISSING, code: 'missing' })
  })

  it.each([
    ['minutes 의 workspace_id 가 null', 'minutes', { project_id: null, workspace_id: null }],
    ['임베드가 없음', 'wbs_items', { project_id: 'p1' }],
    ['임베드 배열이 빔', 'wbs_items', { project_id: 'p1', projects: [] }],
    ['workspace_id 가 빈 문자열', 'issues', { project_id: 'p1', projects: { workspace_id: '' } }],
  ] as const)('(e) 워크스페이스를 확정하지 못하면 ERR_LOOKUP(fail-closed) — %s', async (_n, table, data) => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { db } = fakeDb({ data, error: null })
    expect(await readScope(db, table, 'r1', 't')).toEqual({ ok: false, error: ERR_LOOKUP, code: 'lookup' })
  })
})

describe('resolveScopeAdmin', () => {
  it('주어진 admin 클라이언트로 같은 해석을 한다', async () => {
    const { db, seen } = fakeDb({ data: { project_id: 'p1', projects: { workspace_id: 'w1' } }, error: null })
    expect(await resolveScopeAdmin(db, 'wbs_items', 'i1')).toEqual({ ok: true, projectId: 'p1', workspaceId: 'w1' })
    expect(seen.table).toBe('wbs_items')
  })
})
