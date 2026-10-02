import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { DeterministicRoute } from '@/lib/ai/chat/router'
import type { ChatTool } from '@/lib/ai/chat/registry'
import {
  moduleSetFor, moduleState, projectsWithModule, requireModule, requireSessionModule, workspacesWithModule,
} from '@/lib/modules/gate'
import { MODULE_IDS, type ModuleId } from '@/lib/modules/defaults'

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
// 기본 레지스트리를 **빈 껍데기**로 두면 `gateChatTools` 가 아무리 잘 걸러도 관측할 도구가 없다 —
// 라우트 배선을 보려면 도구가 들어 있는 목이 필요하다(wbs 는 항상 켜진 채 남고, weekly 는 모듈로 끄고 켠다).
vi.mock('@/lib/ai/chat/default-registry', async () => {
  const { createChatToolRegistry } = await import('@/lib/ai/chat/registry')
  const tool = (name: string, requiredCapability: string) => ({ name, requiredCapability, execute: vi.fn() })
  return {
    createDefaultChatToolRegistry: () => createChatToolRegistry([
      tool('find_wbs_items', 'wbs:read'), tool('get_weekly_sheet', 'weekly:read'),
    ] as unknown as ChatTool[]),
  }
})
// 라우트는 스코프 확인 뒤 요청 범위 팀 원천(SP4 A2)에서 팀(이름 포함)을 읽어 다시 라우팅한다. 공유 목에 두 접근자만 vi.fn 으로
// 덮어 어떤 범위로 읽었는지 본다.
const teams = vi.hoisted(() => ({
  projectTeams: vi.fn(),
  visibleTeams: vi.fn(),
}))
vi.mock('@/lib/teams/source', async () => ({
  ...(await import('../helpers/teams-source-mock')).teamsSourceMock(),
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
      // 비소속 워크스페이스의 존재 확인(과제 34 — 플랫폼 관리자 보기 축)
      workspaces: { data: { id: '00000000-0000-0000-7e57-000000001773', slug: 'acme', name: 'Acme' }, error: null },
    }
    return {
      auth: { getClaims: async () => ({ data: { claims: { sub: 'u1' } } }) },   // 범위 관문(과제 34)의 행위자 조회
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
import { teamRows } from '../helpers/teams-source-mock'

const post = (body: unknown) => {
  return POST(new NextRequest('http://localhost/api/chat/v2/stream', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }))
}

const WBS_QUERY = (projectId: string) => ({
  projectId, message: '이번 주 작업 알려줘', history: [],
  pageContext: { contextVersion: 1, pathname: `/p/${projectId}/wbs`, domain: 'wbs', projectId, timezone: 'Asia/Seoul' },
})
const depsOf = (index = 0) => mocks.orchestrateChatV2.mock.calls[index][1] as {
  registry: { names(): string[] }
  context: { capabilities: readonly string[] }
}

describe('POST /api/chat/v2/stream — 도구 컨텍스트', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    teams.projectTeams.mockResolvedValue(teamRows(['Acme']))
    teams.visibleTeams.mockResolvedValue(teamRows(['Acme']))
  })
  // 관문 mock 값을 바꾼 케이스가 남은 Once 값을 새어 나가지 않게 되돌린다(공통 규칙 — 전역 mock 여섯 함수).
  afterEach(() => {
    for (const fn of [requireModule, requireSessionModule, moduleState, projectsWithModule, workspacesWithModule, moduleSetFor]) {
      vi.mocked(fn).mockReset()
    }
    vi.unstubAllEnvs()
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
    expect(teams.projectTeams).toHaveBeenCalledWith('p1', { client: expect.objectContaining({ from: expect.any(Function) }) })
    const { route } = mocks.orchestrateChatV2.mock.calls[0][1] as { route: DeterministicRoute }
    expect(route.kind).toBe('tools')
    expect(route.calls[0]).toMatchObject({ tool: 'find_wbs_items', args: { projectId: 'p1', team: 'Acme' } })
    vi.unstubAllEnvs()
  })

  it('전역 회의록 질문은 조회자의 팀 가시 범위(플랫폼 관리자는 전부)로 팀을 뽑는다', async () => {
    vi.stubEnv('CHAT_V2_ENABLED', 'true')
    const res = await post({
      projectId: null, message: 'Acme 회의록 찾아줘', history: [],
      pageContext: { contextVersion: 1, pathname: '/w/acme/minutes', domain: 'minutes', projectId: null, timezone: 'Asia/Seoul', workspaceId: '00000000-0000-0000-7e57-000000001773' },
    })
    expect(res.status).toBe(200)
    await res.text()
    expect(teams.visibleTeams).toHaveBeenCalledWith({ all: true }, { client: expect.objectContaining({ from: expect.any(Function) }) })
    expect(teams.projectTeams).not.toHaveBeenCalled()
    const { route } = mocks.orchestrateChatV2.mock.calls[0][1] as { route: DeterministicRoute }
    expect(route.kind === 'tools' && route.calls[0]).toMatchObject({ tool: 'search_minutes', args: { team: 'Acme' } })
    vi.unstubAllEnvs()
  })
})

