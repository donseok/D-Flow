// 팀 코드 변경 뒤 엑셀 양식(wbs.excel_profile)의 팀 열 치환 — swapExcelProfileTeamCode.
// 전용 팀은 그 프로젝트 하나, 공용 팀은 전용 팀이 없는(상속) 프로젝트만. 옛 code 의 열만 바꾸고, 새 code 의 열이 이미 있으면 추측하지 않는다.
// 실패(읽기·쓰기)는 던지지 않고 건수로 돌려준다 — 코드 변경은 이미 커밋됐고 호출부가 알린다.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  getProjectConfig: vi.fn(), write: vi.fn(),
  projects: [] as { id: string }[], ownTeams: [] as { project_id: string }[], failList: false,
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/settings/projectConfig', () => ({ getProjectConfig: h.getProjectConfig }))
vi.mock('@/lib/settings/write', () => ({ writeProjectSettingsInternal: h.write }))
vi.mock('@/lib/settings/registry', () => ({ valueOf: (cfg: Record<string, unknown>, key: string) => cfg[key] }))

import { swapExcelProfileTeamCode } from '@/lib/teams/excelProfileCode'

const WS = 'ws-1'
const profile = (teamColumns: [number, string][]) => ({
  version: 1 as const, sheetName: 'WBS', holidaySheetName: null, headerRow: 0, hierarchy: { kind: 'outline' as const, column: 0 },
  logical: { extraAxis: null, code: 0, name: 1, deliverable: null, start: null, end: null, weight: null, actualPct: null },
  teamColumns, ownerMarks: { '●': 'primary' as const },
})
const admin = {
  from: (table: string) => {
    const q: Record<string, unknown> = {}
    Object.assign(q, {
      select: () => q, eq: () => q, not: () => q,
      then: (res: (v: unknown) => unknown) => Promise.resolve(
        h.failList ? { data: null, error: { message: 'boom' } } : { data: table === 'projects' ? h.projects : h.ownTeams, error: null }).then(res),
    })
    return q
  },
} as never

beforeEach(() => {
  vi.clearAllMocks()
  h.projects = []; h.ownTeams = []; h.failList = false
  h.write.mockResolvedValue({ ok: true, status: 'applied', revision: 2, commandId: 'c' })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('swapExcelProfileTeamCode', () => {
  it('전용 팀 — 그 프로젝트의 양식에서 옛 code 의 열만 새 code 로 바꿔 내부 쓰기 한 번', async () => {
    h.getProjectConfig.mockResolvedValue({ 'wbs.excel_profile': profile([[5, 'DEV'], [6, 'QA'], [7, 'DEV']]) })
    const r = await swapExcelProfileTeamCode(admin, { workspaceId: WS, projectId: 'p1' }, { from: 'DEV', to: 'ENG' }, 'u1')
    expect(r).toEqual({ swapped: 1, failed: 0 })
    expect(h.write).toHaveBeenCalledTimes(1)
    const [, pid, change, actor] = h.write.mock.calls[0]
    expect([pid, actor]).toEqual(['p1', 'u1'])
    expect(change.set['wbs.excel_profile'].teamColumns).toEqual([[5, 'ENG'], [6, 'QA'], [7, 'ENG']])
    expect(change.set['wbs.excel_profile'].sheetName).toBe('WBS')
  })
  it('양식이 없거나 옛 code 의 열이 없으면 쓰지 않는다', async () => {
    h.getProjectConfig.mockResolvedValueOnce({ 'wbs.excel_profile': null })
    expect(await swapExcelProfileTeamCode(admin, { workspaceId: WS, projectId: 'p1' }, { from: 'DEV', to: 'ENG' }, 'u1')).toEqual({ swapped: 0, failed: 0 })
    h.getProjectConfig.mockResolvedValueOnce({ 'wbs.excel_profile': profile([[5, 'QA'], [6, '*']]) })
    expect(await swapExcelProfileTeamCode(admin, { workspaceId: WS, projectId: 'p1' }, { from: 'DEV', to: 'ENG' }, 'u1')).toEqual({ swapped: 0, failed: 0 })
    expect(h.write).not.toHaveBeenCalled()
  })
  it('새 code 의 열이 이미 있으면 바꾸지 않고 실패로 센다(같은 팀의 열 둘을 만들지 않는다)', async () => {
    h.getProjectConfig.mockResolvedValue({ 'wbs.excel_profile': profile([[5, 'DEV'], [6, 'ENG']]) })
    expect(await swapExcelProfileTeamCode(admin, { workspaceId: WS, projectId: 'p1' }, { from: 'DEV', to: 'ENG' }, 'u1')).toEqual({ swapped: 0, failed: 1 })
    expect(h.write).not.toHaveBeenCalled()
  })
  it('공용 팀 — 전용 팀이 없는 프로젝트만 본다. 한 프로젝트의 실패가 나머지를 막지 않는다', async () => {
    h.projects = [{ id: 'inherit-1' }, { id: 'own-1' }, { id: 'inherit-2' }, { id: 'inherit-3' }]
    h.ownTeams = [{ project_id: 'own-1' }]
    h.getProjectConfig.mockImplementation(async (pid: string) => {
      if (pid === 'inherit-2') throw new Error('설정 손상')
      return { 'wbs.excel_profile': profile([[5, 'DEV']]) }
    })
    h.write.mockImplementation(async (_a: unknown, pid: string) =>
      pid === 'inherit-3' ? { ok: false, code: 'CONFIG_CONFLICT', error: '충돌' } : { ok: true, status: 'applied', revision: 2, commandId: 'c' })
    const r = await swapExcelProfileTeamCode(admin, { workspaceId: WS, projectId: null }, { from: 'DEV', to: 'ENG' }, 'u1')
    expect(r).toEqual({ swapped: 1, failed: 2 })
    expect(h.getProjectConfig.mock.calls.map((c) => c[0])).toEqual(['inherit-1', 'inherit-2', 'inherit-3'])
  })
  it('대상 프로젝트 목록을 못 읽으면 아무 양식도 바꾸지 않고 실패 한 건으로 알린다', async () => {
    h.failList = true
    expect(await swapExcelProfileTeamCode(admin, { workspaceId: WS, projectId: null }, { from: 'DEV', to: 'ENG' }, 'u1')).toEqual({ swapped: 0, failed: 1 })
    expect(h.getProjectConfig).not.toHaveBeenCalled()
  })
})
