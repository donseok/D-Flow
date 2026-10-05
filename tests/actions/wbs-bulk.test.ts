import { beforeEach, describe, expect, it, vi } from 'vitest'
import { bulkPasteWbsItems, bulkUpdateWbsItems, createWbsBulkSnapshot } from '@/app/actions/wbsBulk'

const m = vi.hoisted(() => ({ guard: vi.fn(), admin: vi.fn(), from: vi.fn(), rpc: vi.fn(), stage: vi.fn(), assignee: vi.fn(), snapshot: vi.fn() }))
vi.mock('@/lib/authz', () => ({ requireProjectMember: m.guard }))
vi.mock('@/lib/domain/authz', () => ({ isProjectAdmin: m.admin }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: async () => ({ from: m.from }) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ rpc: m.rpc }) }))
vi.mock('@/app/actions/wbsAssign', () => ({ setWbsStage: m.stage, setWbsAssignee: m.assignee }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/server', () => ({ after: (fn: () => void) => fn() }))
vi.mock('@/lib/data/snapshots', () => ({ recordProgressSnapshot: m.snapshot }))
const P = '00000000-0000-4000-8000-000000000001'
const A = '00000000-0000-4000-8000-000000000002'
const B = '00000000-0000-4000-8000-000000000003'
const M = '00000000-0000-4000-8000-000000000004'
const revision = '2026-10-05T12:00:00.000Z'
const targets = [{ id: A, updatedAt: revision }, { id: B, updatedAt: revision }]
beforeEach(() => { vi.clearAllMocks(); m.guard.mockResolvedValue({ ok: true, actor: { userId: 'actor' } }); m.admin.mockReturnValue(true); m.rpc.mockResolvedValue({ data: { ok: true }, error: null }) })

describe('SPU3 대량 변경 계약', () => {
  it('권한 없음은 RPC 전에 모든 대상을 permission으로 반환한다', async () => {
    m.guard.mockResolvedValue({ ok: false, error: '권한 없음' })
    const res = await bulkUpdateWbsItems(P, [A, B], { deliverable: { mode: 'clear' } }, targets)
    expect(res.failed.map(row => row.reason)).toEqual(['permission', 'permission'])
    expect(m.rpc).not.toHaveBeenCalled()
  })
  it('멤버라도 관리자가 아니면 쓰지 않는다', async () => {
    m.admin.mockReturnValue(false)
    expect((await bulkUpdateWbsItems(P, [A], {}, targets.slice(0, 1))).failed[0].reason).toBe('permission')
    expect(m.rpc).not.toHaveBeenCalled()
  })
  it('화면에서 확인한 revision 없이 저장하지 않는다', async () => {
    const res = await bulkUpdateWbsItems(P, [A], { biz: { mode: 'clear' } })
    expect(res.failed[0].reason).toBe('validation'); expect(m.rpc).not.toHaveBeenCalled()
  })
  it('일반 필드와 주관 팀은 동일한 항목별 RPC에 전달한다', async () => {
    const res = await bulkUpdateWbsItems(P, [A, B], { deliverable: { mode: 'set', value: ' 보고서 ' }, teamCode: { mode: 'set', value: 'DEV' } }, targets)
    expect(res.succeeded).toEqual([A, B])
    expect(m.rpc).toHaveBeenCalledWith('apply_wbs_bulk_item', { p_project_id: P, p_actor: 'actor', p_item_id: A, p_expected_updated_at: revision, p_patch: { deliverable: '보고서', team_code: 'DEV' } })
  })
  it('충돌 항목은 성공과 분리되며 두 번째 항목 실행은 계속한다', async () => {
    m.rpc.mockResolvedValueOnce({ data: { ok: false, reason: 'conflict' } }).mockResolvedValueOnce({ data: { ok: true } })
    const res = await bulkUpdateWbsItems(P, [A, B], { biz: { mode: 'clear' } }, targets)
    expect(res.succeeded).toEqual([B]); expect(res.failed[0]).toMatchObject({ itemId: A, reason: 'conflict' })
  })
  it('단계와 일반 필드를 섞으면 부분 저장 없이 거부한다', async () => {
    const res = await bulkUpdateWbsItems(P, [A], { stage: { mode: 'set', value: 'ip' }, biz: { mode: 'clear' } }, targets.slice(0, 1))
    expect(res.failed[0].reason).toBe('validation'); expect(m.stage).not.toHaveBeenCalled(); expect(m.rpc).not.toHaveBeenCalled()
  })
  it('단계 변경은 기존 승인 가드 및 revision CAS 경로를 사용한다', async () => {
    m.stage.mockResolvedValue({ ok: false, stale: true, error: '변경됨' })
    const res = await bulkUpdateWbsItems(P, [A], { stage: { mode: 'set', value: 'ip' } }, targets.slice(0, 1))
    expect(m.stage).toHaveBeenCalledWith(A, 'ip', undefined, revision)
    expect(res.failed[0].reason).toBe('conflict')
  })
  it('담당자 변경은 기존 배정·알림 액션에 revision을 전달한다', async () => {
    m.assignee.mockResolvedValue({ ok: true })
    const res = await bulkUpdateWbsItems(P, [A], { assigneeMemberId: { mode: 'set', value: M } }, targets.slice(0, 1))
    expect(m.assignee).toHaveBeenCalledWith(A, M, revision); expect(res.ok).toBe(true)
  })
  it('RPC 오류 원문을 결과에 노출하지 않는다', async () => {
    m.rpc.mockResolvedValue({ error: { message: 'secret database detail' } })
    const res = await bulkUpdateWbsItems(P, [A], { biz: { mode: 'clear' } }, targets.slice(0, 1))
    expect(res.failed[0].reason).toBe('unknown'); expect(JSON.stringify(res)).not.toContain('secret database')
  })
  it('invalid mode/날짜/숨겨진 필드 주입을 거부한다', async () => {
    for (const changes of [{ plannedStart: { mode: 'set', value: '' } }, { actualPct: { mode: 'set', value: '100' } }, { biz: { mode: 'oops' } }]) {
      expect((await bulkUpdateWbsItems(P, [A], changes as never, targets.slice(0, 1))).ok).toBe(false)
    }
    expect(m.rpc).not.toHaveBeenCalled()
  })
  it('스냅샷은 RLS/프로젝트로 좁힌 서버 값을 요청 ID 순서로 확정한다', async () => {
    const query = { eq: vi.fn().mockReturnThis(), in: vi.fn().mockResolvedValue({ data: [{ id: B, name: '둘', updated_at: revision, item_owners: [] }, { id: A, name: '하나', updated_at: revision, item_owners: [] }] }) }
    m.from.mockReturnValue({ select: () => query })
    const res = await createWbsBulkSnapshot(P, [A, B])
    expect(res.ok && res.rows.map(row => row.id)).toEqual([A, B]); expect(query.eq).toHaveBeenCalledWith('project_id', P)
  })
  it('스냅샷에서 항목이 빠지면 부분 대상 자동 저장 없이 실패한다', async () => {
    m.from.mockReturnValue({ select: () => ({ eq: () => ({ in: async () => ({ data: [] }) }) }) })
    expect((await createWbsBulkSnapshot(P, [A])).ok).toBe(false)
  })
})

 describe('붙여넣기 서버 방어', () => {
  it('빈 배치에도 세션 거부 사유를 반환한다', async () => {
    m.guard.mockResolvedValue({ ok: false, error: '로그인 필요' })
    expect(await bulkPasteWbsItems(P, [])).toMatchObject({ ok: false, error: '로그인 필요' })
    expect(m.rpc).not.toHaveBeenCalled()
  })
  it('중복 대상과 허용되지 않은 열을 저장하지 않는다', async () => {
    const op = { target: targets[0], changes: { stage: { mode: 'clear' as const } } }
    expect((await bulkPasteWbsItems(P, [op, op])).ok).toBe(false)
    expect((await bulkPasteWbsItems(P, [op])).failed[0].reason).toBe('validation')
    expect(m.rpc).not.toHaveBeenCalled()
  })
  it('행마다 다른 값과 revision을 보내고 배치당 진척 스냅샷은 한 번 기록한다', async () => {
    const res = await bulkPasteWbsItems(P, targets.map((target, i) => ({ target, changes: { deliverable: { mode: 'set', value: String(i) } } })))
    expect(res.succeeded).toEqual([A, B])
    expect(m.rpc.mock.calls.map(call => call[1].p_patch.deliverable)).toEqual(['0', '1'])
    expect(m.snapshot).toHaveBeenCalledTimes(1)
  })
 })
