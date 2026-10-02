// 가져오기 실행 라우트의 입력·가드·검증·저장 양식 대조·양식 저장(W5)·후처리 배선(SP4 §4.4 #1~#4·#10·#11).
// 명령 경로(영수증 선확인·팀 대조와 등록·전환·백업·RPC·결과 종류·실패 순서)는 tests/api/import-idempotent.test.ts,
// replace 백업의 끝까지 읽기는 tests/data/paging-consumers.test.ts 가 본다.
// 라우트 mock 관례(tests/api/import-inspect.test.ts 참고) — 가드·파서·팀 원천·DB 클라이언트를 각각 mock 해 라우트의 배선(순서·상태코드·
// 에러 위장 금지)만 검증한다. validateProfile·compareProfiles·validateProjectConfig 는 실물이다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireProjectAdmin: vi.fn(),
  parseWithProfile: vi.fn(),
  linkByDepth: vi.fn(),
  resolveLegacyLevelLabels: vi.fn(),
  splitLeafOwners: vi.fn(),
  createServerClient: vi.fn(),
  createAdminClient: vi.fn(),
  recordProgressSnapshot: vi.fn(),
  ingestProject: vi.fn(),
  detectWorkbook: vi.fn(),
  getProjectConfig: vi.fn(),
  writeProjectSettingsInternal: vi.fn(),
  ensureProjectTeams: vi.fn(),
}))
vi.mock('@/lib/authz', () => ({ requireProjectAdmin: mocks.requireProjectAdmin }))
vi.mock('@/lib/excel/parseWithProfile', () => ({
  parseWithProfile: mocks.parseWithProfile,
  linkByDepth: mocks.linkByDepth,
  resolveLegacyLevelLabels: mocks.resolveLegacyLevelLabels,
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
// 혼합 프로젝트의 공용 팀 참조 판정(Z4) — 이 파일은 그 경우를 보지 않는다: 참조 없음
vi.mock('@/lib/teams/referencedCommon', () => ({ referencedCommonTeamCodes: async () => new Map<string, string>() }))
vi.mock('@/lib/teams/source', async () => (await import('../helpers/teams-source-mock')).teamsSourceMock())

import { POST } from '@/app/api/import/execute/route'
import { projectOwnTeams, projectTeams } from '@/lib/teams/source'
import type { Team } from '@/lib/domain/teams'
import type { ExcelProfile } from '@/lib/excel/profile'
import type { ConfigTeam } from '@/lib/settings/projectConfig'
import { makeProjectConfig } from '../helpers/projectConfigFixture'
import { ConfigUnavailableError } from '@/lib/settings/errors'
import { makeActor, WS } from '../fixtures/actor'
import { ERR_MISSING } from '@/lib/authz/errors'

// UUID 형식 픽스처(agent-loop 교훈 — 'p1' 같은 비-UUID 를 쓰지 않는다).
const PROJECT_ID = '11111111-1111-4111-8111-111111111111'
const COMMAND_ID = '44444444-4444-4444-8444-444444444444'
// 라우트 진입 가드(requireProjectAdmin)를 통과한 액터 — 이 프로젝트는 워크스페이스 WS 소속이다.
const ACTOR = makeActor({ projectWorkspace: new Map([[PROJECT_ID, WS]]) })
const FILE = new Blob(['x'], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
/** 합성 양식(3행 머리) — 계층 3열 + 팀 열 둘(RES·OPS). 옛 5팀 양식 상수는 쓰지 않는다(A2 가 fixture 로 옮긴다) */
const PROFILE: ExcelProfile = {
  version: 1, sheetName: 'WBS', holidaySheetName: 'Holiday', headerRow: 2,
  hierarchy: { kind: 'columns', columns: [1, 2, 3] },
  logical: { extraAxis: 0, code: null, name: null, deliverable: 6, start: 7, end: 8, weight: 9, actualPct: 11 },
  teamColumns: [[4, 'RES'], [5, 'OPS']],
  ownerMarks: { '●': 'primary', '△': 'support' },
}
const team = (code: string, sortOrder: number): Team => ({
  id: `own-${code.toLowerCase()}`, code, name: code, color: '#6b7280', sortOrder,
  active: true, progressVisible: true, projectId: PROJECT_ID, workspaceId: WS,
})
/** 이 프로젝트의 전용 팀 — 양식의 팀 열과 같은 code(대조·교차 검증이 통과하는 기준) */
const TEAMS = [team('RES', 0), team('OPS', 1)]
const configTeam = ({ id, code, name, color, sortOrder, active, progressVisible, projectId }: Team): ConfigTeam =>
  ({ id, code, name, color, sortOrder, active, progressVisible, projectId })
const cfgWith = (excelProfile?: unknown, teams: ConfigTeam[] = TEAMS.map(configTeam)) => makeProjectConfig(
  { 'core.level_labels': ['단계'], ...(excelProfile === undefined ? {} : { 'wbs.excel_profile': excelProfile }) },
  { projectId: PROJECT_ID, workspaceId: WS, teams },
)

const ROW = {
  depth: 0, code: null, name: 'x', extraAxis: null, deliverable: null,
  plannedStart: null, plannedEnd: null, weight: null, actualPct: null,
  owners: [{ team: 'RES', kind: 'primary' as const }], excelRow: 4,
}
const LINKED_ITEM = {
  tempId: 't0', parentTempId: null, level: 'activity' as const, code: '1', sortOrder: 0,
  name: 'x', biz: null, deliverable: null, plannedStart: null, plannedEnd: null,
  weight: null, actualPct: null, owners: [{ team: 'RES', kind: 'primary' as const }], isOwnerSplit: false,
}

function req(fields: Record<string, string | Blob>): Parameters<typeof POST>[0] {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) form.append(k, v)
  return { formData: async () => form } as unknown as Parameters<typeof POST>[0]
}

function baseFields(overrides: Record<string, string | Blob> = {}) {
  return {
    file: FILE,
    projectId: PROJECT_ID,
    profile: JSON.stringify(PROFILE),
    mode: 'append',
    saveProfile: 'false',
    registerTeams: 'false',
    commandId: COMMAND_ID,
    ...overrides,
  }
}

/** 세션 클라이언트 — 영수증 선확인만 받는다(이 파일의 경로는 영수증 없음·append. 백업은 import-idempotent·paging-consumers 가 본다) */
function makeSbClient() {
  const from = vi.fn((table: string) => {
    if (table !== 'command_receipts') throw new Error(`unexpected table: ${table}`)
    const q: Record<string, unknown> = {}
    q.select = () => q
    q.eq = () => q
    q.maybeSingle = async () => ({ data: null, error: null })
    return q
  })
  return { from }
}

/** service_role 클라이언트 — import_wbs_cmd 만 받는다. 표는 직접 만지지 않는다(양식 저장은 writeProjectSettingsInternal 목에 넘길 뿐) */
function makeAdminClient() {
  const rpc = vi.fn(async () => ({ data: { status: 'applied', mode: 'append', count: 5, command_id: COMMAND_ID }, error: null }))
  const from = vi.fn((table: string) => { throw new Error(`unexpected table: ${table}`) })
  return { rpc, from }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireProjectAdmin.mockResolvedValue({ ok: true, actor: ACTOR })
  mocks.parseWithProfile.mockReturnValue({ ok: true, rows: [ROW], holidays: [] })
  mocks.resolveLegacyLevelLabels.mockReturnValue(true)
  mocks.linkByDepth.mockReturnValue({ ok: true, items: [LINKED_ITEM] })
  mocks.splitLeafOwners.mockImplementation((items: unknown) => items)
  mocks.recordProgressSnapshot.mockResolvedValue(undefined)
  mocks.ingestProject.mockResolvedValue({ count: 3 })
  mocks.createServerClient.mockImplementation(async () => makeSbClient())
  mocks.createAdminClient.mockImplementation(() => makeAdminClient())
  mocks.ensureProjectTeams.mockResolvedValue({ ok: true, created: [], existing: [] })
  vi.mocked(projectTeams).mockResolvedValue(TEAMS)
  vi.mocked(projectOwnTeams).mockResolvedValue(TEAMS)
  // 기본: 저장 양식 없음 — 구조 대조(Task 1b)를 건너뛰는 종전 경로.
  mocks.getProjectConfig.mockResolvedValue(cfgWith())
  mocks.detectWorkbook.mockReturnValue({ ok: true, result: { profile: PROFILE, warnings: [] } })
})
afterEach(() => { vi.restoreAllMocks() })

describe('POST /api/import/execute — 입력 검증(가드 이전)', () => {
  it.each([
    ['file 누락', { projectId: PROJECT_ID, profile: '{}', mode: 'append', commandId: COMMAND_ID }],
    ['projectId 누락', { file: FILE, profile: '{}', mode: 'append', commandId: COMMAND_ID }],
    ['profile 누락', { file: FILE, projectId: PROJECT_ID, mode: 'append', commandId: COMMAND_ID }],
  ] as const)('%s → 400 INVALID_INPUT, 가드 호출 없음', async (_name, fields) => {
    const res = await POST(req(fields as Record<string, string | Blob>))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ ok: false, code: 'INVALID_INPUT' })
    expect(mocks.requireProjectAdmin).not.toHaveBeenCalled()
  })

  it('mode 가 append/replace 가 아니면 400, 가드 호출 없음', async () => {
    const res = await POST(req(baseFields({ mode: 'delete' })))
    expect(res.status).toBe(400)
    expect(mocks.requireProjectAdmin).not.toHaveBeenCalled()
  })

  it('비 UUID projectId → 400, 가드 호출 없음', async () => {
    const res = await POST(req(baseFields({ projectId: 'p1' })))
    expect(res.status).toBe(400)
    expect(mocks.requireProjectAdmin).not.toHaveBeenCalled()
  })

  it.each([['없음', ''], ['uuid 아님', 'cmd-1']])('명령 id %s → 400 COMMAND_ID_REQUIRED(고정 문구), 가드 호출 없음 — 재전송을 한 벌로 묶을 수 없다', async (_n, commandId) => {
    const res = await POST(req(baseFields({ commandId })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ ok: false, code: 'COMMAND_ID_REQUIRED', error: expect.stringContaining('commandId') })
    expect(mocks.requireProjectAdmin).not.toHaveBeenCalled()
  })
})

