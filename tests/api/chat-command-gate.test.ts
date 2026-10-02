// /api/chat/command 의 chatbot 관문(과제 20) — 프로젝트 화면 전용 명령. 꺼지면 404 이고 WBS 를 읽지 않는다.
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ getSession: vi.fn(), getComputedWbs: vi.fn(), run: vi.fn(), getActor: vi.fn(), listProjectsWithState: vi.fn() }))
// 볼 수 있는 프로젝트 목록(RLS + 비공개 명단) — 명단 밖 비공개 프로젝트는 없다(U2b-5 리뷰 수정 CC6, legacyChatProjectGate)
vi.mock('@/app/actions/project', () => ({ listProjectsWithState: m.listProjectsWithState }))
vi.mock('@/lib/auth', () => ({ getSession: m.getSession }))
vi.mock('@/lib/authz', () => ({ getActor: m.getActor }))
vi.mock('@/lib/data/wbs', () => ({ getComputedWbs: m.getComputedWbs }))
vi.mock('@/lib/ai/commands/pipeline', () => ({ runCommandPipeline: m.run }))
import { POST } from '@/app/api/chat/command/route'
import { ERR_MISSING, ERR_MODULE_DISABLED } from '@/lib/authz/errors'
import { makeActor } from '../fixtures/actor'
import { moduleState, projectsWithModule, requireModule, requireSessionModule, workspacesWithModule } from '@/lib/modules/gate'

const post = (body: unknown) => new NextRequest('http://l/api/chat/command', { method: 'POST', body: JSON.stringify(body) })
beforeEach(() => {
  vi.clearAllMocks()
  m.getSession.mockResolvedValue({ id: 'u1' }); m.getComputedWbs.mockResolvedValue({ items: [] }); m.run.mockResolvedValue({ kind: 'noop' })
  m.listProjectsWithState.mockResolvedValue({ projects: [{ id: 'p1' }], degraded: false })
})
// 관문 mock 값을 바꾸는 파일 — 전역 통과 구현으로 되돌린다(공통 규칙)
afterEach(() => { for (const f of [requireModule, requireSessionModule, moduleState, projectsWithModule, workspacesWithModule]) vi.mocked(f).mockReset() })

describe('/api/chat/command — chatbot 관문', () => {
  it('꺼지면 404 이고 WBS·파이프라인을 부르지 않는다', async () => {
    vi.mocked(requireModule).mockResolvedValueOnce({ ok: false, error: ERR_MODULE_DISABLED })
    const res = await POST(post({ projectId: 'p1', message: '실적 80' }))
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ error: ERR_MODULE_DISABLED })
    expect(requireModule).toHaveBeenCalledWith({ projectId: 'p1' }, 'chatbot')
    expect(m.getComputedWbs).not.toHaveBeenCalled(); expect(m.run).not.toHaveBeenCalled()
  })
  it('켜지면 기존 흐름, 프로젝트 없으면 관문 전에 안내문(기존 계약)', async () => {
    expect((await POST(post({ projectId: 'p1', message: '실적 80' }))).status).toBe(200)
    expect(m.getComputedWbs).toHaveBeenCalledWith('p1')
    vi.mocked(requireModule).mockClear()
    const none = await (await POST(post({ message: '실적 80' }))).json()
    expect(none).toMatchObject({ kind: 'error' })
    expect(requireModule).not.toHaveBeenCalled()
  })
  it('비로그인은 관문 전에 401', async () => {
    m.getSession.mockResolvedValue(null)
    expect((await POST(post({ projectId: 'p1', message: '실적 80' }))).status).toBe(401)
    expect(requireModule).not.toHaveBeenCalled()
  })
  it('적대 — 프로젝트와 다른 워크스페이스를 함께 실으면 404, 형식 밖도 404 — WBS·파이프라인을 부르지 않는다(과제 34)', async () => {
    m.getActor.mockResolvedValue(makeActor({ workspaceRoles: new Map([['ws-a', 'member'], ['ws-b', 'member']]), projectWorkspace: new Map([['p1', 'ws-a']]) }))
    for (const workspaceId of ['ws-b', 'ws-a\n', 7]) {
      const res = await POST(post({ projectId: 'p1', workspaceId, message: '실적 80' }))
      expect(res.status, String(workspaceId)).toBe(404)
      expect(await res.json()).toEqual({ error: ERR_MISSING })
    }
    expect(requireModule).not.toHaveBeenCalled()
    expect(m.getComputedWbs).not.toHaveBeenCalled(); expect(m.run).not.toHaveBeenCalled()
    expect((await POST(post({ projectId: 'p1', workspaceId: 'ws-a', message: '실적 80' }))).status).toBe(200)
  })
  it('명단 밖 비공개 프로젝트(볼 수 없는 프로젝트)는 404 — 그 작업 이름이 후보로 나가지 않는다, 관문·WBS 없음(CC6)', async () => {
    const res = await POST(post({ projectId: 'p-priv', message: '실적 80' }))
    expect(res.status).toBe(404)
    expect(requireModule).not.toHaveBeenCalled()
    expect(m.getComputedWbs).not.toHaveBeenCalled(); expect(m.run).not.toHaveBeenCalled()
  })
  it('프로젝트 목록을 못 읽었으면 500 — 없는 프로젝트로 위장하지 않고 WBS 를 읽지 않는다(CC6)', async () => {
    m.listProjectsWithState.mockResolvedValue({ projects: [], degraded: true })
    expect((await POST(post({ projectId: 'p1', message: '실적 80' }))).status).toBe(500)
    expect(m.getComputedWbs).not.toHaveBeenCalled()
  })
})
