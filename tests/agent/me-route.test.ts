import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { generateAgentToken } from '@/lib/agent/token'

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn(), actorFromUser: vi.fn(), buildActor: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
// PAT 소유자의 권한 스냅샷은 fixture 로 준다 — 실구현(buildActor)은 테이블 큐를 소비해 버린다.
vi.mock('@/lib/authz', () => ({ actorFromUser: mocks.actorFromUser }))
// 프로젝트별 역할은 라우트의 스냅샷으로 판정한다 — buildActor 를 다시 부르지 않는지 단언하려고 mock 한다.
vi.mock('@/lib/authz/buildActor', () => ({ buildActor: mocks.buildActor }))

import { GET as meGET } from '@/app/api/v1/agent/me/route'
import type { ProjectRole } from '@/lib/domain/authz'
import { makeActor, WS } from '../fixtures/actor'

const P1 = '11111111-1111-4111-8111-111111111111'
const P2 = '22222222-2222-4222-8222-222222222222'
type Resp = { data?: unknown; error?: { message: string } | null }
const PAT = generateAgentToken()
const RUNNER = {
  id: 'r-1', kind: 'user_pat', owner_user_id: 'u-1', name: '맥북 에어', token_prefix: PAT.prefix,
  token_hash: PAT.hash, project_id: null, scopes: ['work:read'], enabled: true,
  revoked_at: null, expires_at: '2099-01-01T00:00:00Z',
}
function useAdmin(queues: Record<string, Resp[]>, calls: Array<[string, string, unknown[]]> = []) {
  const admin = {
    from: vi.fn((table: string) => {
      const resp = (queues[table] ?? []).shift() ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'update', 'eq', 'in', 'limit', 'order']) b[k] = (...a: unknown[]) => { calls.push([table, k, a]); return b }
      b.maybeSingle = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.then = (r: (v: unknown) => unknown) =>
        Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null }).then(r)
      return b
    }),
    auth: { admin: { getUserById: vi.fn(async () => ({ data: { user: { id: 'u-1', email: 'dev@example.com' } }, error: null })) } },
  }
  mocks.createAdminClient.mockReturnValue(admin)
  return admin
}
const get = (bearer: string) => new NextRequest('http://l/api/v1/agent/me', { headers: { Authorization: `Bearer ${bearer}` } })

beforeEach(() => {
  process.env.AGENT_API_ENABLED = 'true'
  process.env.AGENT_API_SECRET = 'legacy-secret'
  vi.clearAllMocks()
  // 기본: 소유자는 WS 의 두 프로젝트를 볼 수 있다(P1·P2 둘 다 내 워크스페이스).
  mocks.actorFromUser.mockResolvedValue(makeActor({ userId: 'u-1', projectWorkspace: new Map([[P1, WS], [P2, WS]]) }))
})

describe('GET /agent/me', () => {
  it('PAT → 소유자·스코프·contract_version + 멤버인 enabled 프로젝트만', async () => {
    // enabled 프로젝트 2건 중 명단 권한은 P1(admin) 만 — P2 는 같은 워크스페이스의 조회 전용이라 싣지 않는다.
    mocks.actorFromUser.mockResolvedValue(makeActor({
      userId: 'u-1', projectWorkspace: new Map([[P1, WS], [P2, WS]]), projectRoles: new Map<string, ProjectRole>([[P1, 'admin']]),
    }))
    useAdmin({
      agent_runners: [{ data: RUNNER }, { data: null }],
      agent_projects: [{ data: [{ project_id: P1 }, { project_id: P2 }] }],
      projects: [{ data: [{ id: P1, name: '테스트' }, { id: P2, name: '남의것' }] }],
    })
    const res = await meGET(get(PAT.token))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.user_email).toBe('dev@example.com')
    // 계약 2.4 — 토큰이 여럿일 때 "이 키가 무엇인지" 를 알려 주는 두 필드
    expect(body.token_name).toBe('맥북 에어')
    expect(body.token_prefix).toBe(PAT.prefix)
    expect(body.contract_version).toBe('2.4')
    expect(body.projects).toHaveLength(1)
    expect(body.projects[0]).toMatchObject({ id: P1, role: 'admin' })
    // 스냅샷은 한 번만 조립한다 — 프로젝트마다 다시 만들지 않는다(N+1 제거).
    expect(mocks.actorFromUser).toHaveBeenCalledTimes(1)
    expect(mocks.buildActor).not.toHaveBeenCalled()
  })
  it('소유자의 워크스페이스 밖 프로젝트는 enabled·명단이 있어도 싣지 않는다 — 조회를 내 프로젝트 id 로 좁힌다', async () => {
    // P2 명단 admin 행이 있어도 스냅샷(내 워크스페이스)에 없는 프로젝트다.
    mocks.actorFromUser.mockResolvedValue(makeActor({
      userId: 'u-1', projectWorkspace: new Map([[P1, WS]]),
      projectRoles: new Map<string, ProjectRole>([[P1, 'admin'], [P2, 'admin']]),
    }))
    const calls: Array<[string, string, unknown[]]> = []
    useAdmin({
      agent_runners: [{ data: RUNNER }, { data: null }],
      // DB 필터가 새도(P2 가 섞여 와도) 스냅샷 키로 한 번 더 거른다.
      agent_projects: [{ data: [{ project_id: P1 }, { project_id: P2 }] }],
      projects: [{ data: [{ id: P1, name: '테스트' }] }],
    }, calls)
    const body = await (await meGET(get(PAT.token))).json()
    expect(body.projects.map((p: { id: string }) => p.id)).toEqual([P1])
    expect(calls).toContainEqual(['agent_projects', 'in', ['project_id', [P1]]])
    expect(mocks.actorFromUser).toHaveBeenCalledWith(expect.anything(), 'u-1')
  })
  it('볼 수 있는 프로젝트가 없으면 등록 조회 없이 빈 목록', async () => {
    mocks.actorFromUser.mockResolvedValue(makeActor({ userId: 'u-1' }))
    const admin = useAdmin({ agent_runners: [{ data: RUNNER }, { data: null }] })
    const body = await (await meGET(get(PAT.token))).json()
    expect(body.projects).toEqual([])
    expect(admin.from.mock.calls.map(c => c[0])).not.toContain('agent_projects')
  })
  it('소유자 권한 조회 실패는 500 — 빈 목록으로 위장하지 않는다', async () => {
    mocks.actorFromUser.mockRejectedValue(new Error('권한 정보를 불러오지 못했습니다'))
    useAdmin({ agent_runners: [{ data: RUNNER }, { data: null }] })
    expect((await meGET(get(PAT.token))).status).toBe(500)
  })
  it('legacy 시크릿 호출 → 400 identity_required', async () => {
    useAdmin({})
    const res = await meGET(get('legacy-secret'))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('identity_required')
  })
})
