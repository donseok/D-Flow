import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import * as XLSX from 'xlsx'

// /api/export — 한 경로(SP4 §4.3, W22). 저장 양식이 있으면 그 양식, 없으면 프로젝트 팀·단계 이름으로 계산한 표준 양식 — 두 모드(접기·펼침)
// 모두 프로파일 빌더 한 길이다. 응답 머리 X-Excel-Layout 이 어느 쪽인지 알린다(조용한 대체가 아니다 — D48). 볼 수 없는 프로젝트는
// 팀·WBS 를 읽기 전에 404 다(SP2 Task 16b). 빌더는 실물을 감싼 vi.fn 이다 — 인자를 보고 실제 결과도 본다.
const mocks = vi.hoisted(() => ({
  state: { projects: [] as Array<{ id: string; name: string }>, degraded: false },
  getSession: vi.fn(async () => ({ id: 'u1' }) as { id: string } | null),
  getComputedWbs: vi.fn(),
  projectTeams: vi.fn(),
  getProjectConfig: vi.fn(),
  buildWorkbookWithProfile: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/data/wbs', () => ({ getComputedWbs: mocks.getComputedWbs }))
vi.mock('@/app/actions/project', () => ({ listProjectsWithState: vi.fn(async () => mocks.state) }))
vi.mock('@/lib/teams/source', async () => {
  const base = (await import('../helpers/teams-source-mock')).teamsSourceMock()
  return { ...base, projectTeams: mocks.projectTeams }
})
vi.mock('@/lib/settings/projectConfig', () => ({ getProjectConfig: mocks.getProjectConfig }))
vi.mock('@/lib/excel/exportWithProfile', () => ({ buildWorkbookWithProfile: mocks.buildWorkbookWithProfile }))

import { GET } from '@/app/api/export/route'
import { makeProjectConfig } from '../helpers/projectConfigFixture'
import { teamRows } from '../helpers/teams-source-mock'
import { ConfigKeyError, ConfigUnavailableError, CONFIG_MESSAGES } from '@/lib/settings/errors'
import { deriveStandardExcelProfile } from '@/lib/excel/standardProfile'
import { computeTree } from '@/lib/domain/rollup'
import { TeamsUnavailableError } from '@/lib/teams/source'
import type { ExcelProfile } from '@/lib/excel/profile'
import type { ComputedItem, WbsRow } from '@/lib/domain/types'
import { calUtcSun } from '../helpers/calendarFixture'

const get = (projectId: string, expand = false) => GET(new NextRequest(`http://localhost/api/export?projectId=${projectId}${expand ? '&expand=1' : ''}`))
const SAVED: ExcelProfile = {
  version: 1, sheetName: '일정', holidaySheetName: null, headerRow: 0,
  hierarchy: { kind: 'columns', columns: [0, 1] },
  logical: { extraAxis: null, code: null, name: null, deliverable: 2, start: 3, end: 4, weight: null, actualPct: 5 },
  teamColumns: [[6, 'RES']], ownerMarks: { '●': 'primary', '△': 'support' },
}
const row = (over: Partial<WbsRow>): WbsRow => ({ id: 'x', parentId: null, code: 'x', sortOrder: 0, name: 'x', biz: null, deliverable: null,
  plannedStart: null, plannedEnd: null, weight: null, actualPct: null, owners: [], isOwnerSplit: false, ...over })
/** 단계 이름(2)보다 깊은 트리 + 깊은 잎의 sub-act 둘 */
const DEEP: ComputedItem[] = computeTree([
  row({ id: 'a', name: '1' }), row({ id: 'b', parentId: 'a', name: '2' }), row({ id: 'c', parentId: 'b', name: '3' }),
  row({ id: 'd', parentId: 'c', name: '깊은 잎', owners: [{ team: 'RES', kind: 'primary' }, { team: 'OPS', kind: 'support' }] }),
  row({ id: 'd0', parentId: 'd', name: '깊은 잎 (RES)', owners: [{ team: 'RES', kind: 'primary' }], isOwnerSplit: true }),
  row({ id: 'd1', parentId: 'd', name: '깊은 잎 (OPS)', owners: [{ team: 'OPS', kind: 'support' }], isOwnerSplit: true }),
], '2026-03-02', calUtcSun, { subActTeamOrder: new Map([['RES', 0], ['OPS', 1]]) })

beforeEach(async () => {
  vi.clearAllMocks()
  const actual = await vi.importActual<typeof import('@/lib/excel/exportWithProfile')>('@/lib/excel/exportWithProfile')
  mocks.buildWorkbookWithProfile.mockImplementation(actual.buildWorkbookWithProfile)
  mocks.state = { projects: [{ id: 'p-mine', name: 'Acme' }], degraded: false }
  mocks.getProjectConfig.mockResolvedValue(makeProjectConfig({ 'core.level_labels': ['단계', '작업'] }))
  mocks.getComputedWbs.mockResolvedValue({ items: [], holidays: [], calendar: calUtcSun })
  mocks.projectTeams.mockResolvedValue([...teamRows(['RES']), ...teamRows(['OLD'], { active: false, id: 't-OLD2' })])
})

describe('GET /api/export — 볼 수 없는 프로젝트는 팀·WBS 전에 404', () => {
  it('다른 워크스페이스 pid 는 404 — 팀·WBS·빌더에 닿지 않는다', async () => {
    expect((await get('p-other-ws')).status).toBe(404)
    expect(mocks.projectTeams).not.toHaveBeenCalled()
    expect(mocks.getComputedWbs).not.toHaveBeenCalled()
    expect(mocks.buildWorkbookWithProfile).not.toHaveBeenCalled()
  })
  it('프로젝트 목록을 읽지 못했으면 500 — "없는 프로젝트"(404)로 위장하지 않는다', async () => {
    mocks.state = { projects: [], degraded: true }
    expect((await get('p-mine')).status).toBe(500)
  })
  it('비로그인은 401', async () => {
    mocks.getSession.mockResolvedValueOnce(null)
    expect((await get('p-mine')).status).toBe(401)
  })
})

describe('GET /api/export — 저장 양식 없음 → 표준(W22)', () => {
  it.each([false, true])('expand=%s 모두 200·X-Excel-Layout standard, 프로필 = 활성 프로젝트 팀·단계 이름으로 계산', async (expand) => {
    const res = await get('p-mine', expand)
    expect(res.status).toBe(200)
    expect(res.headers.get('X-Excel-Layout')).toBe('standard')
    const [, profile, , opts, name] = mocks.buildWorkbookWithProfile.mock.calls[0]
    expect(profile).toEqual(deriveStandardExcelProfile(['RES'], ['단계', '작업']))
    expect(opts).toEqual({ expandSubActs: expand, levelLabels: ['단계', '작업'], deep: 'fold' })
    expect(name).toBe('Acme')
  })
  it('비활성 팀이라도 담당이 있으면 열이 뒤에 붙는다(옛 빌더와 같은 규칙)', async () => {
    mocks.getComputedWbs.mockResolvedValue({ items: computeTree([row({ id: 'a', name: '잎', owners: [{ team: 'OLD', kind: 'primary' }] })], '2026-03-02', calUtcSun, { subActTeamOrder: new Map() }), holidays: [], calendar: calUtcSun })
    await get('p-mine')
    expect(mocks.buildWorkbookWithProfile.mock.calls[0][1].teamColumns.map(([, c]: [number, string]) => c)).toEqual(['RES', 'OLD'])
  })
  it('깊은 트리 — 표준은 접어 200, 펼침의 sub-act 는 세부업무 열에(Q40)', async () => {
    mocks.getComputedWbs.mockResolvedValue({ items: DEEP, holidays: [], calendar: calUtcSun })
    const res = await get('p-mine', true)
    expect(res.status).toBe(200)
    const wb = XLSX.read(Buffer.from(await res.arrayBuffer()), { type: 'buffer' })
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.WBS, { header: 1, blankrows: false, defval: '' })
    const insertAt = 1 + 2
    expect(aoa[2][insertAt]).toBe('세부업무')
    expect(aoa.slice(3).filter((r) => r[insertAt] !== '').map((r) => r[insertAt]).sort()).toEqual(['깊은 잎 (OPS)', '깊은 잎 (RES)'])
    expect(aoa.slice(3).some((r) => r[2] === '깊은 잎')).toBe(true)   // 마지막 계층 열(2)로 접혔다
  })
  it('팀 원천 실패는 503 TEAMS_UNAVAILABLE — 빈 팀 열로 내보내지 않는다', async () => {
    mocks.projectTeams.mockRejectedValueOnce(new TeamsUnavailableError())
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await get('p-mine')
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: '프로젝트 팀을 확인할 수 없습니다.', code: 'TEAMS_UNAVAILABLE' })
    expect(mocks.buildWorkbookWithProfile).not.toHaveBeenCalled()
    err.mockRestore()
  })
  it('[U5] WBS 를 읽는 단계(getComputedWbs — 같은 팀 원천을 먼저 읽는다)의 팀 원천 실패도 503 TEAMS_UNAVAILABLE — 본문 없는 500 이 아니다(저장 양식 경로 포함)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.getComputedWbs.mockRejectedValueOnce(new TeamsUnavailableError())
    const res = await get('p-mine')
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: '프로젝트 팀을 확인할 수 없습니다.', code: 'TEAMS_UNAVAILABLE' })
    expect(mocks.buildWorkbookWithProfile).not.toHaveBeenCalled()
    err.mockRestore()
  })
  it('WBS 달력 손상(getComputedWbs 의 ConfigKeyError)은 configStatus 와 키 — 일반 500 이 아니다(A-3 리뷰 P3, M5)', async () => {
    mocks.getComputedWbs.mockRejectedValueOnce(new ConfigKeyError('CONFIG_INVALID', 'calendar.timezone'))
    const res = await get('p-mine')
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: `${CONFIG_MESSAGES.CONFIG_INVALID} (calendar.timezone)`, code: 'CALENDAR_INVALID', key: 'calendar.timezone' })
  })
  it('WBS 의 설정 조회 실패(getComputedWbs 의 ConfigUnavailableError)는 503 고정 문구 — 일반 500 이 아니다(A-4 리뷰 N5)', async () => {
    mocks.getComputedWbs.mockRejectedValueOnce(new ConfigUnavailableError('휴일 조회 실패: boom'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await get('p-mine')
    err.mockRestore()
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: '프로젝트 설정을 확인할 수 없습니다.' })
    expect(mocks.buildWorkbookWithProfile).not.toHaveBeenCalled()
  })
  it('표준 경로의 빌더 거부는 결함 — 500 고정 문구와 로그(거부 문구 "저장된 양식 비우기"가 표준의 처방으로 나가지 않는다)', async () => {
    mocks.buildWorkbookWithProfile.mockReturnValueOnce({ ok: false, error: '저장된 엑셀 양식의 계층 열(2개)보다 WBS가 깊습니다 — 설정 화면의 "저장된 양식 비우기"로 양식을 비우세요' })
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await get('p-mine')
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: '엑셀 파일을 만들지 못했습니다.' })
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })
})

