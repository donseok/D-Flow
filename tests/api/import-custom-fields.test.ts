// 가져오기 마법사의 사용자 정의 필드 열(개정 §3.6.7 "임포트 마법사 자동 감지") — 라우트 배선.
// inspect: 헤더가 필드 라벨·key 와 같으면 감지 양식의 customColumns 로 제안한다. execute: 값을 TS 판정으로 미리 검사해 행 단위 오류 표
// (LINK_ERRORS 와 같은 errors[])에 싣고, 통과한 값은 필드 유형의 값으로 바꿔 RPC 에 넘긴다. 제안·검사의 규칙 자체는
// tests/excel/custom-columns-import.test.ts 가 본다. mock 관례는 tests/api/import-execute.test.ts 와 같다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireProjectAdmin: vi.fn(), parseWithProfile: vi.fn(), linkByDepth: vi.fn(), resolveLegacyLevelLabels: vi.fn(),
  splitLeafOwners: vi.fn(), createServerClient: vi.fn(), createAdminClient: vi.fn(), recordProgressSnapshot: vi.fn(),
  ingestProject: vi.fn(), detectWorkbook: vi.fn(), getProjectConfig: vi.fn(), writeProjectSettingsInternal: vi.fn(),
  ensureProjectTeams: vi.fn(), readHolidaysFromBuffer: vi.fn(), rpc: vi.fn(),
}))
vi.mock('@/lib/authz', () => ({ requireProjectAdmin: mocks.requireProjectAdmin }))
vi.mock('@/lib/excel/parseWithProfile', () => ({
  parseWithProfile: mocks.parseWithProfile, linkByDepth: mocks.linkByDepth,
  resolveLegacyLevelLabels: mocks.resolveLegacyLevelLabels, readHolidaysFromBuffer: mocks.readHolidaysFromBuffer,
}))
vi.mock('@/lib/excel/validate', () => ({ splitLeafOwners: mocks.splitLeafOwners }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: mocks.createServerClient }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/data/snapshots', () => ({ recordProgressSnapshot: mocks.recordProgressSnapshot }))
vi.mock('@/lib/ai/ingest', () => ({ ingestProject: mocks.ingestProject }))
vi.mock('@/lib/excel/detect', () => ({ detectWorkbook: mocks.detectWorkbook }))
vi.mock('@/lib/settings/projectConfig', () => ({ getProjectConfig: mocks.getProjectConfig }))
vi.mock('@/lib/settings/write', () => ({ writeProjectSettingsInternal: mocks.writeProjectSettingsInternal }))
vi.mock('@/lib/teams/register', () => ({ ensureProjectTeams: mocks.ensureProjectTeams }))
vi.mock('@/lib/teams/referencedCommon', () => ({ referencedCommonTeamCodes: async () => new Map<string, string>() }))
vi.mock('@/lib/teams/source', async () => (await import('../helpers/teams-source-mock')).teamsSourceMock())

import { POST as EXECUTE } from '@/app/api/import/execute/route'
import { POST as INSPECT } from '@/app/api/import/inspect/route'
import { projectOwnTeams, projectTeams } from '@/lib/teams/source'
import type { Team } from '@/lib/domain/teams'
import type { FieldDef } from '@/lib/domain/customFields'
import type { ExcelProfile } from '@/lib/excel/profile'
import type { ConfigTeam } from '@/lib/settings/projectConfig'
import { makeProjectConfig } from '../helpers/projectConfigFixture'
import { makeActor, WS } from '../fixtures/actor'

const PROJECT_ID = '11111111-1111-4111-8111-111111111111'
const COMMAND_ID = '44444444-4444-4444-8444-444444444444'
const ACTOR = makeActor({ projectWorkspace: new Map([[PROJECT_ID, WS]]) })
const FILE = new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
const BASE_PROFILE: ExcelProfile = {
  version: 1, sheetName: 'WBS', holidaySheetName: null, headerRow: 0,
  hierarchy: { kind: 'columns', columns: [0, 1] },
  logical: { extraAxis: null, code: null, name: null, deliverable: 3, start: null, end: null, weight: null, actualPct: null },
  teamColumns: [[2, 'RES']], ownerMarks: { '●': 'primary', '△': 'support' },
}
const PROFILE: ExcelProfile = { ...BASE_PROFILE, customColumns: [[4, 'qty'], [5, 'result']] }
const HEADERS = ['Phase', 'Activity', 'RES', '산출물', '검측 수량', 'result', '메모']
const def = (over: Partial<FieldDef>): FieldDef => ({
  key: 'qty', label: '검측 수량', description: '', type: 'number', required: false, editable_by: 'member',
  show_in_list: true, searchable: false, sort: 0, active: true, ...over,
} as FieldDef)
const DEFS = [
  def({ limits: { decimals: 1, unit: 'm³' } }),
  def({ key: 'result', label: '실험 결과', type: 'select', sort: 1, options: [{ code: 'pass', label: '통과', sort: 0, active: true }, { code: 'fail', label: '실패', sort: 1, active: true }] }),
]
const team = (code: string): Team => ({ id: `own-${code}`, code, name: code, color: '#6b7280', sortOrder: 0, active: true, progressVisible: true, projectId: PROJECT_ID, workspaceId: WS })
const TEAMS = [team('RES')]
const configTeam = ({ id, code, name, color, sortOrder, active, progressVisible, projectId }: Team): ConfigTeam => ({ id, code, name, color, sortOrder, active, progressVisible, projectId })
function cfg(values: Record<string, unknown> = { 'fields.wbs_item': DEFS }, fieldsInvalid = false) {
  const c = makeProjectConfig({ 'core.level_labels': ['단계'], ...values }, { projectId: PROJECT_ID, workspaceId: WS, teams: TEAMS.map(configTeam) })
  if (fieldsInvalid) (c.keys as Record<string, unknown>)['fields.wbs_item'] = { status: 'invalid', error: '손상' }
  return c
}
const row = (excelRow: number, custom?: Record<string, unknown>) => ({
  depth: 0, code: null, name: `행${excelRow}`, extraAxis: null, deliverable: null, plannedStart: null, plannedEnd: null,
  weight: null, actualPct: null, owners: [{ team: 'RES', kind: 'primary' as const }], excelRow, ...(custom ? { custom } : {}),
})
function req(fields: Record<string, string | Blob>) {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) form.append(k, v)
  return { formData: async () => form } as unknown as Parameters<typeof EXECUTE>[0]
}
const executeFields = (over: Record<string, string | Blob> = {}) => ({
  file: FILE, projectId: PROJECT_ID, profile: JSON.stringify(PROFILE), mode: 'append', saveProfile: 'false', registerTeams: 'false', commandId: COMMAND_ID, ...over,
})
function sbClient() {
  const q: Record<string, unknown> = {}
  q.select = () => q; q.eq = () => q; q.neq = () => q
  q.maybeSingle = async () => ({ data: null, error: null })
  q.then = (resolve: (v: unknown) => unknown) => resolve({ count: 0, error: null })
  return { from: vi.fn(() => q) }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireProjectAdmin.mockResolvedValue({ ok: true, actor: ACTOR })
  mocks.resolveLegacyLevelLabels.mockReturnValue(true)
  // 링크는 받은 행을 그대로 항목으로 — 검사가 바꾼 custom 이 RPC 까지 가는지 본다
  mocks.linkByDepth.mockImplementation((rows: { name: string; custom?: unknown }[]) => ({ ok: true, items: rows.map((r, i) => ({ tempId: `t${i}`, owners: [], name: r.name, ...(r.custom ? { custom: r.custom } : {}) })) }))
  mocks.splitLeafOwners.mockImplementation((items: unknown) => items)
  mocks.recordProgressSnapshot.mockResolvedValue(undefined)
  mocks.ingestProject.mockResolvedValue({ count: 0 })
  mocks.readHolidaysFromBuffer.mockReturnValue([])
  mocks.parseWithProfile.mockReturnValue({ ok: false, error: '미리보기 읽기 없음(이 파일은 보지 않는다)' })
  mocks.createServerClient.mockImplementation(async () => sbClient())
  mocks.rpc.mockResolvedValue({ data: { status: 'applied', mode: 'append', count: 2, command_id: COMMAND_ID }, error: null })
  mocks.createAdminClient.mockImplementation(() => ({ rpc: mocks.rpc }))
  mocks.ensureProjectTeams.mockResolvedValue({ ok: true, created: [], existing: [] })
  vi.mocked(projectTeams).mockResolvedValue(TEAMS)
  vi.mocked(projectOwnTeams).mockResolvedValue(TEAMS)
  mocks.getProjectConfig.mockResolvedValue(cfg())
  mocks.detectWorkbook.mockReturnValue({
    ok: true,
    result: { sheetNames: ['WBS'], profile: BASE_PROFILE, confidence: { header: 1, hierarchy: 1, logical: 1 }, preview: { headers: HEADERS, rows: [] }, warnings: [] },
  })
})
afterEach(() => { vi.restoreAllMocks() })

