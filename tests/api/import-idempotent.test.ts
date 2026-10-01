// 가져오기 명령 경로(스펙 §4.4 #5~#11 — D4·D17·D50·D54, Q14·Q16·Q36·Q40). 같은 명령 id 두 번 = 한 벌(영수증 선확인 + RPC 판정),
// 미등록 팀은 전용 팀(상속이면 먼저 전환), 양식 저장의 교차 검증 기준, 실패 순서(앞 단계가 실패하면 뒤 단계를 부르지 않는다)와 응답
// 모양을 본다. 라우트의 배선만 본다 — RPC 의 판정(영수증·요약·등급·전환)은 tests/rls/command-receipts·team-convert 가, 입력·가드·
// 저장 양식 대조는 tests/api/import-execute.test.ts 가, 백업의 끝까지 읽기는 tests/data/paging-consumers.test.ts 가 본다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  requireProjectAdmin: vi.fn(), parseWithProfile: vi.fn(), linkByDepth: vi.fn(), resolveLegacyLevelLabels: vi.fn(),
  splitLeafOwners: vi.fn(), detectWorkbook: vi.fn(), createServerClient: vi.fn(), createAdminClient: vi.fn(),
  recordProgressSnapshot: vi.fn(), ingestProject: vi.fn(), getProjectConfig: vi.fn(), writeProjectSettingsInternal: vi.fn(),
  ensureProjectTeams: vi.fn(),
}))
vi.mock('@/lib/authz', () => ({ requireProjectAdmin: m.requireProjectAdmin }))
vi.mock('@/lib/excel/parseWithProfile', () => ({
  parseWithProfile: m.parseWithProfile, linkByDepth: m.linkByDepth, resolveLegacyLevelLabels: m.resolveLegacyLevelLabels,
}))
vi.mock('@/lib/excel/validate', () => ({ splitLeafOwners: m.splitLeafOwners }))
vi.mock('@/lib/excel/detect', () => ({ detectWorkbook: m.detectWorkbook }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: m.createServerClient }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: m.createAdminClient }))
vi.mock('@/lib/data/snapshots', () => ({ recordProgressSnapshot: m.recordProgressSnapshot }))
vi.mock('@/lib/ai/ingest', () => ({ ingestProject: m.ingestProject }))
vi.mock('@/lib/settings/projectConfig', () => ({ getProjectConfig: m.getProjectConfig }))
vi.mock('@/lib/settings/write', () => ({ writeProjectSettingsInternal: m.writeProjectSettingsInternal }))
vi.mock('@/lib/teams/register', () => ({ ensureProjectTeams: m.ensureProjectTeams }))
vi.mock('@/lib/teams/source', async () => (await import('../helpers/teams-source-mock')).teamsSourceMock())

import { POST } from '@/app/api/import/execute/route'
import { TeamsUnavailableError, projectOwnTeams, projectTeams } from '@/lib/teams/source'
import { ERR_MISSING } from '@/lib/authz/errors'
import type { Team } from '@/lib/domain/teams'
import type { ExcelProfile } from '@/lib/excel/profile'
import type { ConfigTeam } from '@/lib/settings/projectConfig'
import { makeProjectConfig } from '../helpers/projectConfigFixture'
import { makeActor, makeSuperuser, WS } from '../fixtures/actor'

