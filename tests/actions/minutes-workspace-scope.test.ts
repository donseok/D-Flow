import { describe, it, expect, vi, beforeEach } from 'vitest'

// SP2 Task 16a — 회의록 액션은 대상 행의 워크스페이스·프로젝트를 resolveScope 로 확정하고 그 범위에서 판정한다.
// 회의록 계열은 service_role 로 쓰므로(RLS 쓰기 정책 0) 거부는 admin client 에 닿기 전이어야 한다.
// 두 워크스페이스 WA·WB — 행은 가짜 DB 가 그대로 돌려준다(실제로는 RLS 가 비소속 워크스페이스 행을 가린다).
const getSession = vi.fn()
const getActor = vi.fn()
const createServerClient = vi.fn()
// 목 팩토리(호이스팅)가 import 시점에 쓰는 id 라 vi.hoisted 로 먼저 만든다.
const { WA, WB, PA, PB, MEETING_B } = vi.hoisted(() => ({
  WA: 'aaaaaaaa-1111-4111-8111-111111111111',
  WB: 'bbbbbbbb-2222-4222-8222-222222222222',
  PA: 'cccccccc-3333-4333-8333-333333333333',
  PB: 'dddddddd-4444-4444-8444-444444444444',
  MEETING_B: 'ffffffff-6666-4666-8666-666666666666',
}))
const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  ensureMinuteInsights: vi.fn(),
  // 팀 마스터 — 워크스페이스·프로젝트마다 팀이 다르다. 옛 전역 접근자는 전 워크스페이스 합집합(실구현과 같은 성질).
  workspaceTeams: vi.fn<(workspaceId: string) => string[]>(),
}))
vi.mock('@/lib/auth', () => ({ getSession: (...a: unknown[]) => getSession(...(a as [])) }))
vi.mock('@/lib/authz', async () => ({
  getActor: (...a: unknown[]) => getActor(...(a as [])),
  resolveScope: (await import('../helpers/resolve-scope-mock')).resolveScopeVia(() => createServerClient()),
}))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: (...a: unknown[]) => createServerClient(...(a as [])) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/server', () => ({ after: vi.fn() }))
vi.mock('@/lib/ai/minutes-ingest', () => ({ ingestMinute: vi.fn() }))
vi.mock('@/lib/ai/minutes-insights', () => ({
  ensureMinuteInsights: (...a: unknown[]) => mocks.ensureMinuteInsights(...(a as [])), generateMinuteInsights: vi.fn(),
}))
vi.mock('@/lib/data/meetings', () => ({ getProjectMeetingData: vi.fn() }))
vi.mock('@/lib/data/minutes', () => ({
  getMinuteDetail: vi.fn(), getMinutesPage: vi.fn(), searchMinutes: vi.fn(),
  getMinuteFavorites: vi.fn(), getMinutesExplorer: vi.fn(),
}))
vi.mock('@/lib/ai/wiki-ingest', () => ({
  enqueueMinuteWikiProcessing: vi.fn(async () => null), processMinuteWikiJob: vi.fn(),
  rebuildProjectWikiFromActiveMinutes: vi.fn(async () => {}),
}))
vi.mock('@/lib/minutes/folders', () => ({
  resolveTeamRootFolderId: vi.fn(async () => null), refileMinuteAfterProjectChange: vi.fn(async () => {}),
  loadFolderSnapshot: vi.fn(async () => null),
}))

const M = 'eeeeeeee-5555-4555-8555-555555555555'

vi.mock('@/lib/minutes/project', () => ({
  // 실구현은 실재만 확인한다 — 회의를 주면 그 회의의 프로젝트(MEETING_B → PB).
  resolveMinuteProject: vi.fn(async (_db: unknown, input: { meetingId: string | null; projectId?: string | null }) =>
    ({ projectId: input.meetingId === MEETING_B ? PB : input.projectId ?? null, error: null })),
}))
vi.mock('@/lib/teams/master', () => {
  const team = (code: string, workspaceId: string, projectId: string | null = null) =>
    ({ id: `t-${code}`, code, sortOrder: 0, active: true, progressVisible: true, projectId, workspaceId })
  const byProject: Record<string, string> = { [PA]: WA, [PB]: WB }
  return {
    teamsSync: () => [team('PMO', WA), team('ERP', WB)],
    activeTeamCodesSync: () => ['PMO', 'ERP'],
    teamsForWorkspaceSync: (w: string) => mocks.workspaceTeams(w).map(c => team(c, w)),
    activeTeamCodesForWorkspaceSync: (w: string) => mocks.workspaceTeams(w),
    teamsForProjectSync: (p: string) => mocks.workspaceTeams(byProject[p]).map(c => team(c, byProject[p])),
    activeTeamCodesForProjectSync: (p: string) => mocks.workspaceTeams(byProject[p]),
  }
})