describe('POST /api/import/execute — 가드', () => {
  it('미인가(관리자 아님) → 403 ERR_DENIED, 파서 미호출', async () => {
    mocks.requireProjectAdmin.mockResolvedValue({ ok: false, error: '권한 없음' })
    const res = await POST(req(baseFields()))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ ok: false, code: 'ERR_DENIED', error: '권한 없음' })
    expect(mocks.parseWithProfile).not.toHaveBeenCalled()
  })

  it('비로그인 → 401 ERR_ANON', async () => {
    mocks.requireProjectAdmin.mockResolvedValue({ ok: false, error: '로그인 필요' })
    const res = await POST(req(baseFields()))
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ ok: false, code: 'ERR_ANON' })
  })

  it('권한 조회 실패 → 500 ERR_LOOKUP(거부가 아니라 서버 사정)', async () => {
    mocks.requireProjectAdmin.mockResolvedValue({ ok: false, error: '권한을 확인할 수 없어 중단했습니다.' })
    const res = await POST(req(baseFields()))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ ok: false, code: 'ERR_LOOKUP', error: '권한을 확인할 수 없어 중단했습니다.' })
  })

  it('타 워크스페이스·미존재 프로젝트(ERR_MISSING) → 404, 파서 미호출 — 500 이 아니다(존재 은닉, denyStatus 와 같은 매핑)', async () => {
    mocks.requireProjectAdmin.mockResolvedValue({ ok: false, error: ERR_MISSING })
    const res = await POST(req(baseFields()))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ ok: false, code: 'ERR_MISSING', error: ERR_MISSING })
    expect(mocks.parseWithProfile).not.toHaveBeenCalled()
  })
})