const P = '00000000-0000-0000-7e57-0000000018b1'   // 단위 테스트 픽스처 id(GC — 18b0~18bf 는 이 파일)
const CMD = '00000000-0000-0000-7e57-0000000018b2'
const ACTOR = makeActor({ userId: '00000000-0000-0000-7e57-0000000018b3', projectWorkspace: new Map([[P, WS]]) })
const DUP_WARNING = '이 실행은 이미 적용되어 있었습니다 — 교체 전 백업은 처음 응답에만 실렸습니다. 실행 전에 받은 백업 파일을 쓰세요.'
/** 합성 양식 — 계층 2열 + 팀 열 둘(RES·QA) */
const PROFILE: ExcelProfile = {
  version: 1, sheetName: 'WBS', holidaySheetName: null, headerRow: 0, hierarchy: { kind: 'columns', columns: [0, 1] },
  logical: { extraAxis: null, code: null, name: null, deliverable: null, start: null, end: null, weight: null, actualPct: null },
  teamColumns: [[2, 'RES'], [3, 'QA']], ownerMarks: { '●': 'primary', '△': 'support' },
}
const row = (...teams: string[]) => ({ depth: 0, code: null, name: 'x', extraAxis: null, deliverable: null, plannedStart: null,
  plannedEnd: null, weight: null, actualPct: null, owners: teams.map((team) => ({ team, kind: 'primary' as const })), excelRow: 2 })
const ITEMS = [{ tempId: 't0', parentTempId: null, level: 'activity' as const, code: '1', sortOrder: 0, name: 'x', biz: null,
  deliverable: null, plannedStart: null, plannedEnd: null, weight: null, actualPct: null,
  owners: [{ team: 'RES', kind: 'primary' as const }], isOwnerSplit: false }]
const team = (code: string, over: Partial<Team> = {}): Team => ({ id: `own-${code}`, code, name: code, color: '#6b7280', sortOrder: 0,
  active: true, progressVisible: true, projectId: P, workspaceId: WS, ...over })
const configTeam = ({ id, code, name, color, sortOrder, active, progressVisible, projectId }: Team): ConfigTeam =>
  ({ id, code, name, color, sortOrder, active, progressVisible, projectId })
const OWN_RES = team('RES')
const OWN_QA = team('QA', { id: 'own-QA', sortOrder: 1 })
/** 상속 프로젝트가 쓰는 그 워크스페이스의 공용 팀 — 비활성 하나 포함(409 목록에서 빠진다) */
const COMMON = [
  team('RES', { id: 'common-res', name: '연구팀', projectId: null }),
  team('OPS', { id: 'common-ops', name: '운영팀', sortOrder: 1, projectId: null }),
  team('OLD', { id: 'common-old', sortOrder: 2, active: false, projectId: null }),
]
/** 이 프로젝트가 쓰는 팀(원천 projectTeams)·전용 팀(projectOwnTeams)과, 같은 팀을 든 설정(#3 — 교차 검증 기준의 한쪽) */
function teamsAre(teams: Team[], own: Team[]) {
  vi.mocked(projectTeams).mockResolvedValue(teams)
  vi.mocked(projectOwnTeams).mockResolvedValue(own)
  m.getProjectConfig.mockResolvedValue(
    makeProjectConfig({ 'core.level_labels': ['단계', '작업'] }, { projectId: P, workspaceId: WS, teams: teams.map(configTeam) }))
}

