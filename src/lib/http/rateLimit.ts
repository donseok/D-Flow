import 'server-only'
import { headers as nextHeaders } from 'next/headers'
import { NextResponse } from 'next/server'
import { isLocalDevEnv } from '@/lib/domain/appEnv'

// 요청 제한(앱 계층) — 로그인 없이 닿는 길의 대입 시도를 늦춘다: 초대 토큰·공유 링크·비밀번호 재설정 요청·외부/에이전트 API 의 토큰 인증.
// 미들웨어 전체에 걸지 않고 그 길의 핸들러·액션이 이 파일의 도우미를 부른다(한도·키 규칙은 여기 한 곳).
//
// 저장소는 **프로세스 메모리의 고정 창 카운터**다(새 인프라·새 표 없음 — 정본 §5.7 은 외부 API 의 429 를 비목표로 두었고, 저장소를 정한 스펙이 없다).
// 그래서 한계가 분명하다:
//   · 인스턴스별이다 — 서버리스·다중 인스턴스에서는 요청이 인스턴스에 흩어져 실제 한도가 (한도 × 인스턴스 수)까지 느슨해지고, 콜드 스타트·재배포로
//     카운터가 사라진다. "대입을 불가능하게"가 아니라 "한 곳에서 몰아치는 시도를 늦춘다"까지다. 토큰 자체의 길이(무작위 256비트급)가 1차 방어다.
//   · 키는 클라이언트 IP 다. IP 는 프록시 헤더에서 읽으므로 **프록시가 그 헤더를 덮어쓸 때만** 믿을 수 있다(clientIp 주석).
//   · 같은 IP 를 쓰는 사람들(사무실 NAT)은 한 통을 나눠 쓴다 — 한도를 보수적으로(정상 사용이 닿지 않게) 잡는 이유다.
// 세는 것은 **실패**다(잘못된 토큰). 성공한 요청은 세지 않는다 — 정상 사용자의 반복 사용이 한도를 먹지 않게. 예외는 재설정 메일 요청으로,
// 성공·실패를 가르면 그 차이가 곧 가입 여부라 모든 요청을 센다.
// 막힌 동안에는 토큰을 확인하지 않고 거절한다(유효한 토큰도 같이 막힌다) — 확인한 뒤 가르면 429/200 의 차이가 토큰의 유효 여부를 드러낸다.

export interface RateRule {
  /** 창 하나에서 허용하는 횟수 — 이 횟수를 채우면 창이 끝날 때까지 막힌다 */
  limit: number
  windowMs: number
}

const TEN_MINUTES = 10 * 60_000

/** 한도 — 대상 종류마다 한 줄. scripts/e2e-local.mjs 는 같은 IP 로 공유 링크 실패 2회·자격증명 실패 1회를 보낸다(한도보다 한참 아래). */
export const RATE_RULES = {
  /** 초대 토큰 확인·수락(/invite/[token] 과 그 액션)의 실패 — 형식이 아닌 토큰·없는 초대 */
  inviteToken: { limit: 10, windowMs: TEN_MINUTES },
  /** 회의록 공유 링크(/share/minutes/[token])의 실패 — 형식이 아닌 토큰·없는(꺼진) 공유 */
  shareToken: { limit: 10, windowMs: TEN_MINUTES },
  /** 재설정 메일 요청 — 실패가 아니라 요청 수(메일 한 통씩 나간다). 같은 주소의 연속 요청은 인증 서버가 따로 막는다 */
  passwordResetRequest: { limit: 10, windowMs: TEN_MINUTES },
  /** 외부 API·에이전트 API(/api/v1/**)의 토큰 인증 실패. 회수된 토큰으로 계속 물어보는 에이전트가 같은 사무실의 다른 에이전트를 막지 않게 넉넉히 */
  apiCredential: { limit: 30, windowMs: TEN_MINUTES },
  /** CSP 위반 보고(/api/csp-report) — 실패가 아니라 요청 수(무인증 수집이라 요청마다 로그 한 줄이 될 수 있다). 위반이 많은 화면 하나가 수십 건을
   *  보내므로 넉넉히 잡는다 — 넘친 보고는 버려도 된다(같은 위반은 다음 창에 다시 온다) */
  cspReport: { limit: 120, windowMs: TEN_MINUTES },
} as const satisfies Record<string, RateRule>
export type RateKind = keyof typeof RATE_RULES

