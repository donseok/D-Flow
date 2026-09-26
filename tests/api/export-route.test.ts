import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// /api/export — 로그인 사용자 누구나 부를 수 있고 projectId 는 쿼리로 온다. 다른 워크스페이스 pid 는 RLS 로 WBS 가 빈
// 결과(오류 없음)라, 그대로 진행하면 xlsx 헤더에 service_role 팀 캐시의 그 프로젝트 팀(또는 그 워크스페이스 공용 팀)이
// 실렸다(교차 조회, SP2 Task 16b 리뷰). 볼 수 있는 프로젝트 목록에 없으면 팀 캐시를 건드리기 전에 404 다.
const mocks = vi.hoisted(() => ({
  state: { projects: [] as Array<{ id: string; name: string }>, degraded: false },
  getSession: vi.fn(async () => ({ id: 'u1' }) as { id: string } | null),
  getComputedWbs: vi.fn(async () => ({ items: [], holidays: [] })),
  activeTeamCodesForProjectSync: vi.fn<(projectId: string) => string[]>(() => ['A팀']),
  buildWbsWorkbook: vi.fn(() => new ArrayBuffer(8)),
}))
vi.mock('@/lib/auth', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/data/wbs', () => ({ getComputedWbs: mocks.getComputedWbs }))
vi.mock('@/app/actions/project', () => ({
  listProjects: vi.fn(async () => mocks.state.projects),
  listProjectsWithState: vi.fn(async () => mocks.state),
}))
vi.mock('@/lib/teams/master', () => ({ activeTeamCodesForProjectSync: mocks.activeTeamCodesForProjectSync }))
vi.mock('@/lib/data/projectConfig', () => ({ getProjectConfig: vi.fn(async () => ({ levelLabels: ['단계'], excelProfile: {} })) }))
vi.mock('@/lib/excel/export', () => ({ buildWbsWorkbook: mocks.buildWbsWorkbook }))
vi.mock('@/lib/excel/exportWithProfile', () => ({ buildWorkbookWithProfile: vi.fn() }))

import { GET } from '@/app/api/export/route'

const get = (projectId: string) => GET(new NextRequest(`http://localhost/api/export?projectId=${projectId}`))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.state = { projects: [{ id: 'p-mine', name: 'Acme' }], degraded: false }
})

describe('GET /api/export — 볼 수 없는 프로젝트는 팀 캐시 전에 404', () => {
  it('다른 워크스페이스 pid 는 404 — 팀 캐시·WBS·워크북 생성에 닿지 않는다', async () => {
    const res = await get('p-other-ws')
    expect(res.status).toBe(404)
    expect(mocks.activeTeamCodesForProjectSync).not.toHaveBeenCalled()
    expect(mocks.getComputedWbs).not.toHaveBeenCalled()
    expect(mocks.buildWbsWorkbook).not.toHaveBeenCalled()
  })

  it('볼 수 있는 프로젝트는 그 프로젝트 팀으로 내보낸다', async () => {
    const res = await get('p-mine')
    expect(res.status).toBe(200)
    expect(mocks.activeTeamCodesForProjectSync).toHaveBeenCalledWith('p-mine')
    expect(mocks.buildWbsWorkbook.mock.calls[0]).toContainEqual(['A팀'])
  })

  it('프로젝트 목록을 읽지 못했으면 500 — 조회 실패를 "없는 프로젝트"(404)로 위장하지 않는다', async () => {
    mocks.state = { projects: [], degraded: true }
    const res = await get('p-mine')
    expect(res.status).toBe(500)
    expect(mocks.activeTeamCodesForProjectSync).not.toHaveBeenCalled()
  })

  it('비로그인은 401', async () => {
    mocks.getSession.mockResolvedValueOnce(null)
    expect((await get('p-mine')).status).toBe(401)
  })
})