describe('POST /api/import/execute — 검증 오류 400', () => {
  it('프로파일이 스키마를 위반하면 400, parseWithProfile 미호출', async () => {
    const res = await POST(req(baseFields({ profile: JSON.stringify({ version: 2 }) })))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('INVALID_INPUT')
    expect(body.error).toContain('version')
    expect(mocks.parseWithProfile).not.toHaveBeenCalled()
  })

  it('프로파일이 JSON 파싱조차 안 되면 400', async () => {
    const res = await POST(req(baseFields({ profile: 'not-json' })))
    expect(res.status).toBe(400)
    expect(mocks.parseWithProfile).not.toHaveBeenCalled()
  })

  it('parseWithProfile 실패 → 그 에러 문자열 그대로 400, 팀 원천·DB 미호출', async () => {
    mocks.parseWithProfile.mockReturnValue({ ok: false, error: '시트를 찾을 수 없습니다: WBS' })
    const res = await POST(req(baseFields()))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ ok: false, code: 'INVALID_INPUT', error: '시트를 찾을 수 없습니다: WBS' })
    expect(projectTeams).not.toHaveBeenCalled()
    expect(mocks.createServerClient).not.toHaveBeenCalled()
  })

  it('linkByDepth 구조 오류 → errors 배열 그대로 400 LINK_ERRORS', async () => {
    mocks.linkByDepth.mockReturnValue({ ok: false, errors: [{ excelRow: 5, message: '깊이 건너뜀' }] })
    const res = await POST(req(baseFields()))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ ok: false, code: 'LINK_ERRORS', errors: [{ excelRow: 5, message: '깊이 건너뜀' }] })
  })

  it('미등록 팀 포함 + linkByDepth 구조 오류 → 팀 단계 전에 400 — 팀 대조·등록·영수증 확인 전부 미호출(검증 실패 요청은 부수효과를 남기지 않는다)', async () => {
    mocks.parseWithProfile.mockReturnValue({ ok: true, rows: [{ ...ROW, owners: [{ team: 'NEWTEAM', kind: 'primary' as const }] }], holidays: [] })
    mocks.linkByDepth.mockReturnValue({ ok: false, errors: [{ excelRow: 5, message: '깊이 건너뜀' }] })
    const res = await POST(req(baseFields({ registerTeams: 'true' })))
    expect(res.status).toBe(400)
    expect(projectTeams).not.toHaveBeenCalled()
    expect(projectOwnTeams).not.toHaveBeenCalled()
    expect(mocks.ensureProjectTeams).not.toHaveBeenCalled()
    expect(mocks.createServerClient).not.toHaveBeenCalled()
  })
})

