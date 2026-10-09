import { describe, expect, it } from 'vitest'
import { GRACE_MS } from '../../src/lib/minutes/attachmentSweep.mjs'
import { runSweep } from '../../src/lib/minutes/attachmentSweepRun.mjs'

// SP5 B3 과제10 — 청소 잡 실행부를 가짜 클라이언트(메모리 버킷·표)로 돈다. 실제 DB 리허설은 로컬 Supabase 에서 사람이 한다.
const W = 'aaaaaaaa-1111-4111-8111-111111111111'
const P = 'bbbbbbbb-2222-4222-8222-222222222222'
const M = 'cccccccc-3333-4333-8333-333333333333'
const NOW = Date.parse('2026-10-04T12:00:00Z')
const OLD = new Date(NOW - GRACE_MS - 1).toISOString()
const att = (n: string) => `ws/${W}/p/${P}/minute-files/${M}/${n}`
const body = (n: string) => `ws/${W}/p/${P}/minutes/${M}/${n}`

type Row = Record<string, unknown>
function fake(init: {
  objects: { name: string; createdAt: string }[]
  minute_files?: Row[]
  minute_versions?: Row[]
  failList?: string
  failRemove?: Set<string>
  /** 재검증 시점에 참조가 생긴 경로(판정 뒤 확정된 업로드) */
  lateRefs?: Set<string>
}) {
  const objects = new Map(init.objects.map(o => [o.name, o.createdAt]))
  const tables: Record<string, Row[]> = { minute_files: init.minute_files ?? [], minute_versions: init.minute_versions ?? [] }
  const listed: string[] = []
  const removed: string[] = []
  const updates: { id: unknown; patch: Row }[] = []
  const list = async (prefix: string, opts: { limit: number; offset: number }) => {
    listed.push(prefix)
    if (init.failList && prefix === init.failList) return { data: null, error: { message: 'list down' } }
    const kids = new Map<string, { id: string | null; name: string; created_at?: string }>()
    for (const [name, createdAt] of objects) {
      if (!name.startsWith(`${prefix}/`)) continue
      const rest = name.slice(prefix.length + 1).split('/')
      kids.set(rest[0], rest.length === 1 ? { id: `obj-${name}`, name: rest[0], created_at: createdAt } : { id: null, name: rest[0] })
    }
    const all = [...kids.values()].sort((a, b) => a.name.localeCompare(b.name))
    return { data: all.slice(opts.offset, opts.offset + opts.limit), error: null }
  }
  const remove = async (paths: string[]) => {
    const p = paths[0]
    if (init.failRemove?.has(p)) return { data: null, error: { message: 'remove down' } }
    removed.push(p)
    const had = objects.delete(p)
    return { data: had ? [{ name: p }] : [], error: null }
  }
  const from = (table: string) => {
    const filters: ((r: Row) => boolean)[] = []
    let patch: Row | null = null
    let headCount = false
    const q: Record<string, unknown> = {
      select: (_c: string, o?: { head?: boolean }) => { headCount = !!o?.head; return q },
      update: (p: Row) => { patch = p; return q },
      eq: (k: string, v: unknown) => { filters.push(r => r[k] === v); return q },
      is: (k: string, v: unknown) => { filters.push(r => (r[k] ?? null) === v); return q },
      not: (k: string) => { filters.push(r => r[k] !== null && r[k] !== undefined); return q },
      order: () => q,
      range: async (a: number, b: number) => ({ data: tables[table].filter(r => filters.every(f => f(r))).slice(a, b + 1), error: null }),
      then: (res: (v: unknown) => unknown) => {
        const rows = tables[table].filter(r => filters.every(f => f(r)))
        if (patch) { for (const r of rows) { Object.assign(r, patch); updates.push({ id: r.id, patch: patch! }) } return Promise.resolve({ error: null }).then(res) }
        if (headCount) {
          const late = init.lateRefs && table === 'minute_files' && rows.length === 0 ? [...init.lateRefs].some(p => filters.some(f => f({ file_path: p }))) : false
          return Promise.resolve({ count: rows.length + (late ? 1 : 0), error: null }).then(res)
        }
        return Promise.resolve({ data: rows, error: null }).then(res)
      },
    }
    return q
  }
  return { client: { from, storage: { from: () => ({ list, remove }) } }, listed, removed, updates, objects }
}
const quiet = { log: () => {}, warn: () => {} }