/** 키 수의 상한 — 꾸민 IP 로 키를 무한히 만들어 메모리를 먹지 못하게. 넘치면 만료분을 치우고, 그래도 넘치면 오래된 키부터 버린다 */
export const RATE_MAX_KEYS = 10_000
/** 만료 정리 간격 — 새 키가 들어올 때 이 간격이 지났으면 만료된 키를 훑어 지운다(타이머를 두지 않는다 — 서버리스에서 타이머는 돌지 않는다) */
const SWEEP_EVERY_MS = 60_000
const MESSAGE = '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.'

interface Bucket { count: number; resetAt: number }

export interface RateLimiter {
  /** 막혀 있으면 풀릴 때까지 남은 초(1 이상), 아니면 0. 세지 않는다 */
  retryAfter(key: string, rule: RateRule): number
  /** 한 번 센다 */
  hit(key: string, rule: RateRule): void
  /** 지금 들고 있는 키 수(테스트·상한 확인용) */
  size(): number
}

/** 고정 창 카운터의 순수 구현 — 시계를 주입받는다(tests/http/rate-limit.test.ts). 창은 그 키의 첫 기록에서 시작해 windowMs 뒤에 통째로 비워진다. */
export function createRateLimiter(opts: { now?: () => number; maxKeys?: number } = {}): RateLimiter {
  const now = opts.now ?? Date.now
  const maxKeys = Math.max(1, opts.maxKeys ?? RATE_MAX_KEYS)
  const buckets = new Map<string, Bucket>()
  let nextSweepAt = 0

  function sweep(t: number): void {
    for (const [key, b] of buckets) if (b.resetAt <= t) buckets.delete(key)
    nextSweepAt = t + SWEEP_EVERY_MS
  }
  function live(key: string, t: number): Bucket | null {
    const b = buckets.get(key)
    if (!b) return null
    if (b.resetAt <= t) { buckets.delete(key); return null }
    return b
  }
  return {
    retryAfter(key, rule) {
      const t = now()
      const b = live(key, t)
      return b && b.count >= rule.limit ? Math.max(1, Math.ceil((b.resetAt - t) / 1000)) : 0
    },
    hit(key, rule) {
      const t = now()
      const b = live(key, t)
      if (b) { b.count += 1; return }
      if (t >= nextSweepAt || buckets.size >= maxKeys) sweep(t)
      // 만료분을 치우고도 가득하면 가장 오래된 키부터 버린다(Map 은 넣은 순서) — 상한을 지키는 쪽이 먼저다. 키를 쏟아부어 남의 차단을
      // 밀어낼 수 있다는 뜻이기도 하다(메모리 카운터의 한계)
      while (buckets.size >= maxKeys) {
        const oldest = buckets.keys().next()
        if (oldest.done) break
        buckets.delete(oldest.value)
      }
      buckets.set(key, { count: 1, resetAt: t + rule.windowMs })
    },
    size: () => buckets.size,
  }
}

type HeaderBag = { get(name: string): string | null }

/**
 * 클라이언트 IP — `x-forwarded-for` 의 첫 값, 없으면 `x-real-ip`, 그것도 없으면 'unknown'(모르는 요청은 한 통을 나눠 쓴다 — 통과시키지 않는다).
 * **신뢰 경계**: 이 헤더들은 클라이언트가 직접 적어 보낼 수 있다. 앞단 프록시가 값을 **덮어쓸 때만** 첫 값이 실제 주소다(Vercel 은 덮어쓴다.
 * Next 서버는 헤더가 없을 때 소켓 주소로 채운다). 프록시가 받은 값 뒤에 덧붙이기만 하면(nginx 의 `$proxy_add_x_forwarded_for`) 첫 값은
 * 공격자가 고르는 값이라 요청마다 바꿔 한도를 피할 수 있다 — 자체호스트는 프록시가 `X-Forwarded-For` 를 `$remote_addr` 로 덮어쓰게 둔다
 * (docs/runbook-selfhost.md '요청 제한'). 값은 키로만 쓰고 길이를 자른다(긴 값으로 메모리를 먹지 못하게).
 */
