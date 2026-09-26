import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// 회의록 Q&A(archive) 필터 — SP2 Task 16a. 담당 필터는 호출자 워크스페이스들의 공용 팀으로 보고(옛 전역 접근자는 전
// 워크스페이스 합집합이었다), 폴더 필터의 담당 루트는 그 폴더 범위(프로젝트, 미지정이면 워크스페이스)의 팀 시드 루트다.
const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getActor: vi.fn(),
  createServerClient: vi.fn(),
  streamArchiveAnswer: vi.fn(),
  streamDocAnswer: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/authz', () => ({ getActor: mocks.getActor }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: mocks.createServerClient }))
vi.mock('@/lib/ai/answer', () => ({ sanitizeHistory: () => [] }))
vi.mock('@/lib/ai/minutes-answer', () => ({
  streamArchiveAnswer: mocks.streamArchiveAnswer, streamDocAnswer: mocks.streamDocAnswer,
}))
vi.mock('@/lib/teams/master', () => ({
  activeTeamCodesSync: () => ['PMO', 'ERP'],
  activeTeamCodesForWorkspaceSync: (wid: string) => (wid === 'ws-a' ? ['PMO'] : wid === 'ws-b' ? ['ERP'] : []),
}))

import { POST } from '@/app/api/minutes/chat/route'
import { makeActor } from '../fixtures/actor'

// 두 워크스페이스에 동명 'PMO' 미지정 루트가 공존한다 — 시드 루트 키는 범위를 품는다.
const FOLDERS = [
  { id: 'a-pmo', name: 'PMO', parent_id: null, created_by: null, project_id: null, workspace_id: 'ws-a' },
  { id: 'a-sub', name: '주간', parent_id: 'a-pmo', created_by: 'u1', project_id: null, workspace_id: 'ws-a' },
  { id: 'a-leaf', name: '정례', parent_id: 'a-sub', created_by: 'u1', project_id: null, workspace_id: 'ws-a' },
  { id: 'a-erp', name: 'ERP', parent_id: null, created_by: null, project_id: null, workspace_id: 'ws-a' },
  { id: 'a-erp-sub', name: '물류', parent_id: 'a-erp', created_by: 'u1', project_id: null, workspace_id: 'ws-a' },
]

function folderClient() {
  const b: Record<string, unknown> = {}
  b.select = () => b
  b.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: FOLDERS, error: null }).then(resolve)
  return { from: vi.fn(() => b) }
}
const archive = (filters: Record<string, unknown>) => new NextRequest('http://localhost/api/minutes/chat', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ mode: 'archive', message: '결정 사항?', filters }),
})
const passedFilters = () => (mocks.streamArchiveAnswer.mock.calls[0][0] as { filters: Record<string, unknown> }).filters

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getSession.mockResolvedValue({ id: 'u1' })
  mocks.getActor.mockResolvedValue(makeActor({ workspaceRoles: new Map([['ws-a', 'member']]) }))
  mocks.createServerClient.mockResolvedValue(folderClient())
  mocks.streamArchiveAnswer.mockResolvedValue(new ReadableStream({ start: c => c.close() }))
})

describe('/api/minutes/chat archive — 담당 필터는 호출자 워크스페이스의 팀', () => {
  it('내 워크스페이스의 팀은 필터로 넘기고, 다른 워크스페이스의 팀 코드는 넘기지 않는다', async () => {
    expect((await POST(archive({ team: 'PMO' }))).status).toBe(200)
    expect(passedFilters().team).toBe('PMO')
    mocks.streamArchiveAnswer.mockClear()
    expect((await POST(archive({ team: 'ERP' }))).status).toBe(200)
    expect(passedFilters().team).toBeNull()
  })

  it('권한 조회 실패는 500 — 필터를 조용히 넓혀 답하지 않는다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.getActor.mockRejectedValue(new Error('db down'))
    expect((await POST(archive({ team: 'PMO' }))).status).toBe(500)
    expect(mocks.streamArchiveAnswer).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('/api/minutes/chat archive — 폴더 필터의 담당 루트는 그 폴더 범위의 팀 시드 루트', () => {
  it('담당 팀 루트 아래 폴더면 그 하위 트리로 확장해 넘긴다', async () => {
    expect((await POST(archive({ team: 'PMO', folderId: 'a-sub' }))).status).toBe(200)
    expect([...(passedFilters().folderIds as string[])].sort()).toEqual(['a-leaf', 'a-sub'])
  })

  it('다른 팀 루트 아래 폴더는 400 — 필터를 넓히지 않는다', async () => {
    const res = await POST(archive({ team: 'PMO', folderId: 'a-erp-sub' }))
    expect(res.status).toBe(400)
    expect(mocks.streamArchiveAnswer).not.toHaveBeenCalled()
  })
})