describe('runSweep', () => {
  const scenario = () => fake({
    objects: [
      { name: att('orphan.pdf'), createdAt: OLD },
      { name: att('live.pdf'), createdAt: OLD },
      { name: att('tomb.pdf'), createdAt: OLD },
      { name: body('body.md'), createdAt: OLD },
    ],
    minute_files: [
      { id: 'live', file_path: att('live.pdf'), role: 'attachment', deleted_at: null, purged_at: null },
      { id: 'tomb', file_path: att('tomb.pdf'), role: 'attachment', deleted_at: OLD, purged_at: null },
      { id: 'gone', file_path: att('gone.pdf'), role: 'attachment', deleted_at: OLD, purged_at: null },
    ],
  })

  it('dry-run 은 아무것도 지우거나 고치지 않는다 — 본문 세그먼트는 목록조차 읽지 않는다', async () => {
    const f = scenario()
    const res = await runSweep(f.client, { apply: false, now: NOW, ...quiet })
    expect(res).toMatchObject({ ok: true, failures: 0, summary: { orphans: 1, tombstoneObjects: 1, tombstoneMarkOnly: 1, scannedObjects: 3 } })
    expect(f.removed).toEqual([])
    expect(f.updates).toEqual([])
    expect(f.listed.some(p => p.endsWith('/minutes') || p.includes('/minutes/'))).toBe(false)
  })

  it('apply: 고아 삭제, 톰스톤 객체 삭제 후 purged_at, 객체 없는 톰스톤은 purged_at 만 — 활성·본문 객체는 남는다', async () => {
    const f = scenario()
    const res = await runSweep(f.client, { apply: true, now: NOW, ...quiet })
    expect(res).toMatchObject({ ok: true, failures: 0 })
    expect(f.removed.sort()).toEqual([att('orphan.pdf'), att('tomb.pdf')].sort())
    expect(f.updates.map(u => u.id).sort()).toEqual(['gone', 'tomb'])
    expect([...f.objects.keys()].sort()).toEqual([att('live.pdf'), body('body.md')].sort())
  })

  it('목록 읽기가 하나라도 실패하면 아무것도 지우지 않는다', async () => {
    const f = fake({ objects: [{ name: att('orphan.pdf'), createdAt: OLD }], failList: `ws/${W}/p/${P}/minute-files` })
    expect(await runSweep(f.client, { apply: true, now: NOW, ...quiet })).toMatchObject({ ok: false, stage: 'read' })
    expect(f.removed).toEqual([])
  })

  it('판정 뒤 참조가 생긴 후보는 재검증에서 건너뛴다', async () => {
    const f = fake({ objects: [{ name: att('late.pdf'), createdAt: OLD }], lateRefs: new Set([att('late.pdf')]) })
    expect(await runSweep(f.client, { apply: true, now: NOW, ...quiet })).toMatchObject({ ok: true, failures: 0 })
    expect(f.removed).toEqual([])
  })

  it('삭제 실패는 건수로 돌려준다(스크립트가 nonzero 로 끝난다) — 톰스톤은 객체를 못 지우면 purged_at 을 남기지 않는다', async () => {
    const f = fake({
      objects: [{ name: att('tomb.pdf'), createdAt: OLD }],
      minute_files: [{ id: 'tomb', file_path: att('tomb.pdf'), role: 'attachment', deleted_at: OLD, purged_at: null }],
      failRemove: new Set([att('tomb.pdf')]),
    })
    expect(await runSweep(f.client, { apply: true, now: NOW, ...quiet })).toMatchObject({ ok: true, failures: 1 })
    expect(f.updates).toEqual([])
  })

  it('페이지 끝까지 읽는다 — 1000건을 넘는 회의록 폴더', async () => {
    const many = Array.from({ length: 1001 }, (_, i) => ({ name: att(`${String(i).padStart(4, '0')}.pdf`), createdAt: OLD }))
    const f = fake({ objects: many })
    const res = await runSweep(f.client, { apply: false, now: NOW, ...quiet })
    expect(res).toMatchObject({ ok: true, summary: { scannedObjects: 1001, orphans: 1001 } })
  })
})
