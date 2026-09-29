import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// 레거시 챗 라우트(/api/chat·/api/chat/stream·/api/chat/context)의 projectId 관문(SP2 최종 리뷰 ISO-1·ISO-2).
// 본문의 projectId 는 클라이언트 입력이다. 워크스페이스 B 사용자가 A 의 pid 를 보내면 세션 조회는 RLS 로 전부 비어(오류 없음)
// 파이프라인이 그대로 흘러, service_role 자가 치유 색인이 A 의 wbs_embeddings 에 쓰고(admin upsert) 팀별 답변이 service_role
// 팀 캐시의 A 팀 코드를 실었다. 답변 파이프라인·색인은 실제 모듈을 태우고 IO 경계(세션·admin·임베딩·데이터 로더)만 흉내 낸다.
const A_PID = 'a0000000-0000-4000-8000-00000000000a'
const B_PID = 'b0000000-0000-4000-8000-00000000000b'
const A_TEAM = 'A-ERP'

const mocks = vi.hoisted(() => ({
  listProjectsWithState: vi.fn(),
  visibleProjectRow: vi.fn(),
  upsert: vi.fn(async () => ({ error: null })),
  teamCodes: vi.fn(() => ['A-ERP']),
  embedDocuments: vi.fn(async (docs: string[]) => docs.map(() => [0.1])),
}))
vi.mock('@/lib/auth', () => ({ getSession: vi.fn(async () => ({ id: 'user-b' })) }))
vi.mock('@/app/actions/project', () => ({
  listProjectsWithState: mocks.listProjectsWithState,
  listProjects: vi.fn(async () => (await mocks.listProjectsWithState()).projects),
}))
// 세션(RLS) — B 사용자에게 A 프로젝트 행은 보이지 않는다(0행·오류 없음). B 프로젝트는 보인다.
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(async () => ({
    from: () => {
      let id: unknown = null
      const b: Record<string, unknown> = {}
      b.select = () => b
      b.eq = (_col: string, v: unknown) => { id = v; return b }
      b.maybeSingle = async () => ({ data: mocks.visibleProjectRow(id), error: null })
      return b
    },
  })),
}))
// service_role — 색인 개수 조회는 0건(자가 치유 대상), upsert 는 기록만 한다.
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: () => {
      const b: Record<string, unknown> = {}
      b.select = () => b
      b.eq = () => Promise.resolve({ count: 0, error: null })
      b.upsert = mocks.upsert
      b.delete = () => ({ eq: () => ({ lt: async () => ({ error: null }) }) })
      return b
    },
  })),
}))
vi.mock('@/lib/supabase/env', () => ({ serviceRoleConfigured: () => true }))
vi.mock('@/lib/ai/provider', () => ({ hasLLM: () => false, hasEmbeddings: () => true }))
vi.mock('@/lib/ai/embeddings', () => ({ embedDocuments: mocks.embedDocuments }))
vi.mock('@/lib/ai/retrieve', () => ({ retrieveContext: vi.fn(async () => []) }))
vi.mock('@/lib/ai/llm', () => ({ generateAnswer: vi.fn(async () => null), generateAnswerStream: vi.fn(async () => null) }))
vi.mock('@/lib/data/wbs', () => ({ getComputedWbs: vi.fn(async () => ({ items: [], holidays: [], today: '2026-09-26' })) }))
vi.mock('@/lib/data/members', () => ({ getProjectRoster: vi.fn(async () => ({ ok: true, rows: [] })) }))
vi.mock('@/lib/settings/projectConfig', async () => {
  const { makeProjectConfig } = await import('../helpers/projectConfigFixture')
  return { getProjectConfig: vi.fn(async () => makeProjectConfig({ 'core.level_labels': ['Phase', 'Task', 'Activity'] })) }
})
// service_role 팀 캐시 — pid 만 주면 그 프로젝트의 팀을 돌려준다(권한 판정 없음). A 의 팀 코드가 답변에 실리면 누설이다.
vi.mock('@/lib/teams/master', () => ({ activeTeamCodesForProjectSync: mocks.teamCodes }))

