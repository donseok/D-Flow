import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'
import { generateCredentialToken } from '@/lib/agent/token'
import { actorFromCredential, authorizeAgentCredentialProject, credentialHasScope, resolveCredential, type ResolvedCredential } from '@/lib/authz/credentials'
import { roleIn, type Actor } from '@/lib/domain/authz'
import { requireModule } from '@/lib/modules/gate'

const { buildActor } = vi.hoisted(() => ({ buildActor: vi.fn() }))
vi.mock('@/lib/authz/buildActor', () => ({ buildActor }))

const W = '10000000-0000-4000-8000-000000000001'
const P = '20000000-0000-4000-8000-000000000001'
const U = '30000000-0000-4000-8000-000000000001'
const ID = '40000000-0000-4000-8000-000000000001'
const pat = generateCredentialToken('agent_runner')
const minutes = generateCredentialToken('minutes_api')

function row(kind: 'agent_runner' | 'minutes_api' = 'agent_runner') {
  const token = kind === 'agent_runner' ? pat : minutes
  return {
    id: ID, workspace_id: W, kind, name: 'test', token_prefix: token.prefix, token_hash: token.hash,
    scopes: kind === 'agent_runner' ? ['work:read'] : [], project_ids: [P], default_project_id: P,
    default_team_id: null, team_map: {}, owner_user_id: kind === 'agent_runner' ? U : null,
    enabled: true, revoked_at: null, expires_at: '2099-01-01T00:00:00Z', workspaces: { archived_at: null },
  }
}

function request(token = pat.token) {
  return new Request('http://localhost/api/v1/agent/work', { headers: { authorization: `Bearer ${token}` } })
}

function db(data: unknown, options: { lookupError?: unknown; lookupThrow?: boolean; updateError?: unknown; updateThrow?: boolean } = {}) {
  const updateEq = vi.fn().mockReturnThis()
  const updated = {
    eq: updateEq,
    then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) =>
      (options.updateThrow ? Promise.reject(new Error('sensitive update error')) : Promise.resolve({ error: options.updateError ?? null }))
        .then(resolve, reject),
  }
  const maybeSingle = vi.fn(async () => {
    if (options.lookupThrow) throw new Error('sensitive lookup error')
    return { data, error: options.lookupError ?? null }
  })
  const eq = vi.fn().mockReturnThis()
  const select = vi.fn().mockReturnThis()
  const update = vi.fn(() => updated)
  const from = vi.fn(() => ({ select, eq, maybeSingle, update }))
  return { admin: { from } as never, from, eq, select, update, updateEq, maybeSingle }
}

