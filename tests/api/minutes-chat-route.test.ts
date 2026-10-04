import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// 회의록 Q&A(archive) 필터 — SP2 Task 16a·16b. 담당 필터는 호출자가 볼 수 있는 팀으로 본다(소속 워크스페이스들의 공용 팀 +
// 볼 수 있는 프로젝트의 전용 팀, 플랫폼 관리자는 전부 — 옛 전역 접근자는 전 워크스페이스 합집합이었다). 폴더 필터의 담당
// 루트는 그 폴더 범위(프로젝트, 미지정이면 워크스페이스)의 팀 시드 루트다.
const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getActor: vi.fn(),
  resolveScope: vi.fn(),
  getHiddenProjectIds: vi.fn(),
  createServerClient: vi.fn(),
  streamArchiveAnswer: vi.fn(),
  streamDocAnswer: vi.fn(),
  workspaceRefById: vi.fn(),
}))
const TEAMS = vi.hoisted((): Team[] => {
  const t = (code: string, workspaceId: string, projectId: string | null = null): Team =>
    ({ id: `${workspaceId}-${code}`, code, name: code, color: '#6b7280', sortOrder: 0, active: true, progressVisible: true, projectId, workspaceId })
  return [t('PMO', 'ws-a'), t('ERP', 'ws-b'), t('MES', 'ws-a', 'pa'), t('QA', 'ws-a', 'pa-priv')]
})
vi.mock('@/lib/auth', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/authz', () => ({ getActor: mocks.getActor, resolveScope: mocks.resolveScope }))
vi.mock('@/lib/authz/visibility', () => ({ getHiddenProjectIds: mocks.getHiddenProjectIds }))
// 플랫폼 관리자 비소속 워크스페이스의 존재 확인(과제 34 — 보기 축)
vi.mock('@/lib/workspace/resolve', () => ({ workspaceRefById: mocks.workspaceRefById }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: mocks.createServerClient }))
vi.mock('@/lib/ai/answer', () => ({ sanitizeHistory: () => [] }))
vi.mock('@/lib/ai/minutes-answer', () => ({
  streamArchiveAnswer: mocks.streamArchiveAnswer, streamDocAnswer: mocks.streamDocAnswer,
}))
const teamsFail = vi.hoisted(() => ({ on: false }))
vi.mock('@/lib/teams/source', async () => {
  const { teamCodesVisibleTo } = await import('@/lib/domain/teams')
  return {
    teamCodesVisibleTo: async (view: Parameters<typeof teamCodesVisibleTo>[1]) => {
      if (teamsFail.on) throw new Error('teams down')
      return teamCodesVisibleTo(TEAMS, view)
    },
  }
})

import { POST } from '@/app/api/minutes/chat/route'
import type { Team } from '@/lib/domain/teams'
import { ERR_LOOKUP, ERR_MISSING, ERR_MODULE_DISABLED } from '@/lib/authz/errors'
import { ERR_WORKSPACE_REQUIRED } from '@/lib/authz/workspace'
import { moduleState, projectsWithModule, requireModule, requireSessionModule, workspacesWithModule } from '@/lib/modules/gate'
import { makeActor, makeSuperuser } from '../fixtures/actor'

// 두 워크스페이스에 동명 'PMO' 미지정 루트가 공존한다 — 시드 루트 키는 범위를 품는다.
const FOLDERS = [
  { id: 'a-pmo', name: 'PMO', parent_id: null, created_by: null, kind: 'team_root', team_id: 't-PMO', team: { code: 'PMO', project_id: null }, project_id: null, workspace_id: 'ws-a' },
  { id: 'a-sub', name: '주간', parent_id: 'a-pmo', created_by: 'u1', project_id: null, workspace_id: 'ws-a' },
  { id: 'a-leaf', name: '정례', parent_id: 'a-sub', created_by: 'u1', project_id: null, workspace_id: 'ws-a' },
  { id: 'a-erp', name: 'ERP', parent_id: null, created_by: null, kind: 'team_root', team_id: 't-ERP', team: { code: 'ERP', project_id: null }, project_id: null, workspace_id: 'ws-a' },
  { id: 'a-erp-sub', name: '물류', parent_id: 'a-erp', created_by: 'u1', project_id: null, workspace_id: 'ws-a' },
  // 명단 밖 비공개 프로젝트(pa-priv)의 전용 트리 — 같은 워크스페이스·같은 담당(PMO) 루트(CC1)
  { id: 'priv-pmo', name: 'PMO', parent_id: null, created_by: null, kind: 'team_root', team_id: 't-PMO', team: { code: 'PMO', project_id: null }, project_id: 'pa-priv', workspace_id: 'ws-a' },
  { id: 'priv-sub', name: '비공개 정례', parent_id: 'priv-pmo', created_by: 'u1', project_id: 'pa-priv', workspace_id: 'ws-a' },
  // 볼 수 있는 프로젝트(pa)의 전용 트리(대조)
  { id: 'pa-pmo', name: 'PMO', parent_id: null, created_by: null, kind: 'team_root', team_id: 't-PMO', team: { code: 'PMO', project_id: null }, project_id: 'pa', workspace_id: 'ws-a' },
  { id: 'pa-sub', name: '프로젝트 정례', parent_id: 'pa-pmo', created_by: 'u1', project_id: 'pa', workspace_id: 'ws-a' },
]

