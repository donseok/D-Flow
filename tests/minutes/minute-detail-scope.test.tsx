// /w/[slug]/minutes/[id](스펙 §4.2 2행, D6·P20) — 첫 await 은 슬러그 판정, 행의 워크스페이스가 슬러그와 다르면 404, 관문은 행의 워크스페이스.
// 연결 이슈·위키 영향은 그 회의록의 프로젝트(없으면 워크스페이스)에서 모듈이 켜졌을 때만 싣는다.
import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  loadWorkspaceScope: vi.fn(), requireModulePage: vi.fn(async () => {}), moduleSetFor: vi.fn(),
  getMinuteDetail: vi.fn(), getMinuteLinkedIssues: vi.fn(async () => [{ id: 'i1' }]), getMinuteWikiImpact: vi.fn(async () => ({ topics: [] })),
  notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }), viewerProps: vi.fn(), getMinuteVersionBody: vi.fn(async (): Promise<unknown> => null),
  getMinuteVersions: vi.fn(async () => ({ ok: true, rows: [] })),
}))
vi.mock('@/lib/authz/workspaceScope', () => ({ loadWorkspaceScope: h.loadWorkspaceScope }))
vi.mock('@/lib/modules/pageGate', () => ({ requireModulePage: h.requireModulePage }))
vi.mock('@/lib/modules/gate', () => ({ moduleSetFor: h.moduleSetFor }))
vi.mock('next/navigation', () => ({ notFound: h.notFound }))
vi.mock('@/lib/data/minutes', () => ({
  getMinuteDetail: h.getMinuteDetail, getMinuteAnnotations: vi.fn(async () => ({ highlights: [], insights: [] })),
  getMinuteVersions: h.getMinuteVersions, getMinuteWikiImpact: h.getMinuteWikiImpact,
  getMinuteVersionBody: h.getMinuteVersionBody, getMinuteFolderPath: vi.fn(async () => []),
}))
vi.mock('@/lib/data/issues', () => ({ getMinuteLinkedIssues: h.getMinuteLinkedIssues }))
vi.mock('@/lib/data/members', () => ({ getProjectRoster: vi.fn(async () => ({ ok: true, rows: [] })), getMyProjectIds: vi.fn(async () => []) }))
vi.mock('@/lib/auth', () => ({ getSession: vi.fn(async () => ({ id: 'u1' })) }))
vi.mock('@/app/actions/project', () => ({ listProjects: vi.fn(async () => []) }))
vi.mock('@/app/actions/preferences', () => ({ getAccountPrefs: vi.fn(async () => ({})) }))
vi.mock('@/components/minutes/MinuteViewer', () => ({ MinuteViewer: (p: unknown) => { h.viewerProps(p); return null } }))

import MinuteDetailPage from '@/app/(app)/w/[slug]/minutes/[id]/page'
import { makeActor } from '../fixtures/actor'

const WA = { id: '00000000-0000-0000-7e57-000000001681', slug: 'acme', name: 'Acme' }
const MID = '00000000-0000-0000-7e57-000000001682', PID = '00000000-0000-0000-7e57-000000001683'
const detail = (workspaceId: string | null, projectId: string | null = PID) => ({
  minute: { id: MID, workspaceId, projectId, ownProjectId: projectId, projectName: 'P', folderId: null, createdBy: 'u1', archivedAt: null, meetingProjectId: null },
  files: { ok: true, rows: [] },
})
const run = async () => renderToString(await MinuteDetailPage({ params: Promise.resolve({ slug: 'acme', id: MID }), searchParams: Promise.resolve({}) }))
const ALL = ['dashboard', 'wbs', 'members', 'settings', 'minutes', 'issues', 'wiki']

beforeEach(() => {
  vi.clearAllMocks()
  h.loadWorkspaceScope.mockResolvedValue({ ws: WA, actor: makeActor({ workspaceRoles: new Map([[WA.id, 'member']]) }), degraded: false, role: 'member' })
  h.getMinuteDetail.mockResolvedValue(detail(WA.id))
  h.moduleSetFor.mockResolvedValue(new Set(ALL))
})

