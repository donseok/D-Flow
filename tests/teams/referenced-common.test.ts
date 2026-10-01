// 전용 팀이 있는 프로젝트가 이미 참조 중인 공용 팀 code(A1 최종 리뷰 보안 P3 — Z4). 가져오기가 그 code 를 전용 팀으로 새로 등록하면
// 같은 code·다른 id(D4 분열)가 된다 — 라우트는 이 code 를 등록하지 않고 가져오기 RPC 가 공용 팀으로 잇게 둔다.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ adminFor: vi.fn() }))
vi.mock('@/lib/supabase/adminFor', () => ({ adminFor: h.adminFor }))

import { referencedCommonTeamCodes } from '@/lib/teams/referencedCommon'

const P = '00000000-0000-0000-7e57-0000000019a1'
const W = '00000000-0000-0000-7e57-0000000019a2'
type Resp = { data: unknown; error: { message: string } | null }

/** 표마다 응답 하나 — teams 는 공용 후보, 나머지 넷은 참조 확인(team_id 로 거른다). 걸린 필터를 기록한다 */
function fakeAdmin(over: { teams?: Resp; refs?: Record<string, string[]>; errorOn?: string } = {}) {
  const calls: Array<{ table: string; filters: Array<[string, string, unknown]> }> = []
  const from = (table: string) => {
    const filters: Array<[string, string, unknown]> = []
    calls.push({ table, filters })
    const q: Record<string, unknown> = {}
    for (const m of ['select', 'limit']) q[m] = () => q
    for (const m of ['eq', 'in', 'is', 'contains']) q[m] = (c: string, v: unknown) => { filters.push([m, c, v]); return q }
    q.then = (res: (v: Resp) => unknown) => {
      if (over.errorOn === table) return Promise.resolve({ data: null, error: { message: 'boom' } }).then(res)
      if (table === 'teams') return Promise.resolve(over.teams ?? { data: [], error: null }).then(res)
      const team = filters.find(([m, c]) => (m === 'eq' && c === 'team_id') || (m === 'contains' && c === 'team_ids'))?.[2]
      const id = Array.isArray(team) ? team[0] : team
      return Promise.resolve({ data: (over.refs?.[table] ?? []).includes(id as string) ? [{ id: 'r' }] : [], error: null }).then(res)
    }
    return q
  }
  h.adminFor.mockReturnValue({ admin: { from }, projectId: P })
  return calls
}

beforeEach(() => vi.clearAllMocks())

describe('referencedCommonTeamCodes', () => {
  it('그 워크스페이스의 공용 팀 가운데 이 프로젝트가 참조 중인 것의 code(담당·명단 팀·영역 팀·수락 전 초대)', async () => {
    const calls = fakeAdmin({
      teams: { data: [{ id: 'c-x', code: 'X' }, { id: 'c-y', code: 'Y' }, { id: 'c-z', code: 'Z' }], error: null },
      refs: { item_owners: ['c-x'], project_invites: ['c-z'] },
    })
    expect(await referencedCommonTeamCodes({ projectId: P, workspaceId: W }, ['X', 'Y', 'Z', 'NEW'])).toEqual(new Set(['X', 'Z']))
    const teams = calls.find((c) => c.table === 'teams')!
    expect(teams.filters).toEqual(expect.arrayContaining([['is', 'project_id', null], ['eq', 'workspace_id', W], ['in', 'code', ['X', 'Y', 'Z', 'NEW']]]))
    expect(h.adminFor).toHaveBeenCalledWith({ projectId: P })
  })
  it('후보가 없으면(그 code 의 공용 팀이 없다) 참조를 묻지 않는다', async () => {
    const calls = fakeAdmin()
    expect(await referencedCommonTeamCodes({ projectId: P, workspaceId: W }, ['NEW'])).toEqual(new Set())
    expect(calls.map((c) => c.table)).toEqual(['teams'])
  })
  it('빈 목록은 DB 를 부르지 않는다', async () => {
    expect(await referencedCommonTeamCodes({ projectId: P, workspaceId: W }, [])).toEqual(new Set())
    expect(h.adminFor).not.toHaveBeenCalled()
  })
  it('조회 오류는 throw — "참조 없음"으로 위장하지 않는다(쓰기 전 선행 조회 실패는 중단)', async () => {
    fakeAdmin({ teams: { data: [{ id: 'c-x', code: 'X' }], error: null }, errorOn: 'area_teams' })
    await expect(referencedCommonTeamCodes({ projectId: P, workspaceId: W }, ['X'])).rejects.toThrow(/area_teams/)
    fakeAdmin({ errorOn: 'teams' })
    await expect(referencedCommonTeamCodes({ projectId: P, workspaceId: W }, ['X'])).rejects.toThrow(/teams/)
  })
})
