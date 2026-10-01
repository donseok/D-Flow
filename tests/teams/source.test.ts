// 요청 범위 팀 원천(스펙 §4.2.1, D19·D36) — 원천은 해석기의 팀(공용 ∪ 전용), 노출 규칙은 기존 순수 함수 resolveTeamsForProject.
// React cache 는 RSC 밖(vitest node)에서 기억하지 않는다 — "같은 요청에서 한 번"은 해석기 캐시(getProjectConfig)가 맡으므로,
// 여기서는 두 접근자가 해석기를 같은 인자로 부르는지(같은 요청이면 한 번으로 줄어든다)를 본다.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ getProjectConfig: vi.fn(), createServerClient: vi.fn() }))
vi.mock('@/lib/settings/projectConfig', () => ({ getProjectConfig: h.getProjectConfig }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: h.createServerClient }))

import { TeamsUnavailableError, projectOwnTeams, projectTeams, workspaceTeams } from '@/lib/teams/source'
import { ConfigUnavailableError } from '@/lib/settings/errors'
import type { ConfigTeam } from '@/lib/settings/projectConfig'
import { makeProjectConfig } from '../helpers/projectConfigFixture'

const P = '00000000-0000-0000-7e57-0000000018c1'   // 단위 테스트 픽스처 id(GC — 18c0~18cf 는 이 파일)
const W = '00000000-0000-0000-7e57-00000000aa4c'
const team = (over: Partial<ConfigTeam> & Pick<ConfigTeam, 'id' | 'code'>): ConfigTeam => ({
  name: over.code, sortOrder: 0, active: true, color: '#6b7280', progressVisible: true, projectId: null, ...over,
})
const COMMON = [
  team({ id: 'c-ops', code: 'OPS', name: '운영팀', sortOrder: 1 }),
  team({ id: 'c-res', code: 'RES', name: '연구팀', sortOrder: 0 }),
  team({ id: 'c-arc', code: 'ARC', sortOrder: 1, active: false }),
]
const configWith = (teams: ConfigTeam[]) => makeProjectConfig({}, { projectId: P, workspaceId: W, teams })

beforeEach(() => { vi.clearAllMocks() })

describe('projectTeams — 전용 팀이 하나라도 있으면 그것만, 없으면 그 워크스페이스 공용', () => {
  it('전용 팀 0개(상속) — 공용 팀 전부(비활성 포함), (sortOrder, code) 순, 워크스페이스·이름·색을 싣는다', async () => {
    h.getProjectConfig.mockResolvedValue(configWith(COMMON))
    const got = await projectTeams(P)
    expect(got.map((t) => t.code)).toEqual(['RES', 'ARC', 'OPS'])
    expect(got[0]).toEqual({ id: 'c-res', code: 'RES', name: '연구팀', color: '#6b7280', sortOrder: 0, active: true,
      progressVisible: true, projectId: null, workspaceId: W })
  })
  it('전용 팀이 비활성 하나뿐이어도 전용 팀만 — "전 팀 비활성화"가 공용 상속으로 되돌아가지 않는다', async () => {
    h.getProjectConfig.mockResolvedValue(configWith([...COMMON, team({ id: 'o-civ', code: 'CIV', projectId: P, active: false })]))
    expect((await projectTeams(P)).map((t) => t.code)).toEqual(['CIV'])
  })
  it('projectOwnTeams 는 전용 팀만 — 상속 프로젝트는 빈 목록(가져오기의 inheritsCommon 판정)', async () => {
    h.getProjectConfig.mockResolvedValue(configWith(COMMON))
    expect(await projectOwnTeams(P)).toEqual([])
    h.getProjectConfig.mockResolvedValue(configWith([...COMMON,
      team({ id: 'o-saf', code: 'SAF', projectId: P, sortOrder: 2 }), team({ id: 'o-mep', code: 'MEP', projectId: P, sortOrder: 2 })]))
    expect((await projectOwnTeams(P)).map((t) => t.code)).toEqual(['MEP', 'SAF'])
  })
  it('두 접근자는 해석기를 같은 인자로 부른다 — 같은 요청이면 해석기 캐시가 한 번으로 줄인다', async () => {
    h.getProjectConfig.mockResolvedValue(configWith(COMMON))
    const client = { from: vi.fn() }
    await projectTeams(P, { client: client as never })
    await projectOwnTeams(P, { client: client as never })
    expect(h.getProjectConfig.mock.calls).toEqual([[P, { client }], [P, { client }]])
  })
  it('해석기 조회 실패는 TeamsUnavailableError — 빈 목록으로 위장하지 않는다(cause 보존)', async () => {
    const boom = new ConfigUnavailableError('프로젝트 설정 조회 실패: db down')
    h.getProjectConfig.mockRejectedValue(boom)
    const e = await projectTeams(P).catch((x: unknown) => x)
    expect(e).toBeInstanceOf(TeamsUnavailableError)
    expect((e as TeamsUnavailableError).code).toBe('TEAMS_UNAVAILABLE')
    expect((e as Error).cause).toBe(boom)
    await expect(projectOwnTeams(P)).rejects.toBeInstanceOf(TeamsUnavailableError)
  })
})

