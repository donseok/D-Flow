// tests/data/agent-hub.test.ts
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
import { fetchAgentHubRows, getAgentHub } from '@/lib/data/agentHub'
import { moduleState, projectsWithModule, requireModule, requireSessionModule, workspacesWithModule } from '@/lib/modules/gate'
import { ERR_MODULE_DISABLED } from '@/lib/authz/errors'

const NOW = Date.parse('2026-09-14T09:00:00Z')
const P1 = '0a000000-0000-4000-8000-0000000000a1' // getAgentHub 가 adminFor({ projectId }) 로 스코프를 검사한다 — uuid 여야 한다
const WA = 'ws-a'
type Resp = { data?: unknown; error?: { message: string } | null }

/** 테이블별 응답 큐 + 호출 기록(select 컬럼·필터). 체인은 전부 자기 자신, await 시 큐 응답. */
function admin(queues: Record<string, Resp[]>) {
  const calls: Array<{ table: string; select?: string; filters: Array<[string, unknown[]]> }> = []
  const client = {
    from: vi.fn((table: string) => {
      const rec = { table, filters: [] as Array<[string, unknown[]]> } as (typeof calls)[number]
      calls.push(rec)
      const resp = (queues[table] ?? []).shift() ?? { data: [], error: null }
      const b: Record<string, unknown> = {}
      b.select = (cols: string) => { rec.select = cols; return b }
      for (const k of ['eq', 'in', 'or', 'gte', 'order', 'limit']) b[k] = (...a: unknown[]) => { rec.filters.push([k, a]); return b }
      b.maybeSingle = async () => ({ data: Array.isArray(resp.data) ? (resp.data[0] ?? null) : (resp.data ?? null), error: resp.error ?? null })
      b.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: resp.data ?? [], error: resp.error ?? null }).then(r)
      return b
    }),
    // 뷰어 이메일은 읽지 않는다(신원 = people.user_id) — auth 조회가 일어나면 실패시킨다.
    auth: { admin: { getUserById: vi.fn(async () => { throw new Error('auth 조회 금지') }) } },
  }
  mocks.createAdminClient.mockReturnValue(client)
  return { client, calls }
}

beforeEach(() => vi.clearAllMocks())
// 모듈 거부 케이스가 바꾼 전역 관문 mock 을 통과 구현으로 되돌린다(공통 규칙)
afterEach(() => { for (const f of [requireModule, requireSessionModule, moduleState, projectsWithModule, workspacesWithModule]) vi.mocked(f).mockReset() })
const c0 = (calls: ReturnType<typeof admin>['calls'], t: string) => calls.find(x => x.table === t)!

