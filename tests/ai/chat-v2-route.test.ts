import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { EMPTY_CHAT_TOOL_REGISTRY } from '@/lib/ai/chat/registry'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  createServerClient: vi.fn(),
  createDefaultRegistry: vi.fn(),
}))

const { withCount } = vi.hoisted(() => ({
  withCount: (r: unknown) => {
    const x = r as { data?: unknown }
    return Array.isArray(x.data) ? { ...(r as object), count: x.data.length } : r
  },
}))
vi.mock('@/lib/auth', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: mocks.createServerClient }))
vi.mock('@/lib/ai/chat/default-registry', () => ({ createDefaultChatToolRegistry: mocks.createDefaultRegistry }))
// 라우트는 스코프 확인 뒤 등록된 팀 코드로 다시 라우팅한다 — master 를 그대로 import 하면 최상위 await refreshTeams() 가 DB 를
// 부른다. 공유 목에 두 접근자만 vi.fn 으로 덮어 '던짐'·'호출 없음'을 개별 테스트에서 본다.
const teams = vi.hoisted(() => ({
  activeTeamCodesForProjectSync: vi.fn<(projectId: string) => string[]>(),
  activeTeamCodesVisibleToSync: vi.fn<(view: unknown) => string[]>(),
}))
vi.mock('@/lib/teams/master', async () => ({
  ...(await import('../helpers/teams-master-mock')).teamsMasterMock(),
  ...teams,
}))
// 재라우팅의 503 범위(팀 조회 실패만)를 보려고 라우터를 감싼다 — 기본은 실제 라우터를 그대로 부른다(beforeEach).
const router = vi.hoisted(() => ({
  routeChatRequest: vi.fn<typeof import('@/lib/ai/chat/router').routeChatRequest>(),
}))
vi.mock('@/lib/ai/chat/router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ai/chat/router')>()),
  routeChatRequest: router.routeChatRequest,
}))
const actualRouter = () => vi.importActual<typeof import('@/lib/ai/chat/router')>('@/lib/ai/chat/router')

import { POST } from '@/app/api/chat/v2/stream/route'

function request(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/chat/v2/stream', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
}

// accessScope 는 buildActor 4축(platform_admins·workspace_members·project_members·projects)과 projects 의 비공개 플래그를 읽는다.
// 여기서는 워크스페이스 ws-1 의 멤버·명단 역할 없음·전 프로젝트 공개로 고정 — 워크스페이스 경계와 비공개 스코프 제외는
// accessScope 전용 테스트가 검증한다. @/lib/authz 는 모킹하지 않는다(실제 조립 경로를 탄다).
function client(projects: string[], error: { message: string } | null = null) {
  const tables: Record<string, { data: unknown; error: { message: string } | null }> = {
    platform_admins: { data: null, error: null },
    workspace_members: { data: [{ workspace_id: 'ws-1', role: 'member' }], error: null },
    project_members: { data: [], error: null },
    projects: { data: error ? null : projects.map(id => ({ id, workspace_id: 'ws-1', is_private: false })), error },
  }
  const from = vi.fn((table: string) => {
    const r = tables[table] ?? { data: null, error: { message: `unexpected table ${table}` } }
    const b: Record<string, unknown> = {}
    for (const k of ['select', 'eq', 'in', 'limit', 'order', 'range']) b[k] = () => b
    b.maybeSingle = async () => r
    // buildActor 의 projects 는 페이지 + count 총합 대조(fetchAllPages) — 배열 응답에는 count 를 싣는다
    b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(withCount(r)).then(res, rej)
    return b
  })
  return { from }
}

