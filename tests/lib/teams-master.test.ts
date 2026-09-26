import { beforeEach, describe, expect, it, vi } from 'vitest'

// llm-override 테스트와 동일 전략: service_role 클라이언트를 가짜 테이블로 대체.
// 모듈 초기화 top-level await 보다 모킹이 먼저 걸리도록 vi.hoisted 사용,
// 각 테스트는 vi.resetModules + 동적 import 로 콜드스타트를 재현한다.
// 캐시는 teams 와 projects(id, workspace_id) 를 한 로드에서 읽는다 — 어느 쪽이 실패해도 같은 로드 실패다.
const { db, createAdminClient } = vi.hoisted(() => {
  type Table = { rows: Array<Record<string, unknown>> | null; error: { message: string } | null; count?: number | null }
  const db = {
    teams: { rows: null, error: null } as Table,
    projects: { rows: [], error: null } as Table,
  }
  // PostgREST 처럼 한 응답은 max_rows(1000)에서 잘리고, range(from, to) 를 주면 그 구간만 준다. count 는 총합(지정하면 그 값).
  const MAX_ROWS = 1000
  const createAdminClient = vi.fn(() => ({
    from: (name: 'teams' | 'projects') => {
      const b: Record<string, unknown> = {}
      let range: [number, number] | null = null
      b.select = () => b
      b.order = () => b
      b.range = (from: number, to: number) => { range = [from, to]; return b }
      b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
        const t = db[name]
        const count = t.count === undefined ? (t.rows?.length ?? null) : t.count
        const from = range?.[0] ?? 0
        const rows = t.rows && t.rows.slice(from, Math.min(range ? range[1] + 1 : t.rows.length, from + MAX_ROWS))
        return Promise.resolve({ data: rows, error: t.error, count }).then(res, rej)
      }
      return b
    },
  }))
  return { db, createAdminClient }
})
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }))

const WA = 'ws-a'
const WB = 'ws-b'
const ROWS = [
  { id: 't1', code: 'PMO', sort_order: 0, active: true, progress_visible: true, workspace_id: WA },
  { id: 't2', code: '신팀', sort_order: 5, active: true, progress_visible: true, workspace_id: WA },
  { id: 't3', code: '구팀', sort_order: 6, active: false, progress_visible: true, workspace_id: WA },
]
const PROJECTS = [
  { id: 'p-a', workspace_id: WA },
  { id: 'p-a2', workspace_id: WA },
  { id: 'p-b', workspace_id: WB },
]
/** 두 워크스페이스 픽스처 — W1(WA) 공용 3 + 프로젝트 전용 1, W2(WB) 공용 2(1 비활성). */
const MIXED = [
  ...ROWS,
  { id: 'b1', code: 'B팀', sort_order: 0, active: true, progress_visible: true, workspace_id: WB },
  { id: 'b2', code: 'B휴면', sort_order: 1, active: false, progress_visible: true, workspace_id: WB },
  { id: 'ap', code: 'A프로젝트팀', sort_order: 0, active: true, progress_visible: true, workspace_id: WA, project_id: 'p-a' },
]

async function importMaster() {
  vi.resetModules()
  return import('@/lib/teams/master')
}