describe('fetchAgentHubRows', () => {
  it('1차 4건(항목·주문·로스터·프로젝트) 병렬 + 2차 감시자·보고, 컬럼·필터가 계약대로. 등록 표(agent_projects)는 읽지 않는다(SP7)', async () => {
    const { client, calls } = admin({
      wbs_items: [{ data: [{ id: 'i1', project_id: P1, parent_id: null, code: 'T', name: 'n', sort_order: 0, milestone: false, dev_workflow: true, tags: ['agent'], assignee_member_id: null, agent_prompt: null, actual_pct: 0, stage: null }] }],
      agent_work_orders: [{ data: [{ id: 'o1', project_id: P1, wbs_item_id: 'i1', status: 'reported', claimed_by: 'a', claimed_by_user_id: null, claimed_at: null, created_at: 'x', updated_at: 'x', last_heartbeat_at: null, heartbeat_phase: null, heartbeat_agent: null, heartbeat_note: null }] }],
      agent_work_reports: [{ data: [{ work_order_id: 'o1', percent: 100, summary: 's', links: [], agent: 'a', review_action: null, review_note: null, created_at: 'x' }] }],
      agent_watchers: [{ data: [] }],
      project_members: [{ data: [
        { id: 'm1', active: true, people: { display_name: '장', user_id: null, active: true } },
        // 비활성 행·비활성 인물도 이름 표시를 위해 싣되 active=false 로 편다.
        { id: 'm2', active: false, people: { display_name: '빠진 행', user_id: 'u2', active: true } },
        { id: 'm3', active: true, people: { display_name: '빠진 인물', user_id: 'u3', active: false } },
      ] }],
      projects: [{ data: [{ id: P1, name: 'proj-a', workspace_id: WA }] }],
    })
    const rows = await fetchAgentHubRows(client as never, P1, NOW)
    expect(rows.project).toEqual({ id: P1, name: 'proj-a' })
    // 감시자는 이 프로젝트의 워크스페이스로 좁힌다 — 프로젝트 없는(project_id null) 다른 워크스페이스 감시자가
    // 이 허브에 "떠 있는 팀장"으로 보이지 않게(SP2 §4.2).
    expect(c0(calls, 'projects').select).toBe('id, name, workspace_id')
    expect(c0(calls, 'agent_watchers').filters).toContainEqual(['eq', ['workspace_id', WA]])
    // 사용 여부 = agents 모듈(유일한 원천) — 세션이 없는 서버 조회라 admin 으로 판정한다
    expect(rows.agentProject).toEqual({ enabled: true })
    expect(requireModule).toHaveBeenCalledWith({ projectId: P1 }, 'agents', { client })
    expect(rows.reports).toHaveLength(1)
    const c = (t: string) => calls.find(x => x.table === t)!
    expect(c('wbs_items').select).toBe('id, project_id, parent_id, code, name, sort_order, milestone, dev_workflow, tags, assignee_member_id, agent_prompt, actual_pct, stage, external_ref, depends')
    expect(rows.approvedItemIds).toEqual([]) // depends 가 없으면 선행 승인 조회도 없다
    expect(c('agent_work_orders').select).toContain('last_heartbeat_at')
    expect(c('agent_work_orders').filters.find(f => f[0] === 'or')?.[1][0]).toContain('status.in.(ready,claimed,reported)')
    expect(c('agent_work_reports').filters).toEqual(expect.arrayContaining([['in', ['work_order_id', ['o1']]], ['eq', ['kind', 'completion']]]))
    // 이름·이메일·계정은 people 이 정본 — 임베드로 읽어 허브 조립기에는 평평한 행으로 넘긴다.
    expect(c('project_members').select).toBe('id, active, people!inner(display_name, user_id, active)')
    expect(rows.members).toEqual([
      { id: 'm1', name: '장', user_id: null, active: true },
      { id: 'm2', name: '빠진 행', user_id: 'u2', active: false },
      { id: 'm3', name: '빠진 인물', user_id: 'u3', active: false },
    ])
    expect(calls.map(x => x.table).sort()).toEqual(['agent_watchers', 'agent_work_orders', 'agent_work_reports', 'project_members', 'projects', 'wbs_items'])
  })
  it('살아 있는 주문이 없으면 보고 조회를 생략한다(2차 0건)', async () => {
    const { client, calls } = admin({ agent_work_orders: [{ data: [] }], projects: [{ data: [{ id: P1, name: 'x' }] }] })
    const rows = await fetchAgentHubRows(client as never, P1, NOW)
    expect(rows.reports).toEqual([])
    expect(calls.some(x => x.table === 'agent_work_reports')).toBe(false)
  })
  it('어느 조회든 실패하면 throw — 데이터 없음으로 위장하지 않는다', async () => {
    const { client } = admin({ wbs_items: [{ data: null, error: { message: 'boom' } }] })
    await expect(fetchAgentHubRows(client as never, P1, NOW)).rejects.toThrow(/항목 조회 실패: boom/)
  })
  it('프로젝트 행이 없으면 감시자를 조회하지 않는다(워크스페이스를 모르면 전역으로 넓히지 않는다)', async () => {
    const { client, calls } = admin({ projects: [{ data: [] }] })
    const rows = await fetchAgentHubRows(client as never, P1, NOW)
    expect(rows.project).toBeNull()
    expect(rows.watchers).toEqual([])
    expect(calls.some(x => x.table === 'agent_watchers')).toBe(false)
  })
  it('감시자 조회 실패도 throw', async () => {
    const { client } = admin({ projects: [{ data: [{ id: P1, name: 'x', workspace_id: WA }] }], agent_watchers: [{ data: null, error: { message: 'wboom' } }] })
    await expect(fetchAgentHubRows(client as never, P1, NOW)).rejects.toThrow(/감시자 조회 실패: wboom/)
  })
  // 옮김(SP7): 'agent_projects 가 없으면 null(미등록)' — 등록 행이 없어졌으므로 "미등록"이라는 상태가 없다. 등록 행이 하나도 없는(읽지도 않는) 프로젝트도
  // agents 모듈이 켜져 있으면 켜짐이다. 가짜 admin 에 꺼진 등록 행을 넣어 둔다 — 코드가 그 표로 되돌아가면 enabled 가 false 로 드러난다.
  it('등록 행이 없어도(읽지 않는다) 모듈이 켜져 있으면 agentProject.enabled 는 true — null(미등록)은 없다', async () => {
    const { client, calls } = admin({ agent_projects: [{ data: [{ enabled: false }] }], projects: [{ data: [{ id: P1, name: 'x' }] }] })
    const rows = await fetchAgentHubRows(client as never, P1, NOW)
    expect(rows.agentProject).toEqual({ enabled: true })
    expect(calls.some(x => x.table === 'agent_projects')).toBe(false)
  })
  // 옮김(SP7): '행이 enabled 여도 agents 모듈이 꺼지면 false — 두 원천 AND 의 두 번째 방어선' → 모듈이 꺼져 있으면 닫힘(원천 하나)
  it('agents 모듈이 꺼지면 agentProject.enabled 는 false — 옛 등록 행이 켜져 있어도(읽지 않는다)', async () => {
    const { client, calls } = admin({ agent_projects: [{ data: [{ enabled: true }] }], projects: [{ data: [{ id: P1, name: 'p', workspace_id: WA }] }] })
    vi.mocked(requireModule).mockResolvedValueOnce({ ok: false, error: ERR_MODULE_DISABLED })
    const rows = await fetchAgentHubRows(client as never, P1, NOW)
    expect(rows.agentProject).toEqual({ enabled: false })
    expect(requireModule).toHaveBeenCalledWith({ projectId: P1 }, 'agents', { client })
    expect(calls.some(x => x.table === 'agent_projects')).toBe(false)
  })
})

