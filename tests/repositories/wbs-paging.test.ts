import { beforeEach, describe, expect, it, vi } from 'vitest'
import { keysetTable } from '../helpers/keysetTable'

const m = vi.hoisted(() => ({ projectTeams: vi.fn() }))
vi.mock('@/lib/teams/source', async () => {
  const actual = await vi.importActual<typeof import('../helpers/teams-source-mock')>('../helpers/teams-source-mock')
  return { ...actual.teamsSourceMock(), projectTeams: m.projectTeams }
})

import { createSupabaseWbsRepository } from '@/lib/repositories/supabase/wbs'
import { TeamsUnavailableError } from '@/lib/teams/source'

const PID = '00000000-0000-0000-7e57-000000001930'
const team = (id: string, code: string, sortOrder: number, active = true) => ({
  id, code, name: code, color: '#6b7280', sortOrder, active, progressVisible: true, projectId: PID, workspaceId: 'w' })
const row = (i: number, owners: Array<{ kind: string; teams: { code: string } }> = []) => ({
  id: `i${String(i).padStart(4, '0')}`, project_id: PID, parent_id: null, code: String(i), sort_order: 100 - i, name: `항목 ${i}`,
  biz: null, deliverable: null, planned_start: null, planned_end: null, weight: null, actual_pct: 0, updated_at: null, is_owner_split: false,
  external_ref: null, depends: null, item_owners: owners })

function clientOf(t: { items: ReturnType<typeof keysetTable>; holidays?: ReturnType<typeof keysetTable>; deps?: ReturnType<typeof keysetTable> }) {
  const project = keysetTable([{ id: PID, base_date: null }])
  return { from: (name: string) => name === 'projects' ? project.make() : name === 'wbs_items' ? t.items.make()
    : name === 'holidays' ? (t.holidays ?? keysetTable([])).make() : name === 'task_dependencies' ? (t.deps ?? keysetTable([])).make()
    : (() => { throw new Error(`unexpected ${name}`) })() }
}

describe('봇 WBS 리포지토리 — 세 표를 끝까지, 팀 순서는 한 번(SP4 A2 §4.6)', () => {
  beforeEach(() => { vi.clearAllMocks() })   // 호출 횟수 단언이 앞 케이스의 호출을 세지 않게
  it('wbs_items·holidays·task_dependencies 가 상한(2행)을 넘어도 전부, 키는 id·date·id', async () => {
    m.projectTeams.mockResolvedValue([])
    const items = keysetTable(Array.from({ length: 5 }, (_, i) => row(i)), { maxRows: 2 })
    const holidays = keysetTable(['2026-01-01', '2026-01-02', '2026-01-03'].map((date) => ({ project_id: PID, date })), { maxRows: 2 })
    const deps = keysetTable(Array.from({ length: 3 }, (_, i) => ({ id: `d${i}`, project_id: PID, predecessor_id: 'i0000', successor_id: 'i0001',
      dependency_type: 'FS', lag_days: 0 })), { maxRows: 2 })
    const r = await createSupabaseWbsRepository(clientOf({ items, holidays, deps }) as never).getProjectSnapshot(PID)
    expect(r.ok && r.data?.items).toHaveLength(5)
    expect(r.ok && r.data?.holidays).toHaveLength(3)
    expect(r.ok && r.data?.dependencies).toHaveLength(3)
    expect(items.log[0]).toEqual(expect.arrayContaining([{ method: 'order', args: ['id'] }]))
    expect(holidays.log[0]).toEqual(expect.arrayContaining([{ method: 'order', args: ['date'] }]))
  })
  it('담당 순서는 요청 범위 projectTeams(비활성 포함)의 순서이고, 팀은 항목 수와 무관하게 한 번 읽는다(받은 클라이언트로)', async () => {
    m.projectTeams.mockResolvedValue([team('t-ops', 'OPS', 0, false), team('t-res', 'RES', 1)])
    const owners = [{ kind: 'support', teams: { code: 'RES' } }, { kind: 'support', teams: { code: 'OPS' } }]
    const client = clientOf({ items: keysetTable([row(0, owners), row(1, owners), row(2, owners)]) })
    const r = await createSupabaseWbsRepository(client as never).getProjectSnapshot(PID)
    expect(r.ok && r.data?.items[0].owners).toEqual([{ team: 'OPS', kind: 'support' }, { team: 'RES', kind: 'support' }])
    expect(m.projectTeams).toHaveBeenCalledTimes(1)
    expect(m.projectTeams).toHaveBeenCalledWith(PID, { client })
  })
  it('팀 원천 실패는 WBS_TEAMS_READ_FAILED(재시도 가능) — 순서 없는 담당을 데이터로 내지 않는다', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    m.projectTeams.mockRejectedValue(new TeamsUnavailableError())
    const r = await createSupabaseWbsRepository(clientOf({ items: keysetTable([row(0)]) }) as never).getProjectSnapshot(PID)
    expect(r).toEqual({ ok: false, errorCode: 'WBS_TEAMS_READ_FAILED', retryable: true })
    err.mockRestore()
  })
  it('wbs_items 를 읽는 사이 변경이면 WBS_ITEMS_READ_FAILED — 잘린 트리를 봇 답의 근거로 쓰지 않는다', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    m.projectTeams.mockResolvedValue([])
    const items = keysetTable([row(0), row(1), row(2)], { maxRows: 2, afterResponse: (n, rows) => (n === 1 ? [...rows, row(9)] : undefined) })
    const r = await createSupabaseWbsRepository(clientOf({ items }) as never).getProjectSnapshot(PID)
    expect(r).toEqual({ ok: false, errorCode: 'WBS_ITEMS_READ_FAILED', retryable: true })
    err.mockRestore()
  })
})
