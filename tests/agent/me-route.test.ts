import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn(), buildActor: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
// PAT 소유자의 권한 스냅샷은 fixture 로 준다 — 실구현(buildActor)은 테이블 큐를 소비해 버린다. 라우트는 이 스냅샷을 자격증명 범위로
// 좁혀(actorFromCredential) 한 번만 쓴다 — 프로젝트마다 다시 조립하지 않는지 호출 횟수로 단언한다.
vi.mock('@/lib/authz/buildActor', () => ({ buildActor: mocks.buildActor }))

import { GET as meGET } from '@/app/api/v1/agent/me/route'
import type { Actor, ProjectRole } from '@/lib/domain/authz'
import { makeActor as baseActor } from '../fixtures/actor'
import { agentCredential, CRED_OWNER, CRED_WS, ownerLookup } from '../fixtures/credentials'
import { moduleState, projectsWithModule, requireModule, requireSessionModule, workspacesWithModule } from '@/lib/modules/gate'

const P1 = '11111111-1111-4111-8111-111111111111'
const P2 = '22222222-2222-4222-8222-222222222222'
type Resp = { data?: unknown; error?: { message: string } | null; count?: number | null }
// 인증 원천은 integration_credentials(agent_runner) 행 하나다(SP7 §5.1.4). 후보 프로젝트는 자격증명 워크스페이스의 projects 이고
// 옛 원천(agent_projects 등록 행·agent_runners)은 읽지 않는다.
const RUNNER = agentCredential({ name: '맥북 에어', scopes: ['work:read'] })
const PAT = { token: RUNNER.token, prefix: RUNNER.prefix }
const LEGACY_SECRET = 'legacy-secret'
const WS = CRED_WS
const U = CRED_OWNER
/** 소유자 스냅샷 — 기본 소속은 자격증명 워크스페이스의 member */
const makeActor = (over: Partial<Actor> = {}) => baseActor({ userId: U, workspaceRoles: new Map([[WS, 'member']]), ...over })
function useAdmin(queues: Record<string, Resp[]>, calls: Array<[string, string, unknown[]]> = []) {
  const admin = {
    from: vi.fn((table: string) => {
      const resp = (queues[table] ?? []).shift() ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'update', 'eq', 'in', 'limit', 'order', 'range']) b[k] = (...a: unknown[]) => { calls.push([table, k, a]); return b }
      b.maybeSingle = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      // 등록 조회는 페이지 + count 총합 대조(fetchAllPages) — 배열 응답에는 count 를 싣는다
      b.then = (r: (v: unknown) => unknown) => Promise.resolve({
        data: resp.data ?? null, error: resp.error ?? null,
        count: resp.count ?? (Array.isArray(resp.data) ? resp.data.length : null),
      }).then(r)
      return b
    }),
    auth: { admin: { getUserById: vi.fn(ownerLookup()) } },
  }
  mocks.createAdminClient.mockReturnValue(admin)
  return admin
}
const get = (bearer: string) => new NextRequest('http://l/api/v1/agent/me', { headers: { Authorization: `Bearer ${bearer}` } })
/** 자격증명 워크스페이스의 프로젝트 행(id·이름) — me 는 projects 를 workspace_id 로 좁혀 페이지로 읽는다 */
const prj = (id: string, name: string) => ({ id, name })
const creds = (runner = RUNNER) => ({ integration_credentials: runner.queue() })

beforeEach(() => {
  process.env.AGENT_API_ENABLED = 'true'
  process.env.AGENT_API_SECRET = LEGACY_SECRET // 설정돼 있어도 인증에 쓰이지 않는다(SP7)
  vi.clearAllMocks()
  // 기본: 소유자는 WS 의 두 프로젝트를 볼 수 있다(P1·P2 둘 다 내 워크스페이스).
  mocks.buildActor.mockResolvedValue(makeActor({ projectWorkspace: new Map([[P1, WS], [P2, WS]]) }))
})
// 목록 거르기 케이스가 바꾼 전역 관문 mock 을 통과 구현으로 되돌린다(공통 규칙)
afterEach(() => { for (const f of [requireModule, requireSessionModule, moduleState, projectsWithModule, workspacesWithModule]) vi.mocked(f).mockReset() })

