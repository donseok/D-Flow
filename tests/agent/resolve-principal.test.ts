import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'
import { hashToken } from '@/lib/agent/token'
import { agentCredential, agentPrincipal, CRED_ID, CRED_OWNER, CRED_WS, minutesCredential, type CredentialRow } from '../fixtures/credentials'

const OLD = { ...process.env }
beforeEach(() => { vi.resetModules() })
afterEach(() => { process.env = { ...OLD } })

function req(auth?: string) {
  return new Request('http://l/api/v1/agent/work', { headers: auth ? { Authorization: auth } : {} })
}
/**
 * 표별 응답을 주는 admin 목 — integration_credentials 는 token_prefix 가 맞는 행만 돌려준다(없으면 null).
 * 옛 저장소(agent_runners)에도 행을 둘 수 있다: 리졸버가 그 표를 읽으면 통과해 버리는 함정이고, tables 로 호출 여부를 본다.
 */
function adminWith(
  row: unknown,
  opts: { user?: { id: string; email: string | null } | null; userError?: boolean; legacyRunner?: unknown; credError?: boolean } = {},
) {
  const tables: string[] = []
  const updates: Array<{ table: string; payload: unknown }> = []
  const user = opts.user === undefined ? { id: CRED_OWNER, email: 'Dev@Example.com' } : opts.user
  return {
    tables, updates,
    from: (table: string) => {
      tables.push(table)
      let prefix: unknown
      let updating = false
      const b: Record<string, unknown> = {}
      b.select = () => b
      b.update = (payload: unknown) => { updating = true; updates.push({ table, payload }); return b }
      b.eq = (col: string, val: unknown) => { if (col === 'token_prefix') prefix = val; return b }
      const result = () => {
        if (updating) return { data: null, error: null }
        if (table === 'integration_credentials') {
          if (opts.credError) return { data: null, error: { message: 'storage unavailable' } }
          const r = row as { token_prefix?: unknown } | null
          return { data: r && r.token_prefix === prefix ? r : null, error: null }
        }
        if (table === 'agent_runners') return { data: opts.legacyRunner ?? null, error: null }
        return { data: null, error: null }
      }
      b.maybeSingle = async () => result()
      b.then = (r: (v: unknown) => unknown) => Promise.resolve(result()).then(r)
      return b
    },
    auth: { admin: { getUserById: vi.fn(async () => opts.userError
      ? { data: { user: null }, error: { message: 'auth down' } }
      : { data: { user }, error: null }) } },
  }
}
async function load() { return await import('@/lib/agent/externalApi') }
const quiet = () => vi.spyOn(console, 'error').mockImplementation(() => {})

