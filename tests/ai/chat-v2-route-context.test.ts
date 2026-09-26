import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

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

describe('POST /api/chat/v2/stream — 도구 컨텍스트', () => {
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
})