describe('teams/master', () => {
  beforeEach(() => {
    db.teams = { rows: null, error: null }
    db.projects = { rows: PROJECTS, error: null }
  })

  it('로드 성공 시 DB 값을 반환하고 활성 코드만 추린다', async () => {
    db.teams.rows = ROWS
    const m = await importMaster()
    expect(m.teamsForWorkspaceSync(WA).map(t => t.code)).toEqual(['PMO', '신팀', '구팀'])
    expect(m.activeTeamCodesForWorkspaceSync(WA)).toEqual(['PMO', '신팀'])
    expect(m.isRegisteredTeamCodeForProject('구팀', 'p-a')).toBe(true)
    expect(m.isActiveTeamCodeForProject('구팀', 'p-a')).toBe(false)
    expect(m.isActiveTeamCodeForProject('없는팀', 'p-a')).toBe(false)
  })

  it('콜드스타트 로드 실패 — 기본 팀을 지어내지 않고, 접근자는 빈 목록이 아니라 throw 한다. 실패는 로그로 남는다', async () => {
    db.teams.error = { message: 'down' }
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const m = await importMaster()
    expect(() => m.activeTeamCodesForWorkspaceSync(WA)).toThrow(/팀 마스터/)
    expect(err).toHaveBeenCalledWith(expect.stringContaining('최초 팀 마스터 로드 실패'), 'teams 조회 실패: down')
    err.mockRestore()
  })

  it('projects 조회 실패도 같은 로드 실패다 — 워크스페이스를 모르는 채로 팀만 싣지 않는다', async () => {
    db.teams.rows = ROWS
    db.projects = { rows: null, error: { message: 'projects down' } }
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const m = await importMaster()
    expect(err).toHaveBeenCalledWith(expect.stringContaining('최초 팀 마스터 로드 실패'), 'projects 조회 실패: projects down')
    expect(() => m.teamsForProjectSync('p-a')).toThrow(/팀 마스터/)
    err.mockRestore()
  })

  // max_rows(1000) 를 넘어도 페이지로 끝까지 읽는다 — 한 번에 읽으면 1000행에서 잘려 로드가 영영 실패했다(SP2 최종 리뷰 ERR-1).
  it('projects·teams 가 max_rows 를 넘으면(1500행) 두 페이지로 전부 싣는다', async () => {
    db.teams.rows = [...ROWS, ...Array.from({ length: 1497 }, (_, i) => (
      { id: `tp${i}`, code: `P${i}`, sort_order: 10, active: true, progress_visible: true, project_id: `p-${i}`, workspace_id: WB }))]
    db.projects = { rows: [...PROJECTS, ...Array.from({ length: 1497 }, (_, i) => ({ id: `p-${i}`, workspace_id: WB }))], error: null }
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const m = await importMaster()
    expect(err).not.toHaveBeenCalled()
    expect(m.teamsForProjectSync('p-1496').map(t => t.code)).toEqual(['P1496'])   // 1500번째 팀·프로젝트(두 번째 페이지)
    expect(m.teamsForWorkspaceSync(WA).map(t => t.code)).toEqual(['PMO', '신팀', '구팀'])
    err.mockRestore()
  })

  it('다 읽은 행 수가 count 와 다르면(잘림·페이지 사이 변경) 로드 실패 — 빠진 프로젝트가 조용히 팀 없음이 되지 않는다', async () => {
    db.teams.rows = ROWS
    db.projects = { rows: PROJECTS, error: null, count: PROJECTS.length + 1 }
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const m = await importMaster()
    expect(err).toHaveBeenCalledWith(expect.stringContaining('최초 팀 마스터 로드 실패'), expect.stringContaining('projects'))
    expect(() => m.teamsForProjectSync('p-a')).toThrow(/팀 마스터/)
    err.mockRestore()
  })

  it('teams 가 잘려 오면(max_rows) 로드 실패 — 빠진 팀이 조용히 사라지지 않는다', async () => {
    db.teams = { rows: ROWS, error: null, count: ROWS.length + 1 }
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const m = await importMaster()
    expect(err).toHaveBeenCalledWith(expect.stringContaining('최초 팀 마스터 로드 실패'), expect.stringContaining('teams'))
    expect(() => m.teamsForWorkspaceSync(WA)).toThrow(/팀 마스터/)
    err.mockRestore()
  })

  it.each(['teams', 'projects'] as const)('%s 의 count 가 없으면(null) 잘림을 확인할 수 없으므로 로드 실패', async (table) => {
    db.teams.rows = ROWS
    db[table] = { ...db[table], count: null }
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const m = await importMaster()
    expect(err).toHaveBeenCalledWith(expect.stringContaining('최초 팀 마스터 로드 실패'), expect.stringContaining(table))
    expect(() => m.teamsForProjectSync('p-a')).toThrow(/팀 마스터/)
    err.mockRestore()
  })

  it('빈 teams 는 정상 — 빈 목록, 오류 로그 없음', async () => {
    db.teams.rows = []
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const m = await importMaster()
    expect(m.activeTeamCodesForWorkspaceSync(WA)).toEqual([])
    expect(m.teamsForProjectSync('p-a')).toEqual([])
    expect(err).not.toHaveBeenCalled()
    err.mockRestore()
  })

  it('갱신 실패 시 직전 유효값 유지(stale ≠ 폴백)', async () => {
    db.teams.rows = ROWS
    const m = await importMaster()
    expect(m.teamsForWorkspaceSync(WA).map(t => t.code)).toContain('신팀')
    db.teams = { rows: null, error: { message: 'down' } }
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    await m.refreshTeams()
    expect(m.teamsForWorkspaceSync(WA).map(t => t.code)).toContain('신팀')
    expect(m.teamsForProjectSync('p-a').map(t => t.code)).toContain('신팀')
    err.mockRestore()
  })

  it('refreshTeams는 저장 직후 최신 스냅샷을 반영한다 — 새 프로젝트도 다음 로드부터 워크스페이스를 안다', async () => {
    db.teams.rows = ROWS
    const m = await importMaster()
    expect(m.teamsForProjectSync('p-new')).toEqual([])
    db.teams.rows = [...ROWS, { id: 't4', code: '추가팀', sort_order: 7, active: true, progress_visible: true, workspace_id: WA }]
    db.projects.rows = [...PROJECTS, { id: 'p-new', workspace_id: WA }]
    await m.refreshTeams()
    expect(m.activeTeamCodesForWorkspaceSync(WA)).toContain('추가팀')
    expect(m.activeTeamCodesForProjectSync('p-new')).toEqual(['PMO', '신팀', '추가팀'])
  })

  it('프로젝트 행만 있고 공용 행이 0이어도 정상 로드 — 공용 0개는 폴백 대상이 아니다', async () => {
    db.teams.rows = ROWS
    const m = await importMaster()
    expect(m.teamsForWorkspaceSync(WA).map(t => t.code)).toEqual(['PMO', '신팀', '구팀'])

    // 갱신 시점에 공용 행이 전부 사라지고 프로젝트 행만 남는다 — 빈 DB 출발 플랫폼에선 정상 상태.
    db.teams.rows = [{ id: 'tp1', code: '개발', sort_order: 0, active: true, progress_visible: true, project_id: 'p-a', workspace_id: WA }]
    const ok = await m.refreshTeams()
    expect(ok).toBe(true)
    expect(m.teamsForWorkspaceSync(WA)).toEqual([]) // 공용 팀 0개 — 정상, 지어내지 않는다
    expect(m.teamsForProjectSync('p-a').map(t => t.code)).toEqual(['개발'])
    expect(m.teamsForProjectSync('p-a2')).toEqual([])
  })

  it('project_id가 있는 행은 Team.projectId로 매핑되고 워크스페이스 접근자에는 섞이지 않는다(봉쇄)', async () => {
    db.teams.rows = [
      ...ROWS,
      { id: 'tp1', code: '개발', sort_order: 0, active: true, progress_visible: true, project_id: 'p-a', workspace_id: WA },
    ]
    const m = await importMaster()

    // DB 행 → Team.projectId 매핑이 실값으로 통과한다.
    expect(m.teamsForProjectSync('p-a').map(t => t.code)).toEqual(['개발'])
    expect(m.projectTeamRowsSync('p-a')).toEqual([
      { id: 'tp1', code: '개발', sortOrder: 0, active: true, progressVisible: true, projectId: 'p-a', workspaceId: WA },
    ])

    // 워크스페이스 접근자는 프로젝트 행 혼입 없이 공용 3행만 반환한다(봉쇄).
    expect(m.teamsForWorkspaceSync(WA).map(t => t.code)).toEqual(['PMO', '신팀', '구팀'])
    expect(m.teamsForWorkspaceSync(WA).some(t => t.projectId !== null)).toBe(false)
  })

  describe('워크스페이스 접근자(SP2 §4.2) — 캐시는 전 워크스페이스를 담고, 접근자가 한 워크스페이스로 좁힌다', () => {
    it('teamsForWorkspaceSync 는 그 워크스페이스의 공용 팀만(비활성 포함) — 다른 워크스페이스·프로젝트 팀은 없다', async () => {
      db.teams.rows = MIXED
      const m = await importMaster()
      expect(m.teamsForWorkspaceSync(WA).map(t => t.code)).toEqual(['PMO', '신팀', '구팀'])
      expect(m.teamsForWorkspaceSync(WB).map(t => t.code)).toEqual(['B팀', 'B휴면'])
      expect(m.teamsForWorkspaceSync(WA).every(t => t.workspaceId === WA && t.projectId === null)).toBe(true)
      expect(m.teamsForWorkspaceSync('ws-없음')).toEqual([])
    })

    it('activeTeamCodesForWorkspaceSync 는 그 워크스페이스의 활성 공용 팀 코드만', async () => {
      db.teams.rows = MIXED
      const m = await importMaster()
      expect(m.activeTeamCodesForWorkspaceSync(WA)).toEqual(['PMO', '신팀'])
      expect(m.activeTeamCodesForWorkspaceSync(WB)).toEqual(['B팀'])
    })

    it('한 번도 로드하지 못했으면 throw — 조회 실패를 빈 목록으로 위장하지 않는다', async () => {
      db.teams.error = { message: 'down' }
      const err = vi.spyOn(console, 'error').mockImplementation(() => {})
      const m = await importMaster()
      expect(() => m.teamsForWorkspaceSync(WA)).toThrow(/팀 마스터/)
      expect(() => m.activeTeamCodesForWorkspaceSync(WA)).toThrow(/팀 마스터/)
      expect(() => m.activeTeamsForWorkspacesSync([WA])).toThrow(/팀 마스터/)
      expect(() => m.activeTeamCodesVisibleToSync({ all: true })).toThrow(/팀 마스터/)
      err.mockRestore()
    })

    it('정상 로드 뒤의 갱신 실패는 직전 값을 쓴다(stale ≠ 실패)', async () => {
      db.teams.rows = MIXED
      const m = await importMaster()
      db.teams = { rows: null, error: { message: 'down' } }
      const err = vi.spyOn(console, 'error').mockImplementation(() => {})
      await m.refreshTeams()
      expect(m.activeTeamCodesForWorkspaceSync(WB)).toEqual(['B팀'])
      err.mockRestore()
    })

    it('workspace_id 가 없는 행은 로드 실패로 본다 — 워크스페이스를 모르는 팀을 캐시에 넣지 않는다', async () => {
      db.teams.rows = [{ id: 'x', code: 'X', sort_order: 0, active: true, progress_visible: true }]
      const err = vi.spyOn(console, 'error').mockImplementation(() => {})
      const m = await importMaster()
      expect(err).toHaveBeenCalledWith(expect.stringContaining('최초 팀 마스터 로드 실패'), expect.stringContaining('workspace_id'))
      expect(() => m.teamsForWorkspaceSync(WA)).toThrow(/팀 마스터/)
      err.mockRestore()
    })

    it('activeTeamsForWorkspacesSync 는 주어진 워크스페이스들의 활성 공용 팀만(앱 레이아웃용)', async () => {
      db.teams.rows = MIXED
      const m = await importMaster()
      expect(m.activeTeamsForWorkspacesSync([WA]).map(t => t.code)).toEqual(['PMO', '신팀'])
      expect(m.activeTeamsForWorkspacesSync([WB]).map(t => t.code)).toEqual(['B팀'])
      expect(m.activeTeamsForWorkspacesSync([])).toEqual([])
    })

    it('activeTeamCodesVisibleToSync 는 소속 워크스페이스 공용 + 볼 수 있는 프로젝트 전용, 플랫폼 관리자는 전부', async () => {
      db.teams.rows = MIXED
      const m = await importMaster()
      expect(m.activeTeamCodesVisibleToSync({ all: false, workspaceIds: [WA], projectIds: [] })).toEqual(['PMO', '신팀'])
      expect([...m.activeTeamCodesVisibleToSync({ all: false, workspaceIds: [WA], projectIds: ['p-a'] })].sort())
        .toEqual(['A프로젝트팀', 'PMO', '신팀'])
      expect([...m.activeTeamCodesVisibleToSync({ all: true })].sort()).toEqual(['A프로젝트팀', 'B팀', 'PMO', '신팀'])
    })
  })

  describe('프로젝트 접근자 — 폴백은 그 프로젝트 워크스페이스의 공용 팀뿐(SP2 Task 16b)', () => {
    it('(a) W1 프로젝트(전용 팀 없음)의 팀에 W2 공용 팀이 없다', async () => {
      db.teams.rows = MIXED
      const m = await importMaster()
      expect(m.teamsForProjectSync('p-a2').map(t => t.code)).toEqual(['PMO', '신팀', '구팀'])
      expect(m.teamsForProjectSync('p-a2').every(t => t.workspaceId === WA)).toBe(true)
      expect(m.teamsForProjectSync('p-b').map(t => t.code)).toEqual(['B팀', 'B휴면'])
    })

    it('활성 코드·등록 판정도 같은 폴백 — 다른 워크스페이스 공용 팀 코드는 통과하지 않는다', async () => {
      db.teams.rows = MIXED
      const m = await importMaster()
      expect(m.activeTeamCodesForProjectSync('p-a2')).toEqual(['PMO', '신팀'])
      expect(m.activeTeamCodesForProjectSync('p-a2')).not.toContain('B팀')
      expect(m.isRegisteredTeamCodeForProject('B팀', 'p-a2')).toBe(false)
      expect(m.isActiveTeamCodeForProject('B팀', 'p-a2')).toBe(false)
      expect(m.isRegisteredTeamCodeForProject('B팀', 'p-b')).toBe(true)
      // 전용 팀이 있는 프로젝트는 그것만.
      expect(m.activeTeamCodesForProjectSync('p-a')).toEqual(['A프로젝트팀'])
    })

    it('(b) 로드 전 호출은 throw, 로드 후 모르는 pid 는 [] — 캐시 미로드와 존재하지 않는 프로젝트를 구분한다', async () => {
      db.teams.error = { message: 'down' }
      const err = vi.spyOn(console, 'error').mockImplementation(() => {})
      const cold = await importMaster()
      expect(() => cold.teamsForProjectSync('p-a')).toThrow(/팀 마스터/)
      expect(() => cold.projectTeamRowsSync('p-a')).toThrow(/팀 마스터/)
      expect(() => cold.activeTeamCodesForProjectSync('p-a')).toThrow(/팀 마스터/)
      expect(() => cold.isRegisteredTeamCodeForProject('PMO', 'p-a')).toThrow(/팀 마스터/)
      expect(() => cold.workspaceTeamsForProjectSync('p-a')).toThrow(/팀 마스터/)
      err.mockRestore()

      db.teams = { rows: MIXED, error: null }
      const warm = await importMaster()
      expect(warm.teamsForProjectSync('p-없음')).toEqual([])
      expect(warm.projectTeamRowsSync('p-없음')).toEqual([])
      expect(warm.activeTeamCodesForProjectSync('p-없음')).toEqual([])
      expect(warm.workspaceTeamsForProjectSync('p-없음')).toEqual([])
    })

    it('프로젝트 회의록의 담당 검증(activeTeamCodesForMinuteScope)도 다른 워크스페이스 공용 팀 코드를 통과시키지 않는다', async () => {
      db.teams.rows = MIXED
      await importMaster()
      // resetModules 뒤의 같은 모듈 그래프 — teamScope 는 방금 로드한 캐시를 쓴다.
      const { activeTeamCodesForMinuteScope } = await import('@/lib/minutes/teamScope')
      expect(activeTeamCodesForMinuteScope({ projectId: 'p-a2', workspaceId: WA })).toEqual(['PMO', '신팀'])
      expect(activeTeamCodesForMinuteScope({ projectId: 'p-a2', workspaceId: WA })).not.toContain('B팀')
    })

    it('workspaceTeamsForProjectSync 는 프로젝트가 속한 워크스페이스의 공용 팀(전용 팀 유무와 무관) — 설정 화면의 상속 판정용', async () => {
      db.teams.rows = MIXED
      const m = await importMaster()
      expect(m.workspaceTeamsForProjectSync('p-a').map(t => t.code)).toEqual(['PMO', '신팀', '구팀'])
      expect(m.workspaceTeamsForProjectSync('p-b').map(t => t.code)).toEqual(['B팀', 'B휴면'])
    })
  })
})