/** PostgREST 흉내 — 한 응답을 maxRows 에서 자르고 count 는 총합(count: 'exact'). 걸린 필터를 기록한다 */
function teamsClient(rows: Array<Record<string, unknown>>, opts: { maxRows?: number; count?: number; error?: string } = {}) {
  const filters: Array<[string, string, unknown]> = []
  const client = {
    from: (table: string) => {
      if (table !== 'teams') throw new Error(`unexpected table ${table}`)
      let range: [number, number] = [0, rows.length - 1]
      const b: Record<string, unknown> = {}
      b.select = () => b
      b.eq = (col: string, v: unknown) => { filters.push(['eq', col, v]); return b }
      b.is = (col: string, v: unknown) => { filters.push(['is', col, v]); return b }
      b.order = () => b
      b.range = (from: number, to: number) => { range = [from, to]; return b }
      b.then = (res: (v: unknown) => unknown) => {
        if (opts.error) return Promise.resolve({ data: null, error: { message: opts.error }, count: null }).then(res)
        const end = Math.min(range[1] + 1, range[0] + (opts.maxRows ?? 1000))
        return Promise.resolve({ data: rows.slice(range[0], end), error: null, count: opts.count ?? rows.length }).then(res)
      }
      return b
    },
  }
  return { client, filters }
}
const row = (i: number) => ({ id: `w-${String(i).padStart(3, '0')}`, code: `T${i}`, name: `팀 ${i}`, color: '#6b7280', sort_order: i % 3,
  active: i % 4 !== 0, progress_visible: true, project_id: null, workspace_id: W })

describe('workspaceTeams — 한 워크스페이스의 공용 팀(비활성 포함), 끝까지 읽는다', () => {
  it('쪽 크기보다 많은 공용 팀을 빠짐없이 — 워크스페이스·공용 필터, (sortOrder, code) 순, 이름·색을 싣는다', async () => {
    const rows = Array.from({ length: 7 }, (_, i) => row(i + 1))
    const { client, filters } = teamsClient(rows, { maxRows: 3 })
    const got = await workspaceTeams(W, { client: client as never })
    expect(got).toHaveLength(7)
    expect(filters).toEqual(expect.arrayContaining([['eq', 'workspace_id', W], ['is', 'project_id', null]]))
    expect(got.map((t) => t.code)).toEqual(['T3', 'T6', 'T1', 'T4', 'T7', 'T2', 'T5'])
    expect(got.find((t) => t.code === 'T4')).toMatchObject({ name: '팀 4', color: '#6b7280', active: false, projectId: null, workspaceId: W })
  })
  it('조회 오류·잘림(count 불일치)은 TeamsUnavailableError', async () => {
    await expect(workspaceTeams(W, { client: teamsClient([], { error: 'db down' }).client as never })).rejects.toBeInstanceOf(TeamsUnavailableError)
    await expect(workspaceTeams(W, { client: teamsClient([row(1)], { count: 2 }).client as never })).rejects.toBeInstanceOf(TeamsUnavailableError)
  })
  it('클라이언트를 넘기지 않으면 세션 클라이언트를 쓴다', async () => {
    const { client } = teamsClient([row(1)])
    h.createServerClient.mockResolvedValue(client)
    expect((await workspaceTeams(W)).map((t) => t.code)).toEqual(['T1'])
    expect(h.createServerClient).toHaveBeenCalledTimes(1)
  })
})
