// 응답 보안 헤더의 순수 구성 — 정적 경로(next.config.ts headers())와 미들웨어 경로(nonce)의 CSP, 모드(report 기본·enforce), 프레임 차단은 늘 강제.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  CSP_REPORT_PATH, HSTS_VALUE, PERMISSIONS_POLICY,
  buildCsp, buildSecurityHeaders, cspDirectives, cspModeOf, serializeCsp, supabaseOrigins,
} from '@/lib/http/securityHeaders'

const NONCE = 'q83vEjRWeJCrze8SNFZ4kA=='

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
  it('report 모드(명시했을 때만) — 강제 CSP 는 frame-ancestors 한 지시어뿐이고 정책 전체는 보고 전용으로 나간다', () => {
    for (const env of [{ cspMode: 'report' }, { cspMode: ' report ' }, { appEnv: 'production', supabaseUrl: SB, cspMode: 'report' }]) {
      expect(flat(env).get('Content-Security-Policy')).toBe("frame-ancestors 'none'")
      expect(flat(env).has('Content-Security-Policy-Report-Only')).toBe(true)
    }
  })
  it('enforce 모드(기본) — 값이 없거나 report 가 아니면 같은 정책이 강제 헤더 하나로 나가고(프레임 차단 포함) 보고 전용 헤더는 없다', () => {
    const report = flat({ supabaseUrl: SB, cspMode: 'report' })
    for (const cspMode of [undefined, '', 'enforce', 'REPORT', 'reprot', 'off', 'report-only']) {
      const enforce = flat({ supabaseUrl: SB, cspMode })
      expect(enforce.get('Content-Security-Policy'), String(cspMode)).toBe(report.get('Content-Security-Policy-Report-Only'))
      expect(enforce.get('Content-Security-Policy')).toContain("frame-ancestors 'none'")
      expect(enforce.get('Content-Security-Policy')).toContain("default-src 'self'")
      expect(enforce.has('Content-Security-Policy-Report-Only')).toBe(false)
      expect(enforce.get('X-Frame-Options')).toBe('DENY')
    }
  })
  it('위반 보고 주소 — 정책의 report-uri·report-to 와 Reporting-Endpoints 가 같은 수집 라우트를 가리킨다', () => {
    for (const cspMode of ['report', 'enforce']) {
      const h = flat({ cspMode })
      expect(h.get('Reporting-Endpoints')).toBe(`csp-endpoint="${CSP_REPORT_PATH}"`)
      const policy = h.get('Content-Security-Policy-Report-Only') ?? h.get('Content-Security-Policy')!
      expect(policy).toContain(`report-uri ${CSP_REPORT_PATH}`)
      expect(policy).toContain('report-to csp-endpoint')
    }
    expect(CSP_REPORT_PATH).toBe('/api/csp-report')
  })
  it('정책의 내용 — 기본(강제) 헤더에 실린다', () => {
    const h = flat({ appEnv: 'production', supabaseUrl: SB })
    const ro = h.get('Content-Security-Policy')!
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
    expect(d['img-src']).toEqual(["'self'", 'data:', 'blob:', 'https:'])
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
  it('와일드카드 출처(*)를 싣지 않고, 임의 https: 는 그림(img-src — 마크다운 본문의 외부 그림)에만 연다', () => {
    for (const nonce of [undefined, NONCE]) {
      const d = cspDirectives({ supabaseUrl: SB, dev: true, nonce })
      expect(serializeCsp(d)).not.toMatch(/(^|\s)\*(\s|;|$)/)
      expect(Object.entries(d).filter(([, v]) => v.includes('https:') || v.includes('http:')).map(([k]) => k)).toEqual(['img-src'])
      expect(d['img-src']).not.toContain('http:')
    }
  })
  it('직렬화 — "이름 값…" 을 "; " 로 잇는다', () => {
    expect(serializeCsp({ 'default-src': ["'self'"], 'img-src': ["'self'", 'data:'] })).toBe("default-src 'self'; img-src 'self' data:")
  })
})

