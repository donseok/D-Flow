import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/** GET /api/v1/wbs/structure — PL 스킬의 서버 직조회 원천(스펙 §import 계약 v2.2).
 *  levels 정본 + 얕은 노드(기본 depth≤2 = Phase·System)를 돌려준다. */

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
// levels 정본은 해석기(R3) — 라우트는 설정 표를 직접 읽지 않는다
// max_depth 는 levelDepthOf 한 함수로 낸다(§9 #1 대안 전환 비용을 한 곳에 — FM-10). 실물을 감싸 부른 것을 본다
const cfg = vi.hoisted(() => ({ getProjectConfig: vi.fn(), levelDepthOf: vi.fn() }))
vi.mock('@/lib/settings/projectConfig', async (importOriginal) => {
  const real = (await importOriginal<typeof import('@/lib/settings/projectConfig')>()).levelDepthOf
  return { getProjectConfig: cfg.getProjectConfig, levelDepthOf: (c: never) => (cfg.levelDepthOf(c) as number | undefined) ?? real(c) }
})

import { GET as structureGET } from '@/app/api/v1/wbs/structure/route'
import { axes, credAxes, roster, rosterRow } from '../fixtures/actorQueues'
import { agentCredential, ownerLookup } from '../fixtures/credentials'
import { makeProjectConfig } from '../helpers/projectConfigFixture'
import { ConfigUnavailableError, ERR_CONFIG_INVALID } from '@/lib/settings/errors'
import { moduleState, projectsWithModule, requireModule, requireSessionModule, workspacesWithModule } from '@/lib/modules/gate'
import { ERR_MODULE_DISABLED } from '@/lib/authz/errors'

const LEGACY_SECRET = 'legacy-secret'
const PL = { email: 'pl@example.com' } // 토큰 소유자

type Resp = { data?: unknown; error?: { message: string } | null; count?: number | null }

function useAdmin(queues: Record<string, Resp[]>) {
  const admin = {
    from: vi.fn((table: string) => {
      const resp = (queues[table] ?? []).shift() ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'update', 'eq', 'in', 'order', 'limit', 'range']) b[k] = () => b
      b.maybeSingle = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.then = (r: (v: unknown) => unknown) =>
        Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null, count: resp.count ?? null }).then(r)
      return b
    }),
    auth: { admin: { getUserById: vi.fn(ownerLookup(undefined, PL.email)) } },
  }
  mocks.createAdminClient.mockReturnValue(admin)
  return admin
}
/** 루프·보조 함수 안에서 부르는 별칭 — 이름이 use 로 시작하면 훅 규칙(react-hooks/rules-of-hooks)이 오탐한다. */
const seedAdmin = useAdmin

const PROJECT_ID = '87654321-4321-4321-4321-987654321def'

/** 인증 원천은 integration_credentials(agent_runner) 행 하나다(SP7 §5.1.4) — 케이스마다 새 토큰과 그 행을 만든다. */
function patRow(scopes: string[] = ['work:read']) {
  const cred = agentCredential({ scopes })
  return { token: cred.token, row: cred.row }
}

function get(qs: string, bearer: string) {
  return new NextRequest(`http://l/api/v1/wbs/structure?${qs}`, {
    headers: { Authorization: `Bearer ${bearer}` },
  })
}

/** 골격 트리 픽스처 — PH-03(depth0) > SYS-OP(depth1) > SUB-OP-EV(depth2) > TSK(depth3) */
const TREE = [
  { id: 'n1', parent_id: null, name: '구축', external_ref: 'acme-skel/PH-03', level_idx: 0, sort_order: 2 },
  { id: 'n2', parent_id: 'n1', name: '생산운영', external_ref: 'acme-skel/SYS-OP', level_idx: 1, sort_order: 3 },
  { id: 'n3', parent_id: 'n2', name: '생산이벤트', external_ref: 'acme-op/SUB-OP-EV', level_idx: 2, sort_order: 0 },
  { id: 'n4', parent_id: 'n3', name: '수집 프로세스', external_ref: 'acme-op/TSK-OP-EV-PR-01', level_idx: 5, sort_order: 1 },
]

beforeEach(() => {
  process.env.AGENT_API_ENABLED = 'true'
  delete process.env.AGENT_API_SECRET
  vi.clearAllMocks()
})
// 모듈 거부 케이스가 바꾼 전역 관문 mock 을 통과 구현으로 되돌린다(공통 규칙)
afterEach(() => { for (const f of [requireModule, requireSessionModule, moduleState, projectsWithModule, workspacesWithModule]) vi.mocked(f).mockReset() })

