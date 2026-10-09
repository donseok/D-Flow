// CSP 위반 보고 수집(/api/csp-report) — 무인증이라 좁게 받는다: 보고 콘텐츠 타입만, 본문 상한, IP 별 요청 제한, 로그에는 지시어와
// 차단된 주소(쿼리 제거)만. 본문 전체·문서 주소·쿠키·쿼리스트링이 로그에 남지 않는다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanBlocked, cleanDirective, extractCspViolations, CSP_REPORT_MAX_ENTRIES } from '@/lib/http/cspReport'
import { RATE_RULES } from '@/lib/http/rateLimit'
import { POST } from '@/app/api/csp-report/route'

const legacy = (over: Record<string, unknown> = {}) => ({
  'csp-report': {
    'document-uri': 'https://app.example/share/minutes/SECRET-TOKEN?x=1', referrer: 'https://app.example/p/1?ref=SECRET',
    'violated-directive': "script-src 'self' 'nonce-abc'", 'effective-directive': 'script-src-elem',
    'original-policy': "default-src 'self'", 'blocked-uri': 'https://evil.example/a/b.js?token=SECRET#frag', 'script-sample': 'alert(SECRET)',
    ...over,
  },
})

describe('extractCspViolations — 두 값만 뽑는다', () => {
  it('report-uri 형식 — 지시어 이름과 출처+경로(쿼리·조각 제거)', () => {
    expect(extractCspViolations(legacy())).toEqual([{ directive: 'script-src-elem', blocked: 'https://evil.example/a/b.js' }])
  })
  it('effective-directive 가 없으면 violated-directive 의 첫 낱말', () => {
    expect(extractCspViolations(legacy({ 'effective-directive': undefined }))[0].directive).toBe('script-src')
  })
  it('report-to 형식 — csp-violation 만, 상한까지', () => {
    const body = [
      { type: 'deprecation', body: { id: 'x' } },
      { type: 'csp-violation', url: 'https://app.example/?q=SECRET', body: { blockedURL: 'inline', effectiveDirective: 'script-src-elem', documentURL: 'https://app.example/?q=SECRET' } },
      { type: 'csp-violation', body: { blockedURL: 'https://img.example/p.png?sig=SECRET', effectiveDirective: 'img-src' } },
    ]
    expect(extractCspViolations(body)).toEqual([{ directive: 'script-src-elem', blocked: 'inline' }, { directive: 'img-src', blocked: 'https://img.example/p.png' }])
    const many = Array.from({ length: CSP_REPORT_MAX_ENTRIES + 30 }, () => body[1])
    expect(extractCspViolations(many)).toHaveLength(CSP_REPORT_MAX_ENTRIES)
  })
  it('형식 밖 본문은 버린다', () => {
    for (const bad of [null, 1, 'x', {}, { 'csp-report': 'x' }, [1, 'a', null], [{ type: 'csp-violation' }]]) expect(extractCspViolations(bad)).toEqual([])
  })
  it('cleanBlocked — 낱말·스킴만, 사용자 정보·제어 문자·긴 값은 남기지 않는다', () => {
    expect(cleanBlocked('inline')).toBe('inline')
    expect(cleanBlocked('eval')).toBe('eval')
    expect(cleanBlocked('data')).toBe('data')
    expect(cleanBlocked('data:text/html;base64,SECRET')).toBe('data')
    expect(cleanBlocked('blob:https://app.example/1234-SECRET')).toBe('blob')
    expect(cleanBlocked('chrome-extension://abcdef/content.js')).toBe('chrome-extension')
    expect(cleanBlocked('https://user:pw@host.example:8443/p?q=1')).toBe('https://host.example:8443/p')
    expect(cleanBlocked('wss://rt.example/socket?apikey=SECRET')).toBe('wss://rt.example/socket')
    expect(cleanBlocked(`https://h.example/${'a'.repeat(500)}`).length).toBeLessThanOrEqual(200)
    expect(cleanBlocked('https://h.example/a\nFAKE LOG LINE')).not.toMatch(/\s/)
    for (const bad of [undefined, 3, '', '   ', 'not a url', '줄\n바꿈']) expect(cleanBlocked(bad)).toBe('other')
  })
  it('cleanDirective — 지시어 꼴이 아니면 unknown(임의 글자를 로그에 싣지 않는다)', () => {
    expect(cleanDirective('IMG-SRC')).toBe('img-src')
    for (const bad of [undefined, 1, '', 'x', 'script-src\nFAKE', 'a b c'.repeat(30), '<script>']) {
      const out = cleanDirective(bad)
      expect(out === 'unknown' || /^[a-z-]+$/.test(out), String(bad)).toBe(true)
    }
    expect(cleanDirective('<script>')).toBe('unknown')
  })
})

