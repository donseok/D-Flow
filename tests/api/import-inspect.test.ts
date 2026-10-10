import { describe, it, expect, vi, beforeEach } from 'vitest'
import { LEGACY_EXCEL_PROFILE_V1 } from '../fixtures/excel/legacy-3row-profile'
import type { DetectionResult } from '@/lib/excel/detect'

// 라우트 mock 관례(tests/agent/work-routes.test.ts, tests/actions/authz-gate-wbs.test.ts 참고) —
// 가드·감지·설정 조회를 각각 mock 해 라우트의 배선(순서·상태코드·에러 위장 금지)만 검증한다.
const mocks = vi.hoisted(() => ({
  requireProjectAdmin: vi.fn(),
  detectWorkbook: vi.fn(),
  getProjectConfig: vi.fn(),
}))
vi.mock('@/lib/authz', () => ({ requireProjectAdmin: mocks.requireProjectAdmin }))
vi.mock('@/lib/excel/detect', () => ({ detectWorkbook: mocks.detectWorkbook }))
vi.mock('@/lib/settings/projectConfig', () => ({ getProjectConfig: mocks.getProjectConfig }))
// 새로 만들 팀 미리보기(BUG-10)의 팀 원천 — 기본은 공용 팀 다섯(FIXTURE_TEAMS). 미리보기 읽기(parseWithProfile)는 실물이다
vi.mock('@/lib/teams/source', async () => (await import('../helpers/teams-source-mock')).teamsSourceMock())

import { POST } from '@/app/api/import/inspect/route'
import { projectTeams, TeamsUnavailableError } from '@/lib/teams/source'
import type { ExcelProfile } from '@/lib/excel/profile'
import * as XLSXLib from 'xlsx'
import { makeProjectConfig } from '../helpers/projectConfigFixture'
import { ConfigUnavailableError } from '@/lib/settings/errors'
import { makeActor } from '../fixtures/actor'
import { ERR_MISSING } from '@/lib/authz/errors'

// UUID 형식 픽스처(agent-loop 교훈 — 'p1' 같은 비-UUID 를 쓰지 않는다).
const PROJECT_ID = '11111111-1111-4111-8111-111111111111'
const ACTOR = makeActor()
const FILE = new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })

function req(fields: Record<string, string | Blob>): Parameters<typeof POST>[0] {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) form.append(k, v)
  return { formData: async () => form } as unknown as Parameters<typeof POST>[0]
}

function detectionResult(overrides: Partial<DetectionResult> = {}): DetectionResult {
  return {
    sheetNames: ['WBS'],
    profile: LEGACY_EXCEL_PROFILE_V1,
    confidence: { header: 1, hierarchy: 1, logical: 1 },
    preview: { headers: [], rows: [] },
    warnings: [],
    hierarchyCandidates: { columns: [1, 2, 3], outline: null, name: null },
    uncertain: false,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireProjectAdmin.mockResolvedValue({ ok: true, actor: ACTOR })
  mocks.detectWorkbook.mockReturnValue({ ok: true, result: detectionResult() })
  mocks.getProjectConfig.mockResolvedValue(makeProjectConfig({ 'core.level_labels': ['단계'] }))
})

