import { describe, it, expect, vi, beforeEach } from 'vitest'

// /api/chat/reindex — 프로젝트 색인 재생성은 그 프로젝트의 관리자(SP2 §4.1). 가드는 모킹하되 판정은 순수 계층에 위임한다.
const mocks = vi.hoisted(() => ({ requireProjectAdmin: vi.fn(), ingestProject: vi.fn() }))
vi.mock('@/lib/authz', () => ({ requireProjectAdmin: mocks.requireProjectAdmin }))
vi.mock('@/lib/ai/ingest', () => ({ ingestProject: mocks.ingestProject }))

import { POST } from '@/app/api/chat/reindex/route'
import { roleIn, type Actor } from '@/lib/domain/authz'
import { ERR_DENIED, ERR_MISSING } from '@/lib/authz/errors'
import { makeActor, WS } from '../fixtures/actor'

const PID = 'p-1'

function signedInAs(a: Actor) {
  mocks.requireProjectAdmin.mockImplementation(async (pid: string | null) => {
    const r = roleIn(a, pid)
    if (r === null) return { ok: false, error: ERR_MISSING }
    return r === 'superuser' || r === 'admin' ? { ok: true, actor: a } : { ok: false, error: ERR_DENIED }
  })
}
function req(body: unknown): Parameters<typeof POST>[0] {
  return { json: async () => body } as unknown as Parameters<typeof POST>[0]
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.ingestProject.mockResolvedValue({ count: 3 })
})

describe('POST /api/chat/reindex — 프로젝트 관리자 가드', () => {
  it('그 프로젝트의 관리자(워크스페이스 관리자 승계)는 색인한다', async () => {
    signedInAs(makeActor({ workspaceRoles: new Map([[WS, 'admin']]), projectWorkspace: new Map([[PID, WS]]) }))
    const res = await POST(req({ projectId: PID }))
    expect(res.status).toBe(200)
    expect(mocks.requireProjectAdmin).toHaveBeenCalledWith(PID)
    expect(mocks.ingestProject).toHaveBeenCalledWith(PID)
  })

  it('멤버는 403, 색인하지 않는다', async () => {
    signedInAs(makeActor({ projectWorkspace: new Map([[PID, WS]]), projectRoles: new Map([[PID, 'member']]) }))
    expect((await POST(req({ projectId: PID }))).status).toBe(403)
    expect(mocks.ingestProject).not.toHaveBeenCalled()
  })

  it('다른 워크스페이스의 관리자는 404(존재 은닉), 색인하지 않는다', async () => {
    signedInAs(makeActor({ workspaceRoles: new Map([['ws-b', 'admin']]) }))
    expect((await POST(req({ projectId: PID }))).status).toBe(404)
    expect(mocks.ingestProject).not.toHaveBeenCalled()
  })

  it('projectId 가 없으면 가드 전에 400', async () => {
    expect((await POST(req({}))).status).toBe(400)
    expect(mocks.requireProjectAdmin).not.toHaveBeenCalled()
  })
})
