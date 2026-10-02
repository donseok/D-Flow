import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
// 라우트는 스코프 확인 뒤 요청 범위 팀 원천(SP4 A2)에서 팀(이름 포함)을 읽어 다시 라우팅한다. 공유 목에 두 접근자만 vi.fn 으로
// 덮어 '던짐'·'호출 없음'을 개별 테스트에서 본다.
const teams = vi.hoisted(() => ({
  projectTeams: vi.fn(),
  visibleTeams: vi.fn(),
}))
vi.mock('@/lib/teams/source', async () => ({
  ...(await import('../helpers/teams-source-mock')).teamsSourceMock(),
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
import { teamRows } from '../helpers/teams-source-mock'
import { ERR_MODULE_DISABLED } from '@/lib/authz/errors'
import { moduleState, projectsWithModule, requireModule, requireSessionModule, workspacesWithModule } from '@/lib/modules/gate'

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
  // 범위 관문(과제 34)의 행위자 조회 — getActor 가 claims 의 sub 로 buildActor 를 부른다(위 네 축 표)
  return { from, auth: { getClaims: async () => ({ data: { claims: { sub: 'u1' } } }) } }
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
    teams.projectTeams.mockResolvedValue(teamRows(['ERP']))
    teams.visibleTeams.mockResolvedValue(teamRows(['ERP']))
  })
  // 관문 mock 값을 바꾸는 파일 — 전역 통과 구현으로 되돌린다(공통 규칙)
  afterEach(() => { for (const f of [requireModule, requireSessionModule, moduleState, projectsWithModule, workspacesWithModule]) vi.mocked(f).mockReset() })

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
    expect(teams.projectTeams).not.toHaveBeenCalled()
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
        contextVersion: 1, pathname: '/w/acme/projects', domain: 'projects', projectId: null, timezone: 'Asia/Seoul', workspaceId: 'ws-1',
      },
    }))
    expect(response.status).toBe(501)
    expect(await response.json()).toMatchObject({ code: 'CHAT_V2_UNSUPPORTED' })
    expect(mocks.getSession).toHaveBeenCalledOnce()
    // 프로젝트 없는 질문의 범위 관문(과제 34)이 행위자(소속)를 한 번 읽는다 — 라우트의 접근 범위 조회(두 번째 세션 클라이언트)에는 가지 않는다
    expect(mocks.createServerClient).toHaveBeenCalledTimes(1)
    expect(mocks.createDefaultRegistry).not.toHaveBeenCalled()
  })

  // U2b-5 리뷰 수정 CC6 — selectedProjectId 도 관문의 프로젝트 입력이다(스코프 검증과 같은 우선순위). 함께 실은 워크스페이스와 다른(또는 볼 수 없는)
  // 프로젝트면 관문에서 404 SCOPE_NOT_FOUND — "프로젝트와 다른 워크스페이스는 404" 불변식이 이 힌트로 우회되지 않는다. 전에는 관문이 워크스페이스로
  // 통과하고 스코프 검증의 403 에서 멈췄다(누설은 아니나 조합 판정이 빠졌다)
  it('rejects an out-of-scope selected global meeting project at the scope gate — 404, before module gate and routing', async () => {
    const response = await POST(request({
      projectId: null, message: '그 회의 상세', history: [],
      pageContext: {
        contextVersion: 1, pathname: '/w/acme/meetings', domain: 'meetings', projectId: null, workspaceId: 'ws-1',
        selectedEntity: { type: 'meeting', id: 'm2' },
        selectedProjectId: 'p2', timezone: 'Asia/Seoul',
      },
    }))
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ code: 'SCOPE_NOT_FOUND' })
    expect(requireModule).not.toHaveBeenCalled()
    expect(router.routeChatRequest).not.toHaveBeenCalled()
  })
  it('대조 — 같은 워크스페이스의 선택 프로젝트는 그 프로젝트로 관문을 판정한다', async () => {
    await POST(request({
      projectId: null, message: '그 회의 상세', history: [],
      pageContext: {
        contextVersion: 1, pathname: '/w/acme/meetings', domain: 'meetings', projectId: null, workspaceId: 'ws-1',
        selectedEntity: { type: 'meeting', id: 'm1' },
        selectedProjectId: 'p1', timezone: 'Asia/Seoul',
      },
    }))
    expect(requireModule).toHaveBeenCalledWith({ projectId: 'p1' }, 'chatbot')
  })

  it('팀 원천 실패면 빈 목록으로 폴백하지 않고 503 TEAMS_UNAVAILABLE 로 닫는다 — 스트림 없음', async () => {
    teams.projectTeams.mockRejectedValueOnce(new Error('팀 목록을 불러오지 못했습니다.'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = await POST(request({
      projectId: 'p1', message: 'ERP 작업 현황 알려줘', history: [],
      pageContext: { contextVersion: 1, pathname: '/p/p1/wbs', domain: 'wbs', projectId: 'p1', timezone: 'Asia/Seoul' },
    }))
    expect(response.status).toBe(503)
    expect(response.headers.get('content-type')).not.toContain('ndjson')
    expect(await response.json()).toMatchObject({ code: 'TEAMS_UNAVAILABLE' })
    expect(teams.projectTeams).toHaveBeenCalledWith('p1', { client: expect.objectContaining({ from: expect.any(Function) }) })
    expect(mocks.createDefaultRegistry).not.toHaveBeenCalled()
    expect(err).toHaveBeenCalledWith('[chat-v2] 팀 목록 조회 실패:', '팀 목록을 불러오지 못했습니다.')
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

  it('대화 상태의 옛 엔터티가 허용 밖 프로젝트를 가리키면 그 pid 로 팀을 읽지 않는다', async () => {
    const response = await POST(request({
      projectId: null, workspaceId: 'ws-1', message: 'ERP 작업 현황 알려줘', history: [],
      conversationState: {
        version: 1, lastDomains: ['wbs'],
        lastEntities: [{ type: 'wbs_item', id: 'item-9', ref: 'S1', projectId: 'p2', title: '설계' }],
      },
    }))
    expect(response.status).toBe(200)
    await response.text()
    expect(teams.projectTeams).not.toHaveBeenCalled()
    expect(teams.visibleTeams).not.toHaveBeenCalled()
  })

  it('1차 라우트가 legacy(501)면 팀을 읽지 않는다 — 스코프 조회 전 게이트 유지', async () => {
    const response = await POST(request({
      projectId: null, message: '도와줘', history: [],
      pageContext: { contextVersion: 1, pathname: '/w/acme/projects', domain: 'projects', projectId: null, timezone: 'Asia/Seoul', workspaceId: 'ws-1' },
    }))
    expect(response.status).toBe(501)
    expect(mocks.createServerClient).toHaveBeenCalledTimes(1)   // 범위 관문의 행위자 조회뿐(과제 34)
    expect(teams.projectTeams).not.toHaveBeenCalled()
    expect(teams.visibleTeams).not.toHaveBeenCalled()
  })

  it('chatbot 모듈이 꺼지면 404 — 검증된 요청의 프로젝트로 판정하고 라우팅·스코프 조회 전에 멈춘다(과제 20)', async () => {
    vi.mocked(requireModule).mockResolvedValueOnce({ ok: false, error: ERR_MODULE_DISABLED })
    const res = await POST(request({ projectId: 'p1', message: '이번 주 회의 알려줘', history: [] }))
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ error: ERR_MODULE_DISABLED, code: 'MODULE_DISABLED' })
    expect(requireModule).toHaveBeenCalledWith({ projectId: 'p1' }, 'chatbot')
    expect(requireSessionModule).not.toHaveBeenCalled()
    expect(router.routeChatRequest).not.toHaveBeenCalled()
    expect(mocks.createServerClient).not.toHaveBeenCalled()
  })
  it('화면 문맥의 프로젝트가 우선이다 — pageContext.projectId 로 판정(과제 20, P23)', async () => {
    vi.mocked(requireModule).mockResolvedValueOnce({ ok: false, error: ERR_MODULE_DISABLED })
    const res = await POST(request({
      projectId: null, message: '이번 주 회의 알려줘', history: [],
      pageContext: { contextVersion: 1, pathname: '/p/p1/wbs', domain: 'wbs', projectId: 'p1', timezone: 'Asia/Seoul' },
    }))
    expect(res.status).toBe(404)
    expect(requireModule).toHaveBeenCalledWith({ projectId: 'p1' }, 'chatbot')
  })
  it('프로젝트 힌트가 없으면 요청의 워크스페이스(화면 문맥 우선, 소속 확인) — 강등(legacy 501) 경로도 관문을 지난다(과제 34, D26)', async () => {
    vi.mocked(requireModule).mockResolvedValueOnce({ ok: false, error: ERR_MODULE_DISABLED })
    const res = await POST(request({
      projectId: null, workspaceId: 'ws-x', message: '도와줘', history: [],
      pageContext: { contextVersion: 1, pathname: '/w/acme/projects', domain: 'projects', projectId: null, timezone: 'Asia/Seoul', workspaceId: 'ws-1' },
    }))
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ error: ERR_MODULE_DISABLED, code: 'MODULE_DISABLED' })
    expect(requireModule).toHaveBeenCalledWith({ workspaceId: 'ws-1' }, 'chatbot')
    expect(requireSessionModule).not.toHaveBeenCalled()
  })
  it('프로젝트도 워크스페이스도 없으면 400 WORKSPACE_REQUIRED — 세션 유일 워크스페이스로 추측하지 않는다(과제 34)', async () => {
    const res = await POST(request({
      projectId: null, message: '도와줘', history: [],
      pageContext: { contextVersion: 1, pathname: '/account', domain: 'unknown', projectId: null, timezone: 'Asia/Seoul' },
    }))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: 'WORKSPACE_REQUIRED' })
    expect(requireModule).not.toHaveBeenCalled()
    expect(mocks.createServerClient).not.toHaveBeenCalled()
    expect(router.routeChatRequest).not.toHaveBeenCalled()
  })
  it.each([
    ['비소속 워크스페이스', { workspaceId: 'ws-2' }],
    ['형식 밖 워크스페이스(줄바꿈)', { workspaceId: 'ws-1\nx' }],
    ['형식 밖 워크스페이스(65자)', { workspaceId: 'w'.repeat(65) }],
  ])('적대 — %s 는 404 SCOPE_NOT_FOUND, 관문·라우팅 전에 멈춘다(과제 34)', async (_n, extra) => {
    const res = await POST(request({
      projectId: null, message: '도와줘', history: [],
      pageContext: { contextVersion: 1, pathname: '/w/acme', domain: 'projects', projectId: null, timezone: 'Asia/Seoul', ...extra },
    }))
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ code: 'SCOPE_NOT_FOUND' })
    expect(requireModule).not.toHaveBeenCalled()
    expect(router.routeChatRequest).not.toHaveBeenCalled()
  })
  it('적대 — 화면 문맥의 프로젝트와 다른 워크스페이스를 실으면 404 SCOPE_NOT_FOUND(조합 불일치, 과제 34)', async () => {
    const res = await POST(request({
      projectId: 'p1', message: '이번 주 회의 알려줘', history: [],
      pageContext: { contextVersion: 1, pathname: '/p/p1/wbs', domain: 'wbs', projectId: 'p1', timezone: 'Asia/Seoul', workspaceId: 'ws-2' },
    }))
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ code: 'SCOPE_NOT_FOUND' })
    expect(requireModule).not.toHaveBeenCalled()
    expect(router.routeChatRequest).not.toHaveBeenCalled()
  })
  it('대조 — 같은 워크스페이스를 함께 실은 프로젝트 질문은 그 프로젝트로 통과한다', async () => {
    const res = await POST(request({
      projectId: 'p1', workspaceId: 'ws-1', message: '첨부파일 보여줘', history: [],
      pageContext: { contextVersion: 1, pathname: '/p/p1/wbs', domain: 'wbs', projectId: 'p1', timezone: 'Asia/Seoul', workspaceId: 'ws-1' },
    }))
    expect(res.status).toBe(200)
    await res.text()
    expect(requireModule).toHaveBeenCalledWith({ projectId: 'p1' }, 'chatbot')
  })
  it('env 로 꺼져 있으면 관문 전에 501(강등 신호 유지 — 과제 20)', async () => {
    vi.stubEnv('CHAT_V2_ENABLED', 'false')
    expect((await POST(request({ projectId: 'p1', message: 'x', history: [] }))).status).toBe(501)
    expect(requireSessionModule).not.toHaveBeenCalled()
    expect(requireModule).not.toHaveBeenCalled()
  })

  it('returns 501 when the explicit v2 kill switch is off', async () => {
    vi.stubEnv('CHAT_V2_ENABLED', 'false')
    const response = await POST(request({ projectId: null, message: '질문', history: [] }))
    expect(response.status).toBe(501)
    expect(await response.json()).toMatchObject({ code: 'CHAT_V2_DISABLED' })
  })
})