describe('POST /api/import/inspect — 필드 열 제안', () => {
  it('헤더가 필드 라벨(검측 수량)·key(result)와 같은 열을 감지 양식의 customColumns 로 싣는다', async () => {
    const res = await INSPECT(req({ file: FILE, projectId: PROJECT_ID }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.detection.profile.customColumns).toEqual([[4, 'qty'], [5, 'result']])
    expect(body.detection.profile.logical).toEqual(BASE_PROFILE.logical)   // 그 밖의 감지 결과는 그대로
  })

  it('정의가 없거나 맞는 헤더가 없으면 양식을 건드리지 않는다', async () => {
    mocks.getProjectConfig.mockResolvedValue(cfg({}))
    const body = await (await INSPECT(req({ file: FILE, projectId: PROJECT_ID }))).json()
    expect(body.detection.profile).toEqual(BASE_PROFILE)
    expect('customColumns' in body.detection.profile).toBe(false)
  })

  it('필드 열이 든 저장 양식과 같은 구조의 파일은 불일치가 아니다(제안이 없던 때는 customColumns 가 늘 불일치였다)', async () => {
    mocks.getProjectConfig.mockResolvedValue(cfg({ 'fields.wbs_item': DEFS, 'wbs.excel_profile': PROFILE }))
    const body = await (await INSPECT(req({ file: FILE, projectId: PROJECT_ID }))).json()
    expect(body.savedProfile.customColumns).toEqual(PROFILE.customColumns)
    expect(body.profileMismatch).toBeNull()
  })

  it('필드 열이 없는 저장 양식에 필드 헤더가 든 파일이 오면 customColumns 불일치로 알린다 — 저장 양식으로 읽으면 그 열이 빠진다', async () => {
    mocks.getProjectConfig.mockResolvedValue(cfg({ 'fields.wbs_item': DEFS, 'wbs.excel_profile': { ...BASE_PROFILE, customColumns: [] } }))
    const body = await (await INSPECT(req({ file: FILE, projectId: PROJECT_ID }))).json()
    expect(body.profileMismatch?.fields).toContain('customColumns')
  })

  it('정의 키가 손상이면 제안 없이 경고로 알린다(정의 없음으로 위장하지 않는다)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.getProjectConfig.mockResolvedValue(cfg({}, true))
    const body = await (await INSPECT(req({ file: FILE, projectId: PROJECT_ID }))).json()
    expect('customColumns' in body.detection.profile).toBe(false)
    expect(body.detection.warnings.some((w: string) => w.includes('추가 필드 설정이 손상'))).toBe(true)
  })
})

