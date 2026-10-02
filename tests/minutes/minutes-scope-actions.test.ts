// 회의록 목록·폴더 액션의 워크스페이스 인자(D26, §5.8, 계획 V13) — 비소속이면 거부 값(존재 은닉), 소속이면 그 워크스페이스로 관문.
// ?project= 는 그 워크스페이스의 아는 프로젝트일 때만(W11) — 아니면 비소속과 같은 거부 값. 폴더·회의록 행의 워크스페이스가 인자와 다르면 조작하지 않는다.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  getSession: vi.fn(), getActor: vi.fn(), resolveProjectId: vi.fn(),
  getMinutesPage: vi.fn(async () => []), searchMinutes: vi.fn(async () => []), getMinutesExplorer: vi.fn(async () => ({ folders: [], leaves: [], total: 0, truncated: false })),
  getMinuteFavorites: vi.fn(async () => ['m1']),
  fromCalls: [] as string[], lists: {} as Record<string, unknown[]>, rows: {} as Record<string, unknown>,
}))
vi.mock('@/lib/auth', () => ({ getSession: h.getSession }))
vi.mock('@/lib/authz', () => ({ getActor: h.getActor, resolveScope: vi.fn(), resolveProjectId: h.resolveProjectId }))
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({
    from: (table: string) => {
      h.fromCalls.push(table)
      const chain: Record<string, unknown> = {}
      for (const k of ['select', 'eq', 'is', 'order', 'in', 'update', 'delete', 'insert', 'upsert']) chain[k] = () => chain
      chain.maybeSingle = async () => ({ data: h.rows[table] ?? null, error: null })
      chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: h.lists[table] ?? [], error: null }).then(res)
      return chain
    },
  }),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/server', () => ({ after: vi.fn() }))
vi.mock('@/lib/ai/minutes-ingest', () => ({ ingestMinute: vi.fn() }))
vi.mock('@/lib/ai/minutes-insights', () => ({ ensureMinuteInsights: vi.fn(), generateMinuteInsights: vi.fn() }))
vi.mock('@/lib/ai/wiki-ingest', () => ({ enqueueMinuteWikiProcessing: vi.fn(), processMinuteWikiJob: vi.fn(), rebuildProjectWikiFromActiveMinutes: vi.fn() }))
vi.mock('@/lib/data/meetings', () => ({ getProjectMeetingData: vi.fn() }))
vi.mock('@/lib/minutes/folders', () => ({ resolveTeamRootFolderId: vi.fn(async () => null), refileMinuteAfterProjectChange: vi.fn(), loadFolderSnapshot: vi.fn(async () => null) }))
vi.mock('@/lib/authz/visibility', () => ({ getHiddenProjectIds: async () => new Set<string>() }))
vi.mock('@/lib/data/minutes', () => ({
  getMinuteDetail: vi.fn(), getMinutesPage: h.getMinutesPage, searchMinutes: h.searchMinutes,
  getMinuteFavorites: h.getMinuteFavorites, getMinutesExplorer: h.getMinutesExplorer,
}))

import {
  assignMinutesProject, createMinute, createMinuteFolder, deleteMinuteFolder, fetchMinuteFavorites, fetchMinuteFoldersLite,
  fetchMinutesExplorer, fetchMinutesRange, fetchMinutesSearch, moveMinuteFolder, renameMinuteFolder,
} from '@/app/actions/minutes'
import { ERR_LOOKUP, ERR_MISSING } from '@/lib/authz/errors'
import { ERR_WORKSPACE_REQUIRED } from '@/lib/authz/workspace'
import { requireModule, requireSessionModule } from '@/lib/modules/gate'
import { makeActor } from '../fixtures/actor'

