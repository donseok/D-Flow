// agentsSync(스펙 §4.4) — agents 를 더하면 agent_projects insert/enable + backfillProjectOrders, 빼면 무변경, 실패는 오류.
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ backfillProjectOrders: vi.fn() }))
vi.mock('@/lib/agent/ensureOrder', () => ({ backfillProjectOrders: mocks.backfillProjectOrders }))
import { agentsNewlyEnabled, syncAgentsModule } from '@/lib/modules/agentsSync'

const PID = 'p1', U = 'u1'
function fakeAdmin(existing: { enabled: boolean } | null, opts: { selectError?: string; insertError?: string; updateError?: string } = {}) {
  const writes: { op: string; row: Record<string, unknown> }[] = []
  const admin = {
    from: (table: string) => {
      if (table !== 'agent_projects') throw new Error(`예상치 못한 표: ${table}`)
      const b: Record<string, unknown> = {}
      b.select = () => b; b.eq = () => b
      b.maybeSingle = async () => (opts.selectError ? { data: null, error: { message: opts.selectError } } : { data: existing, error: null })
      b.insert = async (row: Record<string, unknown>) => { writes.push({ op: 'insert', row }); return { error: opts.insertError ? { message: opts.insertError } : null } }
      b.update = (row: Record<string, unknown>) => ({ eq: async () => { writes.push({ op: 'update', row }); return { error: opts.updateError ? { message: opts.updateError } : null } } })
      return b
    },
  }
  return { admin: admin as never, writes }
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
  it('행이 없으면 insert(created_by·note) 뒤 백필', async () => {
    const { admin, writes } = fakeAdmin(null)
    const r = await syncAgentsModule(admin, { projectId: PID, actorUserId: U, prevEnabled: [], nextEnabled: ['agents'] })
    expect(r).toEqual({ ok: true, changed: true, backfilled: 2, failed: [] })
    expect(writes).toEqual([{ op: 'insert', row: { project_id: PID, created_by: U, note: '설정에서 켬' } }])
    expect(mocks.backfillProjectOrders).toHaveBeenCalledWith(admin, { projectId: PID, actorUserId: U })
  })
  it('enabled=false 행은 true 로, 이미 true 면 쓰기 없이 백필만', async () => {
    const off = fakeAdmin({ enabled: false })
    await syncAgentsModule(off.admin, { projectId: PID, actorUserId: U, prevEnabled: [], nextEnabled: ['agents'] })
    expect(off.writes).toEqual([{ op: 'update', row: { enabled: true } }])
    const on = fakeAdmin({ enabled: true })
    await syncAgentsModule(on.admin, { projectId: PID, actorUserId: U, prevEnabled: null, nextEnabled: ['agents'] })
    expect(on.writes).toEqual([])
    expect(mocks.backfillProjectOrders).toHaveBeenCalledTimes(2)
  })
  it('agents 를 빼거나 그대로면 무변경 — 조회조차 하지 않는다', async () => {
    const a = fakeAdmin(null, { selectError: '부르면 실패' })
    expect(await syncAgentsModule(a.admin, { projectId: PID, actorUserId: U, prevEnabled: ['agents'], nextEnabled: [] })).toEqual({ ok: true, changed: false })
    expect(await syncAgentsModule(a.admin, { projectId: PID, actorUserId: U, prevEnabled: ['agents'], nextEnabled: ['agents'] })).toEqual({ ok: true, changed: false })
    expect(mocks.backfillProjectOrders).not.toHaveBeenCalled()
  })
  it('조회·쓰기·백필 실패는 각각 ok:false 와 사유', async () => {
    expect(await syncAgentsModule(fakeAdmin(null, { selectError: 'sel' }).admin, { projectId: PID, actorUserId: U, prevEnabled: [], nextEnabled: ['agents'] })).toEqual({ ok: false, error: '에이전트 등록 조회 실패: sel' })
    expect(await syncAgentsModule(fakeAdmin(null, { insertError: 'ins' }).admin, { projectId: PID, actorUserId: U, prevEnabled: [], nextEnabled: ['agents'] })).toEqual({ ok: false, error: '에이전트 등록 실패: ins' })
    expect(await syncAgentsModule(fakeAdmin({ enabled: false }, { updateError: 'upd' }).admin, { projectId: PID, actorUserId: U, prevEnabled: [], nextEnabled: ['agents'] })).toEqual({ ok: false, error: '에이전트 등록 갱신 실패: upd' })
    mocks.backfillProjectOrders.mockResolvedValue({ ok: false, error: 'bf' })
    expect(await syncAgentsModule(fakeAdmin({ enabled: true }).admin, { projectId: PID, actorUserId: U, prevEnabled: [], nextEnabled: ['agents'] })).toEqual({ ok: false, error: '주문 백필 실패: bf' })
  })
})