describe('GET /wbs/structure', () => {
  it('PAT 멤버 → levels + depth≤1(기본) 노드, parent 는 external_ref 로', async () => {
    const { token, row } = patRow()
    useAdmin({
      integration_credentials: [{ data: row }, { data: null }],
      project_members: [roster(rosterRow(PROJECT_ID, 'member'))],
      ...credAxes([PROJECT_ID]),
      wbs_items: [{ data: TREE }],
    })
    cfg.getProjectConfig.mockResolvedValue(makeProjectConfig({ 'core.level_labels': ['Phase', 'System', 'Subsystem', 'WP', 'Activity', 'Task', 'SubTask'] }))
    const res = await structureGET(get(`project_id=${PROJECT_ID}`, token))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.levels).toEqual(['Phase', 'System', 'Subsystem', 'WP', 'Activity', 'Task', 'SubTask'])
    expect(json.max_depth).toBe(7)   // 단계 이름 수(§9 #1)
    expect(cfg.getProjectConfig).toHaveBeenCalledWith(PROJECT_ID, { client: expect.anything() })
    expect(json.nodes).toEqual([
      { id: 'n1', external_ref: 'acme-skel/PH-03', name: '구축', parent_external_ref: null, depth: 0, level_idx: 0 },
      { id: 'n2', external_ref: 'acme-skel/SYS-OP', name: '생산운영', parent_external_ref: 'acme-skel/PH-03', depth: 1, level_idx: 1 },
    ])
  })

  it('max_depth=2 → Subsystem 층까지 확장', async () => {
    const { token, row } = patRow()
    useAdmin({
      integration_credentials: [{ data: row }, { data: null }],
      project_members: [roster(rosterRow(PROJECT_ID, 'member'))],
      ...credAxes([PROJECT_ID]),
      wbs_items: [{ data: TREE }],
    })
    cfg.getProjectConfig.mockResolvedValue(makeProjectConfig({ 'core.level_labels': ['A', 'B', 'C'] }))
    const res = await structureGET(get(`project_id=${PROJECT_ID}&max_depth=2`, token))
    const json = await res.json()
    expect(json.max_depth).toBe(3)
    expect(json.nodes).toHaveLength(3)
    expect(json.nodes[2]).toMatchObject({ external_ref: 'acme-op/SUB-OP-EV', depth: 2 })
  })

  it('비멤버 PAT → 404 (존재 은닉)', async () => {
    const { token, row } = patRow()
    useAdmin({
      integration_credentials: [{ data: row }, { data: null }],
      project_members: [{ data: [] }],
      ...credAxes([PROJECT_ID]),
    })
    const res = await structureGET(get(`project_id=${PROJECT_ID}`, token))
    expect(res.status).toBe(404)
  })

  it('비멤버 → 404 이고 설정은 읽지 않는다(호출자의 워크스페이스 밖 프로젝트 설정을 내지 않는다)', async () => {
    const { token, row } = patRow()
    useAdmin({ integration_credentials: [{ data: row }, { data: null }], project_members: [roster()], ...axes([]) })
    const res = await structureGET(get(`project_id=${PROJECT_ID}`, token))
    expect(res.status).toBe(404)
    expect(cfg.getProjectConfig).not.toHaveBeenCalled()
  })

  it('설정 조회 실패는 500(apiInternalError)·필수 라벨 없음은 levels·max_depth null', async () => {
    const useMemberToken = () => {
      const { token, row } = patRow()
      useAdmin({
        integration_credentials: [{ data: row }, { data: null }],
        project_members: [roster(rosterRow(PROJECT_ID, 'member'))],
        ...credAxes([PROJECT_ID]),
        wbs_items: [{ data: TREE }],
      })
      return token
    }
    cfg.getProjectConfig.mockRejectedValueOnce(new ConfigUnavailableError('x'))
    let res = await structureGET(get(`project_id=${PROJECT_ID}`, useMemberToken()))
    expect(res.status).toBe(500)
    cfg.getProjectConfig.mockResolvedValueOnce(makeProjectConfig({}))     // required_missing
    res = await structureGET(get(`project_id=${PROJECT_ID}`, useMemberToken()))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.levels).toBeNull()
    expect(json.max_depth).toBeNull()
  })

  it('단계 이름 설정이 손상(invalid)이면 null 로 합치지 않고 422 config_invalid — 원인 키는 로그(C2-F2)', async () => {
    const { token, row } = patRow()
    useAdmin({
      integration_credentials: [{ data: row }, { data: null }],
      project_members: [roster(rosterRow(PROJECT_ID, 'member'))],
      ...credAxes([PROJECT_ID]),
      wbs_items: [{ data: TREE }],
    })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    cfg.getProjectConfig.mockResolvedValue(makeProjectConfig({ 'core.level_labels': 'not-a-list' }))
    spy.mockClear()   // 픽스처(해석기)가 남긴 '[settings] invalid' 로그를 비운다 — 아래 단언은 라우트 자신의 로그만 본다
    const res = await structureGET(get(`project_id=${PROJECT_ID}`, token))
    const calls = [...spy.mock.calls]
    spy.mockRestore()
    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.code).toBe('config_invalid')
    expect(json.error).toBe(ERR_CONFIG_INVALID)
    expect(json.levels).toBeUndefined()
    expect(calls).toContainEqual(['[wbs-structure] 설정 손상:', expect.objectContaining({ projectId: PROJECT_ID, key: 'core.level_labels' })])
  })

  it('work:read 스코프 없음 → 403 insufficient_scope', async () => {
    const { token, row } = patRow(['work:report'])
    useAdmin({ integration_credentials: [{ data: row }, { data: null }] })
    const res = await structureGET(get(`project_id=${PROJECT_ID}`, token))
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('insufficient_scope')
  })

  it('project_id 없음 → 400', async () => {
    const { token } = patRow()
    const res = await structureGET(get('', token))
    expect(res.status).toBe(400)
  })

  it('agents 모듈이 꺼지면 404 이고 트리를 읽지 않는다(과제 18)', async () => {
    const { token, row } = patRow()
    const admin = useAdmin({
      integration_credentials: [{ data: row }, { data: null }],
      project_members: [roster(rosterRow(PROJECT_ID, 'member'))],
      ...credAxes([PROJECT_ID]),
      wbs_items: [{ data: TREE }],
    })
    vi.mocked(requireModule).mockResolvedValueOnce({ ok: false, error: ERR_MODULE_DISABLED })
    const res = await structureGET(get(`project_id=${PROJECT_ID}`, token))
    expect(res.status).toBe(404)
    expect(requireModule).toHaveBeenCalledWith({ projectId: PROJECT_ID }, 'agents', { client: admin })
    expect(admin.from).not.toHaveBeenCalledWith('wbs_items')
  })
})

