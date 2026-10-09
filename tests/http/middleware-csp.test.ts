// 미들웨어의 CSP nonce 배선 — 요청마다 새 nonce 를 만들어 ① 요청 헤더(x-nonce + 정책 — Next·루트 레이아웃이 읽는다)와 ② 응답의 정책 헤더에 싣는다.
// 세션 검증(리다이렉트·matcher)은 그대로다. 기본은 강제(enforce)이고 CSP_MODE=report 일 때만 보고 전용 — 모드는 헤더 이름만 바꾼다. report 모드에서는 강제 헤더를 응답에 싣지 않는다
// (실으면 Next 가 그 값을 요청 헤더로 옮겨 nonce 없는 강제 헤더가 먼저 읽힌다).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({ claims: null as null | { sub: string } }))
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ auth: { getClaims: async () => ({ data: h.claims ? { claims: h.claims } : null }) } }),
}))

import { config, middleware } from '@/middleware'

const RO = 'content-security-policy-report-only', CSP = 'content-security-policy'
const req = (path = '/p/1/wbs', headers: Record<string, string> = {}) => new NextRequest(`http://localhost${path}`, { headers })
/** NextResponse.next({ request }) 가 다음 단계로 넘기는 요청 헤더(x-middleware-request-*) */
const forwarded = (res: Response, name: string) => res.headers.get(`x-middleware-request-${name}`)
const nonceIn = (policy: string | null) => policy?.match(/script-src [^;]*'nonce-([A-Za-z0-9+/=_-]+)'/)?.[1]

const saved = process.env.CSP_MODE
beforeEach(() => { h.claims = { sub: 'u1' }; delete process.env.CSP_MODE })
afterEach(() => { if (saved === undefined) delete process.env.CSP_MODE; else process.env.CSP_MODE = saved })

describe('middleware — CSP nonce', () => {
  it('enforce(기본 — CSP_MODE 없음) — 응답은 강제 헤더에 nonce 정책, 보고 전용은 없다', async () => {
    const res = await middleware(req())
    const nonce = nonceIn(res.headers.get(CSP))
    expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/)
    expect(res.headers.get(CSP)).toContain("'strict-dynamic'")
    expect(res.headers.get(CSP)).toContain("frame-ancestors 'none'")
    expect(res.headers.get(CSP)).not.toMatch(/script-src [^;]*'unsafe-inline'/)
    expect(res.headers.has(RO)).toBe(false)
  })
  it('요청 헤더로 같은 nonce 가 넘어간다 — x-nonce 와 정책(Next 가 여기서 읽는다)', async () => {
    const res = await middleware(req())
    const nonce = nonceIn(res.headers.get(CSP))
    expect(forwarded(res, 'x-nonce')).toBe(nonce)
    expect(nonceIn(forwarded(res, CSP))).toBe(nonce)
    expect(forwarded(res, RO)).toBeNull()
  })
  it('오타·모르는 값도 강제다(fail-closed)', async () => {
    for (const v of ['REPORT', 'reprot', 'off', '']) {
      process.env.CSP_MODE = v
      const res = await middleware(req())
      expect(nonceIn(res.headers.get(CSP)), v).toBeTruthy()
      expect(res.headers.has(RO), v).toBe(false)
    }
  })
  it('report(env 로 켠 경우만) — 같은 정책이 보고 전용 헤더로, 강제 헤더는 응답·요청 어디에도 싣지 않는다', async () => {
    process.env.CSP_MODE = 'report'
    const res = await middleware(req())
    const nonce = nonceIn(res.headers.get(RO))
    expect(nonce).toBeTruthy()
    expect(res.headers.has(CSP)).toBe(false)
    expect(forwarded(res, 'x-nonce')).toBe(nonce)
    expect(nonceIn(forwarded(res, RO))).toBe(nonce)
    expect(forwarded(res, CSP)).toBeNull()
  })
  it('요청마다 다른 nonce', async () => {
    const seen = new Set<string>()
    for (let i = 0; i < 20; i++) seen.add(nonceIn((await middleware(req())).headers.get(CSP))!)
    expect(seen.size).toBe(20)
  })
  it('클라이언트가 보낸 x-nonce·CSP 헤더는 쓰이지 않는다(우리 값으로 덮거나 지운다)', async () => {
    const res = await middleware(req('/p/1/wbs', { 'x-nonce': 'attacker', [CSP]: "script-src 'nonce-attackerattackerattacker'", [RO]: "script-src 'nonce-attackerattackerattacker'" }))
    const nonce = nonceIn(res.headers.get(CSP))
    expect(forwarded(res, 'x-nonce')).toBe(nonce)
    expect(forwarded(res, RO)).toBeNull()
    expect(nonceIn(forwarded(res, CSP))).toBe(nonce)
    expect(nonce).not.toContain('attacker')
  })
})

describe('middleware — 세션 검증은 그대로다', () => {
  it('세션이 없으면 /login 으로 보낸다', async () => {
    h.claims = null
    const res = await middleware(req('/p/1/wbs'))
    expect(res.status).toBe(307)
    expect(new URL(res.headers.get('location')!).pathname).toBe('/login')
  })
  it('세션이 있으면 통과한다(x-middleware-next)', async () => {
    const res = await middleware(req())
    expect(res.status).toBe(200)
    expect(res.headers.get('x-middleware-next')).toBe('1')
  })
  it('matcher 는 바뀌지 않았다 — 로그인·API·공유·초대·정적 자산을 제외한다', () => {
    expect(config.matcher).toEqual(['/((?!_next/static|_next/image|favicon.ico|login|api|share/|invite/|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico)).*)'])
  })
})