describe('/w/[slug]/minutes/[id]', () => {
  it('행의 워크스페이스 = 슬러그 워크스페이스 — 그 워크스페이스로 관문, 모듈이 켜졌으면 연결 이슈·위키 영향을 싣는다', async () => {
    await run()
    expect(h.loadWorkspaceScope).toHaveBeenCalledWith('acme')
    expect(h.requireModulePage).toHaveBeenCalledWith({ workspaceId: WA.id }, 'minutes')
    expect(h.getMinuteWikiImpact).toHaveBeenCalled()
    // 버전 목록의 '이 판 보기' 링크가 스텁을 한 번 더 거치지 않게 새 형식 base 를 넘긴다(과제 21)
    expect(h.getMinuteVersions).toHaveBeenCalledWith(MID, '/w/acme/minutes')
    expect(h.viewerProps).toHaveBeenCalledWith(expect.objectContaining({ linkedIssues: [{ id: 'i1' }], wikiImpact: { topics: [] } }))
  })
  it('행의 워크스페이스가 슬러그와 다르거나 없으면 404(다른 워크스페이스 회의록을 이 주소로 열지 않는다) — 관문·로더 미호출', async () => {
    for (const d of [detail('00000000-0000-0000-7e57-000000001689'), detail(null), null]) {
      vi.clearAllMocks()
      h.getMinuteDetail.mockResolvedValue(d)
      await expect(run()).rejects.toThrow('NEXT_NOT_FOUND')
      expect(h.requireModulePage).not.toHaveBeenCalled()
      expect(h.getMinuteLinkedIssues).not.toHaveBeenCalled()
    }
  })
  it('P20 — 이슈·위키가 꺼진 프로젝트면 연결 이슈·위키 영향을 싣지 않는다(위키 영향 로더도 부르지 않는다)', async () => {
    h.moduleSetFor.mockResolvedValue(new Set(['dashboard', 'wbs', 'members', 'settings', 'minutes']))
    await run()
    expect(h.moduleSetFor).toHaveBeenCalledWith({ projectId: PID })
    expect(h.getMinuteWikiImpact).not.toHaveBeenCalled()
    expect(h.viewerProps).toHaveBeenCalledWith(expect.objectContaining({ linkedIssues: [], wikiImpact: null }))
  })
  it('형식 밖 id 는 조회 없이 404 — 오류 경계·서버 로그에 입력 문자열을 싣지 않는다(V1)', async () => {
    for (const bad of ['not-a-uuid', `${MID}x`, 'abc\n%0A', '']) {
      vi.clearAllMocks()
      await expect(MinuteDetailPage({ params: Promise.resolve({ slug: 'acme', id: bad }), searchParams: Promise.resolve({}) })).rejects.toThrow('NEXT_NOT_FOUND')
      expect(h.loadWorkspaceScope).toHaveBeenCalledWith('acme')   // 슬러그 판정이 먼저(비소속은 거기서 404)
      expect(h.getMinuteDetail).not.toHaveBeenCalled()
      expect(h.requireModulePage).not.toHaveBeenCalled()
    }
  })
  it('형식 밖 ?version= 도 조회 없이 404 — 판 본문 조회의 22P02 로그에 입력 문자열을 싣지 않는다(U2a-4 T5)', async () => {
    for (const bad of ['v2', `${MID}x`, "1' or '1'='1", '%0A']) {
      vi.clearAllMocks()
      await expect(MinuteDetailPage({ params: Promise.resolve({ slug: 'acme', id: MID }), searchParams: Promise.resolve({ version: bad }) })).rejects.toThrow('NEXT_NOT_FOUND')
      expect(h.getMinuteVersionBody).not.toHaveBeenCalled()
      expect(h.getMinuteDetail).not.toHaveBeenCalled()
    }
    vi.clearAllMocks()
    const V = '00000000-0000-0000-7e57-000000001684'
    h.getMinuteVersionBody.mockResolvedValue({ id: V, body: 'b' })
    await MinuteDetailPage({ params: Promise.resolve({ slug: 'acme', id: MID }), searchParams: Promise.resolve({ version: V }) })
    expect(h.getMinuteVersionBody).toHaveBeenCalledWith(MID, V)
  })
  it('권한 조회 열화(degraded)면 위키 영향(service_role)을 부르지 않는다(V3)', async () => {
    h.loadWorkspaceScope.mockResolvedValue({ ws: WA, actor: null, degraded: true, role: null })
    await run()
    expect(h.getMinuteWikiImpact).not.toHaveBeenCalled()
    expect(h.viewerProps).toHaveBeenCalledWith(expect.objectContaining({ wikiImpact: null }))
  })
  it('프로젝트 없는 회의록은 워크스페이스 범위로 모듈 판정', async () => {
    h.getMinuteDetail.mockResolvedValue(detail(WA.id, null))
    await run()
    expect(h.moduleSetFor).toHaveBeenCalledWith({ workspaceId: WA.id })
  })
})