const WA = '00000000-0000-0000-7e57-000000001675', WB = '00000000-0000-0000-7e57-000000001676'
const PA = '00000000-0000-0000-7e57-000000001677', PB = '00000000-0000-0000-7e57-000000001678'
const F_ROOT_A = '00000000-0000-0000-7e57-000000001679', F_B = '00000000-0000-0000-7e57-00000000167a'
const MIN_B = '00000000-0000-4000-8e57-00000000167b'   // 액션의 지역 UUID_RE(버전·변형 니블)를 통과하는 꼴
const folder = (id: string, workspaceId: string, parentId: string | null = null) =>
  ({ id, name: id === F_ROOT_A ? 'PMO' : 'x', parent_id: parentId, sort: 0, created_by: 'u1', project_id: null, workspace_id: workspaceId })

beforeEach(() => {
  vi.clearAllMocks()
  h.fromCalls.length = 0; h.lists = {}; h.rows = {}
  h.getSession.mockResolvedValue({ id: 'u1', email: 'alice@example.com', user_metadata: {} })
  h.getActor.mockResolvedValue(makeActor({ workspaceRoles: new Map([[WA, 'member']]), projectWorkspace: new Map([[PA, WA], [PB, WB]]) }))
})

describe('목록 액션(scope 첫 인자)', () => {
  it('소속 워크스페이스 — 그 워크스페이스로 관문 뒤 로더(범위·프로젝트를 그대로)', async () => {
    await fetchMinutesRange({ workspaceId: WA, projectId: null }, '2026-09-01', '2026-09-30', null)
    expect(requireModule).toHaveBeenCalledWith({ workspaceId: WA }, 'minutes')
    expect(requireSessionModule).not.toHaveBeenCalled()
    expect(h.getMinutesPage).toHaveBeenCalledWith(WA, null, '2026-09-01', '2026-09-30', null)
    await fetchMinutesSearch({ workspaceId: WA, projectId: PA }, 'acme', null)
    expect(h.searchMinutes).toHaveBeenCalledWith(WA, PA, 'acme', null, 100)
    await fetchMinutesExplorer({ workspaceId: WA, projectId: PA })
    expect(h.getMinutesExplorer).toHaveBeenCalledWith(WA, PA)
    expect(await fetchMinuteFavorites(WA)).toEqual(['m1'])
    expect(h.getMinuteFavorites).toHaveBeenCalledWith(WA)           // 인자 워크스페이스의 즐겨찾기만(FA3)
  })
  it('비소속 워크스페이스는 관문 전에 거부 값(존재 은닉) — 로더를 부르지 않는다', async () => {
    expect(await fetchMinutesRange({ workspaceId: WB, projectId: null }, '2026-09-01', '2026-09-30', null)).toEqual({ ok: true, rows: [] })
    expect(await fetchMinutesSearch({ workspaceId: WB, projectId: null }, 'acme', null)).toEqual({ ok: true, rows: [] })
    expect(await fetchMinutesExplorer({ workspaceId: WB, projectId: null })).toBeNull()
    expect(await fetchMinuteFavorites(WB)).toBeNull()
    expect(requireModule).not.toHaveBeenCalled()
    expect(h.getMinutesPage).not.toHaveBeenCalled(); expect(h.searchMinutes).not.toHaveBeenCalled()
    expect(h.getMinutesExplorer).not.toHaveBeenCalled(); expect(h.getMinuteFavorites).not.toHaveBeenCalled()
  })
  it('W11 — 프로젝트가 그 워크스페이스의 아는 프로젝트가 아니면(다른 워크스페이스·모름·형식 밖) 비소속과 같은 거부 값', async () => {
    for (const p of [PB, '00000000-0000-0000-7e57-00000000167f', 'x']) {
      expect(await fetchMinutesRange({ workspaceId: WA, projectId: p }, '2026-09-01', '2026-09-30', null), p).toEqual({ ok: true, rows: [] })
    }
    expect(h.getMinutesPage).not.toHaveBeenCalled()
    expect(requireModule).not.toHaveBeenCalled()
  })
  it('모양 밖 범위(문자열·빈 id·잘못된 projectId 형)는 거부 값', async () => {
    for (const s of ['WA', null, { workspaceId: '' }, { workspaceId: WA, projectId: 3 }]) {
      expect(await fetchMinutesExplorer(s as never)).toBeNull()
    }
    expect(h.getMinutesExplorer).not.toHaveBeenCalled()
  })
  it('플랫폼 관리자가 넣은 모양 밖(줄바꿈·공백·64자 초과) 워크스페이스 id 는 소속 판정·관문·로그에 닿기 전에 거부 값(FA3 — 그 값이 설정 조회 오류·로그에 실리지 않게)', async () => {
    h.getActor.mockResolvedValue(makeActor({ isSuperuser: true, workspaceRoles: new Map() }))
    for (const w of ['x\nforged log line', 'a'.repeat(300), 'a b;c', '']) {
      const scope = { workspaceId: w, projectId: null }
      expect(await fetchMinutesRange(scope, '2026-09-01', '2026-09-30', null), w).toEqual({ ok: true, rows: [] })
      expect(await fetchMinutesSearch(scope, 'acme', null), w).toEqual({ ok: true, rows: [] })
      expect(await fetchMinutesExplorer(scope), w).toBeNull()
      expect(await fetchMinuteFavorites(w), w).toBeNull()
      expect(await fetchMinuteFoldersLite(w), w).toBeNull()
    }
    expect(requireModule).not.toHaveBeenCalled()
    expect(h.getMinutesPage).not.toHaveBeenCalled(); expect(h.getMinuteFavorites).not.toHaveBeenCalled()
  })
  it('플랫폼 관리자도 모양이 맞는 워크스페이스 id 면 그대로 판정한다(대조)', async () => {
    h.getActor.mockResolvedValue(makeActor({ isSuperuser: true, workspaceRoles: new Map() }))
    await fetchMinutesRange({ workspaceId: WB, projectId: null }, '2026-09-01', '2026-09-30', null)
    expect(requireModule).toHaveBeenCalledWith({ workspaceId: WB }, 'minutes')
  })
  it('관문이 닫히면 로더를 부르지 않는다', async () => {
    vi.mocked(requireModule).mockResolvedValueOnce({ ok: false, error: '꺼짐' })
    expect(await fetchMinutesRange({ workspaceId: WA, projectId: null }, '2026-09-01', '2026-09-30', null)).toEqual({ ok: true, rows: [] })
    expect(h.getMinutesPage).not.toHaveBeenCalled()
  })
  it('권한 조회 실패는 거부 값(목록) — 로더를 부르지 않는다', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.getActor.mockRejectedValue(new Error('down'))
    expect(await fetchMinutesExplorer({ workspaceId: WA, projectId: null })).toBeNull()
    expect(h.getMinutesExplorer).not.toHaveBeenCalled()
    err.mockRestore()
  })
  it('월 이동·검색은 권한 조회 실패를 빈 목록이 아니라 실패로 돌려주고 원인을 로그에 남긴다(fetchMyMeetings 와 같은 꼴, V5)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.getActor.mockRejectedValue(new Error('down'))
    expect(await fetchMinutesRange({ workspaceId: WA, projectId: null }, '2026-09-01', '2026-09-30', null)).toEqual({ ok: false, error: ERR_LOOKUP })
    expect(await fetchMinutesSearch({ workspaceId: WA, projectId: null }, 'acme', null)).toEqual({ ok: false, error: ERR_LOOKUP })
    expect(err).toHaveBeenCalledWith('[minutes] 권한 조회 실패:', 'down')
    expect(h.getMinutesPage).not.toHaveBeenCalled(); expect(h.searchMinutes).not.toHaveBeenCalled()
    err.mockRestore()
  })
})