describe('POST /api/import/execute — saveProfile(W5)', () => {
  it('saveProfile=true → writeProjectSettingsInternal(admin, pid, { set: { wbs.excel_profile } }, actor) — profileSaved:true', async () => {
    mocks.writeProjectSettingsInternal.mockResolvedValue({ ok: true, status: 'applied', revision: 2, commandId: 'c' })
    const admin = makeAdminClient()
    mocks.createAdminClient.mockReturnValue(admin)
    const res = await POST(req(baseFields({ saveProfile: 'true' })))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.profileSaved).toBe(true); expect(body.profileSave).toBeUndefined()
    expect(mocks.writeProjectSettingsInternal).toHaveBeenCalledWith(admin, PROJECT_ID, { set: { 'wbs.excel_profile': PROFILE } }, ACTOR.userId)
    // 라우트가 만든 admin(service_role) 클라이언트 그 객체를 넘긴다(깊은 비교가 아니라 동일성) — 감사표 분류 불변
    expect(mocks.writeProjectSettingsInternal.mock.calls[0][0]).toBe(admin)
  })
  it('saveProfile=false → 쓰기 없음, profileSaved:false', async () => {
    const res = await POST(req(baseFields({ saveProfile: 'false' })))
    expect((await res.json()).profileSaved).toBe(false)
    expect(mocks.writeProjectSettingsInternal).not.toHaveBeenCalled()
  })
  it('저장 실패 → 가져오기는 200 이고 profileSaved:false 에 profileSave 사유가 실린다(로그만 남기고 삼키지 않는다)', async () => {
    mocks.writeProjectSettingsInternal.mockResolvedValue({ ok: false, code: 'CONFIG_UNAVAILABLE', error: '설정을 불러오지 못해 중단했습니다.' })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await POST(req(baseFields({ saveProfile: 'true' })))
    expect(spy).toHaveBeenCalledWith('[import/execute] 프로파일 저장 실패:', 'CONFIG_UNAVAILABLE', '설정을 불러오지 못해 중단했습니다.')   // 원인은 로그로
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true); expect(body.profileSaved).toBe(false)
    expect(body.profileSave).toEqual({ ok: false, code: 'CONFIG_UNAVAILABLE', error: '설정을 불러오지 못해 중단했습니다.' })
  })
  it('저장 실패 사유의 DB 원문은 응답에 싣지 않는다 — 코드의 고정 문구만(원문은 로그)', async () => {
    mocks.writeProjectSettingsInternal.mockResolvedValue({ ok: false, code: 'CONFIG_UNAVAILABLE', error: '설정을 불러오지 못해 중단했습니다. (relation "x" boom)' })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await POST(req(baseFields({ saveProfile: 'true' })))
    const body = await res.json()
    expect(body.profileSave).toEqual({ ok: false, code: 'CONFIG_UNAVAILABLE', error: '설정을 불러오지 못해 중단했습니다.' })
    expect(JSON.stringify(body)).not.toContain('boom')
  })
  it('저장이 throw(표에 없는 DB 오류)해도 가져오기는 200 — CONFIG_UNAVAILABLE 경고로 싣는다', async () => {
    mocks.writeProjectSettingsInternal.mockRejectedValue(new Error('[settings/write] 알 수 없는 DB 오류: boom'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await POST(req(baseFields({ saveProfile: 'true' })))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.profileSave).toEqual({ ok: false, code: 'CONFIG_UNAVAILABLE', error: '설정을 불러오지 못해 중단했습니다.' })
    expect(JSON.stringify(body)).not.toContain('boom')
  })
  it('양식의 팀 열이 활성 설정 팀에 없으면(비활성 팀의 열) 저장하지 않고 CONFIG_INVALID 경고 — 가져오기는 성공(교차 검증, 스펙 §4.3)', async () => {
    const opsOff = { ...TEAMS[1], active: false }
    mocks.getProjectConfig.mockResolvedValue(cfgWith(undefined, [configTeam(TEAMS[0]), configTeam(opsOff)]))
    vi.mocked(projectTeams).mockResolvedValue([TEAMS[0], opsOff])
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await POST(req(baseFields({ saveProfile: 'true' })))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      ok: true, profileSaved: false, profileSave: { ok: false, code: 'CONFIG_INVALID', error: '설정 값이 올바르지 않습니다.' },
    })
    expect(mocks.writeProjectSettingsInternal).not.toHaveBeenCalled()
    expect(err).toHaveBeenCalledWith('[import/execute] 양식 저장 교차 검증 실패:', [expect.objectContaining({ key: 'wbs.excel_profile' })])
  })
})

