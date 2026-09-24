import { beforeEach, describe, expect, it, vi } from 'vitest'

// llm-override 테스트와 동일 전략: service_role 클라이언트를 가짜 테이블로 대체.
// 모듈 초기화 top-level await 보다 모킹이 먼저 걸리도록 vi.hoisted 사용,
// 각 테스트는 vi.resetModules + 동적 import 로 콜드스타트를 재현한다.
const { db, createAdminClient } = vi.hoisted(() => {
  const db = {
    rows: null as Array<Record<string, unknown>> | null,
    error: null as { message: string } | null,
  }
  const createAdminClient = vi.fn(() => ({
    from: () => ({
      select: () => ({
        order: () => ({
          order: async () => ({ data: db.rows, error: db.error }),
        }),
      }),
    }),
  }))
  return { db, createAdminClient }
})
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }))

const ROWS = [
  { id: 't1', code: 'PMO', sort_order: 0, active: true, progress_visible: true },
  { id: 't2', code: '신팀', sort_order: 5, active: true, progress_visible: true },
  { id: 't3', code: '구팀', sort_order: 6, active: false, progress_visible: true },
]

async function importMaster() {
  vi.resetModules()
  return import('@/lib/teams/master')
}

describe('teams/master', () => {
  beforeEach(() => { db.rows = null; db.error = null })

  it('로드 성공 시 DB 값을 반환하고 활성 코드만 추린다', async () => {
    db.rows = ROWS
    const m = await importMaster()
    expect(m.teamsSync().map(t => t.code)).toEqual(['PMO', '신팀', '구팀'])
    expect(m.activeTeamCodesSync()).toEqual(['PMO', '신팀'])
    expect(m.isRegisteredTeamCode('구팀')).toBe(true)
    expect(m.isActiveTeamCode('구팀')).toBe(false)
    expect(m.isActiveTeamCode('없는팀')).toBe(false)
  })

  it('콜드스타트 로드 실패 시 빈 목록 — 기본 팀을 지어내지 않는다. 실패는 로그로 남는다', async () => {
    db.error = { message: 'down' }
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const m = await importMaster()
    expect(m.activeTeamCodesSync()).toEqual([])
    // 실패와 '정상적으로 빈 목록'을 가르는 유일한 신호가 이 로그다 — 빠지면 구분이 안 된다.
    expect(err).toHaveBeenCalledWith(expect.stringContaining('최초 팀 마스터 로드 실패'), 'down')
    err.mockRestore()
  })

  it('빈 전역 teams 는 정상 — 빈 목록, 오류 로그 없음', async () => {
    db.rows = []
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const m = await importMaster()
    expect(m.activeTeamCodesSync()).toEqual([])
    expect(err).not.toHaveBeenCalled()
    err.mockRestore()
  })

  it('갱신 실패 시 직전 유효값 유지(stale ≠ 폴백)', async () => {
    db.rows = ROWS
    const m = await importMaster()
    expect(m.teamsSync().map(t => t.code)).toContain('신팀')
    db.rows = null
    db.error = { message: 'down' }
    await m.refreshTeams()
    expect(m.teamsSync().map(t => t.code)).toContain('신팀')
  })

  it('refreshTeams는 저장 직후 최신 스냅샷을 반영한다', async () => {
    db.rows = ROWS
    const m = await importMaster()
    db.rows = [...ROWS, { id: 't4', code: '추가팀', sort_order: 7, active: true, progress_visible: true }]
    await m.refreshTeams()
    expect(m.activeTeamCodesSync()).toContain('추가팀')
  })

  it('프로젝트 행만 있고 전역 행이 0이어도 정상 로드 — 전역 0개는 폴백 대상이 아니다', async () => {
    db.rows = ROWS // 전역 3행으로 정상 기동
    const m = await importMaster()
    expect(m.teamsSync().map(t => t.code)).toEqual(['PMO', '신팀', '구팀'])

    // 갱신 시점에 전역 행이 전부 사라지고 프로젝트 행만 남는다 — 빈 DB 출발 플랫폼에선 정상 상태.
    db.rows = [{ id: 'tp1', code: '개발', sort_order: 0, active: true, progress_visible: true, project_id: 'p1' }]
    const ok = await m.refreshTeams()
    expect(ok).toBe(true)
    expect(m.teamsSync()).toEqual([]) // 전역 팀 0개 — 정상, 지어내지 않는다
    expect(m.teamsForProjectSync('p1').map(t => t.code)).toEqual(['개발'])
  })

  it('project_id가 있는 행은 Team.projectId로 매핑되고 teamsSync()는 전역 행만 반환한다(봉쇄)', async () => {
    db.rows = [
      ...ROWS,
      { id: 'tp1', code: '개발', sort_order: 0, active: true, progress_visible: true, project_id: 'proj-1' },
    ]
    const m = await importMaster()

    // DB 행 → Team.projectId 매핑이 실값으로 통과한다.
    expect(m.teamsForProjectSync('proj-1').map(t => t.code)).toEqual(['개발'])
    expect(m.projectTeamRowsSync('proj-1')).toEqual([
      { id: 'tp1', code: '개발', sortOrder: 0, active: true, progressVisible: true, projectId: 'proj-1' },
    ])

    // 전역 접근자는 프로젝트 행 혼입 없이 여전히 전역 3행만 반환한다(봉쇄).
    expect(m.teamsSync().map(t => t.code)).toEqual(['PMO', '신팀', '구팀'])
    expect(m.teamsSync().some(t => t.projectId !== null)).toBe(false)
  })
})