describe('POST /api/import/inspect', () => {
  it.each([
    ['file 누락', { projectId: PROJECT_ID }],
    ['projectId 누락', { file: FILE }],
  ] as const)('%s → 400, 가드 호출 없음', async (_name, fields) => {
    const res = await POST(req(fields as Record<string, string | Blob>))
    expect(res.status).toBe(400)
    expect(mocks.requireProjectAdmin).not.toHaveBeenCalled()
  })

  it('비 UUID projectId → 400, 가드 호출 없음', async () => {
    const res = await POST(req({ file: FILE, projectId: 'p1' }))
    expect(res.status).toBe(400)
    expect(mocks.requireProjectAdmin).not.toHaveBeenCalled()
  })

  it('미인가(관리자 아님) → 403, 감지·설정 조회 없음', async () => {
    mocks.requireProjectAdmin.mockResolvedValue({ ok: false, error: '권한 없음' })
    const res = await POST(req({ file: FILE, projectId: PROJECT_ID }))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: '권한 없음' })
    expect(mocks.detectWorkbook).not.toHaveBeenCalled()
    expect(mocks.getProjectConfig).not.toHaveBeenCalled()
  })

  it('비로그인 → 401', async () => {
    mocks.requireProjectAdmin.mockResolvedValue({ ok: false, error: '로그인 필요' })
    const res = await POST(req({ file: FILE, projectId: PROJECT_ID }))
    expect(res.status).toBe(401)
  })

  it('권한 조회 실패 → 500(거부가 아니라 서버 사정)', async () => {
    mocks.requireProjectAdmin.mockResolvedValue({ ok: false, error: '권한을 확인할 수 없어 중단했습니다.' })
    const res = await POST(req({ file: FILE, projectId: PROJECT_ID }))
    expect(res.status).toBe(500)
  })

  it('타 워크스페이스·미존재 프로젝트(ERR_MISSING) → 404, 감지 미호출 — 500 이 아니다(존재 은닉, denyStatus 와 같은 매핑)', async () => {
    mocks.requireProjectAdmin.mockResolvedValue({ ok: false, error: ERR_MISSING })
    const res = await POST(req({ file: FILE, projectId: PROJECT_ID }))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: ERR_MISSING })
    expect(mocks.detectWorkbook).not.toHaveBeenCalled()
  })

  it('시트 없음 — detectWorkbook 오류를 그대로 400', async () => {
    mocks.detectWorkbook.mockReturnValue({ ok: false, error: '시트가 없습니다' })
    const res = await POST(req({ file: FILE, projectId: PROJECT_ID }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: '시트가 없습니다' })
  })

  // BUG-04 — 확장자만 .xlsx 인 글자 파일. SheetJS 가 CSV 로 읽어 주어 본문 글자가 열 이름인 "양식"으로 2단계까지 갔다
  it('엑셀이 아닌 파일(ZIP 시그니처 없음) → 400 — 감지도 설정 조회도 하지 않는다', async () => {
    const bogus = new Blob(['this is not a real xlsx file\n'])
    const res = await POST(req({ file: bogus, projectId: PROJECT_ID }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('유효한 엑셀(.xlsx) 파일이 아닙니다')
    expect(mocks.detectWorkbook).not.toHaveBeenCalled()
    expect(mocks.getProjectConfig).not.toHaveBeenCalled()
  })

  it('감지에 프로젝트의 단계 이름(core.level_labels)과 추가 축 이름을 넘긴다 — 계층 열 후보로 쓴다(BUG-07)', async () => {
    mocks.getProjectConfig.mockResolvedValue(makeProjectConfig({ 'core.level_labels': ['단계', '작업', '활동'] }))
    await POST(req({ file: FILE, projectId: PROJECT_ID }))
    expect(mocks.detectWorkbook).toHaveBeenCalledTimes(1)
    expect(mocks.detectWorkbook.mock.calls[0][1]).toEqual({ extraAxisLabel: null, levelLabels: ['단계', '작업', '활동'] })
  })

  it('정상 감지 + 저장된 프로파일 없음(={}) → savedProfile null, DB 쓰기 없음', async () => {
    const res = await POST(req({ file: FILE, projectId: PROJECT_ID }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.detection.profile).toEqual(LEGACY_EXCEL_PROFILE_V1)
    expect(body.savedProfile).toBeNull()
  })

  it('저장된 프로파일이 유효하면 validateProfile 통과분을 savedProfile 로 반환한다', async () => {
    mocks.getProjectConfig.mockResolvedValue(makeProjectConfig({ 'core.level_labels': ['단계'], 'wbs.excel_profile': LEGACY_EXCEL_PROFILE_V1 }))
    const res = await POST(req({ file: FILE, projectId: PROJECT_ID }))
    const body = await res.json()
    expect(body.savedProfile).toEqual(LEGACY_EXCEL_PROFILE_V1)
    expect(body.detection.warnings).not.toContain('저장된 프로파일이 손상됨')
  })

  it('저장된 프로파일이 손상되었으면 savedProfile null + 경고 추가(침묵 무시 금지)', async () => {
    mocks.getProjectConfig.mockResolvedValue(makeProjectConfig({ 'core.level_labels': ['단계'], 'wbs.excel_profile': { version: 2 } }))
    const res = await POST(req({ file: FILE, projectId: PROJECT_ID }))
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.savedProfile).toBeNull()
    expect(body.detection.warnings).toContain('저장된 프로파일이 손상됨')
  })

  it('저장 양식과 감지 양식의 구조가 다르면 profileMismatch 를 싣는다(Task 1b) — savedProfile 은 그대로 돌려준다', async () => {
    const SAVED = { ...LEGACY_EXCEL_PROFILE_V1, logical: { ...LEGACY_EXCEL_PROFILE_V1.logical, start: 13, end: 14 } }
    mocks.getProjectConfig.mockResolvedValue(makeProjectConfig({ 'core.level_labels': ['단계'], 'wbs.excel_profile': SAVED }))
    const res = await POST(req({ file: FILE, projectId: PROJECT_ID }))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.savedProfile).toEqual(SAVED)
    expect(body.profileMismatch).toEqual({ fields: ['start', 'end'], extraTeams: [], missingTeams: [] })
  })

  it('구조가 같거나 저장 양식이 없으면(손상 포함) profileMismatch 는 null', async () => {
    const same = await (await POST(req({ file: FILE, projectId: PROJECT_ID }))).json()
    expect(same.profileMismatch).toBeNull()

    mocks.getProjectConfig.mockResolvedValue(makeProjectConfig({ 'core.level_labels': ['단계'], 'wbs.excel_profile': LEGACY_EXCEL_PROFILE_V1 }))
    expect((await (await POST(req({ file: FILE, projectId: PROJECT_ID }))).json()).profileMismatch).toBeNull()

    mocks.getProjectConfig.mockResolvedValue(makeProjectConfig({ 'core.level_labels': ['단계'], 'wbs.excel_profile': { version: 2 } }))
    expect((await (await POST(req({ file: FILE, projectId: PROJECT_ID }))).json()).profileMismatch).toBeNull()
  })

  it('설정 조회 실패 → 503, 기본값으로 위장하지 않는다 — 본문은 고정 문구, DB 사유는 서버 로그에만', async () => {
    const boom = new ConfigUnavailableError('프로젝트 설정 조회 실패: db down')
    mocks.getProjectConfig.mockRejectedValue(boom)
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await POST(req({ file: FILE, projectId: PROJECT_ID }))
    expect(res.status).toBe(503)
    const body = await res.text()
    expect(body).not.toContain('db down')
    expect(JSON.parse(body)).toEqual({ error: '프로젝트 설정을 확인할 수 없습니다.' })
    expect(err.mock.calls.some(c => c.some(x => String(x).includes('db down')))).toBe(true)
    err.mockRestore()
  })
})