function folderClient() {
  const b: Record<string, unknown> = {}
  b.select = () => b
  b.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: FOLDERS, error: null }).then(resolve)
  return { from: vi.fn(() => b) }
}
/** 보관함 요청 — 회의록 화면의 워크스페이스를 싣는다(과제 34, 기본 ws-a). workspaceId: undefined 면 싣지 않는다 */
const WS_U = '00000000-0000-0000-7e57-000000001793'
const archive = (filters: Record<string, unknown>, workspaceId: unknown = 'ws-a') => new NextRequest('http://localhost/api/minutes/chat', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ mode: 'archive', message: '결정 사항?', filters, ...(workspaceId === undefined ? {} : { workspaceId }) }),
})
const doc = (minuteId = 'm-1') => new NextRequest('http://localhost/api/minutes/chat', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ mode: 'doc', minuteId, message: '요약' }),
})
const passedFilters = () => (mocks.streamArchiveAnswer.mock.calls[0][0] as { filters: Record<string, unknown> }).filters

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getSession.mockResolvedValue({ id: 'u1' })
  mocks.getActor.mockResolvedValue(makeActor({
    workspaceRoles: new Map([['ws-a', 'member']]),
    projectWorkspace: new Map([['pa', 'ws-a'], ['pa-priv', 'ws-a']]),
  }))
  mocks.getHiddenProjectIds.mockResolvedValue(new Set(['pa-priv']))
  mocks.createServerClient.mockResolvedValue(folderClient())
  mocks.streamArchiveAnswer.mockResolvedValue(new ReadableStream({ start: c => c.close() }))
  mocks.streamDocAnswer.mockResolvedValue(new ReadableStream({ start: c => c.close() }))
  mocks.resolveScope.mockResolvedValue({ ok: true, projectId: null, workspaceId: 'ws-a' })
})
// 관문 mock 값을 바꾸는 파일 — 전역 통과 구현으로 되돌린다(공통 규칙)
afterEach(() => { for (const f of [requireModule, requireSessionModule, moduleState, projectsWithModule, workspacesWithModule]) vi.mocked(f).mockReset() })

describe('/api/minutes/chat archive — 담당 필터는 호출자 워크스페이스의 팀', () => {
  it('내 워크스페이스의 팀은 필터로 넘기고, 다른 워크스페이스의 팀 코드는 넘기지 않는다', async () => {
    expect((await POST(archive({ team: 'PMO' }))).status).toBe(200)
    expect(passedFilters().team).toBe('PMO')
    mocks.streamArchiveAnswer.mockClear()
    expect((await POST(archive({ team: 'ERP' }))).status).toBe(200)
    expect(passedFilters().team).toBeNull()
  })

  it('볼 수 있는 프로젝트의 전용 팀 코드는 넘기고, 숨은(비공개) 프로젝트의 전용 팀 코드는 넘기지 않는다', async () => {
    expect((await POST(archive({ team: 'MES' }))).status).toBe(200)
    expect(passedFilters().team).toBe('MES')
    mocks.streamArchiveAnswer.mockClear()
    expect((await POST(archive({ team: 'QA' }))).status).toBe(200)
    expect(passedFilters().team).toBeNull()
  })

  it('멤버십 없는 플랫폼 관리자는 전 워크스페이스의 팀으로 본다 — 필터가 조용히 무시되지 않는다', async () => {
    mocks.getActor.mockResolvedValue(makeSuperuser({ workspaceRoles: new Map() }))
    mocks.workspaceRefById.mockResolvedValue({ ok: true, ws: { id: WS_U, slug: 'acme', name: 'Acme' } })
    expect((await POST(archive({ team: 'ERP' }, WS_U))).status).toBe(200)
    expect(passedFilters().team).toBe('ERP')
    expect(mocks.streamArchiveAnswer).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: WS_U }))
  })

  it('담당 필터가 없으면 비공개 프로젝트 목록을 읽지 않는다', async () => {
    expect((await POST(archive({}))).status).toBe(200)
    expect(mocks.getHiddenProjectIds).not.toHaveBeenCalled()
  })

  it('권한 조회 실패는 503(범위 관문) — 필터를 조용히 넓혀 답하지 않는다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.getActor.mockRejectedValue(new Error('db down'))
    expect((await POST(archive({ team: 'PMO' }))).status).toBe(503)
    expect(mocks.streamArchiveAnswer).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('[RF2] 담당 필터가 있는데 팀을 읽지 못하면 500 — 필터를 조용히 버리고 전 회의록으로 답하지 않는다', async () => {
    teamsFail.on = true
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect((await POST(archive({ team: 'OPS' }))).status).toBe(500)
      expect(mocks.streamArchiveAnswer).not.toHaveBeenCalled()
    } finally { teamsFail.on = false; err.mockRestore() }
  })
})