describe('GET /api/export — 저장 양식·손상', () => {
  it.each([false, true])('저장 양식은 expand=%s 에서도 그 양식, deep reject, X-Excel-Layout saved — 팀 원천을 읽지 않는다', async (expand) => {
    mocks.getProjectConfig.mockResolvedValue(makeProjectConfig({ 'core.level_labels': ['단계', '작업'], 'wbs.excel_profile': SAVED }))
    const res = await get('p-mine', expand)
    expect(res.status).toBe(200)
    expect(res.headers.get('X-Excel-Layout')).toBe('saved')
    const [, profile, , opts] = mocks.buildWorkbookWithProfile.mock.calls[0]
    expect(profile).toEqual(SAVED)
    expect(opts).toEqual({ expandSubActs: expand, levelLabels: ['단계', '작업'], deep: 'reject' })
    expect(mocks.projectTeams).not.toHaveBeenCalled()
  })
  it('저장 양식 + 깊은 트리는 400 과 그 사유(저장 양식에는 맞는 처방)', async () => {
    mocks.getProjectConfig.mockResolvedValue(makeProjectConfig({ 'core.level_labels': ['단계', '작업'], 'wbs.excel_profile': SAVED }))
    mocks.getComputedWbs.mockResolvedValue({ items: DEEP, holidays: [], calendar: calUtcSun })
    const res = await get('p-mine')
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('저장된 양식 비우기')
  })
  it('저장 양식이 outline 이면 펼침은 400(지금 그대로)', async () => {
    const OUTLINE: ExcelProfile = { ...SAVED, hierarchy: { kind: 'outline', column: 0 }, logical: { ...SAVED.logical, name: 1 } }
    mocks.getProjectConfig.mockResolvedValue(makeProjectConfig({ 'core.level_labels': ['단계'], 'wbs.excel_profile': OUTLINE }))
    expect((await get('p-mine', true)).status).toBe(400)
  })
  it('손상 양식은 접기·펼침 모두 422 — 빌더·WBS 에 닿지 않는다', async () => {
    mocks.getProjectConfig.mockResolvedValue(makeProjectConfig({ 'core.level_labels': ['단계'], 'wbs.excel_profile': { version: 2 } }))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    for (const expand of [false, true]) {
      const res = await get('p-mine', expand)
      expect(res.status).toBe(422)
      expect(await res.json()).toMatchObject({ code: 'PROFILE_CORRUPT' })
    }
    expect(mocks.buildWorkbookWithProfile).not.toHaveBeenCalled()
    expect(mocks.getComputedWbs).not.toHaveBeenCalled()
    err.mockRestore()
  })
  it('단계 이름 손상·부재는 지금처럼 422·409(CONFIG_*) — PROFILE_REQUIRED 409 는 더 없다', async () => {
    mocks.getProjectConfig.mockResolvedValue(makeProjectConfig({ 'core.level_labels': ['A', 'A'] }))
    expect(await (await get('p-mine')).json()).toMatchObject({ code: 'CONFIG_INVALID' })
    mocks.getProjectConfig.mockResolvedValue(makeProjectConfig({}))
    const res = await get('p-mine', true)
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'CONFIG_REQUIRED' })
  })
  it('설정 조회 실패는 503 고정 문구 — 팀·WBS 를 읽지 않는다', async () => {
    mocks.getProjectConfig.mockRejectedValueOnce(new ConfigUnavailableError('프로젝트 설정 조회 실패: boom'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await get('p-mine', true)
    expect(res.status).toBe(503)
    expect(await res.text()).not.toContain('boom')
    expect(mocks.projectTeams).not.toHaveBeenCalled()
    expect(mocks.getComputedWbs).not.toHaveBeenCalled()
    err.mockRestore()
  })
})

describe('GET /api/export — Holiday 시트(SP5 D7)', () => {
  it('휴무만 — 근무 예외는 내보내지 않고 이름을 싣는다(해석기의 날짜 예외가 원천)', async () => {
    mocks.getProjectConfig.mockResolvedValue({ ...makeProjectConfig({ 'core.level_labels': ['단계', '작업'] }), holidays: [
      { date: '2026-10-05', name: '창립기념일', kind: 'off' }, { date: '2026-10-10', name: '대체 근무', kind: 'work' },
    ] })
    expect((await get('p-mine')).status).toBe(200)
    expect(mocks.buildWorkbookWithProfile.mock.calls[0][2]).toEqual([{ date: '2026-10-05', name: '창립기념일' }])
  })
})
