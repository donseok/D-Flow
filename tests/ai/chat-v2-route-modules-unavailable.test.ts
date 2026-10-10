// 봇 도구의 모듈 관문이 워크스페이스 설정을 못 읽으면(A2-3 리뷰 보안 P3 — X2) 라우트는 좁힌 채 답하지 않고 503 MODULES_UNAVAILABLE 이다.
// 오류 원문(원인)은 응답에 싣지 않고 로그로만 남긴다. 그 밖의 예외는 삼키지 않는다.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({ gate: vi.fn(), orchestrate: vi.fn() }))
// 요청 범위 달력(SP5 D13 ③) — 해석기 대신 서울·월요일 달력(옛 동작)을 준다. 해석 규칙은 tests/calendar/load.test.ts·bot-week-rules 가 본다
vi.mock('@/lib/calendar/load', async (orig) => ({
  ...(await orig<object>()),
  resolveRequestCalendar: vi.fn(async () => (await import('../helpers/calendarFixture')).calSeoulMon),
  resolveMemberWorkspacesCalendar: vi.fn(async () => (await import('../helpers/calendarFixture')).calSeoulMon),   // 소속 워크스페이스 판정(M3)도 같은 달력
}))
vi.mock('@/lib/auth', () => ({ getSession: vi.fn(async () => ({ id: 'u1' })) }))
vi.mock('@/lib/ai/chat/tool-modules', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ai/chat/tool-modules')>()),
  gateChatTools: m.gate,
}))
vi.mock('@/lib/ai/chat/orchestrator', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ai/chat/orchestrator')>()),
  orchestrateChatV2: m.orchestrate,
}))
vi.mock('@/lib/teams/source', async () => (await import('../helpers/teams-source-mock')).teamsSourceMock())
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(async () => {
    // 플랫폼 관리자, 프로젝트 p1 하나(chat-v2-route-context.test.ts 와 같은 꼴)
    const tables: Record<string, { data: unknown; error: unknown }> = {
      platform_admins: { data: { user_id: 'u1' }, error: null },
      workspace_members: { data: [], error: null },
      project_members: { data: [], error: null },
      projects: { data: [{ id: 'p1', workspace_id: 'ws-9', is_private: false }], error: null },
      // buildActor 가 플랫폼 관리자에게 읽는 "있는 워크스페이스" 축(0056)
      workspaces: { data: [{ id: 'ws-9', archived_at: null }], error: null },
    }
    return {
      from: (table: string) => {
        const r = tables[table] ?? { data: null, error: { message: `unexpected table ${table}` } }
        const b: Record<string, unknown> = {}
        for (const k of ['select', 'eq', 'in', 'limit', 'order', 'range']) b[k] = () => b
        b.maybeSingle = async () => r
        b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
          Promise.resolve(Array.isArray(r.data) ? { ...r, count: r.data.length } : r).then(res, rej)
        return b
      },
    }
  }),
}))

import { POST } from '@/app/api/chat/v2/stream/route'
import { ChatToolGateUnavailableError } from '@/lib/ai/chat/tool-modules'

const post = () => POST(new NextRequest('http://localhost/api/chat/v2/stream', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    projectId: 'p1', message: '이번 주 작업 알려줘', history: [],
    pageContext: { contextVersion: 1, pathname: '/p/p1/wbs', domain: 'wbs', projectId: 'p1', timezone: 'Asia/Seoul' },
  }),
}))

describe('POST /api/chat/v2/stream — 모듈 설정 조회 실패(X2)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('CHAT_V2_ENABLED', 'true')
  })
  it('[X2] 워크스페이스 모듈 설정을 못 읽으면 503 MODULES_UNAVAILABLE — 원문 없이, 오케스트레이터를 부르지 않는다', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    m.gate.mockRejectedValue(new ChatToolGateUnavailableError('워크스페이스 모듈 설정을 읽지 못했습니다.', { cause: new Error('raw db secret') }))
    const res = await post()
    expect(res.status).toBe(503)
    const body = await res.text()
    expect(JSON.parse(body)).toMatchObject({ code: 'MODULES_UNAVAILABLE' })
    expect(body).not.toContain('raw db secret')
    expect(err.mock.calls.flat().some((x) => String(x).includes('raw db secret'))).toBe(true)
    expect(m.orchestrate).not.toHaveBeenCalled()
    err.mockRestore()
  })
  it('[X2] 그 밖의 예외는 삼키지 않는다(관문 오류만 503)', async () => {
    m.gate.mockRejectedValue(new TypeError('programming'))
    await expect(post()).rejects.toThrow('programming')
  })
})