beforeEach(() => {
  vi.stubEnv('AGENT_API_ENABLED', 'true')
  vi.stubEnv('MINUTES_API_ENABLED', 'true')
  vi.stubEnv('AGENT_API_SECRET', '')
  vi.stubEnv('MINUTES_API_SECRET', '')
  buildActor.mockReset()
  vi.mocked(requireModule).mockReset().mockResolvedValue({ ok: true })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

// 워크스페이스 보관(0056) — 토큰은 폐기하지 않고 인증 단계에서 거부한다(복원하면 다시 동작한다)
describe('resolveCredential — 보관된 워크스페이스', () => {
  const AT = '2026-10-10T00:00:00Z'
  it.each(['agent_runner', 'minutes_api'] as const)('%s — 맞는 토큰이어도 401, 사용 시각을 갱신하지 않는다', async kind => {
    const mock = db({ ...row(kind), workspaces: { archived_at: AT } })
    const result = await resolveCredential(request(kind === 'agent_runner' ? pat.token : minutes.token), mock.admin, kind)
    expect(result).toBeInstanceOf(NextResponse)
    expect((result as NextResponse).status).toBe(401)
    expect(await (result as NextResponse).json()).toEqual({ error: '인증이 필요합니다.', code: 'unauthorized' })   // 다른 인증 실패와 같은 응답 — 보관을 알리지 않는다
    expect(mock.update).not.toHaveBeenCalled()
  })
  it.each([
    ['임베드 null(워크스페이스 행이 안 보임)', null],
    ['임베드 없음', undefined],
    ['archived_at 없는 임베드', {}],
    ['배열 임베드의 보관 행', [{ archived_at: AT }]],
  ])('보관 시각을 읽지 못한 응답도 닫는다 — %s', async (_name, workspaces) => {
    const mock = db({ ...row(), workspaces })
    expect((await resolveCredential(request(), mock.admin, 'agent_runner') as NextResponse).status).toBe(401)
    expect(mock.update).not.toHaveBeenCalled()
  })
  it('보관 아님(archived_at null)은 통과한다 — 배열 임베드도', async () => {
    for (const workspaces of [{ archived_at: null }, [{ archived_at: null }]]) {
      const mock = db({ ...row(), workspaces })
      expect(await resolveCredential(request(), mock.admin, 'agent_runner')).toMatchObject({ id: ID, workspaceId: W })
    }
  })
  it('조회 열에 워크스페이스의 보관 시각을 싣는다', async () => {
    const mock = db(row())
    await resolveCredential(request(), mock.admin, 'agent_runner')
    expect(mock.select).toHaveBeenCalledWith(expect.stringContaining('workspaces(archived_at)'))
  })
  it('맞는 토큰의 보관 거부는 요청 제한의 실패로 세지 않는다 — 몇 번을 보내도 429 가 되지 않는다', async () => {
    for (let i = 0; i < 40; i++) {
      const mock = db({ ...row(), workspaces: { archived_at: AT } })
      expect((await resolveCredential(request(), mock.admin, 'agent_runner') as NextResponse).status, String(i)).toBe(401)
    }
  })
})

describe('resolveCredential — SP7 §5.1.3', () => {
  it.each(['agent_runner', 'minutes_api'] as const)('킬스위치 %s는 인증/DB 조회보다 먼저 404', async kind => {
    vi.stubEnv(kind === 'agent_runner' ? 'AGENT_API_ENABLED' : 'MINUTES_API_ENABLED', 'false')
    const mock = db(row(kind))
    const result = await resolveCredential(request(), mock.admin, kind)
    expect(result).toBeInstanceOf(NextResponse)
    expect((result as NextResponse).status).toBe(404)
    expect(mock.from).not.toHaveBeenCalled()
  })

  it.each(['', 'Basic abc', 'Bearer secret', `Bearer ${minutes.token}`])('잘못된 agent Bearer %s는 조회 없이 401', async auth => {
    const mock = db(row())
    const req = new Request('http://localhost', { headers: { authorization: auth } })
    expect((await resolveCredential(req, mock.admin, 'agent_runner') as NextResponse).status).toBe(401)
    expect(mock.from).not.toHaveBeenCalled()
  })

  it.each(['agent_runner', 'minutes_api'] as const)('%s 정상 인증은 해시/평문을 제외한 범위만 반환', async kind => {
    const mock = db(row(kind))
    const token = kind === 'agent_runner' ? pat : minutes
    const result = await resolveCredential(request(token.token), mock.admin, kind)
    expect(result).toMatchObject({ id: ID, workspaceId: W, kind, projectIds: [P], defaultProjectId: P })
    expect(result).not.toHaveProperty('token_hash')
    expect(JSON.stringify(result)).not.toContain(token.token)
    expect(JSON.stringify(result)).not.toContain(token.hash)
    expect(mock.from).toHaveBeenCalledWith('integration_credentials')
    expect(mock.eq.mock.calls).toEqual([['token_prefix', token.prefix], ['kind', kind]])
    expect(mock.update).toHaveBeenCalledOnce()
    expect(mock.updateEq.mock.calls).toEqual([['id', ID], ['workspace_id', W]])
  })

  it.each([
    ['없는 행', null],
    ['꺼짐', { ...row(), enabled: false }],
    ['비불리언 상태', { ...row(), enabled: 'true' }],
    ['회수', { ...row(), revoked_at: '2026-01-01T00:00:00Z' }],
    ['만료', { ...row(), expires_at: '2000-01-01T00:00:00Z' }],
    ['손상된 만료', { ...row(), expires_at: 'not-a-date' }],
    ['회수 열 누락', { ...row(), revoked_at: undefined }],
    ['해시 불일치', { ...row(), token_hash: 'f'.repeat(64) }],
    ['손상된 해시', { ...row(), token_hash: pat.hash + 'zz' }],
    ['유형 불일치', { ...row(), kind: 'minutes_api' }],
    ['prefix 불일치', { ...row(), token_prefix: 'wrong' }],
    ['워크스페이스 없음', { ...row(), workspace_id: null }],
    ['프로젝트 범위 누락', { ...row(), project_ids: undefined }],
    ['손상된 프로젝트 범위', { ...row(), project_ids: [null] }],
    ['허용 밖 기본 프로젝트', { ...row(), project_ids: [] }],
    ['손상된 스코프', { ...row(), scopes: [null] }],
    ['소유자 없음', { ...row(), owner_user_id: null }],
    ['손상된 팀 매핑', { ...row(), team_map: [] }],
    ['runner 팀 매핑', { ...row(), team_map: { DEV: P } }],
  ])('%s은 같은 401이며 사용 시각을 갱신하지 않는다', async (_name, data) => {
    const mock = db(data)
    const result = await resolveCredential(request(), mock.admin, 'agent_runner') as NextResponse
    expect(result.status).toBe(401)
    expect(await result.json()).toEqual({ code: 'unauthorized', error: '인증이 필요합니다.' })
    expect(mock.update).not.toHaveBeenCalled()
  })

  it.each([{ lookupError: { message: 'sensitive lookup error' } }, { lookupThrow: true }])('조회 장애는 401이며 DB 상세를 노출하지 않는다', async options => {
    const mock = db(row(), options)
    const result = await resolveCredential(request(), mock.admin, 'agent_runner') as NextResponse
    expect(result.status).toBe(401)
    expect(mock.update).not.toHaveBeenCalled()
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('sensitive lookup error')
  })

  it.each([{ updateError: { message: 'sensitive update error' } }, { updateThrow: true }])('사용 시각 갱신 장애는 인증 결과를 바꾸지 않는다', async options => {
    const mock = db(row(), options)
    expect(await resolveCredential(request(), mock.admin, 'agent_runner')).toMatchObject({ id: ID, workspaceId: W })
    expect(mock.update).toHaveBeenCalledOnce()
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('sensitive update error')
  })

  it('minutes 자격증명에 소유자/스코프/손상된 team_map이 있으면 거절한다', async () => {
    for (const data of [
      { ...row('minutes_api'), owner_user_id: U },
      { ...row('minutes_api'), scopes: ['work:read'] },
      { ...row('minutes_api'), team_map: { DEV: 'missing' } },
    ]) {
      const mock = db(data)
      expect((await resolveCredential(request(minutes.token), mock.admin, 'minutes_api') as NextResponse).status).toBe(401)
      expect(mock.update).not.toHaveBeenCalled()
    }
  })
})

describe('actorFromCredential', () => {
  const cred: ResolvedCredential = {
    id: ID, workspaceId: W, kind: 'agent_runner', name: 'test', tokenPrefix: pat.prefix,
    expiresAt: '2099-01-01T00:00:00Z', scopes: ['work:read'], projectIds: [P], defaultProjectId: P,
    defaultTeamId: null, teamMap: {}, ownerUserId: U,
  }
  const actor: Actor = {
    userId: U, isSuperuser: true, workspaceRoles: new Map([[W, 'member']]),
    projectWorkspace: new Map([[P, W]]), projectRoles: new Map([[P, 'member']]),
    memberIds: new Map(), rosterTeams: new Map(),
  }

  it('PAT는 payload의 다른 사용자 권한을 가져오지 않는다', async () => {
    await expect(actorFromCredential({} as never, cred, ID)).rejects.toThrow('토큰 소유자')
    expect(buildActor).not.toHaveBeenCalled()
  })

  it('매 요청 현재 권한을 조립하고 플랫폼 관리자 승격을 제거한다', async () => {
    const admin = {} as never
    buildActor.mockResolvedValueOnce(actor)
      .mockResolvedValueOnce({ ...actor, workspaceRoles: new Map() })
    expect(roleIn(await actorFromCredential(admin, cred, U), P)).toBe('member')
    expect(roleIn(await actorFromCredential(admin, cred, U), P)).toBeNull()
    expect(buildActor.mock.calls).toEqual([[admin, U], [admin, U]])
  })

  it('회의록 자격증명은 해석된 payload 사용자를 같은 워크스페이스로 제한한다', async () => {
    buildActor.mockResolvedValue(actor)
    expect(roleIn(await actorFromCredential({} as never, { ...cred, kind: 'minutes_api', ownerUserId: null, scopes: [] }, U), P))
      .toBe('member')
  })

  it('현재 권한 조회 장애는 권한 부여로 폴백하지 않는다', async () => {
    buildActor.mockRejectedValue(new Error('권한 조회 장애'))
    await expect(actorFromCredential({} as never, cred, U)).rejects.toThrow('권한 조회 장애')
  })

  it('스코프는 닫힌 집합이며 옛 work:report 토큰을 work:claim으로 수용한다', () => {
    expect(credentialHasScope(cred, 'work:read')).toBe(true)
    expect(credentialHasScope(cred, 'work:claim')).toBe(false)
    expect(credentialHasScope({ ...cred, scopes: ['work:report'] }, 'work:claim')).toBe(true)
    expect(credentialHasScope({ ...cred, kind: 'minutes_api' }, 'work:read')).toBe(false)
    expect(credentialHasScope({ ...cred, scopes: ['toString'] }, 'toString' as 'work:read')).toBe(false)
  })

  it('같은 자원도 토큰 범위/현재 역할/활성 모듈을 모두 통과해야 열린다', async () => {
    const admin = {} as never
    buildActor.mockResolvedValue(actor)
    expect(roleIn(await authorizeAgentCredentialProject(admin, cred, P, 'work:read') as Actor, P)).toBe('member')
    expect(requireModule).toHaveBeenCalledWith({ projectId: P }, 'agents', { client: admin })

    vi.mocked(requireModule).mockClear()
    expect((await authorizeAgentCredentialProject(admin, cred, ID, 'work:read') as NextResponse).status).toBe(404)
    expect(requireModule).not.toHaveBeenCalled()
    expect((await authorizeAgentCredentialProject(admin, cred, P, 'work:claim') as NextResponse).status).toBe(403)
    expect(requireModule).not.toHaveBeenCalled()

    buildActor.mockResolvedValue({ ...actor, projectRoles: new Map() })
    expect((await authorizeAgentCredentialProject(admin, cred, P, 'work:read') as NextResponse).status).toBe(404)
    expect(requireModule).not.toHaveBeenCalled()

    buildActor.mockResolvedValue(actor)
    vi.mocked(requireModule).mockResolvedValue({ ok: false, error: 'ERR_MODULE_DISABLED' })
    expect((await authorizeAgentCredentialProject(admin, cred, P, 'work:read') as NextResponse).status).toBe(404)
  })

  it('구조 쓰기는 현재 관리자만 통과하며 플랫폼 관리자 비트만으로 열리지 않는다', async () => {
    buildActor.mockResolvedValue(actor)
    expect((await authorizeAgentCredentialProject({} as never, cred, P, 'work:read', { requireAdmin: true }) as NextResponse).status).toBe(404)
    expect(requireModule).not.toHaveBeenCalled()
    buildActor.mockResolvedValue({ ...actor, workspaceRoles: new Map([[W, 'admin']]) })
    expect(roleIn(await authorizeAgentCredentialProject({} as never, cred, P, 'work:read', { requireAdmin: true }) as Actor, P))
      .toBe('admin')
  })

  it('같은 자격증명에서 현재 권한을 다시 조회하고 타 워크스페이스 자원은 모듈 판정 전에 숨긴다', async () => {
    buildActor.mockResolvedValue({ ...actor, projectWorkspace: new Map([[P, ID]]) })
    expect((await authorizeAgentCredentialProject({} as never, cred, P, 'work:read') as NextResponse).status).toBe(404)
    expect(requireModule).not.toHaveBeenCalled()
  })
})