describe('nonce 정책(미들웨어 경로)과 정적 경로의 정책', () => {
  it("nonce 가 있으면 script-src 는 'self' 'nonce-…' 'strict-dynamic' 뿐 — 'unsafe-inline' 도 해시 허용도 없다", () => {
    expect(cspDirectives({ nonce: NONCE })['script-src']).toEqual(["'self'", `'nonce-${NONCE}'`, "'strict-dynamic'"])
    expect(cspDirectives({ nonce: NONCE, dev: true })['script-src']).toEqual(["'self'", `'nonce-${NONCE}'`, "'strict-dynamic'", "'unsafe-eval'"])
    expect(serializeCsp(cspDirectives({ nonce: NONCE }))).not.toMatch(/sha256-/)
  })
  it("nonce 가 없으면(정적 경로) 'self' 'unsafe-inline' — 해시를 섞지 않는다(섞으면 'unsafe-inline' 이 무시된다)", () => {
    expect(cspDirectives({})['script-src']).toEqual(["'self'", "'unsafe-inline'"])
    expect(serializeCsp(cspDirectives({}))).not.toMatch(/sha256-|nonce-|strict-dynamic/)
  })
  it('script-src 밖의 지시어는 두 갈래가 같다(스타일은 두 쪽 모두 unsafe-inline 유지)', () => {
    const a = cspDirectives({ supabaseUrl: SB }), b = cspDirectives({ supabaseUrl: SB, nonce: NONCE })
    expect({ ...a, 'script-src': [] }).toEqual({ ...b, 'script-src': [] })
    expect(b['style-src']).toContain("'unsafe-inline'")
  })
  it('형식 밖 nonce(공백·따옴표·세미콜론 — 지시어 끼워 넣기)는 싣지 않고 정적 정책으로 내려간다', () => {
    for (const bad of ['', 'short', "abc' 'unsafe-inline", 'aaaaaaaaaaaaaaaaaaaa; script-src *', 'aaaaaaaa aaaaaaaaaaaa']) {
      expect(cspDirectives({ nonce: bad })['script-src'], bad).toEqual(["'self'", "'unsafe-inline'"])
    }
  })
  it('Next 가 요청 헤더에서 nonce 를 읽는 식(get-script-nonce-from-header)이 이 정책에서 nonce 를 찾는다', () => {
    const value = buildCsp({ nonce: NONCE, mode: 'report' }).value
    const directive = value.split(';').map(d => d.trim()).find(d => d.startsWith('script-src'))!
    const found = directive.split(/\s+/).slice(1).map(src => src.match(/^'nonce-([A-Za-z0-9+/_-]+={0,2})'$/)?.[1]).find(Boolean)
    expect(found).toBe(NONCE)
  })
  // 깜박임 방지 스크립트는 라이트 전용 결정(2026-10-10)으로 지웠다 — 엄격한 정책은 해시 허용 없이 nonce 만 믿는다.
  // 루트 틀에 인라인 스크립트를 다시 넣으면 nonce·해시가 없어 조용히 막힌다(빌드·단위 테스트로 안 잡힌다)
  it('루트 레이아웃·전역 오류 화면은 앱이 직접 넣는 인라인 스크립트가 없다', () => {
    for (const f of ['src/app/layout.tsx', 'src/app/global-error.tsx']) {
      const src = readFileSync(f, 'utf8')
      expect(src, f).not.toMatch(/<script\b|dangerouslySetInnerHTML/)
    }
  })
  it('루트 레이아웃은 모든 경로를 요청 때 그린다(connection) — 빌드 때 굳은 HTML 에는 Next 가 nonce 를 붙이지 못한다', () => {
    expect(readFileSync('src/app/layout.tsx', 'utf8')).toMatch(/await connection\(\)/)
  })
})

describe('buildCsp — 모드는 헤더 이름만 바꾼다', () => {
  it('report → Report-Only, enforce → 강제 헤더. 정책 문자열은 같다', () => {
    const r = buildCsp({ nonce: NONCE, mode: 'report', supabaseUrl: SB }), e = buildCsp({ nonce: NONCE, mode: 'enforce', supabaseUrl: SB })
    expect(r.key).toBe('Content-Security-Policy-Report-Only')
    expect(e.key).toBe('Content-Security-Policy')
    expect(r.value).toBe(e.value)
    expect(r.value).toContain(`script-src 'self' 'nonce-${NONCE}' 'strict-dynamic'`)
    expect(r.value).toContain("frame-ancestors 'none'")
  })
  it("cspModeOf — 정확히 'report'(앞뒤 공백 허용)만 보고 전용, 없음·오타·대문자는 enforce(fail-closed)", () => {
    expect(cspModeOf('report')).toBe('report')
    expect(cspModeOf(' report ')).toBe('report')
    for (const v of [undefined, '', '  ', 'enforce', 'REPORT', 'Report', 'reports', 'report-only', 'false', '0', 'off']) expect(cspModeOf(v), String(v)).toBe('enforce')
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