describe('폴더·일괄 지정·새 회의록(workspaceId 인자)', () => {
  it('폴더 목록 — 보이는 행이 없으면 인자 워크스페이스로 판정, 인자가 없으면 null(추측하지 않는다)', async () => {
    expect(await fetchMinuteFoldersLite(WA)).toEqual([])
    expect(requireModule).toHaveBeenCalledWith({ workspaceId: WA }, 'minutes')
    expect(await fetchMinuteFoldersLite()).toBeNull()
    expect(await fetchMinuteFoldersLite(WB)).toBeNull()
    expect(requireSessionModule).not.toHaveBeenCalled()
  })
  it('폴더 조작 — 비소속 워크스페이스는 ERR_MISSING, 폴더를 읽지 않는다', async () => {
    expect(await createMinuteFolder(WB, '폴더', F_B)).toEqual({ ok: false, error: ERR_MISSING })
    expect(await renameMinuteFolder(WB, F_B, '폴더')).toEqual({ ok: false, error: ERR_MISSING })
    expect(await deleteMinuteFolder(WB, F_B)).toEqual({ ok: false, error: ERR_MISSING })
    expect(await moveMinuteFolder(WB, F_B, null)).toEqual({ ok: false, error: ERR_MISSING })
    expect(h.fromCalls).toEqual([])
  })
  it('폴더 조작 — 대상·부모 폴더 행의 워크스페이스가 인자와 다르면 ERR_MISSING(쓰기 없음)', async () => {
    h.getActor.mockResolvedValue(makeActor({ isSuperuser: true, workspaceRoles: new Map([[WA, 'admin'], [WB, 'admin']]) }))
    h.lists = { minute_folders: [folder(F_ROOT_A, WA), folder(F_B, WB, F_ROOT_A)] }
    expect(await createMinuteFolder(WA, '새 폴더', F_B)).toEqual({ ok: false, error: ERR_MISSING })
    expect(await renameMinuteFolder(WA, F_B, '폴더')).toEqual({ ok: false, error: ERR_MISSING })
    expect(await deleteMinuteFolder(WA, F_B)).toEqual({ ok: false, error: ERR_MISSING })
    expect(await moveMinuteFolder(WA, F_B, F_ROOT_A)).toEqual({ ok: false, error: ERR_MISSING })
    expect(h.fromCalls.every((t) => t === 'minute_folders')).toBe(true)
  })
  it('일괄 지정 — 비소속이면 쓰기 전 거부, 행의 워크스페이스가 다르면 그 행만 실패로 센다', async () => {
    const res0 = await assignMinutesProject(WB, [MIN_B], null)
    expect(res0).toMatchObject({ ok: false, error: ERR_MISSING })
    expect(h.fromCalls).toEqual([])
    h.lists = { minutes: [{ id: MIN_B, created_by: 'u1', archived_at: null, project_id: null, workspace_id: WB, meeting_id: null, team_code: 'PMO', folder_id: null }] }
    const res = await assignMinutesProject(WA, [MIN_B], null)
    expect(res.updated).toBe(0)
    expect(res.skipped.map((s) => s.id)).toEqual([MIN_B])
  })
  it('새 회의록(프로젝트·회의 없음) — 인자 워크스페이스로 판정, 없으면 ERR_WORKSPACE_REQUIRED, 비소속이면 ERR_MISSING', async () => {
    const input = { minuteDate: '2026-09-01', teamCode: 'PMO', title: 'Acme', bodyMd: '# b', meetingId: null, projectId: null }
    expect(await createMinute(input, null, undefined)).toEqual({ ok: false, error: ERR_WORKSPACE_REQUIRED })
    expect(await createMinute(input, null, undefined, WB)).toEqual({ ok: false, error: ERR_MISSING })
    expect(requireModule).not.toHaveBeenCalled()
    vi.mocked(requireModule).mockResolvedValueOnce({ ok: false, error: '꺼짐' })
    expect(await createMinute(input, null, undefined, WA)).toEqual({ ok: false, error: '꺼짐' })
    expect(requireModule).toHaveBeenCalledWith({ workspaceId: WA }, 'minutes')
    expect(requireSessionModule).not.toHaveBeenCalled()
  })
  it('새 회의록 — 권한 조회 실패는 ERR_LOOKUP', async () => {
    h.getActor.mockRejectedValue(new Error('down'))
    const input = { minuteDate: '2026-09-01', teamCode: 'PMO', title: 'Acme', bodyMd: '# b', meetingId: null, projectId: null }
    expect(await createMinute(input, null, undefined, WA)).toEqual({ ok: false, error: ERR_LOOKUP })
  })
})
