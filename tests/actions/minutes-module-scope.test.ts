// 회의록 액션의 minutes 관문이 무엇으로 판정하는가(스펙 §4.2·판정 P28·사전 점검 D-I4) — 대상 행이 있으면 **행의 워크스페이스**,
// 첨부 내려받기는 **파일 행의 회의록**, 새 회의록은 고른 프로젝트(회의만 고르면 그 회의의 프로젝트, 없으면 세션 유일 워크스페이스), 폴더 조작은
// 세션 유일 워크스페이스, 폴더 목록(fetchMinuteFoldersLite)은 소속 워크스페이스 가운데 켜진 곳의 폴더만(목록형 — P13).
// deny 하네스(tests/gates)는 범위를 한 값으로 고정해 "무엇을 넘겼나"를 못 본다 — 여기서 인자를 문다. 꺼지면 본문에 닿지 않는다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  getSession: vi.fn(), getActor: vi.fn(), resolveScope: vi.fn(), resolveProjectId: vi.fn(),
  createAdminClient: vi.fn(), ensureMinuteInsights: vi.fn(), getMinuteDetail: vi.fn(),
  signed: vi.fn(), fromCalls: [] as string[], rows: {} as Record<string, unknown>, lists: {} as Record<string, unknown[]>,
}))
vi.mock('@/lib/auth', () => ({ getSession: m.getSession }))
vi.mock('@/lib/authz', () => ({ getActor: m.getActor, resolveScope: m.resolveScope, resolveProjectId: m.resolveProjectId }))
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({
    from: (table: string) => {
      m.fromCalls.push(table)
      const chain: Record<string, unknown> = {}
      for (const k of ['select', 'eq', 'is', 'order', 'in', 'update', 'delete', 'insert', 'upsert']) chain[k] = () => chain
      chain.maybeSingle = async () => ({ data: m.rows[table] ?? null, error: null })
      chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: m.lists[table] ?? [], error: null }).then(res)
      return chain
    },
    storage: { from: () => ({ createSignedUrl: m.signed }) },
  }),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: m.createAdminClient }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/server', () => ({ after: vi.fn() }))
vi.mock('@/lib/ai/minutes-ingest', () => ({ ingestMinute: vi.fn() }))
vi.mock('@/lib/ai/minutes-insights', () => ({ ensureMinuteInsights: m.ensureMinuteInsights, generateMinuteInsights: vi.fn() }))
vi.mock('@/lib/ai/wiki-ingest', () => ({ enqueueMinuteWikiProcessing: vi.fn(), processMinuteWikiJob: vi.fn(), rebuildProjectWikiFromActiveMinutes: vi.fn() }))
vi.mock('@/lib/data/meetings', () => ({ getProjectMeetingData: vi.fn() }))
vi.mock('@/lib/authz/visibility', () => ({ getHiddenProjectIds: async () => new Set<string>() }))
vi.mock('@/lib/data/minutes', () => ({
  getMinuteDetail: m.getMinuteDetail, getMinutesPage: vi.fn(), searchMinutes: vi.fn(), getMinuteFavorites: vi.fn(), getMinutesExplorer: vi.fn(),
}))

import {
  createMinute, deleteMinute, ensureMinuteInsightsAction, fetchMeetingMinutesLite, fetchMinuteDetail, fetchMinuteFoldersLite, getMinuteFileUrl,
  getMinuteVersionFileUrl, renameMinuteFolder, toggleMinuteFavorite,
} from '@/app/actions/minutes'
import { ERR_DENIED, ERR_LOOKUP, ERR_MISSING, ERR_MODULE_DISABLED } from '@/lib/authz/errors'
import { moduleState, projectsWithModule, requireModule, requireSessionModule, workspacesWithModule } from '@/lib/modules/gate'
import { makeActor, makeAdminActor, makeMemberActor } from '../fixtures/actor'

const M = '00000000-0000-0000-7e57-000000001601'      // 회의록 — 워크스페이스 WB·프로젝트 PB
const FILE = '00000000-0000-0000-7e57-000000001602'   // 그 회의록의 첨부(id 로 범위를 풀면 WA 가 나온다 — 파일 id 를 회의록 id 로 쓰면 잡힌다)
const PB = '00000000-0000-0000-7e57-000000001603'
const MEETING = '00000000-0000-0000-7e57-000000001604'
const PM = '00000000-0000-0000-7e57-000000001605'     // 회의 MEETING 의 프로젝트
const WA = 'ws-a', WB = 'ws-b'
const OFF = { ok: false as const, error: ERR_MODULE_DISABLED }
const actor = makeAdminActor(PB, { projectWorkspace: new Map([[PB, WB]]), workspaceRoles: new Map([[WB, 'member']]) })

