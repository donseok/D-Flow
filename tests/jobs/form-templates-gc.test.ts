// 잡 form-templates-gc(정본 §4.7.1) — incoming 고아 정리의 본체와 라우트 응답 코드.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { INCOMING_GRACE_MS, runFormTemplatesGc, type IncomingGcClient } from '@/lib/forms/incomingGc'

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn(), archivedWorkspaceIds: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
// 보관된 워크스페이스 목록(0056) — 라우트가 정리 전에 읽는다. 기본은 "보관된 워크스페이스 없음"
vi.mock('@/lib/workspace/archived', () => ({ archivedWorkspaceIds: mocks.archivedWorkspaceIds }))

import { GET } from '@/app/api/cron/form-templates-gc/route'

const NOW = Date.parse('2026-10-08T00:00:00Z')
const W = '11111111-1111-4111-8111-111111111111'
const P = '22222222-2222-4222-8222-222222222222'
const old = new Date(NOW - INCOMING_GRACE_MS - 1).toISOString()
const edge = new Date(NOW - INCOMING_GRACE_MS).toISOString()
const young = new Date(NOW - 60_000).toISOString()

type Obj = { path: string; createdAt: string | null }

/** 경로 목록으로 버킷을 흉내 낸다 — list 는 한 단계 아래의 폴더(id null)와 객체를 돌려준다 */
function bucket(objects: Obj[], opts: { failList?: string; failRemove?: boolean; removeNothing?: boolean } = {}) {
  const store = new Map(objects.map((o) => [o.path, o.createdAt]))
  const listed: string[] = []
  const removed: string[][] = []
  const api = {
    list: vi.fn(async (prefix: string, o: { limit: number; offset: number }) => {
      listed.push(prefix)
      if (opts.failList === prefix) return { data: null, error: { message: 'boom' } }
      const names = new Map<string, { name: string; id: string | null; created_at: string | null }>()
      for (const [path, createdAt] of store) {
        if (!path.startsWith(`${prefix}/`)) continue
        const [head, ...rest] = path.slice(prefix.length + 1).split('/')
        names.set(head, rest.length ? { name: head, id: null, created_at: null } : { name: head, id: `id-${head}`, created_at: createdAt })
      }
      return { data: [...names.values()].slice(o.offset, o.offset + o.limit), error: null }
    }),
    remove: vi.fn(async (paths: string[]) => {
      removed.push(paths)
      if (opts.failRemove) return { data: null, error: { message: 'remove boom' } }
      if (opts.removeNothing) return { data: [], error: null }
      for (const p of paths) store.delete(p)
      return { data: paths.map((name) => ({ name })), error: null }
    }),
  }
  const from = vi.fn(() => api)
  const client: IncomingGcClient = { storage: { from } }
  return { client, from, listed, removed, store }
}

const inc = (file: string, kind = 'weekly_report_pptx', w = W, p = P) => `ws/${w}/p/${p}/${kind}/incoming/${file}`

