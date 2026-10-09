// 요청 제한의 배선 — 로그인 없이 닿는 길(초대·재설정 메일 요청·외부/에이전트 API 자격증명)이 한도를 채운 IP 를 닫는지, 실패만 세는지,
// 막힌 동안 토큰의 유효 여부를 더 드러내지 않는지. 단위 테스트의 전역 끔(tests/setup/rate-limit.ts)을 이 파일에서만 푼다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

const h = vi.hoisted(() => ({
  ip: '203.0.113.1',
  admin: { current: null as unknown },
  getSession: vi.fn(async () => null),
  resetPasswordForEmail: vi.fn(async () => ({ data: {}, error: null })),
}))
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-forwarded-for': h.ip }),
  cookies: async () => ({ get: () => undefined }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NOT_FOUND') } }))
vi.mock('@/lib/supabase/env', () => ({ serviceRoleConfigured: () => true }))
vi.mock('@/components/minutes/ShareViewer', () => ({ ShareViewer: () => null }))
vi.mock('@/lib/auth', () => ({ getSession: h.getSession }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => h.admin.current }))
vi.mock('@/lib/auth/passwordResetMail', () => ({ passwordResetMailAvailable: () => true }))
vi.mock('@/lib/supabase/server', () => ({ createAuthMailClient: () => ({ auth: { resetPasswordForEmail: h.resetPasswordForEmail } }) }))

import { getInvitePreview, getInviteSessionState, redeemInvite, redeemInviteWithSignup } from '@/app/actions/inviteRedeem'
import { requestPasswordReset } from '@/app/actions/passwordReset'
import { generateCredentialToken } from '@/lib/agent/token'
import { resolveCredential } from '@/lib/authz/credentials'
import { RATE_RULES } from '@/lib/http/rateLimit'
import { resolveMinutesPrincipal } from '@/lib/minutes/externalApi'
import SharedMinutePage from '@/app/share/minutes/[token]/page'

const TOO_MANY = '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.'
const NOT_FOUND = '초대를 찾을 수 없습니다.'
const TOKEN = '11111111-2222-4333-8444-555555555555'
let n = 0
/** 테스트마다 새 IP — 모듈의 카운터는 파일 안에서 이어진다 */
const freshIp = () => { n += 1; h.ip = `198.51.100.${n}`; return h.ip }

/** project_invites 조회만 받는 admin — data 가 null 이면 '없는 초대' */
function inviteAdmin(result: { data: unknown; error: unknown }) {
  const maybeSingle = vi.fn(async () => result)
  const chain = { select: () => chain, eq: () => chain, is: () => chain, maybeSingle }
  return { client: { from: () => chain }, maybeSingle }
}

