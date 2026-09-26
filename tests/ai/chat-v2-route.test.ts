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
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    vi.stubEnv('CHAT_V2_ENABLED', 'true')
    mocks.getSession.mockResolvedValue({ id: 'u1' })
    mocks.createServerClient.mockResolvedValue(client(['p1']))
    mocks.createDefaultRegistry.mockReturnValue(EMPTY_CHAT_TOOL_REGISTRY)
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

  it('returns 501 when the explicit v2 kill switch is off', async () => {
    vi.stubEnv('CHAT_V2_ENABLED', 'false')
    const response = await POST(request({ projectId: null, message: '질문', history: [] }))
    expect(response.status).toBe(501)
    expect(await response.json()).toMatchObject({ code: 'CHAT_V2_DISABLED' })
  })
})
