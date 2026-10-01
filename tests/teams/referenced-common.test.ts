// 전용 팀이 있는 프로젝트가 이미 참조 중인 공용 팀 code(A1 최종 리뷰 보안 P3 — Z4). 가져오기가 그 code 를 전용 팀으로 새로 등록하면
// 같은 code·다른 id(D4 분열)가 된다 — 라우트는 이 code 를 등록하지 않고 가져오기 RPC 가 공용 팀으로 잇게 둔다.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ adminFor: vi.fn(), workspaceTeams: vi.fn() }))
vi.mock('@/lib/supabase/adminFor', () => ({ adminFor: h.adminFor }))
// 공용 팀 후보는 요청 범위 원천(workspaceTeams — 끝까지 읽기)에서 받는다(U4 — 정확한 code 가 아니라 정규화 키로 대조하려면 그 워크스페이스 공용 팀 전부)
vi.mock('@/lib/teams/source', () => ({ workspaceTeams: h.workspaceTeams }))

import { referencedCommonTeamCodes } from '@/lib/teams/referencedCommon'
import type { Team } from '@/lib/domain/teams'

const P = '00000000-0000-0000-7e57-0000000019a1'
const W = '00000000-0000-0000-7e57-0000000019a2'
type Resp = { data: unknown; error: { message: string } | null }

/** 표마다 응답 하나 — teams 는 공용 후보, 나머지 넷은 참조 확인(team_id 로 거른다). 걸린 필터를 기록한다 */
const common = (id: string, code: string, name = code): Team => ({ id, code, name, color: '#6b7280', sortOrder: 0, active: true, progressVisible: true, projectId: null, workspaceId: W })
function fakeAdmin(over: { teams?: Resp; refs?: Record<string, string[]>; errorOn?: string } = {}) {
  if (over.errorOn === 'teams') h.workspaceTeams.mockRejectedValue(new Error('공용 팀을 불러오지 못했습니다(teams)'))
  else h.workspaceTeams.mockResolvedValue(((over.teams?.data ?? []) as Array<{ id: string; code: string; name?: string }>).map((t) => common(t.id, t.code, t.name)))
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
  it('그 워크스페이스의 공용 팀 가운데 이 프로젝트가 참조 중인 것 — 요청 code → 그 공용 팀 code(담당·명단 팀·영역 팀·수락 전 초대)', async () => {
    const calls = fakeAdmin({
      teams: { data: [{ id: 'c-x', code: 'X' }, { id: 'c-y', code: 'Y' }, { id: 'c-z', code: 'Z' }], error: null },
      refs: { item_owners: ['c-x'], project_invites: ['c-z'] },
    })
    expect(await referencedCommonTeamCodes({ projectId: P, workspaceId: W }, ['X', 'Y', 'Z', 'NEW'])).toEqual(new Map([['X', 'X'], ['Z', 'Z']]))
    expect(h.workspaceTeams).toHaveBeenCalledWith(W, { client: expect.anything() })
    expect(calls.some((c) => c.table === 'teams')).toBe(false)
    expect(h.adminFor).toHaveBeenCalledWith({ projectId: P })
  })
  it('[U4] 대소문자·전각·개명 이름만 다른 code 도 찾는다 — 요청 code 가 참조 중인 공용 팀과 키가 같으면 그 팀 code(호출부가 겹침으로 거부한다)', async () => {
    fakeAdmin({
      teams: { data: [{ id: 'c-qa', code: 'QA' }, { id: 'c-lab', code: 'LAB', name: '연구' }, { id: 'c-free', code: 'FREE' }], error: null },
      refs: { item_owners: ['c-qa'], area_teams: ['c-lab'] },
    })
    expect(await referencedCommonTeamCodes({ projectId: P, workspaceId: W }, ['qa', 'ＱＡ', '연구', 'free']))
      .toEqual(new Map([['qa', 'QA'], ['ＱＡ', 'QA'], ['연구', 'LAB']]))
  })
  it('[U4] 정확히 같은 code 가 참조 중이면 그것이 먼저다(키만 같은 다른 공용 팀보다)', async () => {
    fakeAdmin({
      teams: { data: [{ id: 'c-qa2', code: 'qa' }, { id: 'c-qa', code: 'QA' }], error: null },
      refs: { item_owners: ['c-qa', 'c-qa2'] },
    })
    expect(await referencedCommonTeamCodes({ projectId: P, workspaceId: W }, ['QA'])).toEqual(new Map([['QA', 'QA']]))
  })
  it('후보가 없으면(그 키의 공용 팀이 없다) 참조를 묻지 않는다', async () => {
    const calls = fakeAdmin()
    expect(await referencedCommonTeamCodes({ projectId: P, workspaceId: W }, ['NEW'])).toEqual(new Map())
    expect(calls).toEqual([])
  })
  it('빈 목록은 DB 를 부르지 않는다', async () => {
    expect(await referencedCommonTeamCodes({ projectId: P, workspaceId: W }, [])).toEqual(new Map())
    expect(h.adminFor).not.toHaveBeenCalled()
    expect(h.workspaceTeams).not.toHaveBeenCalled()
  })
  it('조회 오류는 throw — "참조 없음"으로 위장하지 않는다(쓰기 전 선행 조회 실패는 중단)', async () => {
    fakeAdmin({ teams: { data: [{ id: 'c-x', code: 'X' }], error: null }, errorOn: 'area_teams' })
    await expect(referencedCommonTeamCodes({ projectId: P, workspaceId: W }, ['X'])).rejects.toThrow(/area_teams/)
    fakeAdmin({ errorOn: 'teams' })
    await expect(referencedCommonTeamCodes({ projectId: P, workspaceId: W }, ['X'])).rejects.toThrow(/teams/)
  })
})