describe('getAgentHub', () => {
  const item = { id: 'i1', project_id: P1, parent_id: null, code: 'T', name: 'n', sort_order: 0, milestone: false, dev_workflow: true, tags: [], assignee_member_id: 'm1', agent_prompt: null, actual_pct: 0, stage: null }
  it('본인 판정은 people.user_id 로만 — 뷰어 이메일을 auth 로 읽지 않는다', async () => {
    const { client } = admin({
      wbs_items: [{ data: [item] }],
      project_members: [{ data: [{ id: 'm1', active: true, people: { display_name: '장', user_id: 'u1', active: true } }] }],
      projects: [{ data: [{ id: P1, name: 'x' }] }],
    })
    const hub = await getAgentHub(P1, { userId: 'u1', isAdmin: false }, NOW)
    expect(client.auth.admin.getUserById).not.toHaveBeenCalled()
    expect(hub.rows[0].assigneeMine).toBe(true)
    expect(hub.rows[0].canToggle).toBe(true)
  })
  it('담당 명단 행이 비활성이면 본인이 아니다(이름은 계속 보인다)', async () => {
    admin({
      wbs_items: [{ data: [item] }],
      project_members: [{ data: [{ id: 'm1', active: false, people: { display_name: '장', user_id: 'u1', active: true } }] }],
      projects: [{ data: [{ id: P1, name: 'x' }] }],
    })
    const hub = await getAgentHub(P1, { userId: 'u1', isAdmin: false }, NOW)
    expect(hub.rows[0].assigneeMine).toBe(false)
    expect(hub.rows[0].canToggle).toBe(false)
  })
})

describe('fetchAgentHubRows — 선행 승인 주문(approvedItemIds)', () => {
  const base = { id: 'i1', project_id: P1, parent_id: null, code: 'T', name: 'n', sort_order: 0, milestone: false, dev_workflow: true, tags: ['agent'], assignee_member_id: null, agent_prompt: null, actual_pct: 0, stage: null, external_ref: null, depends: null }
  it('위임 항목의 depends 가 가리키는 항목 id 로 approved 주문을 1회 더 조회한다', async () => {
    const { client, calls } = admin({
      wbs_items: [{ data: [{ ...base, depends: ['M/T0'] }, { ...base, id: 'i0', code: 'T0', tags: [], external_ref: 'M/T0', stage: 'ip' }] }],
      agent_work_orders: [{ data: [] }, { data: [{ wbs_item_id: 'i0' }] }],
    })
    const rows = await fetchAgentHubRows(client as never, P1, NOW)
    const orderCalls = calls.filter(x => x.table === 'agent_work_orders')
    expect(orderCalls).toHaveLength(2)
    expect(orderCalls[1].select).toBe('wbs_item_id')
    expect(orderCalls[1].filters).toEqual([['in', ['wbs_item_id', ['i0']]], ['eq', ['status', 'approved']]])
    expect(rows.approvedItemIds).toEqual(['i0'])
  })
  it('depends 가 가리키는 external_ref 가 프로젝트에 없으면 조회하지 않는다', async () => {
    const { client, calls } = admin({ wbs_items: [{ data: [{ ...base, depends: ['M/T9'] }] }], agent_work_orders: [{ data: [] }] })
    const rows = await fetchAgentHubRows(client as never, P1, NOW)
    expect(calls.filter(x => x.table === 'agent_work_orders')).toHaveLength(1)
    expect(rows.approvedItemIds).toEqual([])
  })
})
