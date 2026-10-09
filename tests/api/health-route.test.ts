// /api/health — 무인증 생존 신호. 깊은 점검(DB 한 줄)은 CRON_SECRET Bearer 가 맞을 때만, 실패는 503, 응답에 내부 정보 없음.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))

import { GET } from '@/app/api/health/route'

const req = (query = '', auth?: string) => new Request(`http://localhost/api/health${query}`, { headers: auth ? { authorization: auth } : {} })
const db = (result: { data: unknown; error: { message: string } | null }) => {
  const limit = vi.fn(async () => result)
  const select = vi.fn(() => ({ limit }))
  const from = vi.fn(() => ({ select }))
  mocks.createAdminClient.mockReturnValue({ from })
  return { from, select, limit }
}
const saved = process.env.CRON_SECRET
beforeEach(() => { vi.clearAllMocks(); process.env.CRON_SECRET = 'test-secret' })
afterEach(() => { if (saved === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = saved })

describe('GET /api/health', () => {
  it('얕은 점검 — 인증 없이 200 { ok: true }, DB 를 건드리지 않는다', async () => {
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })
  it('캐시 금지 헤더 — 얕은·깊은·실패 응답 모두', async () => {
    expect((await GET(req())).headers.get('cache-control')).toBe('no-store, max-age=0')
    db({ data: [], error: null })
    expect((await GET(req('?deep=1', 'Bearer test-secret'))).headers.get('cache-control')).toBe('no-store, max-age=0')
    db({ data: null, error: { message: 'x' } })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await GET(req('?deep=1', 'Bearer test-secret'))).headers.get('cache-control')).toBe('no-store, max-age=0')
    spy.mockRestore()
  })
  it.each([
    ['시크릿 헤더 없음', undefined], ['시크릿 불일치', 'Bearer wrong'], ['Bearer 형식 아님', 'test-secret'],
  ])('deep=1 이어도 %s 이면 얕은 응답 — 익명 요청이 DB 조회를 만들지 못한다', async (_name, auth) => {
    const res = await GET(req('?deep=1', auth))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })
  it('CRON_SECRET 미설정이면 어떤 헤더로도 깊은 점검을 하지 않는다', async () => {
    delete process.env.CRON_SECRET
    for (const auth of ['Bearer test-secret', 'Bearer ', 'Bearer undefined']) {
      expect(await (await GET(req('?deep=1', auth))).json()).toEqual({ ok: true })
    }
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })
  it('deep 값이 1 이 아니면 시크릿이 맞아도 얕은 응답', async () => {
    for (const q of ['?deep=0', '?deep=true', '?deep=']) expect(await (await GET(req(q, 'Bearer test-secret'))).json()).toEqual({ ok: true })
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })
  it('깊은 점검 통과 — DB 한 줄을 읽고 200 { ok: true, db: "ok" }', async () => {
    const q = db({ data: [{ id: 'w' }], error: null })
    const res = await GET(req('?deep=1', 'Bearer test-secret'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, db: 'ok' })
    expect(q.from).toHaveBeenCalledTimes(1)
    expect(q.limit).toHaveBeenCalledWith(1)
  })
  it('DB 조회 실패는 503 — 오류 문구·행 내용을 응답에 싣지 않고 로그로만 남긴다', async () => {
    db({ data: null, error: { message: 'connection refused to db.internal:5432 (password authentication failed)' } })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await GET(req('?deep=1', 'Bearer test-secret'))
    expect(res.status).toBe(503)
    const text = await res.text()
    expect(JSON.parse(text)).toEqual({ ok: false, db: 'unavailable' })
    expect(text).not.toMatch(/connection|internal|password|5432/)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
  it('클라이언트 생성 예외(환경 변수 누락)도 503 — 예외 문구가 새지 않는다', async () => {
    mocks.createAdminClient.mockImplementation(() => { throw new Error('Supabase service_role 환경변수가 설정되지 않았습니다.') })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await GET(req('?deep=1', 'Bearer test-secret'))
    expect(res.status).toBe(503)
    expect(await res.text()).toBe(JSON.stringify({ ok: false, db: 'unavailable' }))
    spy.mockRestore()
  })
  it('응답에 버전·환경 값이 없다 — 키는 ok·db 뿐', async () => {
    process.env.APP_ENV = 'production'
    db({ data: [], error: null })
    const shallow = await (await GET(req())).json()
    const deep = await (await GET(req('?deep=1', 'Bearer test-secret'))).json()
    expect(Object.keys(shallow)).toEqual(['ok'])
    expect(Object.keys(deep).sort()).toEqual(['db', 'ok'])
    delete process.env.APP_ENV
  })
})