describe('/api/minutes/chat archive — 비공개 판정 실패는 막는다(FA1)', () => {
  it('숨김 집합을 못 읽으면 500 — 비공개 프로젝트 팀을 걸러내지 못한 채 답하지 않는다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.getHiddenProjectIds.mockRejectedValue(new Error('hidden down'))
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

  it('다른 워크스페이스의 폴더는 400 — 그 워크스페이스 검색에서 조용히 0건이 되지 않는다(과제 34)', async () => {
    mocks.getActor.mockResolvedValue(makeActor({ workspaceRoles: new Map([['ws-a', 'member'], ['ws-b', 'member']]) }))
    const res = await POST(archive({ team: 'PMO', folderId: 'a-sub' }, 'ws-b'))
    expect(res.status).toBe(400)
    expect(mocks.streamArchiveAnswer).not.toHaveBeenCalled()
  })

  it('명단 밖 비공개 프로젝트의 폴더는 400 — 폴더 id 를 알아도 그 폴더만 골라 묻지 못한다(CC1, FA1)', async () => {
    for (const folderId of ['priv-sub', 'priv-pmo']) {
      const res = await POST(archive({ team: 'PMO', folderId }))
      expect(res.status).toBe(400)
    }
    expect(mocks.streamArchiveAnswer).not.toHaveBeenCalled()
  })

  it('볼 수 있는 프로젝트의 폴더는 그대로 통과한다(대조)', async () => {
    expect((await POST(archive({ team: 'PMO', folderId: 'pa-sub' }))).status).toBe(200)
    expect(passedFilters().folderIds).toEqual(['pa-sub'])
  })

  it('다른 팀 루트 아래 폴더는 400 — 필터를 넓히지 않는다', async () => {
    const res = await POST(archive({ team: 'PMO', folderId: 'a-erp-sub' }))
    expect(res.status).toBe(400)
    expect(mocks.streamArchiveAnswer).not.toHaveBeenCalled()
  })
})

// minutes 모듈 관문(과제 20) — 두 모드의 판정 범위가 다르다(BRANCH_GATE): 보관함은 세션 유일 워크스페이스, 문서는 회의록 행의 워크스페이스.
describe('/api/minutes/chat — minutes 모듈 관문(과제 20)', () => {
  it('보관함 모드: minutes 가 꺼지면 404 이고 답을 만들지 않는다 — 요청의 워크스페이스로 판정(과제 34)', async () => {
    vi.mocked(requireModule).mockResolvedValueOnce({ ok: false, error: ERR_MODULE_DISABLED })
    const res = await POST(archive({}))
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ error: ERR_MODULE_DISABLED })
    expect(requireModule).toHaveBeenCalledWith({ workspaceId: 'ws-a' }, 'minutes')
    expect(requireSessionModule).not.toHaveBeenCalled()
    expect(mocks.streamArchiveAnswer).not.toHaveBeenCalled()
  })
  it('보관함 모드: 워크스페이스가 없으면 400 — 세션 유일 워크스페이스로 추측하지 않는다(과제 34)', async () => {
    const omitted = new NextRequest('http://localhost/api/minutes/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'archive', message: '결정 사항?', filters: {} }),
    })
    for (const req of [omitted, archive({}, null), archive({}, '')]) {
      const res = await POST(req)
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: ERR_WORKSPACE_REQUIRED })
    }
    expect(requireModule).not.toHaveBeenCalled()
    expect(mocks.getActor).not.toHaveBeenCalled()
    expect(mocks.streamArchiveAnswer).not.toHaveBeenCalled()
  })
  it.each([
    ['비소속', 'ws-b'],
    ['형식 밖(대문자)', 'WS-A'],
    ['형식 밖(줄바꿈)', 'ws-a\n'],
    ['형식 밖(객체)', { id: 'ws-a' }],
  ])('보관함 모드 적대 — %s 워크스페이스는 404, 관문·답 없음(과제 34)', async (_n, w) => {
    const res = await POST(archive({ team: 'PMO' }, w))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: ERR_MISSING })
    expect(requireModule).not.toHaveBeenCalled()
    expect(mocks.streamArchiveAnswer).not.toHaveBeenCalled()
  })
  it('보관함 모드: 검색·AI 판정에 그 워크스페이스를 넘긴다(과제 34)', async () => {
    expect((await POST(archive({}))).status).toBe(200)
    expect(mocks.streamArchiveAnswer).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'ws-a' }))
  })
  it('문서 모드: 회의록 행의 워크스페이스가 꺼지면 404 이고 답을 만들지 않는다', async () => {
    mocks.resolveScope.mockResolvedValue({ ok: true, projectId: null, workspaceId: 'ws-a' })
    vi.mocked(requireModule).mockResolvedValueOnce({ ok: false, error: ERR_MODULE_DISABLED })
    const res = await POST(doc('m-1'))
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ error: ERR_MODULE_DISABLED })
    expect(mocks.resolveScope).toHaveBeenCalledWith('minutes', 'm-1')
    expect(requireModule).toHaveBeenCalledWith({ workspaceId: 'ws-a' }, 'minutes')
    expect(requireSessionModule).not.toHaveBeenCalled()
    expect(mocks.streamDocAnswer).not.toHaveBeenCalled()
  })
  it('문서 모드: 켜져 있으면 기존 흐름대로 답한다(대조)', async () => {
    const res = await POST(doc('m-1'))
    expect(res.status).toBe(200)
    expect(requireModule).toHaveBeenCalledWith({ workspaceId: 'ws-a' }, 'minutes')
    expect(mocks.streamDocAnswer).toHaveBeenCalledWith(expect.objectContaining({ minuteId: 'm-1' }))
  })
  // DD1(CC 재리뷰 P3-1) — 명단 밖 비공개 프로젝트의 회의록 본문을 문서 Q&A 근거로 내보내지 않는다(목록·보관함과 같은 숨김 — FA1)
  it('문서 모드: 행의 프로젝트가 명단 밖 비공개면 모듈 판정 전에 404(없는 회의록과 같은 응답) — 답을 만들지 않는다', async () => {
    mocks.resolveScope.mockResolvedValue({ ok: true, projectId: 'pa-priv', workspaceId: 'ws-a' })
    const res = await POST(doc('m-priv'))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: '회의록을 찾을 수 없습니다.' })
    expect(requireModule).not.toHaveBeenCalled()
    expect(mocks.streamDocAnswer).not.toHaveBeenCalled()
  })
  it('문서 모드: 비공개 판정 실패는 500 — 숨김을 모른 채 본문을 근거로 쓰지 않는다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.resolveScope.mockResolvedValue({ ok: true, projectId: 'pa', workspaceId: 'ws-a' })
    mocks.getHiddenProjectIds.mockRejectedValue(new Error('hidden down'))
    expect((await POST(doc('m-pa'))).status).toBe(500)
    expect(mocks.streamDocAnswer).not.toHaveBeenCalled()
    spy.mockRestore()
  })
  it('문서 모드 대조: 볼 수 있는 프로젝트의 회의록은 답한다', async () => {
    mocks.resolveScope.mockResolvedValue({ ok: true, projectId: 'pa', workspaceId: 'ws-a' })
    expect((await POST(doc('m-pa'))).status).toBe(200)
    expect(mocks.streamDocAnswer).toHaveBeenCalledWith(expect.objectContaining({ minuteId: 'm-pa' }))
  })
  it('문서 모드: 볼 수 없는 회의록은 모듈 판정 전에 404, 행 조회 실패는 500 — 없는 회의록으로 위장하지 않는다', async () => {
    mocks.resolveScope.mockResolvedValueOnce({ ok: false, error: ERR_MISSING })
    expect((await POST(doc('m-x'))).status).toBe(404)
    mocks.resolveScope.mockResolvedValueOnce({ ok: false, error: ERR_LOOKUP })
    expect((await POST(doc('m-x'))).status).toBe(500)
    expect(requireModule).not.toHaveBeenCalled()
    expect(mocks.streamDocAnswer).not.toHaveBeenCalled()
  })
})
