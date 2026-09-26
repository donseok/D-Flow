import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { DeterministicRoute } from '@/lib/ai/chat/router'

// SP2 Task 16b — 봇 도구 컨텍스트는 accessScope 의 isSuperuser 를 그대로 싣는다. 이게 빠지면 멤버십 없는 플랫폼 관리자의
// 회의록 담당 필터가 빈 워크스페이스 범위로 거부된다(search_minutes).
const mocks = vi.hoisted(() => ({
  orchestrateChatV2: vi.fn<(request: unknown, deps: unknown) => AsyncGenerator<never>>(async function* () {
    // 이벤트 없음 — 컨텍스트만 본다
  }),
}))
const { withCount } = vi.hoisted(() => ({
  withCount: (r: unknown) => {
    const x = r as { data?: unknown }
    return Array.isArray(x.data) ? { ...(r as object), count: x.data.length } : r
  },
}))
vi.mock('@/lib/auth', () => ({ getSession: vi.fn(async () => ({ id: 'u1' })) }))
vi.mock('@/lib/ai/chat/default-registry', async () => {
  const { EMPTY_CHAT_TOOL_REGISTRY } = await import('@/lib/ai/chat/registry')
  return { createDefaultChatToolRegistry: () => EMPTY_CHAT_TOOL_REGISTRY }
})
// 라우트는 스코프 확인 뒤 등록된 팀 코드로 다시 라우팅한다 — master 를 그대로 import 하면 최상위 await refreshTeams() 가 DB 를
// 부른다. 공유 목에 두 접근자만 vi.fn 으로 덮어 어떤 범위로 읽었는지 본다.
const teams = vi.hoisted(() => ({
  activeTeamCodesForProjectSync: vi.fn<(projectId: string) => string[]>(),
  activeTeamCodesVisibleToSync: vi.fn<(view: unknown) => string[]>(),
}))
vi.mock('@/lib/teams/master', async () => ({
  ...(await import('../helpers/teams-master-mock')).teamsMasterMock(),
  ...teams,
}))
vi.mock('@/lib/ai/chat/orchestrator', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ai/chat/orchestrator')>()),
  orchestrateChatV2: mocks.orchestrateChatV2,
}))
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(async () => {
    // 플랫폼 관리자, 워크스페이스 멤버십 없음, 프로젝트 p1(ws-9) 하나.
    const tables: Record<string, unknown> = {
      platform_admins: { data: { user_id: 'u1' }, error: null },
      workspace_members: { data: [], error: null },
      project_members: { data: [], error: null },
      projects: { data: [{ id: 'p1', workspace_id: 'ws-9', is_private: false }], error: null },
    }
    return {
      from: (table: string) => {
        const r = tables[table] ?? { data: null, error: { message: `unexpected table ${table}` } }
        const b: Record<string, unknown> = {}
        for (const k of ['select', 'eq', 'in', 'limit', 'order', 'range']) b[k] = () => b
        b.maybeSingle = async () => r
        // buildActor 의 projects 는 페이지 + count 총합 대조(fetchAllPages) — 배열 응답에는 count 를 싣는다
        b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(withCount(r)).then(res, rej)
        return b
      },
    }
  }),
}))

import { POST } from '@/app/api/chat/v2/stream/route'

function post(body: unknown) {
  return POST(new NextRequest('http://localhost/api/chat/v2/stream', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }))
}

describe('POST /api/chat/v2/stream — 도구 컨텍스트', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    teams.activeTeamCodesForProjectSync.mockImplementation(() => ['Acme'])
    teams.activeTeamCodesVisibleToSync.mockImplementation(() => ['Acme'])
  })

  it('플랫폼 관리자 플래그를 컨텍스트에 싣는다', async () => {
    vi.stubEnv('CHAT_V2_ENABLED', 'true')
    const res = await POST(new NextRequest('http://localhost/api/chat/v2/stream', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'p1', message: '첨부파일 보여줘', history: [],
        pageContext: { contextVersion: 1, pathname: '/p/p1/wbs', domain: 'wbs', projectId: 'p1', timezone: 'Asia/Seoul' },
      }),
    }))
    expect(res.status).toBe(200)
    await res.text()
    const deps = mocks.orchestrateChatV2.mock.calls[0][1] as { context: { isSuperuser?: boolean; workspaceIds?: string[] } }
    expect(deps.context).toMatchObject({ isSuperuser: true, workspaceIds: [] })
    vi.unstubAllEnvs()
  })

  it('프로젝트 질문은 그 프로젝트의 등록 팀으로 다시 라우팅해 팀 인자를 싣는다', async () => {
    vi.stubEnv('CHAT_V2_ENABLED', 'true')
    const res = await post({
      projectId: 'p1', message: 'Acme 작업 현황 알려줘', history: [],
      pageContext: { contextVersion: 1, pathname: '/p/p1/wbs', domain: 'wbs', projectId: 'p1', timezone: 'Asia/Seoul' },
    })
    expect(res.status).toBe(200)
    await res.text()
    expect(teams.activeTeamCodesForProjectSync).toHaveBeenCalledWith('p1')
    const { route } = mocks.orchestrateChatV2.mock.calls[0][1] as { route: DeterministicRoute }
    expect(route.kind).toBe('tools')
    expect(route.calls[0]).toMatchObject({ tool: 'find_wbs_items', args: { projectId: 'p1', team: 'Acme' } })
    vi.unstubAllEnvs()
  })

  it('전역 회의록 질문은 조회자의 팀 가시 범위(플랫폼 관리자는 전부)로 팀을 뽑는다', async () => {
    vi.stubEnv('CHAT_V2_ENABLED', 'true')
    const res = await post({
      projectId: null, message: 'Acme 회의록 찾아줘', history: [],
      pageContext: { contextVersion: 1, pathname: '/minutes', domain: 'minutes', projectId: null, timezone: 'Asia/Seoul' },
    })
    expect(res.status).toBe(200)
    await res.text()
    expect(teams.activeTeamCodesVisibleToSync).toHaveBeenCalledWith({ all: true })
    expect(teams.activeTeamCodesForProjectSync).not.toHaveBeenCalled()
    const { route } = mocks.orchestrateChatV2.mock.calls[0][1] as { route: DeterministicRoute }
    expect(route.kind === 'tools' && route.calls[0]).toMatchObject({ tool: 'search_minutes', args: { team: 'Acme' } })
    vi.unstubAllEnvs()
  })
})