/**
 * 커밋 제목("꺼진 모듈의 봇 도구와 읽기 권한을 제거한다")의 **유일한 실행 지점**은
 * `route.ts` 의 `gateChatTools` 호출과 `capabilities: gated.capabilities` 다. 단위 함수는 촘촘히 물려 있는데
 * 이 **배선**은 suites 어디에서도 보이지 않았다 — 그 두 줄을 지워도 329 파일이 초록이었다.
 *
 * 반쪽 고정 두 가지가 한 쌍이다:
 *  - 꺼짐(weekly) → 그 도구가 레지스트리에서 빠지고 그 capability 도 컨텍스트에서 빠진다,
 *  - 켜짐(기본, 전역 mock 기본값) → 남는다. 이 반쪽이 없으면 "무조건 닫는" 회귀도 초록이다.
 */
describe('POST /api/chat/v2/stream — 모듈 관문 배선', () => {
  const without = (...disabled: ModuleId[]) => new Set<ModuleId>(MODULE_IDS.filter((module) => !disabled.includes(module)))

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('CHAT_V2_ENABLED', 'true')
    teams.projectTeams.mockResolvedValue(teamRows(['Acme']))
    teams.visibleTeams.mockResolvedValue(teamRows(['Acme']))
  })
  afterEach(() => {
    for (const fn of [requireModule, requireSessionModule, moduleState, projectsWithModule, workspacesWithModule, moduleSetFor]) {
      vi.mocked(fn).mockReset()
    }
    vi.unstubAllEnvs()
  })

  it('weekly 가 꺼지면 그 도구와 weekly:read 를 오케스트레이터에 넘기지 않는다', async () => {
    vi.mocked(moduleSetFor).mockResolvedValue(without('weekly'))
    const res = await post(WBS_QUERY('p1'))
    expect(res.status).toBe(200)
    await res.text()
    const { registry, context } = depsOf()
    // 읽기 권한 축과 도구 축을 **둘 다** 본다 — 하나만 보면 `gated.capabilities` 나 `gated.registry` 한쪽만 물린다.
    expect(context.capabilities).not.toContain('weekly:read')
    expect(registry.names()).not.toContain('get_weekly_sheet')
    // 켜진 모듈의 도구는 남는다(항상 닫는 회귀 방지).
    expect(context.capabilities).toContain('wbs:read')
    expect(registry.names()).toEqual(['find_wbs_items'])
  })

  it('weekly 가 켜져 있으면 도구와 capability 를 그대로 넘긴다 (필터가 항상 비우지 않음)', async () => {
    // 전역 mock 기본값이 "전부 켜짐"이므로 값을 바꾸지 않는다 — 배선 쪽 켜짐이 없으면 회귀가 초록으로 지나간다.
    const res = await post(WBS_QUERY('p1'))
    expect(res.status).toBe(200)
    await res.text()
    const { registry, context } = depsOf()
    expect(registry.names()).toEqual(['find_wbs_items', 'get_weekly_sheet'])
    expect(context.capabilities).toEqual(expect.arrayContaining(['wbs:read', 'weekly:read']))
  })

  it('chatbot 이 꺼지면 도구와 capability 를 모두 뺀다 — 라우트 관문 뒤 구멍도 닫는다', async () => {
    vi.mocked(moduleSetFor).mockResolvedValue(without('chatbot'))
    const res = await post(WBS_QUERY('p1'))
    expect(res.status).toBe(200)
    await res.text()
    const { registry, context } = depsOf()
    expect(registry.names()).toEqual([])
    expect(context.capabilities).toEqual([])
  })
})