describe('POST /api/import/execute — 후처리(스냅샷·색인)', () => {
  it('recordProgressSnapshot 을 프로젝트 id 로 호출한다', async () => {
    await POST(req(baseFields()))
    expect(mocks.recordProgressSnapshot).toHaveBeenCalledWith(PROJECT_ID)
  })

  it('ingestProject 실패해도 응답은 200 유지, reindexed=0', async () => {
    mocks.ingestProject.mockRejectedValue(new Error('embed down'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await POST(req(baseFields()))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.reindexed).toBe(0)
  })
})

/* ── Task 1b — 저장 양식으로 읽는데 파일 구조가 다르면 서버가 최종 관문으로 거부한다(fail-closed) ── */
describe('POST /api/import/execute — 저장 양식·파일 구조 불일치', () => {
  // 저장 양식 = PROFILE, 업로드 파일의 감지 결과 = 시작·종료 열이 밀린 모양.
  const SHIFTED = { ...PROFILE, logical: { ...PROFILE.logical, start: 13, end: 14 } }
  const savedIs = (excelProfile: unknown) => mocks.getProjectConfig.mockResolvedValue(cfgWith(excelProfile))
  const detectedIs = (profile: unknown) => mocks.detectWorkbook.mockReturnValue({ ok: true, result: { profile, warnings: [] } })

  it('저장 양식(내용이 같다)으로 실행 + 확인 없음 → 409 PROFILE_MISMATCH, 파싱·팀·DB 미호출', async () => {
    savedIs(PROFILE)
    detectedIs(SHIFTED)
    const res = await POST(req(baseFields()))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body).toMatchObject({ ok: false, code: 'PROFILE_MISMATCH' })
    expect(body.profileMismatch).toEqual({ fields: ['start', 'end'], extraTeams: [], missingTeams: [] })
    expect(body.error).toMatch(/저장된 엑셀 양식/)
    expect(mocks.parseWithProfile).not.toHaveBeenCalled()
    expect(projectTeams).not.toHaveBeenCalled()
    expect(mocks.createServerClient).not.toHaveBeenCalled()
  })

  it('useSavedProfile=true 를 보내면 내용이 조금 달라도 저장 양식 사용으로 본다 — 확인 없으면 409', async () => {
    savedIs(PROFILE)
    detectedIs(SHIFTED)
    const edited = { ...PROFILE, logical: { ...PROFILE.logical, weight: null } }
    const res = await POST(req(baseFields({ profile: JSON.stringify(edited), useSavedProfile: 'true' })))
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('PROFILE_MISMATCH')
  })

  it('명시 확인(confirmProfileMismatch=true)이 있으면 저장 양식으로 진행한다', async () => {
    savedIs(PROFILE)
    detectedIs(SHIFTED)
    const res = await POST(req(baseFields({ useSavedProfile: 'true', confirmProfileMismatch: 'true' })))
    expect(res.status).toBe(200)
    expect(mocks.parseWithProfile).toHaveBeenCalledWith(expect.any(ArrayBuffer), PROFILE)
  })

  it('감지 결과로 실행(저장 양식과 다른 프로파일)하면 확인 없이 진행한다', async () => {
    savedIs(PROFILE)
    detectedIs(SHIFTED)
    const res = await POST(req(baseFields({ profile: JSON.stringify(SHIFTED) })))
    expect(res.status).toBe(200)
    expect(mocks.parseWithProfile).toHaveBeenCalledWith(expect.any(ArrayBuffer), SHIFTED)
  })

  it('저장 양식과 파일 구조가 같으면 확인 없이 진행한다', async () => {
    savedIs(PROFILE)
    const res = await POST(req(baseFields({ useSavedProfile: 'true' })))
    expect(res.status).toBe(200)
  })

  it('저장 양식으로 읽는데 파일 구조를 감지하지 못하면 대조할 수 없으니 409(fail-closed)', async () => {
    savedIs(PROFILE)
    mocks.detectWorkbook.mockReturnValue({ ok: false, error: '시트가 없습니다' })
    const res = await POST(req(baseFields()))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body).toMatchObject({ ok: false, code: 'PROFILE_MISMATCH', profileMismatch: null })
    expect(body.error).toContain('시트가 없습니다')
    expect(mocks.parseWithProfile).not.toHaveBeenCalled()
  })

  it('저장 양식이 없거나 손상이면 대조하지 않는다(감지 미호출)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})   // 손상 키는 해석기가 키당 한 줄 로그를 남긴다
    for (const excelProfile of [undefined, { version: 2 }]) {
      savedIs(excelProfile)
      const res = await POST(req(baseFields()))
      expect(res.status).toBe(200)
    }
    expect(mocks.detectWorkbook).not.toHaveBeenCalled()
  })

  it('설정 조회 실패 → 503 재시도 가능, 파싱·DB 미호출(대조 불가를 통과로 위장하지 않는다)', async () => {
    const boom = new ConfigUnavailableError('프로젝트 설정 조회 실패: db down')
    mocks.getProjectConfig.mockRejectedValue(boom)
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await POST(req(baseFields()))
    expect(res.status).toBe(503)
    // 본문은 고정 문구 — PostgREST 사유는 서버 로그에만 남긴다.
    const body = await res.text()
    expect(body).not.toContain('db down')
    expect(JSON.parse(body)).toEqual({ ok: false, code: 'CONFIG_UNAVAILABLE', error: '프로젝트 설정을 확인할 수 없습니다.', retryable: true })
    expect(err.mock.calls.flat().some((x) => (x instanceof Error ? x.message : String(x)).includes('db down'))).toBe(true)
    expect(mocks.parseWithProfile).not.toHaveBeenCalled()
    expect(mocks.createServerClient).not.toHaveBeenCalled()
  })
})

