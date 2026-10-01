// 가져오기의 미등록 팀 멱등 등록(스펙 §4.4 #6 — D4·Q36). 늘 그 프로젝트의 전용 팀, "이미 있으면 성공"(사전 조회 + 23505).
// 정규화·예약어는 addProjectTeam 과 같은 normalizeNewTeamCode — 예약어는 호출부가 넘긴다(SP4 D38: 머리 낱말 ∪ 그 프로젝트 단계 이름). DB 오류 원문은 결과에 싣지 않는다(failWith — 로그로만, 스펙 §4.7).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ adminFor: vi.fn() }))
vi.mock('@/lib/supabase/adminFor', () => ({ adminFor: h.adminFor }))

import { ERR_REGISTER_TEAMS, ensureProjectTeams } from '@/lib/teams/register'
import { pickTeamColor } from '@/lib/domain/teamColor'
import { normalizeNewTeamCode, reservedTeamNames } from '@/lib/domain/teams'

const P = '00000000-0000-0000-7e57-0000000018d1'   // 단위 테스트 픽스처 id(GC — 18d0~18df 는 이 파일)
const W = '00000000-0000-0000-7e57-00000000aa4d'
const SCOPE = { projectId: P, workspaceId: W }
/** 호출부(가져오기 라우트)가 그 프로젝트 설정으로 파생해 넘기는 예약어(SP4 D38) — 머리 낱말 ∪ 단계 이름 */
const RESERVED = reservedTeamNames({ levelLabels: ['단계', '작업'], extraAxisLabel: null })

type DbError = { code?: string; message: string }
/** service_role 클라이언트 흉내 — teams 표 하나. select('code') 는 사전 조회(have), select('sort_order') 는 순번 조회(maxSort),
 *  insert 는 차례 응답(inserts — null 이면 성공). 걸린 필터와 넣은 행을 기록한다 */
function teamsAdmin(opts: {
  have?: string[]; haveError?: string; maxSort?: number | null; maxError?: string; inserts?: Array<DbError | null>
} = {}) {
  const inserted: Array<Record<string, unknown>> = []
  const filters: Array<[string, string, unknown]> = []
  const queue = [...(opts.inserts ?? [])]
  const admin = {
    from: (table: string) => {
      if (table !== 'teams') throw new Error(`unexpected table ${table}`)
      let cols = ''
      const b: Record<string, unknown> = {}
      b.select = (c: string) => { cols = c; return b }
      b.eq = (col: string, v: unknown) => { filters.push(['eq', col, v]); return b }
      b.in = (col: string, v: unknown) => { filters.push(['in', col, v]); return b }
      b.order = () => b
      b.limit = () => b
      b.maybeSingle = async () => opts.maxError
        ? { data: null, error: { message: opts.maxError } }
        : { data: opts.maxSort == null ? null : { sort_order: opts.maxSort }, error: null }
      b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(
        cols !== 'code' ? { data: null, error: { message: `unexpected select ${cols}` } }
          : opts.haveError ? { data: null, error: { message: opts.haveError } }
            : { data: (opts.have ?? []).map((code) => ({ code })), error: null },
      ).then(res, rej)
      b.insert = async (row: Record<string, unknown>) => { inserted.push(row); return { data: null, error: queue.shift() ?? null } }
      return b
    },
  }
  h.adminFor.mockImplementation((scope: { projectId: string }) => ({ ...scope, admin }))
  return { inserted, filters }
}
/** console.error 인자에 원문이 있는가 — failWith 가 원문을 무엇으로 싣든(문자열·Error·객체) 찾는다 */
const logged = (spy: { mock: { calls: unknown[][] } }, text: string) =>
  spy.mock.calls.flat().some((x) => (x instanceof Error ? x.message : typeof x === 'string' ? x : JSON.stringify(x) ?? '').includes(text))

beforeEach(() => { vi.clearAllMocks() })
afterEach(() => { vi.restoreAllMocks() })

