// 잡 minutes-attachments-gc(SP5 D26 의 스케줄 배선) — 라우트의 인증·응답 코드와, 잡이 수동 스크립트와 같은 본체(runSweep)를 apply 로 부르는지.
// 판정·실행부 자체는 tests/scripts/attachment-sweep{,-run}.test.ts 가 본다 — 여기서는 버킷·표를 흉내 낸 클라이언트로 라우트 끝까지 돈다.
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GRACE_MS } from '@/lib/minutes/attachmentSweep.mjs'

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))

import { GET } from '@/app/api/cron/minutes-attachments-gc/route'

const W = 'aaaaaaaa-1111-4111-8111-111111111111'
const P = 'bbbbbbbb-2222-4222-8222-222222222222'
const M = 'cccccccc-3333-4333-8333-333333333333'
const att = (n: string) => `ws/${W}/p/${P}/minute-files/${M}/${n}`
const body = (n: string) => `ws/${W}/p/${P}/minutes/${M}/${n}`
const old = () => new Date(Date.now() - GRACE_MS - 60_000).toISOString()
const young = () => new Date(Date.now() - 60_000).toISOString()

type Row = Record<string, unknown>
/** 메모리 버킷·표 — list 는 한 단계 아래의 폴더(id null)와 객체를, 표는 runSweep 이 쓰는 체인(select·eq·is·not·order·range·update)만 */
function fake(init: {
  objects: { name: string; createdAt: string }[]
  minute_files?: Row[]
  minute_versions?: Row[]
  /** workspaces 표 — 보관된 워크스페이스(0056)는 archived_at 이 찬다. 주지 않으면 보관된 워크스페이스 없음 */
  workspaces?: Row[]
  failList?: string
  failTable?: string
  failRemove?: Set<string>
}) {
  const objects = new Map(init.objects.map((o) => [o.name, o.createdAt]))
  const tables: Record<string, Row[]> = { minute_files: init.minute_files ?? [], minute_versions: init.minute_versions ?? [], workspaces: init.workspaces ?? [] }
  const removed: string[] = []
  const updates: unknown[] = []
  const list = async (prefix: string, opts: { limit: number; offset: number }) => {
    if (init.failList === prefix) return { data: null, error: { message: 'list down' } }
    const kids = new Map<string, { id: string | null; name: string; created_at?: string }>()
    for (const [name, createdAt] of objects) {
      if (!name.startsWith(`${prefix}/`)) continue
      const rest = name.slice(prefix.length + 1).split('/')
      kids.set(rest[0], rest.length === 1 ? { id: `obj-${name}`, name: rest[0], created_at: createdAt } : { id: null, name: rest[0] })
    }
    return { data: [...kids.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(opts.offset, opts.offset + opts.limit), error: null }
  }
  const remove = async (paths: string[]) => {
    if (init.failRemove?.has(paths[0])) return { data: null, error: { message: 'remove down' } }
    removed.push(...paths)
    return { data: paths.filter((p) => objects.delete(p)).map((name) => ({ name })), error: null }
  }
  const from = (table: string) => {
    const filters: ((r: Row) => boolean)[] = []
    let patch: Row | null = null
    let head = false
    const down = init.failTable === table ? { message: `${table} down` } : null
    const q: Record<string, unknown> = {
      select: (_c: string, o?: { head?: boolean }) => { head = !!o?.head; return q },
      update: (p: Row) => { patch = p; return q },
      eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return q },
      is: (k: string, v: unknown) => { filters.push((r) => (r[k] ?? null) === v); return q },
      not: (k: string) => { filters.push((r) => r[k] !== null && r[k] !== undefined); return q },
      order: () => q,
      range: async (a: number, b: number) => down ? { data: null, error: down } : { data: tables[table].filter((r) => filters.every((f) => f(r))).slice(a, b + 1), error: null },
      then: (res: (v: unknown) => unknown) => {
        const rows = tables[table].filter((r) => filters.every((f) => f(r)))
        if (patch) { for (const r of rows) { Object.assign(r, patch); updates.push(r.id) } return Promise.resolve({ error: null }).then(res) }
        if (head) return Promise.resolve({ count: rows.length, error: null }).then(res)
        return Promise.resolve({ data: rows, error: null }).then(res)
      },
    }
    return q
  }
  const buckets: string[] = []
  return { client: { from, storage: { from: (b: string) => { buckets.push(b); return { list, remove } } } }, removed, updates, objects, buckets }
}

const scenario = () => fake({
  objects: [
    { name: att('orphan.pdf'), createdAt: old() },
    { name: att('young.pdf'), createdAt: young() },   // 유예 안 — 업로드 직후 확정 전일 수 있다
    { name: att('live.pdf'), createdAt: old() },
    { name: att('tomb.pdf'), createdAt: old() },
    { name: body('body.md'), createdAt: old() },      // 본문 세그먼트 — 어떤 경우에도 후보가 아니다
  ],
  minute_files: [
    { id: 'live', file_path: att('live.pdf'), role: 'attachment', deleted_at: null, purged_at: null },
    { id: 'tomb', file_path: att('tomb.pdf'), role: 'attachment', deleted_at: old(), purged_at: null },
    { id: 'gone', file_path: att('gone.pdf'), role: 'attachment', deleted_at: old(), purged_at: null },
  ],
})

const req = (auth?: string) => new Request('http://localhost/api/cron/minutes-attachments-gc', { headers: auth ? { authorization: auth } : {} })