// 옛 describe 'GET /wbs/structure — 레거시 시크릿 호출의 신원' 의 후신 — 시크릿 principal 과 그 `?user_email=` 신원은 삭제됐다(SP7 §5.1.4).
// 신원은 토큰 소유자 하나이고, 워크스페이스 경계는 자격증명이 가진다.
describe('GET /wbs/structure — 옛 시크릿 호출은 닫히고, 신원은 토큰 소유자다', () => {
  beforeEach(() => { process.env.AGENT_API_SECRET = LEGACY_SECRET })
  const memberQueues = (row: unknown) => ({
    integration_credentials: [{ data: row }, { data: null }],
    ...credAxes([PROJECT_ID]), project_members: [roster(rosterRow(PROJECT_ID, 'member'))],
    wbs_items: [{ data: TREE }],
  })

  // 옛 케이스 'user_email 없이 시크릿만 → 400 identity_required' 와 '멤버 user_email → 200' 의 후신 — 둘 다 401 이다.
  it('옛 시크릿 값 Bearer → 401 — env 에 AGENT_API_SECRET 이 있고 멤버 user_email 을 붙여도 WBS 트리를 읽지 못한다', async () => {
    for (const qs of ['', `&user_email=${PL.email}`]) {
      const admin = seedAdmin(memberQueues(patRow().row))
      const res = await structureGET(get(`project_id=${PROJECT_ID}${qs}`, LEGACY_SECRET))
      expect(res.status).toBe(401)
      expect((await res.json()).code).toBe('unauthorized')
      expect(admin.from).not.toHaveBeenCalled()
      expect(cfg.getProjectConfig).not.toHaveBeenCalled()
    }
  })

  // 옛 케이스 '비멤버 user_email → 404' 의 후신 — 소유자가 그 프로젝트의 명단 member 여도 소속·프로젝트가 자격증명 워크스페이스 밖이면 닫힌다.
  it('자격증명 워크스페이스 밖 프로젝트 → 404 — 명단 member 여도 다른 워크스페이스 프로젝트의 트리를 주지 않는다', async () => {
    const { token, row } = patRow()
    const admin = useAdmin({
      integration_credentials: [{ data: row }, { data: null }],
      ...axes([PROJECT_ID]), project_members: [roster(rosterRow(PROJECT_ID, 'member'))], // 소속·프로젝트가 기본 WS('ws-1')
      wbs_items: [{ data: TREE }],
    })
    const res = await structureGET(get(`project_id=${PROJECT_ID}`, token))
    expect(res.status).toBe(404)
    expect(await res.text()).not.toContain('생산운영')
    expect(admin.from).not.toHaveBeenCalledWith('wbs_items')
    expect(cfg.getProjectConfig).not.toHaveBeenCalled()
  })

  it('멤버인 토큰 소유자 → 200(env 의 옛 시크릿 유무와 무관)', async () => {
    const { token, row } = patRow()
    useAdmin(memberQueues(row))
    cfg.getProjectConfig.mockResolvedValue(makeProjectConfig({ 'core.level_labels': ['Phase', 'System'] }))
    const res = await structureGET(get(`project_id=${PROJECT_ID}`, token))
    expect(res.status).toBe(200)
    expect((await res.json()).max_depth).toBe(2)
  })

  it('응답의 max_depth 는 levelDepthOf 가 낸다 — 라우트에 규칙을 다시 쓰지 않는다(FM-10)', async () => {
    const { token, row } = patRow()
    useAdmin(memberQueues(row))
    cfg.getProjectConfig.mockResolvedValue(makeProjectConfig({ 'core.level_labels': ['Phase', 'System'] }))
    cfg.levelDepthOf.mockReturnValueOnce(42)
    const res = await structureGET(get(`project_id=${PROJECT_ID}`, token))
    expect((await res.json()).max_depth).toBe(42)
    expect(cfg.levelDepthOf).toHaveBeenCalledTimes(1)
  })
})