describe('ensureProjectTeams — 늘 전용 팀, 이미 있으면 성공', () => {
  it('사전 조회의 기존 팀은 건너뛰고 없는 팀만 만든다 — 순번 max+1 부터, 색은 그 순번의 팔레트, 워크스페이스는 받은 값(공백·중복 정규화)', async () => {
    const { inserted, filters } = teamsAdmin({ have: ['RES'], maxSort: 4 })
    expect(await ensureProjectTeams(SCOPE, ['RES', 'OPS', 'OPS', ' QA '], RESERVED)).toEqual({ ok: true, created: ['OPS', 'QA'], existing: ['RES'] })
    expect(inserted).toEqual([
      { code: 'OPS', name: 'OPS', sort_order: 5, project_id: P, workspace_id: W, color: pickTeamColor(5) },
      { code: 'QA', name: 'QA', sort_order: 6, project_id: P, workspace_id: W, color: pickTeamColor(6) },
    ])
    expect(filters).toEqual(expect.arrayContaining([['eq', 'project_id', P], ['in', 'code', ['RES', 'OPS', 'QA']]]))
    expect(h.adminFor).toHaveBeenCalledWith({ projectId: P })
  })
  it('전용 팀이 0개면 순번 0 부터', async () => {
    const { inserted } = teamsAdmin({ maxSort: null })
    await ensureProjectTeams(SCOPE, ['RES'], RESERVED)
    expect(inserted).toEqual([expect.objectContaining({ code: 'RES', sort_order: 0, color: pickTeamColor(0) })])
  })
  it('insert 의 23505(같은 명령의 동시 재전송이 먼저 만들었다)는 이미 있음 = 성공 — 500 이 아니다', async () => {
    teamsAdmin({ inserts: [{ code: '23505', message: 'duplicate key value violates unique constraint' }, null] })
    expect(await ensureProjectTeams(SCOPE, ['OPS', 'QA'], RESERVED)).toEqual({ ok: true, created: ['QA'], existing: ['OPS'] })
  })
  it('재시도(모두 이미 있음)는 insert 없이 성공', async () => {
    const { inserted } = teamsAdmin({ have: ['OPS', 'QA'] })
    expect(await ensureProjectTeams(SCOPE, ['OPS', 'QA'], RESERVED)).toEqual({ ok: true, created: [], existing: ['OPS', 'QA'] })
    expect(inserted).toEqual([])
  })
  it('빈 목록은 DB 를 부르지 않는다', async () => {
    expect(await ensureProjectTeams(SCOPE, [], RESERVED)).toEqual({ ok: true, created: [], existing: [] })
    expect(h.adminFor).not.toHaveBeenCalled()
  })
})

describe('ensureProjectTeams — 거부와 실패', () => {
  it.each(['   ', 'X'.repeat(21), '담당', '작업', 'start'])('팀 이름으로 쓸 수 없는 %j 가 하나라도 있으면 INVALID_TEAM_CODE — 아무것도 만들지 않는다(DB 미호출)', async (bad) => {
    teamsAdmin()
    const n = normalizeNewTeamCode(bad, RESERVED)
    expect(n.ok).toBe(false)
    expect(await ensureProjectTeams(SCOPE, ['RES', bad], RESERVED)).toEqual({ ok: false, code: 'INVALID_TEAM_CODE', error: n.ok ? '' : n.error, team: bad })
    expect(h.adminFor).not.toHaveBeenCalled()
  })
  it('사전 조회 실패는 중단 — insert 없음, 결과는 고정 문구, 원문은 로그로만', async () => {
    const { inserted } = teamsAdmin({ haveError: 'permission denied for table teams' })
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await ensureProjectTeams(SCOPE, ['OPS'], RESERVED)).toEqual({ ok: false, code: 'TEAM_REGISTER_FAILED', error: ERR_REGISTER_TEAMS, team: 'OPS' })
    expect(inserted).toEqual([])
    expect(logged(err, 'permission denied')).toBe(true)
  })
  it('순번 조회 실패도 중단 — insert 없음', async () => {
    const { inserted } = teamsAdmin({ maxError: 'db down' })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await ensureProjectTeams(SCOPE, ['OPS'], RESERVED)).toEqual({ ok: false, code: 'TEAM_REGISTER_FAILED', error: ERR_REGISTER_TEAMS, team: 'OPS' })
    expect(inserted).toEqual([])
  })
  it('23505 가 아닌 insert 실패는 그 팀에서 멈춘다 — 앞서 만든 팀은 남는다(트랜잭션 밖 — 스펙 §4.4 #6)', async () => {
    const { inserted } = teamsAdmin({ inserts: [null, { code: '23514', message: 'WORKSPACE_SCOPE_MISMATCH' }] })
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await ensureProjectTeams(SCOPE, ['OPS', 'QA'], RESERVED)
    expect(r).toEqual({ ok: false, code: 'TEAM_REGISTER_FAILED', error: ERR_REGISTER_TEAMS, team: 'QA' })
    expect(JSON.stringify(r)).not.toContain('WORKSPACE_SCOPE_MISMATCH')
    expect(inserted.map((x) => x.code)).toEqual(['OPS', 'QA'])
    expect(logged(err, 'WORKSPACE_SCOPE_MISMATCH')).toBe(true)
  })
})