import {
  assignMinutesProject, createMinute, deleteMinute, ensureMinuteInsightsAction, getMinuteFileUrl, moveMinuteFolder,
  moveMinuteToFolder, removeMinuteFile, renameMinuteFolder, setMinuteShare, toggleMinuteHighlight, updateMinuteMeta,
} from '@/app/actions/minutes'
import { makeActor } from '../fixtures/actor'
import type { Actor, ProjectRole } from '@/lib/domain/authz'

const ADMIN_REACHED = 'ADMIN_REACHED'
const ERR_LOOKUP = '권한을 확인할 수 없어 중단했습니다.'
const CROSS_WS = '다른 워크스페이스의 프로젝트·폴더로는 옮길 수 없습니다.'

/** WA·WB 양쪽 워크스페이스 멤버 — 명단 역할은 roles 로 준다. */
const actorWith = (roles: Array<[string, ProjectRole]>, over: Partial<Actor> = {}) => makeActor({
  workspaceRoles: new Map([[WA, 'member'], [WB, 'member']]),
  projectWorkspace: new Map([[PA, WA], [PB, WB]]),
  projectRoles: new Map(roles),
  ...over,
})
const onlyInB = actorWith([[PB, 'member']])
const inA = actorWith([[PA, 'member']])
const inBoth = actorWith([[PA, 'member'], [PB, 'member']])
/** WA 에만 소속 — 무프로젝트 생성은 유일 워크스페이스가 필요하다. */
const soloA = makeActor({
  workspaceRoles: new Map([[WA, 'member']]), projectWorkspace: new Map([[PA, WA]]),
  projectRoles: new Map<string, ProjectRole>([[PA, 'member']]),
})

type TableResult = { data?: unknown; error: { message: string } | null }
/** 테이블별 결과를 주입하는 thenable 가짜 빌더 — 같은 표의 조회는 모두 같은 결과. 호출을 기록한다. */
function fakeClient(results: Record<string, TableResult>) {
  const calls: Record<string, string[]> = {}
  const from = vi.fn((table: string) => {
    const log = (calls[table] ??= [])
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'in', 'is', 'order', 'maybeSingle', 'single']) {
      b[m] = vi.fn(() => { log.push(m); return b })
    }
    ;(b as { then: (r: (v: TableResult) => void) => void }).then = resolve => resolve(results[table] ?? { data: [], error: null })
    return b
  })
  return { client: { from }, calls }
}
/** WA 의 무프로젝트 회의록 — 작성자는 u1(각 액터의 userId). */
const minuteRow = (over: Record<string, unknown> = {}) => ({
  id: M, created_by: 'u1', archived_at: null, project_id: null, workspace_id: WA,
  team_code: 'PMO', body_md: '본문', folder_id: null, share_token: null, share_enabled: false, ...over,
})
/** WA·WB 의 무프로젝트 트리 — 각 워크스페이스의 팀 시드 루트와 하위 폴더, WA 의 사용자 루트(옛 데이터). */
const FOLDERS = [
  { id: 'wa-pmo', name: 'PMO', parent_id: null, sort: 0, created_by: null, project_id: null, workspace_id: WA },
  { id: 'wa-sub', name: '하위', parent_id: 'wa-pmo', sort: 0, created_by: 'u1', project_id: null, workspace_id: WA },
  { id: 'wa-free', name: '자유', parent_id: 'wa-pmo', sort: 1, created_by: 'u1', project_id: null, workspace_id: WA },
  { id: 'wa-legacy', name: '옛루트', parent_id: null, sort: 2, created_by: 'u1', project_id: null, workspace_id: WA },
  { id: 'wb-erp', name: 'ERP', parent_id: null, sort: 0, created_by: null, project_id: null, workspace_id: WB },
  { id: 'wb-sub', name: '물류', parent_id: 'wb-erp', sort: 0, created_by: 'u1', project_id: null, workspace_id: WB },
]
const seedDb = (results: Record<string, TableResult> = {}) => {
  const db = fakeClient({
    minutes: { data: minuteRow(), error: null }, minute_folders: { data: FOLDERS, error: null }, ...results,
  })
  createServerClient.mockResolvedValue(db.client)
  return db
}
const PATCH = { minuteDate: '2026-09-26', teamCode: 'PMO', title: '제목', meetingId: null, projectId: null }

