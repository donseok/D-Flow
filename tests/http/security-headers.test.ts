// 응답 보안 헤더(next.config.ts headers() 의 순수 구성) — CSP 는 보고 전용, 강제하는 것은 프레임 차단뿐이다.
import { describe, expect, it } from 'vitest'
import { HSTS_VALUE, PERMISSIONS_POLICY, buildSecurityHeaders, cspDirectives, serializeCsp, supabaseOrigins } from '@/lib/http/securityHeaders'

const SB = 'https://abcdefghijklmnopqrst.supabase.co'
const flat = (env: Parameters<typeof buildSecurityHeaders>[0]) => {
  const out = new Map<string, string>()
  for (const rule of buildSecurityHeaders(env)) for (const h of rule.headers) {
    expect(out.has(h.key), `${h.key} 가 두 규칙에 있다`).toBe(false)
    out.set(h.key, h.value)
  }
  return out
}

describe('buildSecurityHeaders', () => {
  it('모든 규칙은 전 경로에 건다', () => {
    for (const rule of buildSecurityHeaders({ appEnv: 'production', staging: '1', supabaseUrl: SB })) expect(rule.source).toBe('/:path*')
  })
  it('어느 환경이든 기본 보안 헤더 넷과 프레임 차단이 있다', () => {
    const h = flat({})
    expect(h.get('X-Content-Type-Options')).toBe('nosniff')
    expect(h.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin')
    expect(h.get('X-Frame-Options')).toBe('DENY')
    expect(h.get('Permissions-Policy')).toBe(PERMISSIONS_POLICY)
  })
  it('강제 CSP 는 frame-ancestors 한 지시어뿐이다 — 자원 로딩을 막는 지시어를 강제하지 않는다', () => {
    for (const env of [{}, { appEnv: 'production', supabaseUrl: SB }]) {
      expect(flat(env).get('Content-Security-Policy')).toBe("frame-ancestors 'none'")
    }
  })
  it('나머지 정책은 보고 전용 헤더로 나간다', () => {
    const h = flat({ appEnv: 'production', supabaseUrl: SB })
    const ro = h.get('Content-Security-Policy-Report-Only')!
    expect(ro).toContain("default-src 'self'")
    expect(ro).toContain("frame-ancestors 'none'")
    expect(ro).toContain("object-src 'none'")
    expect(ro).toContain(`connect-src 'self' ${SB} wss://abcdefghijklmnopqrst.supabase.co`)
  })
  it('HSTS 는 프로덕션에서만 — preload 없이', () => {
    expect(flat({ appEnv: 'production' }).get('Strict-Transport-Security')).toBe(HSTS_VALUE)
    expect(HSTS_VALUE).toMatch(/^max-age=\d+; includeSubDomains$/)
    for (const appEnv of [undefined, 'staging', 'preview', 'development']) expect(flat({ appEnv }).has('Strict-Transport-Security')).toBe(false)
  })
  it('기존 두 규칙은 조건·값 그대로 — 스테이징 noindex, 프로덕션 툴바 숨김', () => {
    expect(flat({ staging: '1' }).get('X-Robots-Tag')).toBe('noindex, nofollow')
    expect(flat({ staging: '0' }).has('X-Robots-Tag')).toBe(false)
    expect(flat({}).has('X-Robots-Tag')).toBe(false)
    expect(flat({ appEnv: 'production' }).get('x-vercel-skip-toolbar')).toBe('1')
    expect(flat({ appEnv: 'preview' }).has('x-vercel-skip-toolbar')).toBe(false)
  })
  it('Permissions-Policy — 쓰지 않는 기능을 닫고, 쓰는 기능(클립보드)은 건드리지 않는다', () => {
    for (const f of ['camera=()', 'microphone=()', 'geolocation=()', 'payment=()']) expect(PERMISSIONS_POLICY).toContain(f)
    expect(PERMISSIONS_POLICY).not.toMatch(/clipboard/)
  })
})

describe('cspDirectives', () => {
  it('Supabase 출처는 URL 에서 파생한다 — https 는 wss, http(로컬)는 ws', () => {
    expect(supabaseOrigins(SB)).toEqual([SB, 'wss://abcdefghijklmnopqrst.supabase.co'])
    expect(supabaseOrigins(`${SB}/rest/v1/`)).toEqual([SB, 'wss://abcdefghijklmnopqrst.supabase.co'])
    expect(supabaseOrigins('http://127.0.0.1:54321')).toEqual(['http://127.0.0.1:54321', 'ws://127.0.0.1:54321'])
  })
  it('URL 이 없거나 형식 밖이면 정책에 싣지 않는다', () => {
    for (const bad of [undefined, '', 'not a url', 'ftp://x.example', 'javascript:alert(1)']) expect(supabaseOrigins(bad)).toEqual([])
    const d = cspDirectives({})
    expect(d['connect-src']).toEqual(["'self'"])
    expect(d['img-src']).toEqual(["'self'", 'data:', 'blob:'])
  })
  it('앱이 쓰는 출처 — 글꼴 CDN(스타일·글꼴), Storage(그림·미리보기 프레임), data:·blob:', () => {
    const d = cspDirectives({ supabaseUrl: SB })
    expect(d['style-src']).toContain('https://cdn.jsdelivr.net')
    expect(d['font-src']).toEqual(["'self'", 'data:', 'https://cdn.jsdelivr.net'])
    expect(d['img-src']).toContain(SB)
    expect(d['frame-src']).toEqual(["'self'", 'blob:', SB])
    expect(d['base-uri']).toEqual(["'self'"])
    expect(d['form-action']).toEqual(["'self'"])
  })
  it("eval 은 개발 서버에서만 — 프로덕션 정책에 'unsafe-eval' 이 없다", () => {
    expect(cspDirectives({ dev: true })['script-src']).toContain("'unsafe-eval'")
    expect(cspDirectives({})['script-src']).toEqual(["'self'", "'unsafe-inline'"])
  })
  it('와일드카드 출처(*)·임의 https: 를 싣지 않는다', () => {
    const text = serializeCsp(cspDirectives({ supabaseUrl: SB, dev: true }))
    expect(text).not.toMatch(/(^|\s)\*(\s|;|$)/)
    expect(text).not.toMatch(/\shttps:(\s|;|$)/)
  })
  it('직렬화 — "이름 값…" 을 "; " 로 잇는다', () => {
    expect(serializeCsp({ 'default-src': ["'self'"], 'img-src': ["'self'", 'data:'] })).toBe("default-src 'self'; img-src 'self' data:")
  })
})

describe('next.config.ts', () => {
  it('headers() 는 이 함수의 결과를 그대로 낸다(설정 파일에 헤더를 따로 적지 않는다)', async () => {
    const { readFileSync } = await import('node:fs')
    const text = readFileSync('next.config.ts', 'utf8')
    expect(text).toContain('return buildSecurityHeaders({')
    expect(text).not.toMatch(/key:\s*["']/)
  })
})