import { POST as chatPOST } from '@/app/api/chat/route'
import { POST as streamPOST } from '@/app/api/chat/stream/route'
import { GET as contextGET } from '@/app/api/chat/context/route'
import { ingestProject } from '@/lib/ai/ingest'
import { loadProjectAnalysis } from '@/lib/ai/knowledge'
import { ERR_MODULE_DISABLED } from '@/lib/authz/errors'
import { moduleState, projectsWithModule, requireModule, requireSessionModule, workspacesWithModule } from '@/lib/modules/gate'

const post = (url: string, body: unknown) =>
  new NextRequest(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.listProjectsWithState.mockResolvedValue({ projects: [{ id: B_PID, name: 'B 프로젝트' }], degraded: false })
  mocks.visibleProjectRow.mockImplementation((id: unknown) => (id === B_PID ? { name: 'B 프로젝트' } : null))
})
// 관문 mock 값을 바꾸는 파일 — 전역 통과 구현으로 되돌린다(공통 규칙)
afterEach(() => { for (const f of [requireModule, requireSessionModule, moduleState, projectsWithModule, workspacesWithModule]) vi.mocked(f).mockReset() })

describe('레거시 챗 라우트 — 볼 수 없는 projectId 는 404, service_role 경로에 닿지 않는다', () => {
  it('/api/chat: B 사용자가 A pid 로 보내면 404 — 자가 치유 색인(admin upsert)도 팀 캐시도 건드리지 않는다', async () => {
    const res = await chatPOST(post('http://l/api/chat', { projectId: A_PID, message: '안녕' }))
    expect(res.status).toBe(404)
    expect(mocks.upsert).not.toHaveBeenCalled()
    expect(mocks.embedDocuments).not.toHaveBeenCalled()
    expect(mocks.teamCodes).not.toHaveBeenCalled()
  })

  it('/api/chat: 팀별 질문도 404 — 응답에 A 의 팀 코드가 없다', async () => {
    const res = await chatPOST(post('http://l/api/chat', { projectId: A_PID, message: '팀별 업무 정리해줘' }))
    expect(res.status).toBe(404)
    expect(await res.text()).not.toContain(A_TEAM)
    expect(mocks.teamCodes).not.toHaveBeenCalled()
  })

  it('/api/chat/stream·/api/chat/context 도 같은 관문 — 404', async () => {
    const stream = await streamPOST(post('http://l/api/chat/stream', { projectId: A_PID, message: '팀별 업무 정리해줘' }))
    expect(stream.status).toBe(404)
    expect(await stream.text()).not.toContain(A_TEAM)
    const ctx = await contextGET(new NextRequest(`http://l/api/chat/context?projectId=${A_PID}`))
    expect(ctx.status).toBe(404)
    expect(mocks.upsert).not.toHaveBeenCalled()
    expect(mocks.teamCodes).not.toHaveBeenCalled()
  })

  it('프로젝트 목록을 못 읽었으면(degraded) 없는 프로젝트로 위장하지 않고 500', async () => {
    mocks.listProjectsWithState.mockResolvedValue({ projects: [], degraded: true })
    for (const res of [
      await chatPOST(post('http://l/api/chat', { projectId: A_PID, message: '안녕' })),
      await streamPOST(post('http://l/api/chat/stream', { projectId: A_PID, message: '안녕' })),
      await contextGET(new NextRequest(`http://l/api/chat/context?projectId=${A_PID}`)),
    ]) expect(res.status).toBe(500)
    expect(mocks.upsert).not.toHaveBeenCalled()
  })

  it('대조: 볼 수 있는 프로젝트(B)는 통과해 답한다 — 관문이 모든 요청을 막는 것이 아니다', async () => {
    const res = await chatPOST(post('http://l/api/chat', { projectId: B_PID, message: '팀별 업무 정리해줘' }))
    expect(res.status).toBe(200)
    expect(mocks.teamCodes).toHaveBeenCalledWith(B_PID)
  })

  // chatbot 모듈 관문(과제 20) — 프로젝트 관문(legacyChatProjectGate) 뒤. 볼 수 있는 B 라도 모듈이 꺼지면 404 이고 답을 만들지 않는다.
  it('chatbot 모듈이 꺼지면 /api/chat 은 404 이고 답을 만들지 않는다(과제 20)', async () => {
    vi.mocked(requireSessionModule).mockResolvedValue({ ok: false, error: ERR_MODULE_DISABLED })
    const res = await chatPOST(post('http://l/api/chat', { projectId: B_PID, message: '진행 상황' }))
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ error: ERR_MODULE_DISABLED })
    expect(requireSessionModule).toHaveBeenCalledWith(B_PID, 'chatbot')
    expect(mocks.teamCodes).not.toHaveBeenCalled()
  })
  it('chatbot 모듈이 꺼지면 /api/chat/stream 은 404 이고 스트림을 만들지 않는다(과제 20)', async () => {
    vi.mocked(requireSessionModule).mockResolvedValue({ ok: false, error: ERR_MODULE_DISABLED })
    const res = await streamPOST(post('http://l/api/chat/stream', { projectId: B_PID, message: '진행 상황' }))
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ error: ERR_MODULE_DISABLED })
    expect(requireSessionModule).toHaveBeenCalledWith(B_PID, 'chatbot')
    expect(mocks.teamCodes).not.toHaveBeenCalled()
  })
  it('chatbot 모듈이 꺼지면 /api/chat/context 는 404 — probe=1 도 404 이고 문맥을 만들지 않는다(과제 20)', async () => {
    vi.mocked(requireSessionModule).mockResolvedValue({ ok: false, error: ERR_MODULE_DISABLED })
    const ctx = await contextGET(new NextRequest(`http://l/api/chat/context?projectId=${B_PID}`))
    expect(ctx.status).toBe(404)
    expect(await ctx.json()).toMatchObject({ error: ERR_MODULE_DISABLED })
    const probe = await contextGET(new NextRequest(`http://l/api/chat/context?projectId=${B_PID}&probe=1`))
    expect(probe.status).toBe(404)
    expect(await probe.json()).toMatchObject({ error: ERR_MODULE_DISABLED })
    expect(requireSessionModule).toHaveBeenCalledWith(B_PID, 'chatbot')
    expect(mocks.teamCodes).not.toHaveBeenCalled()
  })
  it('프로젝트 없는 전체 질문은 세션 유일 워크스페이스로 판정한다 — requireSessionModule(null)(과제 20, P13)', async () => {
    vi.mocked(requireSessionModule).mockResolvedValue({ ok: false, error: ERR_MODULE_DISABLED })
    const res = await chatPOST(post('http://l/api/chat', { message: '진행 상황' }))
    expect(res.status).toBe(404)
    expect(requireSessionModule).toHaveBeenCalledWith(null, 'chatbot')
  })
  it('볼 수 없는 프로젝트는 모듈 판정 전에 404 — 프로젝트 관문이 먼저다(과제 20)', async () => {
    expect((await chatPOST(post('http://l/api/chat', { projectId: A_PID, message: '안녕' }))).status).toBe(404)
    expect(requireSessionModule).not.toHaveBeenCalled()
  })
  it('probe=1 은 관문만 지나고 문맥을 만들지 않는다(과제 20, P12)', async () => {
    const res = await contextGET(new NextRequest(`http://l/api/chat/context?projectId=${B_PID}&probe=1`))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(requireSessionModule).toHaveBeenCalledWith(B_PID, 'chatbot')
    expect(mocks.teamCodes).not.toHaveBeenCalled()   // buildBotContext 가 돌면 B 의 팀 코드를 읽는다(아래 대조)
  })
  it('대조: probe 없는 context 는 문맥을 만든다 — 탐침 분기가 전부를 막는 것이 아니다(과제 20)', async () => {
    const res = await contextGET(new NextRequest(`http://l/api/chat/context?projectId=${B_PID}`))
    expect(res.status).toBe(200)
    expect(mocks.teamCodes).toHaveBeenCalledWith(B_PID)
  })
})

describe('심층 방어 — 관문을 우회해 들어와도 RLS 로 프로젝트 행을 먼저 확인한다', () => {
  it('ingestProject: RLS 로 행이 없으면 throw — admin upsert·팀 캐시 전에 멈춘다', async () => {
    await expect(ingestProject(A_PID)).rejects.toThrow('프로젝트를 찾을 수 없습니다')
    expect(mocks.upsert).not.toHaveBeenCalled()
    expect(mocks.teamCodes).not.toHaveBeenCalled()
  })

  it('loadProjectAnalysis: RLS 로 행이 없으면 throw — 팀 캐시를 읽지 않는다', async () => {
    await expect(loadProjectAnalysis(A_PID)).rejects.toThrow('프로젝트를 찾을 수 없습니다')
    expect(mocks.teamCodes).not.toHaveBeenCalled()
  })
})
