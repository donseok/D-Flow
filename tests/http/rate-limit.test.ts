// 요청 제한의 순수 조각(src/lib/http/rateLimit.ts) — 고정 창 카운터·키 상한·만료 정리·클라이언트 IP·끄는 조건. 시계는 주입한다.
import { describe, expect, it } from 'vitest'
import { RATE_MAX_KEYS, RATE_RULES, clientIp, createRateLimiter, rateLimitEnabled } from '@/lib/http/rateLimit'

const RULE = { limit: 3, windowMs: 60_000 }
const bag = (h: Record<string, string>) => ({ get: (name: string) => h[name] ?? null })

describe('createRateLimiter — 고정 창', () => {
  it('한도를 채우기 전에는 통과하고, 채우면 창이 끝날 때까지 막힌다(남은 초를 올림으로)', () => {
    let t = 1_000
    const rl = createRateLimiter({ now: () => t })
    rl.hit('k', RULE); rl.hit('k', RULE)
    expect(rl.retryAfter('k', RULE)).toBe(0)
    t += 500
    rl.hit('k', RULE)
    expect(rl.retryAfter('k', RULE)).toBe(60) // 창은 첫 기록(1000)에서 시작 — 59.5초 남음 → 60
    t = 1_000 + 59_999
    expect(rl.retryAfter('k', RULE)).toBe(1)
  })

  it('창이 끝나면 통째로 비워진다 — 다음 기록이 새 창을 연다', () => {
    let t = 0
    const rl = createRateLimiter({ now: () => t })
    for (let i = 0; i < 5; i++) rl.hit('k', RULE)
    expect(rl.retryAfter('k', RULE)).toBeGreaterThan(0)
    t = 60_000
    expect(rl.retryAfter('k', RULE)).toBe(0)
    expect(rl.size()).toBe(0) // 만료된 키는 읽는 순간 지운다
    rl.hit('k', RULE)
    expect(rl.retryAfter('k', RULE)).toBe(0)
  })

  it('확인(retryAfter)은 세지 않는다 — 성공 요청이 한도를 먹지 않는다', () => {
    const rl = createRateLimiter({ now: () => 0 })
    for (let i = 0; i < 100; i++) expect(rl.retryAfter('k', RULE)).toBe(0)
    expect(rl.size()).toBe(0)
  })

  it('키는 서로 독립이다', () => {
    const rl = createRateLimiter({ now: () => 0 })
    for (let i = 0; i < 3; i++) rl.hit('a', RULE)
    expect(rl.retryAfter('a', RULE)).toBeGreaterThan(0)
    expect(rl.retryAfter('b', RULE)).toBe(0)
  })

  it('키 수가 상한을 넘지 않는다 — 만료분을 먼저 치우고, 그래도 가득하면 오래된 키부터 버린다', () => {
    let t = 0
    const rl = createRateLimiter({ now: () => t, maxKeys: 3 })
    rl.hit('old', RULE)
    t = 30_000
    rl.hit('b', RULE); rl.hit('c', RULE)
    expect(rl.size()).toBe(3)
    t = 60_000 // old 만료
    rl.hit('d', RULE)
    expect(rl.size()).toBe(3)
    rl.hit('e', RULE) // 만료분 없음 → 가장 오래된 b 를 버린다
    expect(rl.size()).toBe(3)
    for (let i = 0; i < 2; i++) rl.hit('b', RULE)
    expect(rl.retryAfter('b', RULE)).toBe(0) // b 는 버려져 새로 셌다(2회)
    for (let i = 0; i < 1_000; i++) rl.hit(`flood-${i}`, RULE)
    expect(rl.size()).toBe(3)
  })

  it('새 키가 들어올 때 정리 간격이 지났으면 만료된 키를 훑어 지운다', () => {
    let t = 0
    const rl = createRateLimiter({ now: () => t })
    for (let i = 0; i < 50; i++) rl.hit(`k${i}`, RULE)
    expect(rl.size()).toBe(50)
    t = 120_000
    rl.hit('fresh', RULE)
    expect(rl.size()).toBe(1)
  })
})

describe('clientIp', () => {
  it('x-forwarded-for 의 첫 값 → x-real-ip → unknown', () => {
    expect(clientIp(bag({ 'x-forwarded-for': ' 203.0.113.7 , 10.0.0.1', 'x-real-ip': '10.0.0.9' }))).toBe('203.0.113.7')
    expect(clientIp(bag({ 'x-real-ip': '198.51.100.4' }))).toBe('198.51.100.4')
    expect(clientIp(bag({ 'x-forwarded-for': ' , 10.0.0.1', 'x-real-ip': '198.51.100.4' }))).toBe('198.51.100.4')
    expect(clientIp(bag({}))).toBe('unknown')
  })
  it('길이를 자르고 소문자로 맞춘다 — 긴 값·대소문자로 키를 늘리지 못한다', () => {
    expect(clientIp(bag({ 'x-forwarded-for': '2001:DB8::1' }))).toBe('2001:db8::1')
    expect(clientIp(bag({ 'x-forwarded-for': 'a'.repeat(500) }))).toHaveLength(64)
  })
})

describe('rateLimitEnabled — 기본은 켬, 배포된 서버에서는 꺼지지 않는다', () => {
  it.each([
    [{}, true],
    [{ NODE_ENV: 'production' }, true],
    [{ RATE_LIMIT: 'off', NODE_ENV: 'production' }, true],
    [{ RATE_LIMIT: 'off', APP_ENV: 'production', NODE_ENV: 'development' }, true],
    [{ RATE_LIMIT: 'off', APP_ENV: 'staging' }, true],
    [{ RATE_LIMIT: 'off', APP_ENV: 'preview' }, true],
    [{ RATE_LIMIT: 'off', APP_ENV: 'production', NODE_ENV: 'test' }, true],
    [{ RATE_LIMIT: 'off' }, true],
    [{ RATE_LIMIT: 'off', APP_ENV: 'development' }, false],
    [{ RATE_LIMIT: 'off', NODE_ENV: 'development' }, false],
    [{ RATE_LIMIT: 'off', NODE_ENV: 'test' }, false],
    [{ RATE_LIMIT: '0', NODE_ENV: 'development' }, true],
  ])('%o → %s', (env, expected) => { expect(rateLimitEnabled(env)).toBe(expected) })
})

describe('한도 상수', () => {
  it('모든 대상이 양의 한도·창을 갖고, 실패 한도는 E2E 가 보내는 실패 수(공유 2·자격증명 1)보다 넉넉하다', () => {
    for (const rule of Object.values(RATE_RULES)) { expect(rule.limit).toBeGreaterThanOrEqual(10); expect(rule.windowMs).toBeGreaterThan(0) }
    expect(RATE_MAX_KEYS).toBeGreaterThan(0)
  })
})