type Resp = { data: unknown; error: unknown }
const BACKUP_ROWS = [{ id: 'w1', project_id: P, name: '기존 항목' }]
/** 세션 클라이언트 — 영수증 선확인(command_receipts: select·eq·maybeSingle)과 replace 백업(wbs_items: 한 쪽, count = 길이) */
function session(opts: { receipt?: Resp; backup?: Resp } = {}) {
  const receiptFilters: Array<[string, unknown]> = []
  const from = vi.fn((table: string) => {
    const q: Record<string, unknown> = {}
    if (table === 'command_receipts') {
      q.select = () => q
      q.eq = (col: string, v: unknown) => { receiptFilters.push([col, v]); return q }
      q.maybeSingle = async () => opts.receipt ?? { data: null, error: null }
      return q
    }
    if (table === 'wbs_items') {
      const r = opts.backup ?? { data: BACKUP_ROWS, error: null }
      for (const k of ['select', 'eq', 'gt', 'order', 'limit', 'range']) q[k] = () => q   // 백업은 id 키셋(gt·limit)으로 읽는다
      q.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
        Promise.resolve({ ...r, count: Array.isArray(r.data) ? r.data.length : null }).then(res, rej)
      return q
    }
    throw new Error(`unexpected table: ${table}`)
  })
  m.createServerClient.mockResolvedValue({ from })
  return { from, receiptFilters }
}
const applied = (mode: 'append' | 'replace', count: number): Resp => ({ data: { status: 'applied', mode, count, command_id: CMD }, error: null })
const duplicate = (mode: 'append' | 'replace', count: number): Resp => ({ data: { status: 'duplicate', mode, count, command_id: CMD }, error: null })
const CONVERTED: Resp = { data: { status: 'converted', teams: 2, moved: { item_owners: 0, project_member_teams: 1, area_teams: 0, invites: 0 } }, error: null }
/** service_role 클라이언트 — RPC 둘만(팀 등록은 ensureProjectTeams 목, 양식 저장은 writeProjectSettingsInternal 목). 표는 만지지 않는다 */
function admin(opts: { import?: Resp; convert?: Resp } = {}) {
  const rpc = vi.fn<(name: string, args: Record<string, unknown>) => Promise<Resp>>(async (name) => {
    if (name === 'import_wbs_cmd') return opts.import ?? applied('append', 1)
    if (name === 'convert_inherited_teams') return opts.convert ?? CONVERTED
    throw new Error(`unexpected rpc: ${name}`)
  })
  const client = { rpc }
  m.createAdminClient.mockReturnValue(client)
  return { rpc, client }
}
function req(fields: Record<string, string> = {}): Parameters<typeof POST>[0] {
  const form = new FormData()
  form.append('file', new Blob(['x']))
  for (const [k, v] of Object.entries({
    projectId: P, profile: JSON.stringify(PROFILE), mode: 'append', saveProfile: 'false', registerTeams: 'false', commandId: CMD, ...fields,
  })) form.append(k, v)
  return { formData: async () => form } as unknown as Parameters<typeof POST>[0]
}
/** console.error 인자에 원문이 있는가 — failWith 가 원문을 무엇으로 싣든(문자열·Error·객체) 찾는다 */
const logged = (spy: { mock: { calls: unknown[][] } }, text: string) =>
  spy.mock.calls.flat().some((x) => (x instanceof Error ? x.message : typeof x === 'string' ? x : JSON.stringify(x) ?? '').includes(text))

beforeEach(() => {
  vi.clearAllMocks()
  m.requireProjectAdmin.mockResolvedValue({ ok: true, actor: ACTOR })
  m.parseWithProfile.mockReturnValue({ ok: true, rows: [row('RES')], holidays: [] })
  m.resolveLegacyLevelLabels.mockReturnValue(false)
  m.linkByDepth.mockReturnValue({ ok: true, items: ITEMS })
  m.splitLeafOwners.mockImplementation((items: unknown) => items)
  m.recordProgressSnapshot.mockResolvedValue(undefined)
  m.ingestProject.mockResolvedValue({ count: 2 })
  m.ensureProjectTeams.mockResolvedValue({ ok: true, created: [], existing: [] })
  m.writeProjectSettingsInternal.mockResolvedValue({ ok: true, status: 'applied', revision: 2, commandId: 'settings-cmd' })
  teamsAre([OWN_RES], [OWN_RES])
  session()
  admin()
})
afterEach(() => { vi.restoreAllMocks() })