beforeEach(() => {
  vi.clearAllMocks()
  m.fromCalls.length = 0
  m.lists = {}
  m.rows = { minute_files: { file_path: `${M}/a.pdf`, file_name: 'a.pdf', minute_id: M }, minutes: { created_by: actor.userId, archived_at: null } }
  m.getSession.mockResolvedValue({ id: actor.userId, email: 'alice@example.com', user_metadata: {} })
  m.getActor.mockResolvedValue(actor)
  m.resolveScope.mockImplementation(async (_t: string, id: string) => (id === M ? { ok: true, projectId: PB, workspaceId: WB } : { ok: true, projectId: null, workspaceId: WA }))
  m.resolveProjectId.mockResolvedValue({ ok: true, projectId: PB })
  m.signed.mockResolvedValue({ data: { signedUrl: 'https://signed.example.com/x' }, error: null })
})
// 관문 mock 값을 바꾸는 파일 — 통과 구현으로 되돌린다(공통 규칙)
afterEach(() => { for (const f of [requireModule, requireSessionModule, moduleState, projectsWithModule, workspacesWithModule]) vi.mocked(f).mockReset() })

describe('회의록 관문 — 행의 워크스페이스로 판정', () => {
  it('첨부 내려받기는 파일 행의 회의록(minute_id)의 워크스페이스로 판정하고, 꺼지면 서명하지 않는다', async () => {
    vi.mocked(requireModule).mockResolvedValue(OFF)
    expect(await getMinuteFileUrl(FILE)).toEqual(OFF)
    expect(m.resolveScope).toHaveBeenCalledWith('minutes', M)
    expect(requireModule).toHaveBeenCalledWith({ workspaceId: WB }, 'minutes')
    expect(requireSessionModule).not.toHaveBeenCalled()
    expect(m.signed).not.toHaveBeenCalled()
  })
  it('첨부 내려받기 — 켜져 있으면 기존대로 서명한다', async () => {
    expect(await getMinuteFileUrl(FILE)).toEqual({ ok: true, url: 'https://signed.example.com/x' })
    expect(requireModule).toHaveBeenCalledWith({ workspaceId: WB }, 'minutes')
  })
  it('소유 헬퍼(checkOwner) — 행의 워크스페이스로 판정하고, 꺼지면 service_role 에 닿지 않는다', async () => {
    vi.mocked(requireModule).mockResolvedValue(OFF)
    expect(await deleteMinute(M)).toEqual(OFF)
    expect(requireModule).toHaveBeenCalledWith({ workspaceId: WB }, 'minutes')
    expect(m.createAdminClient).not.toHaveBeenCalled()
  })
  it('멤버 헬퍼(requireMinuteMember) — 인사이트는 꺼지면 사유를 싣은 unavailable 이고 생성기를 부르지 않는다', async () => {
    vi.mocked(requireModule).mockResolvedValue(OFF)
    expect(await ensureMinuteInsightsAction(M)).toEqual({ status: 'unavailable', error: ERR_MODULE_DISABLED })
    expect(requireModule).toHaveBeenCalledWith({ workspaceId: WB }, 'minutes')
    expect(m.ensureMinuteInsights).not.toHaveBeenCalled()
  })
  it.each([
    ['fetchMinuteDetail', () => fetchMinuteDetail(M), null],
    ['getMinuteVersionFileUrl', () => getMinuteVersionFileUrl(M, FILE), OFF],
    ['toggleMinuteFavorite', () => toggleMinuteFavorite(M, true), false],
  ] as const)('%s — 인자 회의록의 워크스페이스로 판정하고 꺼지면 매니페스트 거부 값·조회 없음', async (_n, call, deny) => {
    vi.mocked(requireModule).mockResolvedValue(OFF)
    expect(await call()).toEqual(deny)
    expect(m.resolveScope).toHaveBeenCalledWith('minutes', M)
    expect(requireModule).toHaveBeenCalledWith({ workspaceId: WB }, 'minutes')
    expect(m.fromCalls).toEqual([])
    expect(m.getMinuteDetail).not.toHaveBeenCalled()
  })
  it.each([
    ['getMinuteFileUrl', () => getMinuteFileUrl(FILE), { ok: false, error: ERR_LOOKUP }],
    ['getMinuteVersionFileUrl', () => getMinuteVersionFileUrl(M, FILE), { ok: false, error: ERR_LOOKUP }],
    ['fetchMinuteDetail', () => fetchMinuteDetail(M), null],
    ['toggleMinuteFavorite', () => toggleMinuteFavorite(M, true), false],
  ] as const)('%s — 범위 해석(resolveScope)이 실패하면 기존 실패 꼴이고 관문·본문에 닿지 않는다(B5 T16-m3)', async (_n, call, failed) => {
    m.resolveScope.mockResolvedValue({ ok: false, error: ERR_LOOKUP })
    expect(await call()).toEqual(failed)
    expect(requireModule).not.toHaveBeenCalled()
    expect(m.signed).not.toHaveBeenCalled()
    expect(m.getMinuteDetail).not.toHaveBeenCalled()
  })
  it('소유 헬퍼 — 작성자도 관리자도 아니면 권한 판정에서 끝나고 관문을 부르지 않는다(권한 → 관문, B5 T16-m2)', async () => {
    vi.mocked(requireModule).mockResolvedValue(OFF)
    m.getActor.mockResolvedValue(makeMemberActor(PB, [], { projectWorkspace: new Map([[PB, WB]]), workspaceRoles: new Map([[WB, 'member']]) }))
    m.rows = { ...m.rows, minutes: { created_by: 'u-someone-else', archived_at: null } }
    expect(await deleteMinute(M)).toEqual({ ok: false, error: ERR_DENIED })
    expect(requireModule).not.toHaveBeenCalled()
  })
  it('멤버 헬퍼 — 조회 전용이면 사유 없는 unavailable 이고 관문을 부르지 않는다(권한 → 관문, B5 T16-m2)', async () => {
    vi.mocked(requireModule).mockResolvedValue(OFF)
    m.getActor.mockResolvedValue(makeActor({ projectWorkspace: new Map([[PB, WB]]), workspaceRoles: new Map([[WB, 'member']]) }))
    expect(await ensureMinuteInsightsAction(M)).toEqual({ status: 'unavailable' })
    expect(requireModule).not.toHaveBeenCalled()
    expect(m.ensureMinuteInsights).not.toHaveBeenCalled()
  })
})