describe('runFormTemplatesGc', () => {
  it('24시간을 넘은 incoming 객체만 지우고 등록된 양식(v<n>)은 건드리지 않는다', async () => {
    const b = bucket([
      { path: inc('old.pptx'), createdAt: old },
      { path: inc('edge.pptx'), createdAt: edge },          // 정확히 24시간 — "초과"가 아니다
      { path: inc('young.pptx'), createdAt: young },
      { path: inc('notime.pptx'), createdAt: null },
      { path: inc('old.xlsx', 'wbs_export_xlsx'), createdAt: old },
      { path: `ws/${W}/p/${P}/weekly_report_pptx/v1/template.pptx`, createdAt: old },
      { path: `ws/${W}/p/${P}/issue_analysis_pptx/v3/template.pptx`, createdAt: old },
    ])
    const res = await runFormTemplatesGc(b.client, NOW)
    expect(res).toEqual({ ok: true, scanned: 5, deleted: 2, failed: 0, skippedYoung: 2, skippedNoTime: 1 })
    expect(b.from).toHaveBeenCalledWith('form-templates')
    expect(b.removed.flat().sort()).toEqual([inc('old.pptx'), inc('old.xlsx', 'wbs_export_xlsx')].sort())
    // v<n> 폴더 안은 나열조차 하지 않는다
    expect(b.listed.some((p) => /\/v\d+$/.test(p))).toBe(false)
    expect(b.store.has(`ws/${W}/p/${P}/weekly_report_pptx/v1/template.pptx`)).toBe(true)
  })

  it('버킷이 비었거나 지울 것이 없으면 remove 를 부르지 않는다', async () => {
    const empty = bucket([])
    expect(await runFormTemplatesGc(empty.client, NOW)).toEqual({ ok: true, scanned: 0, deleted: 0, failed: 0, skippedYoung: 0, skippedNoTime: 0 })
    const fresh = bucket([{ path: inc('young.pptx'), createdAt: young }])
    expect(await runFormTemplatesGc(fresh.client, NOW)).toMatchObject({ ok: true, scanned: 1, deleted: 0, skippedYoung: 1 })
    expect(empty.removed).toEqual([])
    expect(fresh.removed).toEqual([])
  })

  it.each([
    ['ws', 'ws'],
    ['프로젝트 폴더', `ws/${W}/p`],
    ['incoming 폴더', `ws/${W}/p/${P}/weekly_report_pptx/incoming`],
  ])('목록 조회(%s)가 실패하면 아무것도 지우지 않고 실패를 돌려준다', async (_n, failList) => {
    const b = bucket([{ path: inc('old.pptx'), createdAt: old }], { failList })
    expect(await runFormTemplatesGc(b.client, NOW)).toEqual({ ok: false, stage: 'list', error: 'boom' })
    expect(b.removed).toEqual([])
  })

  it('삭제 실패·지워지지 않은 객체는 failed 로 센다(성공으로 세지 않는다)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const err = bucket([{ path: inc('old.pptx'), createdAt: old }], { failRemove: true })
    expect(await runFormTemplatesGc(err.client, NOW)).toMatchObject({ ok: true, deleted: 0, failed: 1 })
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
    const none = bucket([{ path: inc('old.pptx'), createdAt: old }], { removeNothing: true })
    expect(await runFormTemplatesGc(none.client, NOW)).toMatchObject({ ok: true, deleted: 0, failed: 1 })
  })

  it('한 폴더가 1000건을 넘어도 전 페이지를 읽고 100건씩 지운다', async () => {
    const many = Array.from({ length: 1001 }, (_, i) => ({ path: inc(`f${String(i).padStart(4, '0')}.pptx`), createdAt: old }))
    const b = bucket(many)
    expect(await runFormTemplatesGc(b.client, NOW)).toMatchObject({ ok: true, scanned: 1001, deleted: 1001, failed: 0 })
    expect(b.removed.map((r) => r.length)).toEqual([...Array(10).fill(100), 1])
  })
})

describe('runFormTemplatesGc — 보관된 워크스페이스(0056)', () => {
  const W2 = 'dddddddd-4444-4444-8444-444444444444'
  it('건너뛸 워크스페이스의 파일은 목록도 읽지 않고 지우지도 않는다 — 다른 워크스페이스는 그대로 정리한다', async () => {
    const stale = new Date(Date.now() - INCOMING_GRACE_MS - 60_000).toISOString()
    const b = bucket([{ path: inc('a.pptx'), createdAt: stale }, { path: inc('b.pptx', 'weekly_report_pptx', W2), createdAt: stale }])
    const res = await runFormTemplatesGc(b.client, Date.now(), new Set([W2]))
    expect(res).toMatchObject({ ok: true, scanned: 1, deleted: 1, failed: 0 })
    expect(b.removed.flat()).toEqual([inc('a.pptx')])
    expect(b.store.has(inc('b.pptx', 'weekly_report_pptx', W2))).toBe(true)
    expect(b.listed.some((p) => p.startsWith(`ws/${W2}`))).toBe(false)
  })
})