describe('결과 종류와 응답 모양(#8·#9·#11)', () => {
  it('applied — { ok, kind, commandId, count, mode, reindexed, profileSaved }, RPC 에 가드의 행위자·명령 id, 영수증은 본인·그 명령·가져오기 종류로 확인', async () => {
    const { receiptFilters } = session()
    const { rpc } = admin({ import: applied('append', 1) })
    const res = await POST(req())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, kind: 'applied', commandId: CMD, count: 1, mode: 'append', reindexed: 2, profileSaved: false })
    expect(rpc.mock.calls).toEqual([['import_wbs_cmd', {
      p_actor: ACTOR.userId, p_project_id: P, p_mode: 'append', p_items: ITEMS, p_holidays: [], p_command_id: CMD,
    }]])
    expect(receiptFilters).toEqual([['actor', ACTOR.userId], ['command_id', CMD], ['kind', 'wbs_import']])
  })
  it('replace applied — 끝까지 읽은 백업과 교체 경고 둘', async () => {
    admin({ import: applied('replace', 3) })
    const body = await (await POST(req({ mode: 'replace' }))).json()
    expect(body).toMatchObject({ ok: true, kind: 'applied', count: 3, mode: 'replace' })
    expect(body.backup.rows).toEqual(BACKUP_ROWS)
    expect(typeof body.backup.generatedAt).toBe('string')
    expect(body.warnings).toHaveLength(2)
    expect(body.warnings).toEqual(expect.arrayContaining([expect.stringContaining('휴일은 삭제되지 않고 갱신만 됩니다')]))
  })
  it('영수증이 있으면(재전송) 팀 대조·등록·백업을 건너뛰고 RPC 의 duplicate — replace 라도 백업 없이 중복 경고 하나', async () => {
    const { from } = session({ receipt: { data: { command_id: CMD }, error: null } })
    admin({ import: duplicate('replace', 4) })
    m.parseWithProfile.mockReturnValue({ ok: true, rows: [row('RES', 'QA')], holidays: [] })   // 미등록 팀이 있어도 대조하지 않는다
    const res = await POST(req({ mode: 'replace' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      ok: true, kind: 'duplicate', commandId: CMD, count: 4, mode: 'replace', reindexed: 2, profileSaved: false, warnings: [DUP_WARNING],
    })
    expect(projectTeams).not.toHaveBeenCalled()
    expect(m.ensureProjectTeams).not.toHaveBeenCalled()
    expect(from.mock.calls.map(([table]) => table)).toEqual(['command_receipts'])
  })
  it('선확인이 놓친 재전송(동시 재전송 — 거짓 음성)도 RPC 의 duplicate — 이번에 읽은 백업은 싣지 않는다(이미 교체된 트리다)', async () => {
    admin({ import: duplicate('replace', 4) })
    const body = await (await POST(req({ mode: 'replace' }))).json()
    expect(body).toMatchObject({ ok: true, kind: 'duplicate', count: 4, warnings: [DUP_WARNING] })
    expect(body.backup).toBeUndefined()
  })
  it('중복이어도 스냅샷·색인과 요청된 양식 저장은 다시 돈다(Q40 — 셋 다 멱등)', async () => {
    session({ receipt: { data: { command_id: CMD }, error: null } })
    admin({ import: duplicate('append', 1) })
    teamsAre([OWN_RES, OWN_QA], [OWN_RES, OWN_QA])
    const body = await (await POST(req({ saveProfile: 'true' }))).json()
    expect(body).toMatchObject({ ok: true, kind: 'duplicate', profileSaved: true })
    expect(m.recordProgressSnapshot).toHaveBeenCalledWith(P)
    expect(m.ingestProject).toHaveBeenCalledWith(P)
    expect(m.writeProjectSettingsInternal).toHaveBeenCalledTimes(1)
  })
  it('RPC 결과의 모양이 기대와 다르면 500 IMPORT_FAILED — 성공으로 위장하지 않는다', async () => {
    admin({ import: { data: 7, error: null } })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await POST(req())
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ ok: false, code: 'IMPORT_FAILED' })
    expect(m.recordProgressSnapshot).not.toHaveBeenCalled()
  })
})

