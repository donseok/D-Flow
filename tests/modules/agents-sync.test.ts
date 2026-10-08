// agentsSync(스펙 §4.4, SP7) — agents 를 더하면 backfillProjectOrders 만 돈다(등록 표 agent_projects 는 0041 이 지웠다 — 행 동기 없음), 빼면 무변경, 실패는 오류.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeSettingsDb } from '../helpers/fakeSettingsDb'
const mocks = vi.hoisted(() => ({ backfillProjectOrders: vi.fn() }))
vi.mock('@/lib/agent/ensureOrder', () => ({ backfillProjectOrders: mocks.backfillProjectOrders }))
import { agentsNewlyEnabled, backfillWorkspaceAgentOrders, syncAgentsModule } from '@/lib/modules/agentsSync'

const PID = 'p1', U = 'u1'
/** 어떤 표든 건드리면 던진다 — syncAgentsModule 은 이제 DB 를 직접 읽거나 쓰지 않는다(백필만 위임) */
function fakeAdmin() {
  const touched: string[] = []
  const admin = { from: (table: string) => { touched.push(table); throw new Error(`예상치 못한 표: ${table}`) } }
  return { admin: admin as never, touched }
}
beforeEach(() => { mocks.backfillProjectOrders.mockReset(); mocks.backfillProjectOrders.mockResolvedValue({ ok: true, created: 2, failed: [] }) })

describe('agentsNewlyEnabled', () => {
  it('prev 에 없고 next 에 있을 때만 참. prev null(생성)은 next 만 본다', () => {
    expect(agentsNewlyEnabled(['kanban'], ['kanban', 'agents'])).toBe(true)
    expect(agentsNewlyEnabled(['agents'], ['agents'])).toBe(false)
    expect(agentsNewlyEnabled(['agents'], [])).toBe(false)
    expect(agentsNewlyEnabled(null, ['agents'])).toBe(true)
  })
})

describe('syncAgentsModule', () => {
  // 삭제(SP7): '행이 없으면 insert(created_by·note)'·'enabled=false 행은 true 로'·'등록 조회/쓰기 실패는 ok:false' — 등록 표와 그 행 동기가 없어졌다.
  // 남는 계약: 새로 켜질 때만 백필을 한 번 돌고, 표를 직접 건드리지 않으며, 백필 실패를 숨기지 않는다.
  it('agents 가 새로 더해지면 백필만 돈다 — 등록 표를 읽거나 쓰지 않는다', async () => {
    const { admin, touched } = fakeAdmin()
    const r = await syncAgentsModule(admin, { projectId: PID, actorUserId: U, prevEnabled: [], nextEnabled: ['agents'] })
    expect(r).toEqual({ ok: true, changed: true, backfilled: 2, failed: [] })
    expect(touched).toEqual([])
    expect(mocks.backfillProjectOrders).toHaveBeenCalledTimes(1)
    expect(mocks.backfillProjectOrders).toHaveBeenCalledWith(admin, { projectId: PID, actorUserId: U })
  })
  it('prev 가 null(생성)이어도 같다 — 호출마다 백필 한 번', async () => {
    const a = fakeAdmin()
    await syncAgentsModule(a.admin, { projectId: PID, actorUserId: U, prevEnabled: [], nextEnabled: ['agents'] })
    await syncAgentsModule(a.admin, { projectId: PID, actorUserId: U, prevEnabled: null, nextEnabled: ['agents'] })
    expect(a.touched).toEqual([])
    expect(mocks.backfillProjectOrders).toHaveBeenCalledTimes(2)
  })
  it('agents 를 빼거나 그대로면 무변경 — 백필도 조회도 하지 않는다', async () => {
    const a = fakeAdmin()
    expect(await syncAgentsModule(a.admin, { projectId: PID, actorUserId: U, prevEnabled: ['agents'], nextEnabled: [] })).toEqual({ ok: true, changed: false })
    expect(await syncAgentsModule(a.admin, { projectId: PID, actorUserId: U, prevEnabled: ['agents'], nextEnabled: ['agents'] })).toEqual({ ok: true, changed: false })
    expect(a.touched).toEqual([])
    expect(mocks.backfillProjectOrders).not.toHaveBeenCalled()
  })
  it('백필 실패는 ok:false 와 사유, 일부 항목 실패는 failed 로 그대로 돌려준다', async () => {
    mocks.backfillProjectOrders.mockResolvedValue({ ok: false, error: 'bf' })
    expect(await syncAgentsModule(fakeAdmin().admin, { projectId: PID, actorUserId: U, prevEnabled: [], nextEnabled: ['agents'] })).toEqual({ ok: false, error: '주문 백필 실패: bf' })
    mocks.backfillProjectOrders.mockResolvedValue({ ok: true, created: 1, failed: ['w-9'] })
    expect(await syncAgentsModule(fakeAdmin().admin, { projectId: PID, actorUserId: U, prevEnabled: [], nextEnabled: ['agents'] })).toEqual({ ok: true, changed: true, backfilled: 1, failed: ['w-9'] })
  })
})

describe('backfillWorkspaceAgentOrders', () => {
  it('워크스페이스의 프로젝트를 페이지 끝까지 훑고 다른 워크스페이스는 건드리지 않는다', async () => {
    const db = new FakeSettingsDb()
    const wid = '00000000-0000-4000-8000-00000000bb01'
    for (let n = 1; n <= 201; n++) db.addProject({
      id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
      workspaceId: wid, values: {},
    })
    db.addProject({ id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', workspaceId: 'other', values: {} })
    const result = await backfillWorkspaceAgentOrders(db.client() as never, { workspaceId: wid, actorUserId: U })
    expect(result).toEqual({ ok: true, created: 402 })
    expect(mocks.backfillProjectOrders).toHaveBeenCalledTimes(201)
    expect(mocks.backfillProjectOrders).not.toHaveBeenCalledWith(expect.anything(), { projectId: 'ffffffff-ffff-4fff-8fff-ffffffffffff', actorUserId: U })
  })

  it('목록 조회나 백필 실패를 성공으로 위장하지 않는다', async () => {
    const db = new FakeSettingsDb().addProject({ id: PID, workspaceId: 'w1', values: {} })
    db.failTable = 'projects'
    expect(await backfillWorkspaceAgentOrders(db.client() as never, { workspaceId: 'w1', actorUserId: U }))
      .toEqual({ ok: false, error: '프로젝트 목록 조회 실패: fake failure: projects' })
    expect(mocks.backfillProjectOrders).not.toHaveBeenCalled()
    db.failTable = null
    mocks.backfillProjectOrders.mockResolvedValueOnce({ ok: false, error: 'failed' })
    expect(await backfillWorkspaceAgentOrders(db.client() as never, { workspaceId: 'w1', actorUserId: U }))
      .toEqual({ ok: false, error: 'p1 주문 백필 실패: failed' })
    mocks.backfillProjectOrders.mockResolvedValueOnce({ ok: true, created: 0, failed: ['wbs-1'] })
    expect(await backfillWorkspaceAgentOrders(db.client() as never, { workspaceId: 'w1', actorUserId: U }))
      .toEqual({ ok: false, error: 'p1 주문 1건 백필 실패' })
  })
})