describe('POST /api/import/inspect — 휴일 충돌 미리보기(SP5 D7·W16)', () => {
  it('감지된 Holiday 시트의 날짜가 프로젝트의 근무 예외와 겹치면 skippedHolidays 로 미리 보인다', async () => {
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['코드']]), 'WBS')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['날짜', '이름'], ['2026-10-10', '회사 휴일'], ['2026-10-12', '회사 휴일 2']]), 'Holiday')
    const file = new Blob([XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer])
    mocks.detectWorkbook.mockReturnValue({ ok: true, result: detectionResult({ sheetNames: ['WBS', 'Holiday'], profile: { ...LEGACY_EXCEL_PROFILE_V1, holidaySheetName: 'Holiday' } }) })
    mocks.getProjectConfig.mockResolvedValue({ ...makeProjectConfig({ 'core.level_labels': ['단계'] }), holidays: [{ date: '2026-10-10', name: '대체 근무', kind: 'work' }] })
    const res = await POST(req({ file, projectId: PROJECT_ID }))
    expect(res.status).toBe(200)
    expect((await res.json()).skippedHolidays).toEqual([{ date: '2026-10-10', name: '회사 휴일', reason: 'work_exception' }])
  })
  it('겹치지 않으면 빈 목록', async () => {
    const res = await POST(req({ file: FILE, projectId: PROJECT_ID }))
    expect((await res.json()).skippedHolidays).toEqual([])
  })
})