describe('POST /api/chat/v2/stream composition', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    router.routeChatRequest.mockImplementation((await actualRouter()).routeChatRequest)
    vi.unstubAllEnvs()
    vi.stubEnv('CHAT_V2_ENABLED', 'true')
    mocks.getSession.mockResolvedValue({ id: 'u1' })
    mocks.createServerClient.mockResolvedValue(client(['p1']))
    mocks.createDefaultRegistry.mockReturnValue(EMPTY_CHAT_TOOL_REGISTRY)
    teams.activeTeamCodesForProjectSync.mockImplementation(() => ['ERP'])
    teams.activeTeamCodesVisibleToSync.mockImplementation(() => ['ERP'])
  })

  it('returns 400 before streaming for mismatched page and legacy project context', async () => {
    const response = await POST(request({
      projectId: 'p1', message: '질문', history: [],
      pageContext: {
        contextVersion: 1, pathname: '/p/p2/wbs', domain: 'wbs', projectId: 'p2', timezone: 'Asia/Seoul',
      },
    }))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'PROJECT_CONTEXT_MISMATCH' })
  })

  it('fails closed with 503 when the allowed-project lookup fails', async () => {
    mocks.createServerClient.mockResolvedValue(client([], { message: 'database down' }))
    const response = await POST(request({ projectId: 'p1', message: 'WBS 현황', history: [] }))
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ code: 'ACCESS_SCOPE_UNAVAILABLE' })
  })

  it('fails closed with 503 when a permission axis lookup fails — no silent "no role" fallback', async () => {
    const broken = client(['p1'])
    const base = broken.from.getMockImplementation()!
    broken.from.mockImplementation((table: string) => {
      if (table !== 'workspace_members') return base(table)
      const r = { data: null, error: { message: 'axis down' } }
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'eq', 'in', 'limit', 'order', 'range']) b[k] = () => b
      b.then = (res: (v: unknown) => unknown) => Promise.resolve(r).then(res)
      return b
    })
    mocks.createServerClient.mockResolvedValue(broken)
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = await POST(request({ projectId: 'p1', message: 'WBS 현황', history: [] }))
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ code: 'ACCESS_SCOPE_UNAVAILABLE' })
    err.mockRestore()
  })

  it('returns 403 for a project outside the server-resolved scope', async () => {
    const response = await POST(request({ projectId: 'p2', message: 'WBS 현황', history: [] }))
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'PROJECT_ACCESS_DENIED' })
    // 스코프 검증이 재라우팅보다 먼저다 — 허용 밖 프로젝트의 팀 구성을 읽지 않는다.
    expect(teams.activeTeamCodesForProjectSync).not.toHaveBeenCalled()
  })

  it('uses NDJSON for a valid stream and ends in one terminal event', async () => {
    const response = await POST(request({
      projectId: 'p1', message: '첨부파일 보여줘', history: [],
      pageContext: {
        contextVersion: 1, pathname: '/p/p1/wbs', domain: 'wbs', projectId: 'p1', timezone: 'Asia/Seoul',
      },
    }))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/x-ndjson; charset=utf-8')
    const events = (await response.text()).trim().split('\n').map(line => JSON.parse(line) as { type: string })
    expect(events.filter(e => e.type === 'done' || e.type === 'error')).toHaveLength(1)
    expect(events.at(-1)?.type).toBe('done')
  })

  it('returns 501 before streaming for unsupported pages so the client uses legacy chat', async () => {
    const response = await POST(request({
      projectId: null, message: '도와줘', history: [],
      pageContext: {
        contextVersion: 1, pathname: '/projects', domain: 'projects', projectId: null, timezone: 'Asia/Seoul',
      },
    }))
    expect(response.status).toBe(501)
    expect(await response.json()).toMatchObject({ code: 'CHAT_V2_UNSUPPORTED' })
    expect(mocks.getSession).toHaveBeenCalledOnce()
    expect(mocks.createServerClient).not.toHaveBeenCalled()
    expect(mocks.createDefaultRegistry).not.toHaveBeenCalled()
  })

  it('rejects an out-of-scope selected global meeting project before routing', async () => {
    const response = await POST(request({
      projectId: null, message: '그 회의 상세', history: [],
      pageContext: {
        contextVersion: 1, pathname: '/meetings', domain: 'meetings', projectId: null,
        selectedEntity: { type: 'meeting', id: 'm2' },
        selectedProjectId: 'p2', timezone: 'Asia/Seoul',
      },
    }))
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'PROJECT_ACCESS_DENIED' })
  })

  it('팀 캐시가 cold 면 빈 목록으로 폴백하지 않고 503 TEAMS_UNAVAILABLE 로 닫는다 — 스트림 없음', async () => {
    teams.activeTeamCodesForProjectSync.mockImplementationOnce(() => { throw new Error('팀 마스터를 아직 불러오지 못했습니다.') })
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = await POST(request({
      projectId: 'p1', message: 'ERP 작업 현황 알려줘', history: [],
      pageContext: { contextVersion: 1, pathname: '/p/p1/wbs', domain: 'wbs', projectId: 'p1', timezone: 'Asia/Seoul' },
    }))
    expect(response.status).toBe(503)
    expect(response.headers.get('content-type')).not.toContain('ndjson')
    expect(await response.json()).toMatchObject({ code: 'TEAMS_UNAVAILABLE' })
    expect(teams.activeTeamCodesForProjectSync).toHaveBeenCalledWith('p1')
    expect(mocks.createDefaultRegistry).not.toHaveBeenCalled()
    expect(err).toHaveBeenCalledWith('[chat-v2] 팀 목록 조회 실패:', '팀 마스터를 아직 불러오지 못했습니다.')
    err.mockRestore()
  })

  it('팀 조회가 아닌 재라우팅 결함은 TEAMS_UNAVAILABLE 로 덮지 않고 그대로 올린다', async () => {
    const { routeChatRequest } = await actualRouter()
    router.routeChatRequest.mockImplementation((input, now, opts) => {
      if (opts) throw new Error('라우터 결함')
      return routeChatRequest(input, now)
    })
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(POST(request({
      projectId: 'p1', message: 'ERP 작업 현황 알려줘', history: [],
      pageContext: { contextVersion: 1, pathname: '/p/p1/wbs', domain: 'wbs', projectId: 'p1', timezone: 'Asia/Seoul' },
    }))).rejects.toThrow('라우터 결함')
    expect(router.routeChatRequest).toHaveBeenCalledTimes(2)
    expect(err).not.toHaveBeenCalled()
    err.mockRestore()
  })

  it('대화 상태의 옛 엔터티가 허용 밖 프로젝트를 가리키면 그 pid 로 팀 캐시를 읽지 않는다', async () => {
    const response = await POST(request({
      projectId: null, message: 'ERP 작업 현황 알려줘', history: [],
      conversationState: {
        version: 1, lastDomains: ['wbs'],
        lastEntities: [{ type: 'wbs_item', id: 'item-9', ref: 'S1', projectId: 'p2', title: '설계' }],
      },
    }))
    expect(response.status).toBe(200)
    await response.text()
    expect(teams.activeTeamCodesForProjectSync).not.toHaveBeenCalled()
    expect(teams.activeTeamCodesVisibleToSync).not.toHaveBeenCalled()
  })

  it('1차 라우트가 legacy(501)면 팀 캐시를 읽지 않는다 — 스코프 조회 전 게이트 유지', async () => {
    const response = await POST(request({
      projectId: null, message: '도와줘', history: [],
      pageContext: { contextVersion: 1, pathname: '/projects', domain: 'projects', projectId: null, timezone: 'Asia/Seoul' },
    }))
    expect(response.status).toBe(501)
    expect(mocks.createServerClient).not.toHaveBeenCalled()
    expect(teams.activeTeamCodesForProjectSync).not.toHaveBeenCalled()
    expect(teams.activeTeamCodesVisibleToSync).not.toHaveBeenCalled()
  })

  it('returns 501 when the explicit v2 kill switch is off', async () => {
    vi.stubEnv('CHAT_V2_ENABLED', 'false')
    const response = await POST(request({ projectId: null, message: '질문', history: [] }))
    expect(response.status).toBe(501)
    expect(await response.json()).toMatchObject({ code: 'CHAT_V2_DISABLED' })
  })
})