beforeEach(() => {
  getSession.mockReset(); getActor.mockReset(); createServerClient.mockReset()
  mocks.createAdminClient.mockReset(); mocks.ensureMinuteInsights.mockReset()
  mocks.createAdminClient.mockImplementation(() => { throw new Error(ADMIN_REACHED) })
  mocks.ensureMinuteInsights.mockResolvedValue('ready')
  mocks.workspaceTeams.mockReset()
  mocks.workspaceTeams.mockImplementation(w => (w === WA ? ['PMO'] : w === WB ? ['ERP'] : []))
  getSession.mockResolvedValue({ id: 'u1', user_metadata: {}, email: 'alice@example.com' })
})

describe('무프로젝트 회의록(WA) — B 에만 역할이 있으면 작성자라도 거부', () => {
  it('updateMinuteMeta: B 전용은 권한 없음, A 에 역할이 있으면 쓰기 단계로 간다', async () => {
    seedDb()
    getActor.mockResolvedValue(onlyInB)
    expect(await updateMinuteMeta(M, PATCH as never)).toEqual({ ok: false, error: '권한 없음' })
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
    getActor.mockResolvedValue(inA)
    expect(await updateMinuteMeta(M, PATCH as never)).toMatchObject({ ok: false, error: ADMIN_REACHED })
  })

  it('deleteMinute(보관): B 전용은 권한 없음, A 에 역할이 있으면 쓰기 단계로 간다', async () => {
    seedDb()
    getActor.mockResolvedValue(onlyInB)
    expect(await deleteMinute(M)).toEqual({ ok: false, error: '권한 없음' })
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
    getActor.mockResolvedValue(inA)
    expect(await deleteMinute(M)).toMatchObject({ ok: false, error: ADMIN_REACHED })
  })

  it('moveMinuteToFolder: B 전용은 권한 없음, A 에 역할이 있으면 쓰기 단계로 간다', async () => {
    seedDb()
    getActor.mockResolvedValue(onlyInB)
    expect(await moveMinuteToFolder(M, 'wa-sub')).toEqual({ ok: false, error: '권한 없음' })
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
    getActor.mockResolvedValue(inA)
    expect(await moveMinuteToFolder(M, 'wa-sub')).toMatchObject({ ok: false, error: ADMIN_REACHED })
  })

  it('setMinuteShare: B 전용은 권한 없음', async () => {
    seedDb()
    getActor.mockResolvedValue(onlyInB)
    expect(await setMinuteShare(M, 'enable' as never)).toEqual({ ok: false, error: '권한 없음' })
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })

  it('toggleMinuteHighlight: B 전용은 하이라이트를 남기지 못한다 — A 에 역할이 있으면 본문 검증까지 간다', async () => {
    const db = seedDb()
    getActor.mockResolvedValue(onlyInB)
    expect(await toggleMinuteHighlight(M, 0, 'hash')).toEqual({ ok: false, error: '권한 없음' })
    expect(db.calls.minute_highlights).toBeUndefined()
    getActor.mockResolvedValue(inA)
    expect(await toggleMinuteHighlight(M, 0, 'hash')).toEqual({ ok: false, error: '본문이 변경되었습니다. 새로고침 해주세요.' })
  })

  it('ensureMinuteInsightsAction: B 전용은 self-heal 을 트리거하지 못한다', async () => {
    seedDb()
    getActor.mockResolvedValue(onlyInB)
    expect(await ensureMinuteInsightsAction(M)).toEqual({ status: 'unavailable' })
    expect(mocks.ensureMinuteInsights).not.toHaveBeenCalled()
    getActor.mockResolvedValue(inA)
    expect(await ensureMinuteInsightsAction(M)).toEqual({ status: 'ready' })
    expect(mocks.ensureMinuteInsights).toHaveBeenCalledTimes(1)
  })
})

describe('resolveScope 조회 실패 — ERR_LOOKUP 으로 중단(쓰기 미도달)', () => {
  const failing = () => seedDb({ minutes: { data: null, error: { message: 'db down' } } })

  it.each([
    ['updateMinuteMeta', () => updateMinuteMeta(M, PATCH as never)],
    ['deleteMinute', () => deleteMinute(M)],
    ['moveMinuteToFolder', () => moveMinuteToFolder(M, 'wa-sub')],
    ['setMinuteShare', () => setMinuteShare(M, 'enable' as never)],
    ['toggleMinuteHighlight', () => toggleMinuteHighlight(M, 0, 'hash')],
  ])('%s', async (_name, run) => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const db = failing()
    getActor.mockResolvedValue(inA)
    expect(await run()).toEqual({ ok: false, error: ERR_LOOKUP })
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
    expect(db.calls.minute_highlights).toBeUndefined()
    spy.mockRestore()
  })
})