/* ── BUG-10·33 — 감지 양식으로 읽어 본 미리보기: 새로 만들 팀, 건너뛸 행 ── */
describe('POST /api/import/inspect — 새로 만들 팀·건너뛸 행 미리보기', () => {
  /** 표준 양식(단계|작업|팀) — 팀 열은 팀명 직접 방식 */
  const PROFILE: ExcelProfile = {
    version: 1, sheetName: 'WBS', holidaySheetName: null, headerRow: 0,
    hierarchy: { kind: 'columns', columns: [0, 1] },
    logical: { extraAxis: null, code: null, name: null, deliverable: null, start: null, end: null, weight: null, actualPct: null },
    teamColumns: [[2, '*']], ownerMarks: { '●': 'primary', '△': 'support' },
  }
  const fileOf = (rows: unknown[][]) => {
    const wb = XLSXLib.utils.book_new()
    XLSXLib.utils.book_append_sheet(wb, XLSXLib.utils.aoa_to_sheet([['단계', '작업', '팀', '메모'], ...rows]), 'WBS')
    return new Blob([XLSXLib.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer])
  }
  beforeEach(() => {
    mocks.detectWorkbook.mockReturnValue({ ok: true, result: detectionResult({ profile: PROFILE, preview: { headers: ['단계', '작업', '팀', '메모'], rows: [] } }) })
    vi.mocked(projectTeams).mockResolvedValue([
      { id: 't-dev', code: 'DEV', name: '플랫폼개발팀', color: '#6b7280', sortOrder: 0, active: true, progressVisible: true, projectId: null, workspaceId: 'ws' },
    ])
  })

  it('프로젝트 팀의 code·이름(공백·대소문자 무시)과 맞는 글자는 새 팀이 아니다 — 맞지 않는 이름만 newTeams 에 든다', async () => {
    const file = fileOf([['1. 준비', '', '', ''], ['', '화면설계', '플랫폼개발팀', ''], ['', 'DB설계', ' dev , 신규팀', ''], ['', '검수', '신규팀', '']])
    const body = await (await POST(req({ file, projectId: PROJECT_ID }))).json()
    expect(body.ok).toBe(true)
    expect(body.newTeams).toEqual(['신규팀'])
    expect(body.skippedRows).toBe(0)
  })

  it('이름도 값도 없는 행(양식 밖 메모만)은 건너뛸 행으로 센다', async () => {
    const file = fileOf([['1. 준비', '', '', ''], ['', '', '', '메모만 있는 줄'], ['', '화면설계', 'DEV', '']])
    const body = await (await POST(req({ file, projectId: PROJECT_ID }))).json()
    expect(body).toMatchObject({ ok: true, newTeams: [], skippedRows: 1 })
  })

  it('팀 조회가 실패하면 newTeams 는 null 이다 — "새 팀 없음"([])으로 위장하지 않는다. 감지 결과는 그대로 돌려준다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(projectTeams).mockRejectedValue(new TeamsUnavailableError('boom'))
    const res = await POST(req({ file: fileOf([['1. 준비', '', '', ''], ['', '화면설계', '신규팀', '']]), projectId: PROJECT_ID }))
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(JSON.parse(text)).toMatchObject({ ok: true, newTeams: null })
    expect(text).not.toContain('boom')
  })

  it('감지 양식으로 읽지 못한 파일은 판정하지 않는다(null) — 팀을 조회하지 않는다', async () => {
    mocks.detectWorkbook.mockReturnValue({ ok: true, result: detectionResult({ profile: { ...PROFILE, sheetName: '없는 시트' } }) })
    const body = await (await POST(req({ file: fileOf([['1. 준비', '', '', '']]), projectId: PROJECT_ID }))).json()
    expect(body).toMatchObject({ ok: true, newTeams: null, skippedRows: null })
    expect(projectTeams).not.toHaveBeenCalled()
  })
})

