// 회의록 액션의 minutes 관문이 무엇으로 판정하는가(스펙 §4.2·판정 P28·사전 점검 D-I4) — 대상 행이 있으면 **행의 워크스페이스**,
// 첨부 내려받기는 **파일 행의 회의록**, 새 회의록은 고른 프로젝트(없으면 세션 유일 워크스페이스), 폴더는 세션 유일 워크스페이스.
// deny 하네스(tests/gates)는 범위를 한 값으로 고정해 "무엇을 넘겼나"를 못 본다 — 여기서 인자를 문다. 꺼지면 본문에 닿지 않는다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  getSession: vi.fn(), getActor: vi.fn(), resolveScope: vi.fn(), resolveProjectId: vi.fn(),
  createAdminClient: vi.fn(), ensureMinuteInsights: vi.fn(), getMinuteDetail: vi.fn(),
  signed: vi.fn(), fromCalls: [] as string[], rows: {} as Record<string, unknown>,
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
      chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res)
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
vi.mock('@/lib/data/minutes', () => ({
  getMinuteDetail: m.getMinuteDetail, getMinutesPage: vi.fn(), searchMinutes: vi.fn(), getMinuteFavorites: vi.fn(), getMinutesExplorer: vi.fn(),
}))

import {
  createMinute, deleteMinute, ensureMinuteInsightsAction, fetchMeetingMinutesLite, fetchMinuteDetail, getMinuteFileUrl,
  getMinuteVersionFileUrl, renameMinuteFolder, toggleMinuteFavorite,
} from '@/app/actions/minutes'
import { ERR_MODULE_DISABLED } from '@/lib/authz/errors'
import { moduleState, projectsWithModule, requireModule, requireSessionModule, workspacesWithModule } from '@/lib/modules/gate'
import { makeAdminActor } from '../fixtures/actor'

const M = '00000000-0000-0000-7e57-000000001601'      // 회의록 — 워크스페이스 WB·프로젝트 PB
const FILE = '00000000-0000-0000-7e57-000000001602'   // 그 회의록의 첨부(id 로 범위를 풀면 WA 가 나온다 — 파일 id 를 회의록 id 로 쓰면 잡힌다)
const PB = '00000000-0000-0000-7e57-000000001603'
const MEETING = '00000000-0000-0000-7e57-000000001604'
const WA = 'ws-a', WB = 'ws-b'
const OFF = { ok: false as const, error: ERR_MODULE_DISABLED }
const actor = makeAdminActor(PB, { projectWorkspace: new Map([[PB, WB]]), workspaceRoles: new Map([[WB, 'member']]) })

beforeEach(() => {
  vi.clearAllMocks()
  m.fromCalls.length = 0
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