beforeEach(() => {
  delete process.env.RATE_LIMIT
  vi.spyOn(console, 'error').mockImplementation(() => {})
  h.resetPasswordForEmail.mockClear()
})
afterEach(() => { process.env.RATE_LIMIT = 'off'; vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe('초대 토큰', () => {
  it('없는 초대를 한도만큼 대면 그 IP 는 막힌다 — 그 뒤로는 초대 행을 조회하지 않는다(맞는 토큰도 같은 문구)', async () => {
    freshIp()
    const admin = inviteAdmin({ data: null, error: null }); h.admin.current = admin.client
    for (let i = 0; i < RATE_RULES.inviteToken.limit; i++) expect(await getInvitePreview(TOKEN)).toEqual({ ok: false, error: NOT_FOUND })
    const calls = admin.maybeSingle.mock.calls.length
    for (const call of [() => getInvitePreview(TOKEN), () => getInviteSessionState(TOKEN), () => redeemInvite(TOKEN),
      () => redeemInviteWithSignup(TOKEN, { name: 'a', password: 'password1', passwordConfirmation: 'password1' })]) {
      expect(await call()).toEqual({ ok: false, error: TOO_MANY })
    }
    expect(admin.maybeSingle.mock.calls.length).toBe(calls)
    expect(h.getSession).not.toHaveBeenCalled()
  })

  it('형식이 아닌 토큰도 실패로 센다', async () => {
    freshIp()
    for (let i = 0; i < RATE_RULES.inviteToken.limit; i++) expect(await getInvitePreview('nope')).toEqual({ ok: false, error: NOT_FOUND })
    expect(await getInvitePreview('nope')).toEqual({ ok: false, error: TOO_MANY })
  })

  it('다른 IP 는 영향을 받지 않는다', async () => {
    freshIp()
    for (let i = 0; i < RATE_RULES.inviteToken.limit; i++) await getInvitePreview('nope')
    expect(await getInvitePreview('nope')).toEqual({ ok: false, error: TOO_MANY })
    freshIp()
    expect(await getInvitePreview('nope')).toEqual({ ok: false, error: NOT_FOUND })
  })

  it('조회 장애는 세지 않는다 — 서버의 문제로 정상 사용자를 막지 않는다', async () => {
    freshIp()
    h.admin.current = inviteAdmin({ data: null, error: { message: 'boom' } }).client
    for (let i = 0; i < RATE_RULES.inviteToken.limit + 5; i++) expect(await getInvitePreview(TOKEN)).toEqual({ ok: false, error: '초대를 확인할 수 없어 중단했습니다.' })
  })

  it('있는 초대의 확인은 세지 않는다 — 만료된 초대를 몇 번을 열어도 막히지 않는다', async () => {
    freshIp()
    const row = { workspace_id: 'w', email: 'a@example.com', expires_at: '2000-01-01T00:00:00Z', revoked_at: null, redeemed_at: null, team_ids: [], access_role: 'member', projects: null, workspaces: null }
    h.admin.current = inviteAdmin({ data: row, error: null }).client
    for (let i = 0; i < RATE_RULES.inviteToken.limit + 5; i++) {
      const res = await getInvitePreview(TOKEN)
      expect(res.ok && res.preview.status).toBe('expired')
    }
  })
})

describe('공유 링크', () => {
  const page = (token: string) => SharedMinutePage({ params: Promise.resolve({ token }) })
  const SHARE = TOKEN // 공유 토큰도 UUID 형식이다(isShareToken)
  it('없는 공유 토큰을 한도만큼 대면 404 대신 안내를 그린다 — 그 뒤로는 조회하지 않는다. 형식이 아닌 토큰도 센다', async () => {
    freshIp()
    const admin = inviteAdmin({ data: null, error: null }); h.admin.current = admin.client
    const tokens = [SHARE, 'bad token']
    for (let i = 0; i < RATE_RULES.shareToken.limit; i++) await expect(page(tokens[i % tokens.length])).rejects.toThrow('NOT_FOUND')
    const calls = admin.maybeSingle.mock.calls.length
    const el = await page(tokens[0]) as { props: { children: { props: Record<string, unknown> } } }
    expect(el.props.children.props['data-rate-limited']).toBe(true)
    expect(el.props.children.props.children).toBe(TOO_MANY)
    expect(admin.maybeSingle.mock.calls.length).toBe(calls)
    expect(calls).toBe(RATE_RULES.shareToken.limit / 2) // 형식이 맞는 절반만 조회했다
  })
  it('조회 장애는 세지 않는다', async () => {
    freshIp()
    h.admin.current = inviteAdmin({ data: null, error: { message: 'boom' } }).client
    for (let i = 0; i < RATE_RULES.shareToken.limit + 3; i++) await expect(page(SHARE)).rejects.toThrow('NOT_FOUND')
  })
})

describe('재설정 메일 요청', () => {
  it('요청마다 센다 — 한도를 넘으면 인증 서버로 보내지 않고 rate_limited(주소와 무관해 가입 여부를 드러내지 않는다)', async () => {
    freshIp()
    for (let i = 0; i < RATE_RULES.passwordResetRequest.limit; i++) expect(await requestPasswordReset(`u${i}@example.com`)).toEqual({ ok: true })
    expect(await requestPasswordReset('other@example.com')).toEqual({ ok: false, code: 'rate_limited' })
    expect(h.resetPasswordForEmail).toHaveBeenCalledTimes(RATE_RULES.passwordResetRequest.limit)
  })
  it('형식이 틀린 주소는 세지 않는다', async () => {
    freshIp()
    for (let i = 0; i < RATE_RULES.passwordResetRequest.limit + 5; i++) expect(await requestPasswordReset('not-an-email')).toEqual({ ok: false, code: 'invalid_email' })
    expect(await requestPasswordReset('a@example.com')).toEqual({ ok: true })
  })
})

describe('외부·에이전트 API 자격증명', () => {
  const pat = generateCredentialToken('agent_runner')
  const row = {
    id: '40000000-0000-4000-8000-000000000001', workspace_id: '10000000-0000-4000-8000-000000000001', kind: 'agent_runner', name: 't',
    token_prefix: pat.prefix, token_hash: pat.hash, scopes: ['work:read'], project_ids: null, default_project_id: null, default_team_id: null,
    team_map: {}, owner_user_id: '30000000-0000-4000-8000-000000000001', enabled: true, revoked_at: null, expires_at: '2099-01-01T00:00:00Z',
  }
  function db(result: { data: unknown; error: unknown }) {
    const maybeSingle = vi.fn(async () => result)
    const updated = { eq: () => updated, then: (ok: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(ok) }
    const chain = { select: () => chain, eq: () => chain, maybeSingle, update: () => updated }
    return { admin: { from: () => chain } as never, maybeSingle }
  }
  const req = (ip: string, token: string | null = pat.token) => new Request('http://localhost/api/v1/agent/work', {
    headers: { 'x-forwarded-for': ip, ...(token ? { authorization: `Bearer ${token}` } : {}) },
  })
  beforeEach(() => { vi.stubEnv('AGENT_API_ENABLED', 'true'); vi.stubEnv('MINUTES_API_ENABLED', 'true') })

  it('인증 실패를 한도만큼 내면 429 + Retry-After — 그 뒤로는 맞는 토큰도 조회 없이 같은 429 다', async () => {
    const ip = freshIp()
    const miss = db({ data: null, error: null })
    for (let i = 0; i < RATE_RULES.apiCredential.limit; i++) {
      const res = await resolveCredential(req(ip, generateCredentialToken('agent_runner').token), miss.admin, 'agent_runner')
      expect(res instanceof NextResponse && res.status).toBe(401)
    }
    const good = db({ data: row, error: null })
    const res = await resolveCredential(req(ip), good.admin, 'agent_runner')
    expect(res).toBeInstanceOf(NextResponse)
    const blocked = res as NextResponse
    expect(blocked.status).toBe(429)
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0)
    expect(Number(blocked.headers.get('retry-after'))).toBeLessThanOrEqual(RATE_RULES.apiCredential.windowMs / 1000)
    expect(await blocked.json()).toEqual({ error: TOO_MANY, code: 'rate_limited' })
    expect(good.maybeSingle).not.toHaveBeenCalled()
    // 다른 IP 의 같은 토큰은 통과한다
    const other = await resolveCredential(req(freshIp()), good.admin, 'agent_runner')
    expect(other).not.toBeInstanceOf(NextResponse)
  })

  it('성공은 세지 않는다 — 맞는 토큰은 몇 번을 써도 막히지 않는다', async () => {
    const ip = freshIp()
    const good = db({ data: row, error: null })
    for (let i = 0; i < RATE_RULES.apiCredential.limit + 5; i++) expect(await resolveCredential(req(ip), good.admin, 'agent_runner')).not.toBeInstanceOf(NextResponse)
  })

  it('조회 장애의 401 은 세지 않는다', async () => {
    const ip = freshIp()
    const broken = db({ data: null, error: { message: 'boom' } })
    for (let i = 0; i < RATE_RULES.apiCredential.limit + 5; i++) {
      const res = await resolveCredential(req(ip), broken.admin, 'agent_runner')
      expect(res instanceof NextResponse && res.status).toBe(401)
    }
  })

  it('Bearer 가 없거나 형식이 아닌 요청도 센다 — 회의록 API 의 조기 401 포함(같은 통)', async () => {
    const ip = freshIp()
    const getAdmin = vi.fn(() => { throw new Error('형식이 아닌 Bearer 는 클라이언트를 만들지 않는다') })
    for (let i = 0; i < RATE_RULES.apiCredential.limit; i++) {
      const res = await resolveMinutesPrincipal(req(ip, i % 2 ? null : 'not-a-credential'), getAdmin as never)
      expect(res instanceof NextResponse && res.status).toBe(401)
    }
    const res = await resolveMinutesPrincipal(req(ip, 'not-a-credential'), getAdmin as never)
    expect(res instanceof NextResponse && res.status).toBe(429)
    // 에이전트 API 도 같은 IP 로는 막힌다
    const agent = await resolveCredential(req(ip), db({ data: row, error: null }).admin, 'agent_runner')
    expect(agent instanceof NextResponse && agent.status).toBe(429)
  })

  it('킬스위치가 꺼진 API 는 제한보다 먼저 404 다(존재를 알리지 않는다)', async () => {
    const ip = freshIp()
    vi.stubEnv('AGENT_API_ENABLED', 'false')
    for (let i = 0; i < RATE_RULES.apiCredential.limit + 2; i++) {
      const res = await resolveCredential(req(ip, 'x'), db({ data: null, error: null }).admin, 'agent_runner')
      expect(res instanceof NextResponse && res.status).toBe(404)
    }
  })
})