describe('resolveAgentPrincipal — 원천은 integration_credentials(agent_runner) 하나(SP7 §5.1.4)', () => {
  it('킬스위치: ENABLED 아니면 404 — 유효한 자격증명이어도, 옛 시크릿이 설정돼 있어도. 표를 읽지 않는다', async () => {
    delete process.env.AGENT_API_ENABLED
    process.env.AGENT_API_SECRET = 's'
    const cred = agentCredential()
    const m = await load()
    for (const bearer of ['Bearer s', `Bearer ${cred.token}`]) {
      const admin = adminWith(cred.row)
      const r = await m.resolveAgentPrincipal(req(bearer), admin as never)
      expect((r as NextResponse).status).toBe(404)
      expect(admin.tables).toEqual([])
    }
  })

  // 옛 케이스 '시크릿 일치 → legacy principal' 의 후신(반전) — 배포 전역 시크릿 principal 은 삭제됐다.
  it('① env 에 AGENT_API_SECRET 을 설정하고 그 값으로 Bearer 를 보내도 401 — principal 을 만들지 않고 어느 표도 읽지 않는다', async () => {
    process.env.AGENT_API_ENABLED = 'true'
    process.env.AGENT_API_SECRET = 's3cret'
    const m = await load()
    const admin = adminWith(agentCredential().row)
    const r = await m.resolveAgentPrincipal(req('Bearer s3cret'), admin as never)
    expect(r).toBeInstanceOf(NextResponse)
    expect((r as NextResponse).status).toBe(401)
    expect(await (r as NextResponse).json()).toEqual({ error: '인증이 필요합니다.', code: 'unauthorized' })
    expect(admin.tables).toEqual([])
    expect(admin.auth.admin.getUserById).not.toHaveBeenCalled()
    // 시크릿이 없을 때와 같다 — 시크릿 존재가 분기를 만들지 않는다
    delete process.env.AGENT_API_SECRET
    vi.resetModules()
    const m2 = await load()
    expect(((await m2.resolveAgentPrincipal(req('Bearer s3cret'), adminWith(null) as never)) as NextResponse).status).toBe(401)
  })

  it('Authorization 헤더가 없거나 Bearer 가 아니면 401 — 표를 읽지 않는다', async () => {
    process.env.AGENT_API_ENABLED = 'true'
    const cred = agentCredential()
    const m = await load()
    for (const auth of [undefined, cred.token, `Basic ${cred.token}`, 'Bearer ']) {
      const admin = adminWith(cred.row)
      expect(((await m.resolveAgentPrincipal(req(auth), admin as never)) as NextResponse).status).toBe(401)
      expect(admin.tables).toEqual([])
    }
  })

  it('PAT 정상 → pat principal(스코프·프로젝트 한정 재료 + 범위를 좁히는 credential 포함), last_used_at 을 한 번 갱신한다', async () => {
    process.env.AGENT_API_ENABLED = 'true'
    const P1 = '11111111-1111-4111-8111-111111111111'
    const cred = agentCredential({ name: 'ci', scopes: ['work:read'], project_ids: [P1] })
    const m = await load()
    const admin = adminWith(cred.row)
    const p = await m.resolveAgentPrincipal(req(`Bearer ${cred.token}`), admin as never)
    expect(p).toEqual({
      kind: 'pat', runnerId: CRED_ID, userId: CRED_OWNER, userEmail: 'dev@example.com', scopes: ['work:read'],
      projectId: P1, runnerKind: 'user_pat', tokenExpiresAt: '2099-01-01T00:00:00Z',
      runnerName: 'ci', tokenPrefix: cred.prefix,
      credential: {
        id: CRED_ID, workspaceId: CRED_WS, kind: 'agent_runner', name: 'ci', tokenPrefix: cred.prefix,
        expiresAt: '2099-01-01T00:00:00Z', scopes: ['work:read'], projectIds: [P1],
        defaultProjectId: null, defaultTeamId: null, teamMap: {}, ownerUserId: CRED_OWNER,
      },
    })
    expect(admin.tables).toEqual(['integration_credentials', 'integration_credentials'])
    expect(admin.updates).toEqual([{ table: 'integration_credentials', payload: { last_used_at: expect.any(String) } }])
    expect(admin.auth.admin.getUserById).toHaveBeenCalledWith(CRED_OWNER)
    // 평문 토큰·해시는 principal 에 싣지 않는다
    expect(JSON.stringify(p)).not.toContain(cred.token)
    expect(JSON.stringify(p)).not.toContain(hashToken(cred.token))
  })

  it('project_ids 가 null 이거나 여럿이면 projectId 는 null — 범위는 credential 이 가진다', async () => {
    process.env.AGENT_API_ENABLED = 'true'
    const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222'
    const m = await load()
    for (const project_ids of [null, [A, B]]) {
      const cred = agentCredential({ project_ids })
      const p = await m.resolveAgentPrincipal(req(`Bearer ${cred.token}`), adminWith(cred.row) as never)
      expect(p).toMatchObject({ kind: 'pat', projectId: null, credential: { projectIds: project_ids } })
    }
  })

  it('PAT 폐기·만료·비활성·해시 불일치·행 손상·행 없음 → 전부 401, last_used_at 을 갱신하지 않고 옛 저장소로 넘어가지 않는다', async () => {
    process.env.AGENT_API_ENABLED = 'true'
    const cred = agentCredential()
    const base = cred.row
    const m = await load()
    const hash = base.token_hash
    for (const row of [
      { ...base, enabled: false },
      { ...base, revoked_at: '2026-01-01T00:00:00Z' },
      { ...base, expires_at: '2020-01-01T00:00:00Z' },
      { ...base, token_hash: 'f'.repeat(64) },
      { ...base, token_hash: hash + 'zz' },
      { ...base, token_hash: hash + 'a' },
      { ...base, token_hash: null },
      { ...base, enabled: 'false' },
      { ...base, workspace_id: 'ws-1' },          // UUID 가 아닌 워크스페이스 — 범위를 넓게 해석하지 않는다
      { ...base, project_ids: 'all' },            // 손상된 범위
      { ...base, owner_user_id: null },           // 소유자 없는 agent_runner 행
      { ...base, kind: 'minutes_api' },           // 다른 종류의 자격증명
      null, // prefix 미존재
    ]) {
      const admin = adminWith(row as CredentialRow | null, { legacyRunner: { id: 'r-1', enabled: true, token_hash: hash } })
      const r = await m.resolveAgentPrincipal(req(`Bearer ${cred.token}`), admin as never)
      expect((r as NextResponse).status).toBe(401)
      expect(admin.tables).toEqual(['integration_credentials'])
      expect(admin.updates).toEqual([])
      expect(admin.auth.admin.getUserById).not.toHaveBeenCalled()
    }
  })

  // 옛 리졸버는 integration_credentials 에 prefix 가 없으면 agent_runners 로 다시 인증했다(단계적 전환용 폴백 — 삭제됐다).
  it('② integration_credentials 에 없고 옛 저장소(agent_runners)에만 있는 prefix 는 401 — 그 표를 조회하지 않는다', async () => {
    process.env.AGENT_API_ENABLED = 'true'
    const legacyOnly = agentCredential() // 토큰 형식은 유효한 PAT 지만 새 저장소에는 행이 없다
    const runnerRow = {
      id: 'r-1', kind: 'user_pat', owner_user_id: CRED_OWNER, name: 'old', token_prefix: legacyOnly.prefix,
      token_hash: legacyOnly.row.token_hash, project_id: null, scopes: ['work:read', 'work:claim'], enabled: true,
      revoked_at: null, expires_at: '2099-01-01T00:00:00Z',
    }
    const m = await load()
    const admin = adminWith(null, { legacyRunner: runnerRow })
    const r = await m.resolveAgentPrincipal(req(`Bearer ${legacyOnly.token}`), admin as never)
    expect(r).toBeInstanceOf(NextResponse)
    expect((r as NextResponse).status).toBe(401)
    expect(admin.tables).toEqual(['integration_credentials'])
    expect(admin.tables).not.toContain('agent_runners')
    expect(admin.updates).toEqual([])
    expect(admin.auth.admin.getUserById).not.toHaveBeenCalled()
  })

  it('새 저장소 조회 장애도 401(fail-closed) — 옛 저장소로 우회하지 않는다', async () => {
    process.env.AGENT_API_ENABLED = 'true'
    const spy = quiet()
    const cred = agentCredential()
    const m = await load()
    const admin = adminWith(cred.row, { credError: true, legacyRunner: { id: 'r-1', enabled: true } })
    expect(((await m.resolveAgentPrincipal(req(`Bearer ${cred.token}`), admin as never)) as NextResponse).status).toBe(401)
    expect(admin.tables).toEqual(['integration_credentials'])
    spy.mockRestore()
  })

  it('회의록 연동 토큰(dflow_int_)은 에이전트 API 에서 401 — 다른 종류의 자격증명으로 들어오지 못한다', async () => {
    process.env.AGENT_API_ENABLED = 'true'
    const minutes = minutesCredential()
    const m = await load()
    const admin = adminWith(minutes.row)
    expect(((await m.resolveAgentPrincipal(req(`Bearer ${minutes.token}`), admin as never)) as NextResponse).status).toBe(401)
    expect(admin.tables).toEqual([])
  })

  it('소유자 계정 조회 실패·이메일 없음·다른 계정 → 401(fail-closed)', async () => {
    process.env.AGENT_API_ENABLED = 'true'
    const spy = quiet()
    const cred = agentCredential()
    const m = await load()
    for (const opts of [
      { userError: true },
      { user: null },
      { user: { id: CRED_OWNER, email: null } },
      { user: { id: 'someone-else', email: 'dev@example.com' } },
    ]) {
      const r = await m.resolveAgentPrincipal(req(`Bearer ${cred.token}`), adminWith(cred.row, opts) as never)
      expect((r as NextResponse).status).toBe(401)
    }
    spy.mockRestore()
  })

  it('env 에 옛 시크릿이 있어도 PAT 는 자격증명 경로로 인증된다 — 시크릿은 인증에 관여하지 않는다', async () => {
    process.env.AGENT_API_ENABLED = 'true'
    process.env.AGENT_API_SECRET = 's3cret'
    const cred = agentCredential({ scopes: ['work:read'] })
    const m = await load()
    const p = await m.resolveAgentPrincipal(req(`Bearer ${cred.token}`), adminWith(cred.row) as never)
    expect(p).toMatchObject({ kind: 'pat', userId: CRED_OWNER, credential: { workspaceId: CRED_WS } })
  })

  it('requireScope — 부족하면 403 insufficient_scope, 미지 스코프·프로토타입 키도 403', async () => {
    const m = await load()
    const pat = agentPrincipal(agentCredential({ scopes: ['work:read'] }))
    // 'work:report' 는 알려진 스코프(work:read/work:claim)가 아니다 — 미지 스코프 취급을 검사한다.
    const unknownScope = 'work:report' as unknown as Parameters<typeof m.requireScope>[1]
    expect(m.requireScope(pat, 'work:read')).toBeNull()
    expect(m.requireScope(pat, 'work:claim')?.status).toBe(403)
    expect(await m.requireScope(pat, 'work:claim')?.json()).toMatchObject({ code: 'insufficient_scope' })
    expect(m.requireScope(pat, unknownScope)?.status).toBe(403)
    for (const scope of ['toString', 'constructor', '__proto__']) {
      expect(m.requireScope(pat, scope as Parameters<typeof m.requireScope>[1])?.status).toBe(403)
    }
    // 옛 토큰의 work:report 는 work:claim 요구를 충족한다(2026-08-25 폐지 스코프의 호환)
    expect(m.requireScope(agentPrincipal(agentCredential({ scopes: ['work:report'] })), 'work:claim')).toBeNull()
    // (삭제) 'legacy principal 은 스코프 없이 통과' — 그 principal 변형이 타입에서 사라졌다.
  })

  it('patProjectAllowed — 자격증명의 project_ids 로만 판정한다(null 은 그 워크스페이스 전체)', async () => {
    const m = await load()
    const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222'
    expect(m.patProjectAllowed(agentPrincipal(agentCredential()), A)).toBe(true)
    const scoped = agentPrincipal(agentCredential({ project_ids: [A] }))
    expect(m.patProjectAllowed(scoped, A)).toBe(true)
    expect(m.patProjectAllowed(scoped, B)).toBe(false)
    // principal.projectId(표시용) 를 바꿔도 판정은 credential 을 따른다
    expect(m.patProjectAllowed({ ...scoped, projectId: B }, B)).toBe(false)
  })
})