describe('POST /api/csp-report', () => {
  const post = (body: string, headers: Record<string, string> = { 'content-type': 'application/csp-report' }) =>
    POST(new Request('http://localhost/api/csp-report?leak=QUERY-SECRET', { method: 'POST', body, headers: { cookie: 'sb=COOKIE-SECRET', ...headers } }))
  let warn: ReturnType<typeof vi.spyOn>
  beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => {}) })
  afterEach(() => { warn.mockRestore() })
  const logged = () => warn.mock.calls.map((c: unknown[]) => c.join(' ')).join('\n')

  it('보고 한 건 → 204, 로그 한 줄에 지시어와 차단된 주소만', async () => {
    const res = await post(JSON.stringify(legacy()))
    expect(res.status).toBe(204)
    expect(await res.text()).toBe('')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(logged()).toBe('[csp] 위반 보고 directive=script-src-elem blocked=https://evil.example/a/b.js')
  })
  it('본문의 다른 칸·쿠키·쿼리스트링은 로그에 남지 않는다', async () => {
    await post(JSON.stringify(legacy()))
    await post(JSON.stringify([{ type: 'csp-violation', body: { blockedURL: 'https://x.example/i.png?s=SECRET', effectiveDirective: 'img-src', documentURL: 'https://app.example/SECRET', sample: 'SECRET' } }]), { 'content-type': 'application/reports+json' })
    expect(warn).toHaveBeenCalledTimes(2)
    expect(logged()).not.toMatch(/SECRET|cookie|share\/minutes|original-policy|referrer/)
  })
  it('보고 콘텐츠 타입이 아니면 415 — 본문을 읽지 않는다', async () => {
    for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x']) {
      expect((await post(JSON.stringify(legacy()), { 'content-type': type })).status).toBe(415)
    }
    expect((await POST(new Request('http://localhost/api/csp-report', { method: 'POST', body: '{}' }))).status).toBe(415)
    expect(warn).not.toHaveBeenCalled()
  })
  it('JSON 이 아니면 400, 형식 밖 JSON 은 204(로그 없음)', async () => {
    expect((await post('not json')).status).toBe(400)
    expect((await post('{"other":1}')).status).toBe(204)
    expect(warn).not.toHaveBeenCalled()
  })
  it('본문 상한을 넘으면 413 — Content-Length 가 없어도(스트림) 읽다 멈춘다', async () => {
    const big = JSON.stringify({ 'csp-report': { 'blocked-uri': 'inline', 'effective-directive': 'script-src', pad: 'x'.repeat(40_000) } })
    expect((await post(big)).status).toBe(413)
    const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode(big)); c.close() } })
    const req = new Request('http://localhost/api/csp-report', { method: 'POST', body: stream, headers: { 'content-type': 'application/json' }, duplex: 'half' } as RequestInit)
    expect((await POST(req)).status).toBe(413)
    expect(warn).not.toHaveBeenCalled()
  })

  describe('요청 제한(켠 상태)', () => {
    const saved = process.env.RATE_LIMIT
    beforeEach(() => { delete process.env.RATE_LIMIT })   // tests/setup/rate-limit.ts 가 끈 것을 이 묶음에서만 되돌린다
    afterEach(() => { process.env.RATE_LIMIT = saved })
    it('같은 IP 가 한도를 채우면 429 — 그 뒤 보고는 읽지도 남기지도 않는다. 다른 IP 는 받는다', async () => {
      const from = (ip: string) => ({ 'content-type': 'application/csp-report', 'x-forwarded-for': ip })
      for (let i = 0; i < RATE_RULES.cspReport.limit; i++) expect((await post(JSON.stringify(legacy()), from('203.0.113.7'))).status).toBe(204)
      warn.mockClear()
      const blocked = await post(JSON.stringify(legacy()), from('203.0.113.7'))
      expect(blocked.status).toBe(429)
      expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0)
      expect(warn).not.toHaveBeenCalled()
      expect((await post(JSON.stringify(legacy()), from('203.0.113.8'))).status).toBe(204)
    })
  })
})