describe('회의록 관문 — 행이 없는 경로', () => {
  const input = { minuteDate: '2026-09-01', teamCode: 'PMO', title: 'Acme', bodyMd: '# b', meetingId: null }
  it('새 회의록 — 프로젝트를 고르면 그 프로젝트로, 꺼지면 대상 해석·쓰기에 닿지 않는다', async () => {
    vi.mocked(requireModule).mockResolvedValue(OFF)
    expect(await createMinute({ ...input, projectId: PB })).toEqual(OFF)
    expect(requireModule).toHaveBeenCalledWith({ projectId: PB }, 'minutes')
    expect(requireSessionModule).not.toHaveBeenCalled()
    expect(m.fromCalls).toEqual([])
  })
  it('새 회의록 — 회의만 고르면 그 회의의 프로젝트(쓰기 대상)로 판정한다(B5 T16-m1)', async () => {
    m.resolveProjectId.mockImplementation(async (t: string, id: string) => (t === 'meetings' && id === MEETING ? { ok: true, projectId: PM } : { ok: false, error: ERR_MISSING }))
    vi.mocked(requireModule).mockResolvedValue(OFF)
    expect(await createMinute({ ...input, meetingId: MEETING, projectId: null })).toEqual(OFF)
    expect(m.resolveProjectId).toHaveBeenCalledWith('meetings', MEETING)
    expect(requireModule).toHaveBeenCalledWith({ projectId: PM }, 'minutes')
    expect(requireSessionModule).not.toHaveBeenCalled()
    expect(m.fromCalls).toEqual([])
  })
  it('새 회의록 — 회의의 프로젝트를 풀지 못하면 그 사유로 끝나고 관문·쓰기에 닿지 않는다', async () => {
    m.resolveProjectId.mockResolvedValue({ ok: false, error: ERR_MISSING })
    expect(await createMinute({ ...input, meetingId: MEETING, projectId: null })).toEqual({ ok: false, error: ERR_MISSING })
    expect(requireModule).not.toHaveBeenCalled()
    expect(requireSessionModule).not.toHaveBeenCalled()
    expect(m.fromCalls).toEqual([])
  })
  it('새 회의록 — 프로젝트가 없으면 세션 유일 워크스페이스로 판정한다', async () => {
    vi.mocked(requireSessionModule).mockResolvedValue(OFF)
    expect(await createMinute({ ...input, projectId: null })).toEqual(OFF)
    expect(requireSessionModule).toHaveBeenCalledWith(null, 'minutes')
    expect(requireModule).not.toHaveBeenCalled()
  })
  it('폴더 조작은 세션 유일 워크스페이스로 판정하고(P28), 꺼지면 폴더를 읽지 않는다', async () => {
    vi.mocked(requireSessionModule).mockResolvedValue(OFF)
    expect(await renameMinuteFolder(M, '폴더')).toEqual(OFF)
    expect(requireSessionModule).toHaveBeenCalledWith(null, 'minutes')
    expect(requireModule).not.toHaveBeenCalled()
    expect(m.fromCalls).toEqual([])
  })
  it('회의 → 연결 회의록은 회의 행의 프로젝트로 minutes·meetings 둘 다 판정하고, 꺼지면 빈 목록', async () => {
    vi.mocked(requireModule).mockResolvedValue(OFF)
    expect(await fetchMeetingMinutesLite(MEETING)).toEqual([])
    expect(m.resolveProjectId).toHaveBeenCalledWith('meetings', MEETING)
    expect(requireModule).toHaveBeenCalledWith({ projectId: PB }, ['minutes', 'meetings'])
    expect(m.fromCalls).toEqual([])
  })
})