describe('GET /agent/me', () => {
  it('PAT → 소유자·스코프·contract_version + 멤버인 프로젝트만', async () => {
    // 워크스페이스 프로젝트 2건 중 명단 권한은 P1(admin) 만 — P2 는 같은 워크스페이스의 조회 전용이라 싣지 않는다.
    mocks.buildActor.mockResolvedValue(makeActor({
      projectWorkspace: new Map([[P1, WS], [P2, WS]]), projectRoles: new Map<string, ProjectRole>([[P1, 'admin']]),
    }))
    const admin = useAdmin({ ...creds(), projects: [{ data: [prj(P1, '테스트'), prj(P2, '남의것')] }] })
    const res = await meGET(get(PAT.token))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.user_email).toBe('dev@example.com')
    // 계약 2.4 — 토큰이 여럿일 때 "이 키가 무엇인지" 를 알려 주는 두 필드
    expect(body.token_name).toBe('맥북 에어')
    expect(body.token_prefix).toBe(PAT.prefix)
    expect(body.contract_version).toBe('2.4')
    expect(body.kind).toBe('user_pat')
    expect(body.scopes).toEqual(['work:read'])
    expect(body.projects).toEqual([{ id: P1, name: '테스트', role: 'admin' }])
    // 스냅샷은 한 번만 조립한다 — 프로젝트마다 다시 만들지 않는다(N+1 제거).
    expect(mocks.buildActor).toHaveBeenCalledTimes(1)
    expect(mocks.buildActor).toHaveBeenCalledWith(expect.anything(), U)
    // 모듈 판정은 역할 판정 뒤다 — 조회 전용(P2)의 설정은 읽지 않는다
    // 자격증명 워크스페이스를 넘겨 한 번에 판정한다 — 프로젝트마다 설정을 따로 읽지 않는다(SP7)
    expect(projectsWithModule).toHaveBeenCalledTimes(1)
    expect(projectsWithModule).toHaveBeenCalledWith([P1], 'agents', { client: expect.anything(), workspaceId: WS })
    expect(admin.from).not.toHaveBeenCalledWith('agent_runners')
    expect(admin.from).not.toHaveBeenCalledWith('agent_projects')
  })
  it('소유자의 워크스페이스 밖 프로젝트는 명단이 있어도 싣지 않는다 — 조회를 자격증명 워크스페이스로 좁힌다', async () => {
    // P2 는 다른 워크스페이스의 프로젝트 — 명단 admin 행이 있어도 자격증명 범위로 좁힌 스냅샷에 없다.
    mocks.buildActor.mockResolvedValue(makeActor({
      workspaceRoles: new Map([[WS, 'member'], ['ws-other', 'admin']]),
      projectWorkspace: new Map([[P1, WS], [P2, 'ws-other']]),
      projectRoles: new Map<string, ProjectRole>([[P1, 'admin'], [P2, 'admin']]),
    }))
    const calls: Array<[string, string, unknown[]]> = []
    // DB 필터가 새도(P2 가 섞여 와도) 스냅샷 키로 한 번 더 거른다.
    useAdmin({ ...creds(), projects: [{ data: [prj(P1, '테스트'), prj(P2, '남의것')] }] }, calls)
    const body = await (await meGET(get(PAT.token))).json()
    expect(body.projects.map((p: { id: string }) => p.id)).toEqual([P1])
    expect(calls).toContainEqual(['projects', 'eq', ['workspace_id', WS]])
    expect(mocks.buildActor).toHaveBeenCalledWith(expect.anything(), U)
  })
  it('자격증명의 project_ids 밖 프로젝트는 명단 admin 이어도 싣지 않는다', async () => {
    mocks.buildActor.mockResolvedValue(makeActor({
      projectWorkspace: new Map([[P1, WS], [P2, WS]]), projectRoles: new Map<string, ProjectRole>([[P1, 'admin'], [P2, 'admin']]),
    }))
    useAdmin({ ...creds(RUNNER.with({ project_ids: [P2] })), projects: [{ data: [prj(P1, '테스트'), prj(P2, '허용')] }] })
    const body = await (await meGET(get(PAT.token))).json()
    expect(body.projects).toEqual([{ id: P2, name: '허용', role: 'admin' }])
  })
  it('플랫폼 관리자가 발급한 토큰도 승격이 없다 — 명단이 없는 프로젝트는 싣지 않는다', async () => {
    mocks.buildActor.mockResolvedValue(makeActor({
      isSuperuser: true, projectWorkspace: new Map([[P1, WS], [P2, WS]]), projectRoles: new Map<string, ProjectRole>([[P1, 'member']]),
    }))
    useAdmin({ ...creds(), projects: [{ data: [prj(P1, '테스트'), prj(P2, '남의것')] }] })
    const body = await (await meGET(get(PAT.token))).json()
    expect(body.projects).toEqual([{ id: P1, name: '테스트', role: 'member' }])
  })
  // 프로젝트 id 목록을 .in() 으로 URL 에 실으면 약 205개부터 게이트웨이가 414 로 거절해 whoami 가 늘 500 이 된다(SP2 최종 리뷰 ERR-4).
  it('프로젝트 300개인 소유자 — id 목록 필터 없이 워크스페이스로 좁히고 메모리에서 거른다', async () => {
    const pids = Array.from({ length: 300 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`)
    mocks.buildActor.mockResolvedValue(makeActor({
      projectWorkspace: new Map(pids.map(pid => [pid, WS])),
      projectRoles: new Map<string, ProjectRole>(pids.map(pid => [pid, 'member'])),
    }))
    const calls: Array<[string, string, unknown[]]> = []
    useAdmin({ ...creds(), projects: [{ data: [prj(pids[0], '하나'), prj(pids[299], '마지막')] }] }, calls)
    const res = await meGET(get(PAT.token))
    expect(res.status).toBe(200)
    expect((await res.json()).projects.map((p: { id: string }) => p.id)).toEqual([pids[0], pids[299]])
    // id 목록은 어디에도 싣지 않는다 — in 필터가 하나도 없고 프로젝트 조회의 필터는 워크스페이스 eq 하나뿐이다
    expect(calls.filter(([, k]) => k === 'in')).toEqual([])
    expect(calls.filter(([t, k]) => t === 'projects' && k === 'eq').map(([, , a]) => a)).toEqual([['workspace_id', WS]])
  })
  it('볼 수 있는 프로젝트가 없으면 프로젝트 조회 없이 빈 목록', async () => {
    mocks.buildActor.mockResolvedValue(makeActor())
    const admin = useAdmin({ ...creds() })
    const body = await (await meGET(get(PAT.token))).json()
    expect(body.projects).toEqual([])
    expect(admin.from.mock.calls.map(c => c[0])).not.toContain('projects')
    expect(admin.from.mock.calls.map(c => c[0])).not.toContain('agent_projects')
  })
  it('소유자 권한 조회 실패는 500 — 빈 목록으로 위장하지 않는다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.buildActor.mockRejectedValue(new Error('권한 정보를 불러오지 못했습니다'))
    useAdmin({ ...creds() })
    expect((await meGET(get(PAT.token))).status).toBe(500)
    spy.mockRestore()
  })
  it('프로젝트 조회 실패는 500 — 빈 목록으로 위장하지 않는다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    useAdmin({ ...creds(), projects: [{ data: null, error: { message: 'db down' } }] })
    expect((await meGET(get(PAT.token))).status).toBe(500)
    spy.mockRestore()
  })
  // 옛 케이스 'legacy 시크릿 호출 → 400 identity_required' 의 후신 — 시크릿 principal 이 삭제돼 인증 실패다.
  it('옛 시크릿 값 Bearer → 401 — env 에 AGENT_API_SECRET 이 있어도, 어느 표도 읽지 않는다', async () => {
    const admin = useAdmin({ ...creds() })
    const res = await meGET(get(LEGACY_SECRET))
    expect(res.status).toBe(401)
    expect((await res.json()).code).toBe('unauthorized')
    expect(admin.from).not.toHaveBeenCalled()
    expect(mocks.buildActor).not.toHaveBeenCalled()
  })

  it('agents 모듈이 꺼진 프로젝트는 목록에서 빠진다(과제 18 — 스펙 §4.2 목록형, E2E 4단계)', async () => {
    mocks.buildActor.mockResolvedValue(makeActor({
      projectWorkspace: new Map([[P1, WS], [P2, WS]]), projectRoles: new Map<string, ProjectRole>([[P1, 'admin'], [P2, 'member']]),
    }))
    useAdmin({ ...creds(), projects: [{ data: [prj(P1, '테스트'), prj(P2, '꺼진것')] }] })
    vi.mocked(projectsWithModule).mockResolvedValueOnce([P1])
    const body = await (await meGET(get(PAT.token))).json()
    expect(body.projects.map((p: { id: string }) => p.id)).toEqual([P1])
    expect(projectsWithModule).toHaveBeenCalledWith([P1, P2], 'agents', { client: expect.anything(), workspaceId: WS })
  })
})