describe('담당 팀 — 대상 범위(프로젝트, 미지정이면 워크스페이스)의 팀만', () => {
  const input = { minuteDate: '2026-09-26', title: '제목', bodyMd: '본문', meetingId: null }

  it('createMinute 무프로젝트(WA): WB 의 팀 코드는 거부, WA 의 팀은 쓰기 단계로 간다', async () => {
    seedDb()
    getActor.mockResolvedValue(soloA)
    expect(await createMinute({ ...input, teamCode: 'ERP', projectId: null } as never))
      .toEqual({ ok: false, error: '잘못된 담당입니다.' })
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
    expect(await createMinute({ ...input, teamCode: 'PMO', projectId: null } as never))
      .toMatchObject({ ok: false, error: ADMIN_REACHED })
  })

  it('createMinute 프로젝트(PA): 그 프로젝트의 팀이 아니면 거부', async () => {
    seedDb()
    getActor.mockResolvedValue(inA)
    expect(await createMinute({ ...input, teamCode: 'ERP', projectId: PA } as never))
      .toEqual({ ok: false, error: '잘못된 담당입니다.' })
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })

  it('updateMinuteMeta: WA 회의록에 WB 의 팀 코드는 거부', async () => {
    seedDb()
    getActor.mockResolvedValue(inA)
    expect(await updateMinuteMeta(M, { ...PATCH, teamCode: 'ERP' } as never))
      .toEqual({ ok: false, error: '잘못된 담당입니다.' })
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })

  it('팀 캐시를 못 채웠으면 빈 목록이 아니라 오류로 멈춘다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.workspaceTeams.mockImplementation(() => { throw new Error('팀 마스터를 아직 불러오지 못했습니다.') })
    seedDb()
    getActor.mockResolvedValue(soloA)
    expect(await createMinute({ ...input, teamCode: 'PMO', projectId: null } as never))
      .toEqual({ ok: false, error: '팀 목록을 불러오지 못했습니다. 잠시 후 다시 시도하세요.' })
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('renameMinuteFolder: 루트 예약어는 그 폴더 워크스페이스의 팀만 — WB 팀 이름은 WA 의 앵커가 아니다', async () => {
    const db = seedDb()
    getActor.mockResolvedValue(inA)
    expect(await renameMinuteFolder('wa-legacy', 'PMO')).toMatchObject({ ok: false })
    expect(db.calls.minute_folders).not.toContain('update')
    expect((await renameMinuteFolder('wa-legacy', 'ERP')).ok).toBe(true)
    expect(db.calls.minute_folders).toContain('update')
  })
})

describe('교차 워크스페이스 이동 — 트리거까지 가지 않고 쓰기 전에 거절', () => {
  it('updateMinuteMeta: WA 회의록을 WB 프로젝트로 — 두 프로젝트의 멤버·작성자여도 거절', async () => {
    seedDb()
    getActor.mockResolvedValue(inBoth)
    expect(await updateMinuteMeta(M, { ...PATCH, teamCode: 'ERP', projectId: PB } as never))
      .toEqual({ ok: false, error: CROSS_WS })
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })

  it('updateMinuteMeta: WB 회의에 연결해도 같다 — 회의의 프로젝트가 기준', async () => {
    seedDb()
    getActor.mockResolvedValue(inBoth)
    expect(await updateMinuteMeta(M, { ...PATCH, teamCode: 'ERP', meetingId: MEETING_B } as never))
      .toEqual({ ok: false, error: CROSS_WS })
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })

  it('updateMinuteMeta: 경합으로 RPC 가 WORKSPACE_SCOPE_MISMATCH 를 내도 영문 상수 대신 사용자 문구', async () => {
    seedDb()
    getActor.mockResolvedValue(inA)
    const rpc = vi.fn(() => ({ single: () => Promise.resolve({ data: null, error: { message: 'WORKSPACE_SCOPE_MISMATCH' } }) }))
    mocks.createAdminClient.mockReset()
    mocks.createAdminClient.mockReturnValue({ rpc, from: vi.fn() })
    expect(await updateMinuteMeta(M, PATCH as never)).toEqual({ ok: false, error: CROSS_WS })
  })

  it('assignMinutesProject: WB 프로젝트로 일괄 지정하면 WA 회의록은 건별 거절 — RPC 미도달', async () => {
    seedDb({ projects: { data: { id: PB, workspace_id: WB }, error: null }, minutes: { data: [minuteRow()], error: null } })
    getActor.mockResolvedValue(actorWith([[PA, 'admin'], [PB, 'admin']]))
    const rpc = vi.fn()
    mocks.createAdminClient.mockReset()
    mocks.createAdminClient.mockReturnValue({ rpc, from: vi.fn() })
    const r = await assignMinutesProject([M], PB)
    expect(r).toMatchObject({ ok: true, updated: 0, skipped: [{ id: M, reason: CROSS_WS }] })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('moveMinuteFolder: WA 폴더를 WB 폴더 아래로 — update 미도달', async () => {
    const db = seedDb()
    getActor.mockResolvedValue(inBoth)
    expect(await moveMinuteFolder('wa-free', 'wb-sub'))
      .toEqual({ ok: false, error: '다른 워크스페이스 폴더로는 이동할 수 없습니다.' })
    expect(db.calls.minute_folders).not.toContain('update')
  })
})

describe('팀 목록 조회 실패 — 폴더 루트 예약어 판정도 빈 목록이 아니라 오류로 멈춘다', () => {
  const TEAMS_DOWN = '팀 목록을 불러오지 못했습니다. 잠시 후 다시 시도하세요.'
  beforeEach(() => {
    mocks.workspaceTeams.mockImplementation(() => { throw new Error('팀 마스터를 아직 불러오지 못했습니다.') })
  })

  it('renameMinuteFolder(루트): update 미도달', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const db = seedDb()
    getActor.mockResolvedValue(inA)
    expect(await renameMinuteFolder('wa-legacy', 'PMO')).toEqual({ ok: false, error: TEAMS_DOWN })
    expect(db.calls.minute_folders).not.toContain('update')
    spy.mockRestore()
  })

  it('moveMinuteFolder(루트로): update 미도달', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const db = seedDb()
    getActor.mockResolvedValue(inA)
    expect(await moveMinuteFolder('wa-free', null)).toEqual({ ok: false, error: TEAMS_DOWN })
    expect(db.calls.minute_folders).not.toContain('update')
    spy.mockRestore()
  })
})

describe('조회 실패를 없음으로 위장하지 않는다(3원칙 ①) — 첨부·요약 self-heal', () => {
  const FILE_DOWN = '첨부 파일 정보를 불러오지 못했습니다. 잠시 후 다시 시도하세요.'

  it('removeMinuteFile: 첨부 조회 실패는 "파일 없음"이 아니라 조회 실패 — 삭제 미도달', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const db = seedDb({ minute_files: { data: null, error: { message: 'db down' } } })
    getActor.mockResolvedValue(inA)
    expect(await removeMinuteFile('file-1')).toEqual({ ok: false, error: FILE_DOWN })
    expect(db.calls.minute_files).not.toContain('delete')
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('getMinuteFileUrl: 첨부 조회 실패는 "파일 없음"이 아니라 조회 실패', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    seedDb({ minute_files: { data: null, error: { message: 'db down' } } })
    expect(await getMinuteFileUrl('file-1')).toEqual({ ok: false, error: FILE_DOWN })
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('ensureMinuteInsightsAction: 범위 조회 실패는 사유를 싣는다 — 자격 없음(사유 없음)과 구별', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    seedDb({ minutes: { data: null, error: { message: 'db down' } } })
    getActor.mockResolvedValue(inA)
    expect(await ensureMinuteInsightsAction(M)).toEqual({ status: 'unavailable', error: ERR_LOOKUP })
    seedDb()
    getActor.mockResolvedValue(onlyInB)
    expect(await ensureMinuteInsightsAction(M)).toEqual({ status: 'unavailable' })
    expect(mocks.ensureMinuteInsights).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('ensureMinuteInsightsAction: 본문 조회 실패도 사유를 싣는다 — self-heal 미실행', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    // 첫 minutes 조회(범위)는 성공, 두 번째(본문)는 실패 — 표별 응답 큐.
    const queue: TableResult[] = [{ data: minuteRow(), error: null }, { data: null, error: { message: 'db down' } }]
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'maybeSingle']) b[m] = vi.fn(() => b)
    ;(b as { then: (r: (v: TableResult) => void) => void }).then = resolve => resolve(queue.shift()!)
    createServerClient.mockResolvedValue({ from: vi.fn(() => b) })
    getActor.mockResolvedValue(inA)
    expect(await ensureMinuteInsightsAction(M))
      .toEqual({ status: 'unavailable', error: '회의록을 불러오지 못했습니다. 잠시 후 다시 시도하세요.' })
    expect(mocks.ensureMinuteInsights).not.toHaveBeenCalled()
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
