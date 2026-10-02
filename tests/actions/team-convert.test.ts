// 전환 뒤 실적 편집(스펙 D54·D4 — 비평 Q16, §6.1 의 A1 몫). 실적 쓰기의 서버 재검사는 팀 **id** 로 판정한다(actions/wbs.ts
// updateActual — item_owners.in('team_id', 명단 팀 id)). 가져오기 경로의 전환(convert_inherited_teams)은 담당(item_owners)과 명단 팀
// (project_member_teams)을 같은 새 전용 팀 id 로 함께 옮긴다(DB 쪽은 tests/rls/team-convert.test.ts) — 그래서 상속 시절 공용 팀으로 명단을
// 꾸린 담당 팀 멤버가 가져온 항목의 실적을 그대로 고친다. 명단을 옮기지 않은 '복사만'(같은 code·다른 id 두 벌)은 같은 멤버를 거부한다.
// 액션은 고치지 않는다(재검사 규칙 그대로) — 이 파일은 전환이 만들어야 할 상태를 고정한다. '공용 팀 전환으로 시작'(copyGlobalTeams)이
// 전환 RPC 를 쓰는 케이스는 B(T14)가 더했다(마무리 판정 T14·Phase B 계획 P6 — 픽스처 1a60~1a7f).
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  requireProjectMember: vi.fn(),
  resolveProjectId: vi.fn(),
  rpc: vi.fn(),
  requireProjectAdmin: vi.fn(),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return { ...actual, after: vi.fn() }
})
vi.mock('@/lib/authz', () => ({
  requireProjectMember: mocks.requireProjectMember, requireProjectAdmin: mocks.requireProjectAdmin,
  requireSuperuser: vi.fn(), resolveProjectId: mocks.resolveProjectId, getActor: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ getSession: vi.fn(), getDisplayName: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: mocks.createServerClient }))
vi.mock('@/lib/data/snapshots', () => ({ recordProgressSnapshot: vi.fn() }))
vi.mock('@/lib/ai/ingest', () => ({ ingestProject: vi.fn(async () => ({ count: 0 })) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }))
vi.mock('@/lib/teams/source', async () => (await import('../helpers/teams-source-mock')).teamsSourceMock())

import { revalidatePath } from 'next/cache'
import { updateActual } from '@/app/actions/wbs'
import { copyGlobalTeams } from '@/app/actions/projectTeams'
import { ERR_DENIED, ERR_MISSING } from '@/lib/authz/errors'
import { makeActor, makeMemberActor } from '../fixtures/actor'

const P = '00000000-0000-0000-7e57-0000000018a1'   // 단위 테스트 픽스처 id(GC — 18a0~18af 는 이 파일)
const ITEM = '00000000-0000-0000-7e57-0000000018a2'
/** 상속 시절의 공용 팀 QA 와, 전환이 같은 code·이름·색으로 만든 이 프로젝트의 전용 팀 QA */
const COMMON_QA = '00000000-0000-0000-7e57-0000000018a3'
const OWN_QA = '00000000-0000-0000-7e57-0000000018a4'

type Resp = { data?: unknown; error?: { message: string } | null }
/** 세션 클라이언트 흉내 — wbs_items 는 차례 응답(항목 → 자식 없음 → update 결과), item_owners 는 in('team_id', 명단 팀 id)를 실제로
 *  적용해 그 항목의 담당 팀 id 가 목록에 있을 때만 행을 준다(액션의 id 재검사가 보는 그대로). 쓰기와 담당 조회의 id 목록을 기록한다 */
function server(ownerTeamId: string) {
  const writes: Array<{ table: string; payload: unknown }> = []
  const ownerLookups: unknown[][] = []
  const items: Resp[] = [
    { data: { id: ITEM, actual_pct: 40, project_id: P, dev_workflow: false, tags: [] } },
    { data: null },
    { data: [{ id: ITEM }] },
  ]
  const client = {
    from: (table: string) => {
      let resp: Resp = table === 'wbs_items' ? (items.shift() ?? { data: null }) : { data: null }
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'eq', 'limit', 'order']) b[k] = () => b
      b.in = (col: string, values: unknown[]) => {
        if (table === 'item_owners' && col === 'team_id') {
          ownerLookups.push(values)
          resp = { data: values.includes(ownerTeamId) ? { team_id: ownerTeamId } : null }
        }
        return b
      }
      b.update = (payload: unknown) => { writes.push({ table, payload }); return b }
      b.insert = (payload: unknown) => { writes.push({ table, payload }); return b }
      b.single = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.maybeSingle = b.single
      b.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null }).then(r)
      return b
    },
  }
  mocks.createServerClient.mockResolvedValue(client)
  return { writes, ownerLookups }
}
/** 그 프로젝트의 담당 팀 멤버(명단 권한 member) — 명단 팀은 rosterTeamId 하나 */
const memberWith = (rosterTeamId: string) =>
  makeMemberActor(P, [], { rosterTeams: new Map([[P, { teamIds: [rosterTeamId], teamCodes: ['QA'] }]]) })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolveProjectId.mockResolvedValue({ ok: true, projectId: P })
})