describe('GET /api/cron/form-templates-gc', () => {
  const req = (headers: Record<string, string> = {}) => new Request('http://localhost/api/cron/form-templates-gc', { headers })
  const BEARER = { authorization: 'Bearer gc-secret' }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    vi.stubEnv('CRON_SECRET', 'gc-secret')
    mocks.archivedWorkspaceIds.mockResolvedValue(new Set())
  })

  it('보관된 워크스페이스(0056)는 건너뛴다 — 그 파일은 남고 수량에도 들지 않는다', async () => {
    const stale = new Date(Date.now() - INCOMING_GRACE_MS - 60_000).toISOString()
    const b = bucket([{ path: inc('old.pptx'), createdAt: stale }])
    mocks.createAdminClient.mockReturnValue(b.client)
    mocks.archivedWorkspaceIds.mockResolvedValue(new Set([W]))
    const res = await GET(req(BEARER))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, scanned: 0, deleted: 0, failed: 0, skippedYoung: 0, skippedNoTime: 0 })
    expect(b.removed).toEqual([])
    expect(mocks.archivedWorkspaceIds).toHaveBeenCalledWith(b.client)
  })

  it('보관된 워크스페이스 목록을 못 읽으면 아무것도 지우지 않고 500 — 보관 여부를 모르는 채 지우지 않는다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const b = bucket([{ path: inc('old.pptx'), createdAt: new Date(Date.now() - INCOMING_GRACE_MS - 60_000).toISOString() }])
    mocks.createAdminClient.mockReturnValue(b.client)
    mocks.archivedWorkspaceIds.mockRejectedValue(new Error('workspaces down'))
    const res = await GET(req(BEARER))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'LIST_FAILED' })
    expect(b.removed).toEqual([])
    spy.mockRestore()
  })

  it('CRON_SECRET 미설정이면 404 — 클라이언트를 만들지 않는다', async () => {
    vi.stubEnv('CRON_SECRET', '')
    expect((await GET(req(BEARER))).status).toBe(404)
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })

  it('헤더 없음·불일치·옛 헤더(x-cron-secret)는 401', async () => {
    const cases: Record<string, string>[] = [{}, { authorization: 'Bearer wrong' }, { authorization: 'gc-secret' }, { 'x-cron-secret': 'gc-secret' }]
    for (const headers of cases) {
      expect((await GET(req(headers))).status).toBe(401)
    }
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })

  it('정상 호출은 200 과 삭제 건수를 돌려준다(경로는 싣지 않는다)', async () => {
    const b = bucket([{ path: inc('old.pptx'), createdAt: new Date(Date.now() - INCOMING_GRACE_MS - 60_000).toISOString() }, { path: inc('young.pptx'), createdAt: new Date().toISOString() }])
    mocks.createAdminClient.mockReturnValue(b.client)
    const res = await GET(req(BEARER))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true, scanned: 2, deleted: 1, failed: 0, skippedYoung: 1, skippedNoTime: 0 })
    expect(JSON.stringify(body)).not.toContain('incoming')
  })

  it('목록 조회 실패는 500 — "지울 것 없음"으로 위장하지 않는다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const b = bucket([{ path: inc('old.pptx'), createdAt: old }], { failList: 'ws' })
    mocks.createAdminClient.mockReturnValue(b.client)
    const res = await GET(req(BEARER))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'LIST_FAILED' })
    expect(b.removed).toEqual([])
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('삭제가 일부라도 실패하면 500 과 수량', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const b = bucket([{ path: inc('old.pptx'), createdAt: old }], { failRemove: true })
    mocks.createAdminClient.mockReturnValue(b.client)
    const res = await GET(req(BEARER))
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ error: 'REMOVE_FAILED', deleted: 0, failed: 1 })
    spy.mockRestore()
  })
})