export function clientIp(h: HeaderBag): string {
  const forwarded = h.get('x-forwarded-for')?.split(',')[0]?.trim()
  const ip = forwarded || h.get('x-real-ip')?.trim() || 'unknown'
  return ip.slice(0, 64).toLowerCase()
}

/**
 * 요청 제한을 켜는가 — **기본은 켬**이다. `RATE_LIMIT=off` 는 로컬 개발(isLocalDevEnv)과 단위 테스트(NODE_ENV=test)에서만 듣는다:
 * 배포된 서버에서는 그 값을 줘도 꺼지지 않는다(운영에서 실수로 끄지 못하게). 단위 테스트는 tests/setup/rate-limit.ts 가 끈다 — 한 파일이
 * 실패 경로를 수십 번 부르면 서로의 카운터에 걸린다.
 */
export function rateLimitEnabled(env: { RATE_LIMIT?: string; APP_ENV?: string; NODE_ENV?: string }): boolean {
  if (env.RATE_LIMIT?.trim() !== 'off') return true
  return !(isLocalDevEnv(env) || (env.NODE_ENV === 'test' && !env.APP_ENV?.trim()))
}

const limiter = createRateLimiter()
// 이름을 적어 읽는다 — next.config.ts 가 APP_ENV 를 빌드 때 이 식에 박는다
const enabled = () => rateLimitEnabled({ RATE_LIMIT: process.env.RATE_LIMIT, APP_ENV: process.env.APP_ENV, NODE_ENV: process.env.NODE_ENV })
const keyOf = (kind: RateKind, h: HeaderBag) => `${kind}:${clientIp(h)}`

/** 라우트 핸들러용 — 막혀 있으면 남은 초, 아니면 0. 토큰을 확인하기 **전에** 부른다 */
export function rateLimitedFor(kind: RateKind, h: HeaderBag): number {
  return enabled() ? limiter.retryAfter(keyOf(kind, h), RATE_RULES[kind]) : 0
}
/** 라우트 핸들러용 — 실패 한 번을 센다(잘못된 토큰. 조회 장애는 세지 않는다 — 서버의 문제로 정상 사용자를 막지 않는다) */
export function noteRateFailureFor(kind: RateKind, h: HeaderBag): void {
  if (enabled()) limiter.hit(keyOf(kind, h), RATE_RULES[kind])
}

/** 서버 액션·서버 컴포넌트용 — 요청 헤더를 next/headers 에서 읽는다. 꺼져 있으면 헤더도 읽지 않는다(요청 밖에서 부르는 단위 테스트) */
export async function rateLimited(kind: RateKind): Promise<number> {
  return enabled() ? rateLimitedFor(kind, await nextHeaders()) : 0
}
export async function noteRateFailure(kind: RateKind): Promise<void> {
  if (enabled()) noteRateFailureFor(kind, await nextHeaders())
}
/** 요청마다 세는 대상(재설정 메일 요청)용 — 막혀 있으면 남은 초, 아니면 세고 0 */
export async function consumeRate(kind: RateKind): Promise<number> {
  if (!enabled()) return 0
  const h = await nextHeaders()
  const wait = rateLimitedFor(kind, h)
  if (wait === 0) noteRateFailureFor(kind, h)
  return wait
}

/** 429 응답 — 외부 API 의 오류 봉투({ error, code })에 Retry-After(초)를 싣는다. 문구는 IP 만으로 정해지므로 토큰에 대해 아무것도 말하지 않는다.
 *  화면·액션의 문구는 사전 키 `rateLimit.tooMany`(ko·en)다 — 외부 API 의 오류문은 다른 코드와 같이 한국어 고정이다. */
export function rateLimitedResponse(retryAfterSeconds: number): NextResponse {
  return NextResponse.json({ error: MESSAGE, code: 'rate_limited' }, { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } })
}