describe('미등록 팀(#6 — D4·D54·Q36)', () => {
  beforeEach(() => { m.parseWithProfile.mockReturnValue({ ok: true, rows: [row('RES', 'QA')], holidays: [] }) })

  it('전용 팀 프로젝트 + registerTeams=false → 409 NEEDS_TEAMS(inheritsCommon:false·공용 목록 없음), 쓰기 없음', async () => {
    const { rpc } = admin()
    const res = await POST(req())
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      ok: false, code: 'NEEDS_TEAMS', error: expect.any(String), needsTeams: ['QA'], inheritsCommon: false, commonTeams: [],
    })
    expect(m.ensureProjectTeams).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })
  it('상속 프로젝트(전용 0개) + registerTeams=false → 409 에 inheritsCommon:true 와 상속 중인 활성 공용 팀(code·이름)', async () => {
    teamsAre(COMMON, [])
    const res = await POST(req())
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({
      code: 'NEEDS_TEAMS', needsTeams: ['QA'], inheritsCommon: true,
      commonTeams: [{ code: 'RES', name: '연구팀' }, { code: 'OPS', name: '운영팀' }],
    })
  })
  it('등록된 팀은 비활성이어도 대조를 통과한다(등록 = 그 프로젝트가 쓰는 팀, 비활성 포함)', async () => {
    const qaOff = team('QA', { id: 'own-QA', active: false })
    teamsAre([OWN_RES, qaOff], [OWN_RES, qaOff])
    expect((await POST(req())).status).toBe(200)
    expect(m.ensureProjectTeams).not.toHaveBeenCalled()
  })
  it('전용 팀 프로젝트 + registerTeams=true → 전환 없이 ensureProjectTeams(가드의 워크스페이스) 뒤 가져오기', async () => {
    const { rpc } = admin()
    expect((await POST(req({ registerTeams: 'true' }))).status).toBe(200)
    expect(m.ensureProjectTeams).toHaveBeenCalledWith({ projectId: P, workspaceId: WS }, ['QA'])
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(['import_wbs_cmd'])
    expect(m.ensureProjectTeams.mock.invocationCallOrder[0]).toBeLessThan(rpc.mock.invocationCallOrder[0])
  })
  it('상속 프로젝트 + registerTeams=true → 전환 RPC 한 번(가드의 행위자) → 등록 → 가져오기 순', async () => {
    teamsAre(COMMON, [])
    const { rpc } = admin()
    expect((await POST(req({ registerTeams: 'true' }))).status).toBe(200)
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(['convert_inherited_teams', 'import_wbs_cmd'])
    expect(rpc.mock.calls[0][1]).toEqual({ p_actor: ACTOR.userId, p_project_id: P })
    const [convertAt, importAt] = rpc.mock.invocationCallOrder
    const ensureAt = m.ensureProjectTeams.mock.invocationCallOrder[0]
    expect(convertAt).toBeLessThan(ensureAt)
    expect(ensureAt).toBeLessThan(importAt)
  })
  it('동시 재전송 — 전환은 already, 등록은 이미 있음, RPC 는 duplicate → 500 이 아니라 200 duplicate', async () => {
    teamsAre(COMMON, [])
    admin({ convert: { data: { status: 'already' }, error: null }, import: duplicate('append', 1) })
    m.ensureProjectTeams.mockResolvedValue({ ok: true, created: [], existing: ['QA'] })
    const res = await POST(req({ registerTeams: 'true' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, kind: 'duplicate', commandId: CMD })
  })
  it('방금 등록한 팀의 열이 든 양식도 저장된다 — 교차 검증 기준 = 처음 읽은 설정 팀 ∪ 등록 결과(설정을 다시 읽지 않는다, Q36)', async () => {
    const { client } = admin()
    m.ensureProjectTeams.mockResolvedValue({ ok: true, created: ['QA'], existing: [] })
    const body = await (await POST(req({ registerTeams: 'true', saveProfile: 'true' }))).json()
    expect(body).toMatchObject({ ok: true, profileSaved: true })
    expect(body.profileSave).toBeUndefined()
    expect(m.writeProjectSettingsInternal).toHaveBeenCalledWith(client, P, { set: { 'wbs.excel_profile': PROFILE } }, ACTOR.userId)
    expect(m.getProjectConfig).toHaveBeenCalledTimes(1)
  })
  it('팀 이름으로 쓸 수 없는 미등록 팀 → 400 INVALID_TEAM_CODE(그 팀), 가져오기 없음', async () => {
    const { rpc } = admin()
    m.ensureProjectTeams.mockResolvedValue({ ok: false, code: 'INVALID_TEAM_CODE', error: '예약어', team: 'QA' })
    const res = await POST(req({ registerTeams: 'true' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ ok: false, code: 'INVALID_TEAM_CODE', team: 'QA' })
    expect(rpc).not.toHaveBeenCalled()
  })
  it('가드 결과에 그 프로젝트의 워크스페이스가 없으면(슈퍼유저·없는 프로젝트) 404 — 전환·등록·가져오기 없음', async () => {
    m.requireProjectAdmin.mockResolvedValue({ ok: true, actor: makeSuperuser() })
    const { rpc } = admin()
    const res = await POST(req({ registerTeams: 'true' }))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ ok: false, code: 'ERR_MISSING', error: ERR_MISSING })
    expect(m.ensureProjectTeams).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('실패 순서(#5~#8) — 앞 단계가 실패하면 뒤 단계를 부르지 않는다, 원문은 로그로만', () => {
  beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}) })

  it('영수증 조회 실패(#5) → 503 RECEIPT_UNAVAILABLE 재시도 가능 — 팀·백업·RPC 없음', async () => {
    session({ receipt: { data: null, error: { message: 'boom: permission denied for table command_receipts' } } })
    const { rpc } = admin()
    const res = await POST(req({ mode: 'replace' }))
    expect(res.status).toBe(503)
    const text = await res.text()
    expect(JSON.parse(text)).toMatchObject({ ok: false, code: 'RECEIPT_UNAVAILABLE', retryable: true })
    expect(text).not.toContain('boom')
    expect(projectTeams).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
    expect(logged(vi.mocked(console.error), 'boom')).toBe(true)
  })
  it('팀 원천 실패(#6) → 503 TEAMS_UNAVAILABLE 재시도 가능 — 전환·등록·RPC 없음', async () => {
    vi.mocked(projectTeams).mockRejectedValue(new TeamsUnavailableError('팀 목록을 불러오지 못했습니다.', { cause: new Error('boom') }))
    m.parseWithProfile.mockReturnValue({ ok: true, rows: [row('RES', 'QA')], holidays: [] })
    const { rpc } = admin()
    const res = await POST(req({ registerTeams: 'true' }))
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ ok: false, code: 'TEAMS_UNAVAILABLE', retryable: true })
    expect(m.ensureProjectTeams).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })
  it.each([
    ['등급 거부', { message: 'TEAM_CONVERT_FORBIDDEN', code: '42501' }, 403, 'ERR_DENIED'],
    ['프로젝트 없음', { message: 'PROJECT_NOT_FOUND', code: 'P0002' }, 404, 'ERR_MISSING'],
    ['잠금 대기 상한', { message: 'canceling statement due to lock timeout', code: '55P03' }, 503, null],
    ['교착', { message: 'deadlock detected', code: '40P01' }, 503, 'CONFIG_BUSY'],
    ['격리 수준(정상 경로 밖)', { message: 'TEAM_CONVERT_ISOLATION', code: '25001' }, 500, 'TEAM_CONVERT_FAILED'],
    ['입력 토큰(정상 경로 밖)', { message: 'TEAM_CONVERT_INVALID_INPUT', code: '22023' }, 500, 'TEAM_CONVERT_FAILED'],
  ] as const)('전환 RPC 실패(#6) — %s → %i, 등록·가져오기 없음', async (_n, err, status, code) => {
    teamsAre(COMMON, [])
    m.parseWithProfile.mockReturnValue({ ok: true, rows: [row('RES', 'QA')], holidays: [] })
    const { rpc } = admin({ convert: { data: null, error: err } })
    const res = await POST(req({ registerTeams: 'true' }))
    expect(res.status).toBe(status)
    const body = await res.json()
    expect(body.ok).toBe(false)
    if (code !== null) expect(body.code).toBe(code)
    expect(body.retryable === true).toBe(status === 503)
    expect(String(body.error)).not.toContain(err.message)   // 문구는 고정 — 원문(토큰·SQLSTATE 사유)은 로그로만
    expect(m.ensureProjectTeams).not.toHaveBeenCalled()
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(['convert_inherited_teams'])
  })
  it('팀 등록 실패(#6) → 500 TEAM_REGISTER_FAILED — 가져오기 없음', async () => {
    m.parseWithProfile.mockReturnValue({ ok: true, rows: [row('RES', 'QA')], holidays: [] })
    m.ensureProjectTeams.mockResolvedValue({ ok: false, code: 'TEAM_REGISTER_FAILED', error: '팀을 등록하지 못했습니다. 잠시 후 다시 시도하세요.', team: 'QA' })
    const { rpc } = admin()
    const res = await POST(req({ registerTeams: 'true' }))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body).toMatchObject({ ok: false, code: 'TEAM_REGISTER_FAILED' })
    expect(body.retryable).toBeUndefined()
    expect(rpc).not.toHaveBeenCalled()
  })
  it('백업 실패(#7) → 500 BACKUP_FAILED 고정 문구 — 가져오기 없음', async () => {
    session({ backup: { data: null, error: { message: 'boom' } } })
    const { rpc } = admin()
    const res = await POST(req({ mode: 'replace' }))
    expect(res.status).toBe(500)
    const text = await res.text()
    expect(JSON.parse(text)).toEqual({ ok: false, code: 'BACKUP_FAILED', error: '교체 전 백업을 만들지 못해 가져오기를 멈췄습니다. 잠시 후 다시 시도하세요.' })
    expect(text).not.toContain('boom')
    expect(rpc).not.toHaveBeenCalled()
  })
  it.each([
    ['등급 거부', { message: 'IMPORT_FORBIDDEN', code: '42501' }, 403, 'ERR_DENIED'],
    ['프로젝트 없음', { message: 'PROJECT_NOT_FOUND', code: 'P0002' }, 404, 'ERR_MISSING'],
    ['같은 id·다른 내용', { message: 'COMMAND_REUSED', code: '23505' }, 422, 'COMMAND_REUSED'],
    ['잠금 대기 상한', { message: 'canceling statement due to lock timeout', code: '55P03' }, 503, null],
    ['교착', { message: 'deadlock detected', code: '40P01' }, 503, 'CONFIG_BUSY'],
    ['격리 수준(정상 경로 밖)', { message: 'IMPORT_RECEIPT_ISOLATION', code: '25001' }, 500, 'IMPORT_FAILED'],
    ['입력 토큰(정상 경로 밖)', { message: 'IMPORT_INVALID_INPUT', code: '22023' }, 500, 'IMPORT_FAILED'],
    ['명령 id 없음(정상 경로 밖)', { message: 'COMMAND_ID_REQUIRED', code: '22023' }, 500, 'IMPORT_FAILED'],
  ] as const)('가져오기 RPC 실패(#8) — %s → %i, 양식 저장·스냅샷·색인 없음', async (_n, err, status, code) => {
    admin({ import: { data: null, error: err } })
    const res = await POST(req({ saveProfile: 'true' }))
    expect(res.status).toBe(status)
    const body = await res.json()
    expect(body.ok).toBe(false)
    if (code !== null) expect(body.code).toBe(code)
    expect(body.retryable === true).toBe(status === 503)
    expect(String(body.error)).not.toContain(err.message)   // 문구는 고정 — 원문은 로그로만
    expect(m.writeProjectSettingsInternal).not.toHaveBeenCalled()
    expect(m.recordProgressSnapshot).not.toHaveBeenCalled()
    expect(m.ingestProject).not.toHaveBeenCalled()
  })
})
