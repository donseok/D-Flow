// /api/chat/command 의 chatbot 관문(과제 20) — 프로젝트 화면 전용 명령. 꺼지면 404 이고 WBS 를 읽지 않는다.
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ getSession: vi.fn(), getComputedWbs: vi.fn(), run: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getSession: m.getSession }))
vi.mock('@/lib/data/wbs', () => ({ getComputedWbs: m.getComputedWbs }))
vi.mock('@/lib/ai/commands/pipeline', () => ({ runCommandPipeline: m.run }))
import { POST } from '@/app/api/chat/command/route'
import { ERR_MODULE_DISABLED } from '@/lib/authz/errors'
import { moduleState, projectsWithModule, requireModule, requireSessionModule, workspacesWithModule } from '@/lib/modules/gate'

const post = (body: unknown) => new NextRequest('http://l/api/chat/command', { method: 'POST', body: JSON.stringify(body) })
beforeEach(() => {
  vi.clearAllMocks()
  m.getSession.mockResolvedValue({ id: 'u1' }); m.getComputedWbs.mockResolvedValue({ items: [] }); m.run.mockResolvedValue({ kind: 'noop' })
})
// 관문 mock 값을 바꾸는 파일 — 전역 통과 구현으로 되돌린다(공통 규칙)
afterEach(() => { for (const f of [requireModule, requireSessionModule, moduleState, projectsWithModule, workspacesWithModule]) vi.mocked(f).mockReset() })

describe('/api/chat/command — chatbot 관문', () => {
  it('꺼지면 404 이고 WBS·파이프라인을 부르지 않는다', async () => {
    vi.mocked(requireSessionModule).mockResolvedValueOnce({ ok: false, error: ERR_MODULE_DISABLED })
    const res = await POST(post({ projectId: 'p1', message: '실적 80' }))
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ error: ERR_MODULE_DISABLED })
    expect(requireSessionModule).toHaveBeenCalledWith('p1', 'chatbot')
    expect(m.getComputedWbs).not.toHaveBeenCalled(); expect(m.run).not.toHaveBeenCalled()
  })
  it('켜지면 기존 흐름, 프로젝트 없으면 관문 전에 안내문(기존 계약)', async () => {
    expect((await POST(post({ projectId: 'p1', message: '실적 80' }))).status).toBe(200)
    expect(m.getComputedWbs).toHaveBeenCalledWith('p1')
    vi.mocked(requireSessionModule).mockClear()
    const none = await (await POST(post({ message: '실적 80' }))).json()
    expect(none).toMatchObject({ kind: 'error' })
    expect(requireSessionModule).not.toHaveBeenCalled()
  })
  it('비로그인은 관문 전에 401', async () => {
    m.getSession.mockResolvedValue(null)
    expect((await POST(post({ projectId: 'p1', message: '실적 80' }))).status).toBe(401)
    expect(requireSessionModule).not.toHaveBeenCalled()
  })
})
