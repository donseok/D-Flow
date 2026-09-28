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
  getProjectConfig: vi.fn(),
  buildWorkbookWithProfile: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/data/wbs', () => ({ getComputedWbs: mocks.getComputedWbs }))
vi.mock('@/app/actions/project', () => ({
  listProjects: vi.fn(async () => mocks.state.projects),
  listProjectsWithState: vi.fn(async () => mocks.state),
}))
vi.mock('@/lib/teams/master', () => ({ activeTeamCodesForProjectSync: mocks.activeTeamCodesForProjectSync }))
vi.mock('@/lib/settings/projectConfig', () => ({ getProjectConfig: mocks.getProjectConfig }))
vi.mock('@/lib/excel/export', () => ({ buildWbsWorkbook: mocks.buildWbsWorkbook }))
vi.mock('@/lib/excel/exportWithProfile', () => ({ buildWorkbookWithProfile: mocks.buildWorkbookWithProfile }))
// @/lib/excel/profile 은 mock 하지 않는다 — 실제 validateProfile 로 손상 판정을 태운다.

import { GET } from '@/app/api/export/route'
import { makeProjectConfig } from '../helpers/projectConfigFixture'
import { ConfigUnavailableError } from '@/lib/settings/errors'
import type { ExcelProfile } from '@/lib/excel/profile'

const get = (projectId: string, expand = false) =>
  GET(new NextRequest(`http://localhost/api/export?projectId=${projectId}${expand ? '&expand=1' : ''}`))

const SAVED: ExcelProfile = {
  version: 1, sheetName: '일정', holidaySheetName: null, headerRow: 0,
  hierarchy: { kind: 'columns', columns: [0, 1] },
  logical: { extraAxis: null, code: null, name: null, deliverable: 2, start: 3, end: 4, weight: null, actualPct: 5 },
  teamColumns: [[6, '팀A'], [7, '팀B']], ownerMarks: { '●': 'primary', '△': 'support' },
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.state = { projects: [{ id: 'p-mine', name: 'Acme' }], degraded: false }
  mocks.getProjectConfig.mockResolvedValue(makeProjectConfig({ 'core.level_labels': ['단계'] }))
  mocks.buildWorkbookWithProfile.mockReturnValue({ ok: true, buffer: new ArrayBuffer(4) })
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

describe('GET /api/export — 저장 양식·부재·손상', () => {
  it.each([false, true])('저장 양식은 expand=%s 에서도 그 양식으로 만들고 expandSubActs 만 다르다', async (expand) => {
    mocks.getProjectConfig.mockResolvedValue(makeProjectConfig({ 'core.level_labels': ['단계', '작업'], 'wbs.excel_profile': SAVED }))
    const res = await get('p-mine', expand)
    expect(res.status).toBe(200)
    expect(mocks.buildWbsWorkbook).not.toHaveBeenCalled()
    const [, profile, , opts, name] = mocks.buildWorkbookWithProfile.mock.calls[0]
    expect(profile).toEqual(SAVED)
    expect(opts).toEqual({ expandSubActs: expand, levelLabels: ['단계', '작업'] })
    expect(name).toBe('Acme')
  })

  it('손상 양식은 접기·펼침 모두 422 — 어떤 빌더도 부르지 않는다(LEGACY 폴백 없음)', async () => {
    mocks.getProjectConfig.mockResolvedValue(makeProjectConfig({ 'core.level_labels': ['단계'], 'wbs.excel_profile': { version: 2 } }))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    for (const expand of [false, true]) {
      const res = await get('p-mine', expand)
      expect(res.status).toBe(422)
      // 안내는 설정 화면의 '저장된 양식 비우기' — 마법사 재저장은 가져오기를 다시 해야 해서 막힌 사용자에게 위험하다.
      expect((await res.json()).error).toMatch(/손상.*설정 화면의 "저장된 양식 비우기"/)
    }
    expect(mocks.buildWorkbookWithProfile).not.toHaveBeenCalled()
    expect(mocks.buildWbsWorkbook).not.toHaveBeenCalled()
    expect(mocks.getComputedWbs).not.toHaveBeenCalled()
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })

  it('저장 양식이 없는데 펼침이면 409 — WBS 도 읽지 않는다', async () => {
    const res = await get('p-mine', true)
    expect(res.status).toBe(409)
    expect((await res.json()).error).toContain('프로젝트 기본값으로 저장')
    expect(mocks.buildWorkbookWithProfile).not.toHaveBeenCalled()
    expect(mocks.getComputedWbs).not.toHaveBeenCalled()
  })

  it('저장 양식이 없으면 접기는 지금처럼 buildWbsWorkbook(프로젝트 팀·단계 라벨)', async () => {
    const res = await get('p-mine')
    expect(res.status).toBe(200)
    expect(mocks.buildWbsWorkbook).toHaveBeenCalledWith([], [], 'Acme', ['A팀'], ['단계'])
  })

  it('빌더 거부는 400 과 그 사유', async () => {
    mocks.getProjectConfig.mockResolvedValue(makeProjectConfig({ 'core.level_labels': ['단계'], 'wbs.excel_profile': SAVED }))
    mocks.buildWorkbookWithProfile.mockReturnValueOnce({ ok: false, error: '아웃라인 양식의 펼침 익스포트는 아직 지원되지 않습니다' })
    const res = await get('p-mine', true)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: '아웃라인 양식의 펼침 익스포트는 아직 지원되지 않습니다' })
  })

  it('설정 조회 실패는 503 이고 설정은 한 번만 읽는다 — 본문은 고정 문구, DB 사유는 서버 로그에만', async () => {
    const boom = new ConfigUnavailableError('프로젝트 설정 조회 실패: relation "project_settings" boom')
    mocks.getProjectConfig.mockRejectedValueOnce(boom)
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await get('p-mine', true)
    expect(res.status).toBe(503)
    const body = await res.text()
    expect(body).not.toContain('boom')
    expect(body).not.toContain('project_settings')
    expect(JSON.parse(body)).toEqual({ error: '프로젝트 설정을 확인할 수 없습니다.' })
    expect(err.mock.calls.some(c => c.some(x => String(x).includes('boom')))).toBe(true)
    expect(mocks.getProjectConfig).toHaveBeenCalledTimes(1)
    expect(mocks.getComputedWbs).not.toHaveBeenCalled()
    expect(mocks.activeTeamCodesForProjectSync).not.toHaveBeenCalled()
    err.mockRestore()
  })
})