describe('폴더 목록(fetchMinuteFoldersLite) — 목록형: 소속 워크스페이스 가운데 minutes 가 켜진 곳의 폴더만(P13, B5 T16-I1)', () => {
  const folder = (id: string, workspaceId: string) => ({ id, name: id, parent_id: null, sort: 0, created_by: null, project_id: null, workspace_id: workspaceId })
  const multi = makeAdminActor(PB, { projectWorkspace: new Map([[PB, WB]]), workspaceRoles: new Map([[WA, 'member'], [WB, 'member']]) })
  /** 진짜 세션 판정은 소속이 둘이면 닫는다(유일 워크스페이스 없음) — 목록형은 그 판정을 쓰지 않는다 */
  const asMulti = () => { m.getActor.mockResolvedValue(multi); vi.mocked(requireSessionModule).mockResolvedValue(OFF) }
  beforeEach(() => { m.lists = { minute_folders: [folder('fa', WA), folder('fb', WB)] } })
  it('여러 워크스페이스 소속·둘 다 켜짐 — 두 곳의 폴더를 모두 돌려준다(/minutes/[id] 메타 모달이 목록을 잃지 않는다)', async () => {
    asMulti()
    expect((await fetchMinuteFoldersLite())?.map((f) => f.id)).toEqual(['fa', 'fb'])
    expect(requireModule).toHaveBeenCalledWith({ workspaceId: WA }, 'minutes')
    expect(requireModule).toHaveBeenCalledWith({ workspaceId: WB }, 'minutes')
    expect(requireSessionModule).not.toHaveBeenCalled()
  })
  it('여러 워크스페이스 소속·한쪽 꺼짐 — 꺼진 워크스페이스의 폴더를 뺀다', async () => {
    asMulti()
    vi.mocked(requireModule).mockImplementation(async (s) => ('workspaceId' in s && s.workspaceId === WB ? OFF : { ok: true }))
    expect((await fetchMinuteFoldersLite())?.map((f) => f.id)).toEqual(['fa'])
  })
  it('켜진 곳이 없으면 null(매니페스트 거부 값)이고 폴더를 읽지 않는다', async () => {
    asMulti()
    vi.mocked(requireModule).mockResolvedValue(OFF)
    expect(await fetchMinuteFoldersLite()).toBeNull()
    expect(m.fromCalls).toEqual([])
  })
  it('유일 소속 — 결과가 전과 같다(소속 워크스페이스의 폴더 전부)', async () => {
    m.getActor.mockResolvedValue(makeAdminActor(PB, { projectWorkspace: new Map([[PB, WB]]), workspaceRoles: new Map([[WB, 'member']]) }))
    m.lists = { minute_folders: [folder('fb1', WB), folder('fb2', WB)] }
    expect((await fetchMinuteFoldersLite())?.map((f) => f.id)).toEqual(['fb1', 'fb2'])
    expect(vi.mocked(requireModule).mock.calls).toEqual([[{ workspaceId: WB }, 'minutes']])
  })
  it('행위자가 없으면 null 이고 관문·폴더에 닿지 않는다', async () => {
    m.getActor.mockResolvedValue(null); m.getSession.mockResolvedValue(null)
    expect(await fetchMinuteFoldersLite()).toBeNull()
    expect(requireModule).not.toHaveBeenCalled()
    expect(m.fromCalls).toEqual([])
  })
})