describe('GET /api/cron/minutes-attachments-gc', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('CRON_SECRET', 's3cret')
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

  it('CRON_SECRET 이 없으면 404 — service_role 클라이언트를 만들지 않는다', async () => {
    vi.stubEnv('CRON_SECRET', '')
    expect((await GET(req('Bearer s3cret'))).status).toBe(404)
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })

  it.each([undefined, 'Bearer wrong', 's3cret', 'Basic s3cret'])('인증 헤더 %s 는 401 — 아무것도 읽거나 지우지 않는다', async (auth) => {
    const res = await GET(req(auth))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'UNAUTHORIZED' })
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })

  it('정상 — 고아와 톰스톤 객체만 지우고 purged_at 을 적는다. 유예 안·활성·본문 객체는 남고 응답은 수량뿐이다', async () => {
    const f = scenario()
    mocks.createAdminClient.mockReturnValue(f.client)
    const res = await GET(req('Bearer s3cret'))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({
      ok: true, scannedObjects: 4, minuteFiles: 3, versions: 0,
      orphans: 1, tombstoneObjects: 1, tombstoneMarkOnly: 1, skippedYoung: 1, skippedNoTime: 0, failed: 0,
    })
    expect(f.buckets.every((b) => b === 'minutes')).toBe(true)
    expect(f.removed.sort()).toEqual([att('orphan.pdf'), att('tomb.pdf')].sort())
    expect(f.updates.sort()).toEqual(['gone', 'tomb'])
    expect([...f.objects.keys()].sort()).toEqual([att('live.pdf'), att('young.pdf'), body('body.md')].sort())
    // 경로·파일 이름이 응답에 없다
    expect(JSON.stringify(json)).not.toMatch(/\.pdf|ws\//)
  })

  it.each([
    ['버킷 목록', { failList: `ws/${W}/p/${P}/minute-files` }],
    ['minute_files 조회', { failTable: 'minute_files' }],
    ['minute_versions 조회', { failTable: 'minute_versions' }],
    ['보관된 워크스페이스 조회(0056)', { failTable: 'workspaces' }],
  ])('%s 가 실패하면 500 READ_FAILED — 아무것도 지우거나 고치지 않는다', async (_name, fail) => {
    const base = scenario()
    const f = fake({ objects: [...base.objects].map(([name, createdAt]) => ({ name, createdAt })), minute_files: [
      { id: 'tomb', file_path: att('tomb.pdf'), role: 'attachment', deleted_at: old(), purged_at: null },
    ], ...fail })
    mocks.createAdminClient.mockReturnValue(f.client)
    const res = await GET(req('Bearer s3cret'))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'READ_FAILED' })
    expect(f.removed).toEqual([])
    expect(f.updates).toEqual([])
  })

  it('삭제가 일부 실패하면 수량을 실은 500 — 톰스톤은 객체를 못 지우면 purged_at 을 남기지 않는다(다음 실행이 다시 시도)', async () => {
    const f = fake({
      objects: [{ name: att('orphan.pdf'), createdAt: old() }, { name: att('tomb.pdf'), createdAt: old() }],
      minute_files: [{ id: 'tomb', file_path: att('tomb.pdf'), role: 'attachment', deleted_at: old(), purged_at: null }],
      failRemove: new Set([att('tomb.pdf')]),
    })
    mocks.createAdminClient.mockReturnValue(f.client)
    const res = await GET(req('Bearer s3cret'))
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ error: 'REMOVE_FAILED', orphans: 1, tombstoneObjects: 1, failed: 1 })
    expect(f.removed).toEqual([att('orphan.pdf')])
    expect(f.updates).toEqual([])
  })

  it('지울 것이 없으면 remove·update 없이 200', async () => {
    const f = fake({ objects: [{ name: att('live.pdf'), createdAt: old() }], minute_files: [
      { id: 'live', file_path: att('live.pdf'), role: 'attachment', deleted_at: null, purged_at: null },
    ] })
    mocks.createAdminClient.mockReturnValue(f.client)
    const res = await GET(req('Bearer s3cret'))
    expect(await res.json()).toMatchObject({ ok: true, orphans: 0, tombstoneObjects: 0, tombstoneMarkOnly: 0, failed: 0 })
    expect(f.removed).toEqual([])
    expect(f.updates).toEqual([])
  })
})

describe('수동 스크립트와 잡은 같은 본체를 쓴다', () => {
  it('스크립트·라우트가 src/lib/minutes/attachmentSweepRun.mjs 의 runSweep 을 import 하고, 유예 시간은 한 곳(GRACE_MS)이다', () => {
    const script = readFileSync('scripts/minutes/sweep-attachments.mjs', 'utf8')
    const route = readFileSync('src/app/api/cron/minutes-attachments-gc/route.ts', 'utf8')
    expect(script).toContain("import { runSweep } from '../../src/lib/minutes/attachmentSweepRun.mjs'")
    expect(route).toContain("import { runSweep } from '@/lib/minutes/attachmentSweepRun.mjs'")
    expect(route).toMatch(/runSweep\(createAdminClient\(\), \{ apply: true \}\)/)
    expect(GRACE_MS).toBe(24 * 60 * 60 * 1000)
    // 잡 쪽에 판정·유예를 다시 적지 않는다
    expect(route).not.toMatch(/GRACE|planSweep|60 \* 60/)
  })
})