describe('POST /api/import/execute — 필드 값 행 검사', () => {
  it('잘못된 값은 400 CUSTOM_FIELD_ERRORS — 엑셀 행 번호가 붙은 errors[] 이고 팀 등록·RPC 를 부르지 않는다', async () => {
    mocks.parseWithProfile.mockReturnValue({ ok: true, rowErrors: [], skippedRows: 0, holidays: [], rows: [row(4, { qty: '많음' }), row(5, { qty: 1, result: '보류' }), row(6, { qty: 2 })] })
    const res = await EXECUTE(req(executeFields()))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body).toMatchObject({ ok: false, code: 'CUSTOM_FIELD_ERRORS' })
    expect(body.errors.map((e: { excelRow: number }) => e.excelRow)).toEqual([4, 5])
    expect(body.errors[0].message).toContain('검측 수량')
    expect(body.errors[1].message).toContain('실험 결과')
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.ensureProjectTeams).not.toHaveBeenCalled()
    expect(mocks.createServerClient).not.toHaveBeenCalled()
  })

  it('계층 오류와 필드 값 오류는 한 표에 행 순으로 함께 실린다(LINK_ERRORS)', async () => {
    mocks.parseWithProfile.mockReturnValue({ ok: true, rowErrors: [], skippedRows: 0, holidays: [], rows: [row(4, { qty: '많음' }), row(9)] })
    mocks.linkByDepth.mockReturnValue({ ok: false, errors: [{ excelRow: 9, message: '깊이 건너뜀' }, { excelRow: 2, message: '시작일이 종료일보다 늦음' }] })
    const body = await (await EXECUTE(req(executeFields()))).json()
    expect(body).toMatchObject({ ok: false, code: 'LINK_ERRORS' })
    expect(body.errors.map((e: { excelRow: number }) => e.excelRow)).toEqual([2, 4, 9])
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('통과한 값은 필드 유형의 값(옵션 라벨 → code, 단위 붙은 숫자 → 숫자)으로 RPC 에 간다', async () => {
    mocks.parseWithProfile.mockReturnValue({ ok: true, rowErrors: [], skippedRows: 0, holidays: [], rows: [row(4, { qty: '12.5 m³', result: '통과' }), row(5)] })
    const res = await EXECUTE(req(executeFields()))
    expect(res.status).toBe(200)
    const items = (mocks.rpc.mock.calls[0][1] as { p_items: { name: string; custom?: unknown }[] }).p_items
    expect(items[0].custom).toEqual({ qty: 12.5, result: 'pass' })
    expect('custom' in items[1]).toBe(false)
  })

  it('필드 열이 없는 파일은 정의를 읽지 않는다 — 손상된 정의 키가 무관한 가져오기를 막지 않는다', async () => {
    mocks.getProjectConfig.mockResolvedValue(cfg({}, true))
    mocks.parseWithProfile.mockReturnValue({ ok: true, rowErrors: [], skippedRows: 0, holidays: [], rows: [row(4)] })
    expect((await EXECUTE(req(executeFields({ profile: JSON.stringify(BASE_PROFILE) })))).status).toBe(200)
  })

  it('값이 있는데 정의 키가 손상이면 그 키의 오류로 멈춘다 — 값이 전부 "모르는 필드"가 되지 않는다', async () => {
    mocks.getProjectConfig.mockResolvedValue(cfg({}, true))
    mocks.parseWithProfile.mockReturnValue({ ok: true, rowErrors: [], skippedRows: 0, holidays: [], rows: [row(4, { qty: 1 })] })
    const res = await EXECUTE(req(executeFields()))
    const body = await res.json()
    expect(body).toMatchObject({ ok: false, code: 'CONFIG_INVALID' })
    expect(body.errors).toBeUndefined()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('사전 검사를 통과해도 DB 트리거가 거부하면(정의가 그새 바뀜) 종전대로 422 다 — 관문은 DB 다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.parseWithProfile.mockReturnValue({ ok: true, rowErrors: [], skippedRows: 0, holidays: [], rows: [row(4, { qty: 1 })] })
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '23514', message: 'CUSTOM_FIELD_INACTIVE:qty' } })
    const res = await EXECUTE(req(executeFields()))
    expect(res.status).toBe(422)
    expect(await res.json()).toMatchObject({ ok: false, code: 'CUSTOM_FIELD_INVALID' })
  })

  it('필드 열이 든 저장 양식 + 같은 구조의 파일은 확인 없이 진행한다(서버의 대조도 inspect 와 같은 제안을 쓴다)', async () => {
    mocks.getProjectConfig.mockResolvedValue(cfg({ 'fields.wbs_item': DEFS, 'wbs.excel_profile': PROFILE }))
    mocks.parseWithProfile.mockReturnValue({ ok: true, rowErrors: [], skippedRows: 0, holidays: [], rows: [row(4, { qty: 1 })] })
    const res = await EXECUTE(req(executeFields({ useSavedProfile: 'true' })))
    expect(res.status).toBe(200)
  })

  it('필드 열이 든 저장 양식인데 파일에 그 헤더가 없으면 확인 없이는 409 PROFILE_MISMATCH(customColumns)', async () => {
    mocks.getProjectConfig.mockResolvedValue(cfg({ 'fields.wbs_item': DEFS, 'wbs.excel_profile': PROFILE }))
    mocks.detectWorkbook.mockReturnValue({ ok: true, result: { profile: BASE_PROFILE, warnings: [], preview: { headers: HEADERS.slice(0, 4), rows: [] } } })
    const res = await EXECUTE(req(executeFields({ useSavedProfile: 'true' })))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.profileMismatch.fields).toContain('customColumns')
    expect(mocks.parseWithProfile).not.toHaveBeenCalled()
  })
})