describe('전환 뒤 실적 편집 — 액션의 팀 id 재검사(D54)', () => {
  it('상속 중(명단·담당 모두 공용 팀 id) — 담당 팀 멤버가 실적을 고친다(출발점)', async () => {
    mocks.requireProjectMember.mockResolvedValue({ ok: true, actor: memberWith(COMMON_QA) })
    const { writes } = server(COMMON_QA)
    expect(await updateActual(ITEM, 70, 40)).toEqual({ ok: true })
    expect(writes[0]).toMatchObject({ table: 'wbs_items', payload: { actual_pct: 70 } })
  })
  it('가져오기 경로로 전환한 뒤(명단 팀·담당이 같은 새 전용 팀 id) — 같은 멤버가 가져온 항목의 실적을 고친다', async () => {
    mocks.requireProjectMember.mockResolvedValue({ ok: true, actor: memberWith(OWN_QA) })
    const { writes, ownerLookups } = server(OWN_QA)
    expect(await updateActual(ITEM, 70, 40)).toEqual({ ok: true })
    expect(ownerLookups).toEqual([[OWN_QA]])
    expect(writes.map((w) => w.table)).toEqual(['wbs_items', 'change_logs'])
  })
  it('복사만 한 분열(명단은 공용 팀 id, 담당은 같은 code 의 전용 팀 id) — 같은 멤버를 거부하고 아무것도 쓰지 않는다', async () => {
    mocks.requireProjectMember.mockResolvedValue({ ok: true, actor: memberWith(COMMON_QA) })
    const { writes, ownerLookups } = server(OWN_QA)
    expect(await updateActual(ITEM, 70, 40)).toEqual({ ok: false, error: '담당 작업이 아님' })
    expect(ownerLookups).toEqual([[COMMON_QA]])
    expect(writes).toEqual([])
  })
})

describe("'공용 팀 전환으로 시작'(copyGlobalTeams → convert_inherited_teams — T14)", () => {
  const ADMIN_ID = '00000000-0000-0000-7e57-000000001a60'
  const moved = { item_owners: 3, project_member_teams: 1, area_teams: 0, invites: 0 }
  beforeEach(() => {
    mocks.requireProjectAdmin.mockResolvedValue({ ok: true, actor: makeActor({ userId: ADMIN_ID }) })
  })
  it('전환 RPC 를 가드 결과의 행위자로 한 번 부르고, 복사가 있으면 성공 + 프로젝트 레이아웃 무효화(D51 (a))', async () => {
    mocks.rpc.mockResolvedValue({ data: { status: 'converted', teams: 2, moved }, error: null })
    expect(await copyGlobalTeams(P)).toEqual({ ok: true })
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    expect(mocks.rpc).toHaveBeenCalledWith('convert_inherited_teams', { p_actor: ADMIN_ID, p_project_id: P })
    expect(revalidatePath).toHaveBeenCalledWith('/(app)/p/[projectId]', 'layout')
  })
  it('already(두 번 누른 버튼·이미 전용 팀) → 지금 문구의 실패, 아무것도 바꾸지 않는다', async () => {
    mocks.rpc.mockResolvedValue({ data: { status: 'already' }, error: null })
    expect(await copyGlobalTeams(P)).toEqual({ ok: false, error: '이미 프로젝트 팀이 정의되어 있습니다.' })
    expect(revalidatePath).not.toHaveBeenCalled()
  })
  it('복사 0개(converted·teams 0 — 공용 팀도 참조도 없음) → 지금 문구의 실패', async () => {
    mocks.rpc.mockResolvedValue({ data: { status: 'converted', teams: 0, moved: { item_owners: 0, project_member_teams: 0, area_teams: 0, invites: 0 } }, error: null })
    expect(await copyGlobalTeams(P)).toEqual({ ok: false, error: '복사할 전역 팀이 없습니다.' })
  })
  it('권한·프로젝트 토큰은 고정 문구, 잠금 대기는 재시도 문구 — DB 원문을 싣지 않는다', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'TEAM_CONVERT_FORBIDDEN' } })
    expect(await copyGlobalTeams(P)).toEqual({ ok: false, error: ERR_DENIED })
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0002', message: 'PROJECT_NOT_FOUND' } })
    expect(await copyGlobalTeams(P)).toEqual({ ok: false, error: ERR_MISSING })
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '55P03', message: 'canceling statement due to lock timeout' } })
    const busy = await copyGlobalTeams(P)
    expect(busy.ok).toBe(false)
    expect(JSON.stringify(busy)).not.toMatch(/canceling|lock timeout/)
    err.mockRestore()
  })
  it('모르는 오류·모양이 어긋난 결과는 고정 문구 + 로그(표시 = 로깅)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: 'XX000', message: 'internal raw detail' } })
    const a = await copyGlobalTeams(P)
    mocks.rpc.mockResolvedValueOnce({ data: { status: 'weird' }, error: null })
    const b = await copyGlobalTeams(P)
    for (const r of [a, b]) { expect(r.ok).toBe(false); expect(JSON.stringify(r)).not.toContain('internal raw detail') }
    expect(err).toHaveBeenCalledTimes(2)
    err.mockRestore()
  })
  it('가드 거부면 RPC 를 부르지 않는다', async () => {
    mocks.requireProjectAdmin.mockResolvedValue({ ok: false, error: ERR_DENIED })
    expect(await copyGlobalTeams(P)).toEqual({ ok: false, error: ERR_DENIED })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