describe('POST /api/import/execute — 휴일 충돌(SP5 D7·W16)', () => {
  it('파일 휴일이 프로젝트의 근무 예외와 겹치면 결과에 skippedHolidays — RPC 에는 그대로 넘긴다(DB 갱신절이 work 행을 덮지 않는다)', async () => {
    mocks.parseWithProfile.mockReturnValue({ ok: true, rows: [ROW], holidays: [{ date: '2026-10-10', name: '회사 휴일' }, { date: '2026-10-12', name: '회사 휴일 2' }] })
    mocks.getProjectConfig.mockResolvedValue({ ...cfgWith(), holidays: [{ date: '2026-10-10', name: '대체 근무', kind: 'work' }] })
    const admin = makeAdminClient()
    mocks.createAdminClient.mockImplementation(() => admin)
    const res = await POST(req(baseFields()))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, skippedHolidays: [{ date: '2026-10-10', name: '회사 휴일', reason: 'work_exception' }] })
    expect(admin.rpc).toHaveBeenCalledWith('import_wbs_cmd', expect.objectContaining({
      p_holidays: [{ date: '2026-10-10', name: '회사 휴일' }, { date: '2026-10-12', name: '회사 휴일 2' }],
    }))
  })
  it('겹치지 않으면 응답에 skippedHolidays 가 없다', async () => {
    const res = await POST(req(baseFields()))
    expect(await res.json()).not.toHaveProperty('skippedHolidays')
  })
})
