// /w/[slug]/minutes/[id](스펙 §4.2 2행, D6·P20) — 첫 await 은 슬러그 판정, 행의 워크스페이스가 슬러그와 다르면 404, 관문은 행의 워크스페이스.
// 연결 이슈·위키 영향은 그 회의록의 프로젝트(없으면 워크스페이스)에서 모듈이 켜졌을 때만 싣는다.
import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  loadWorkspaceScope: vi.fn(), requireModulePage: vi.fn(async () => {}), moduleSetFor: vi.fn(),
  getMinuteDetail: vi.fn(), getMinuteLinkedIssues: vi.fn(async () => [{ id: 'i1' }]), getMinuteWikiImpact: vi.fn(async () => ({ topics: [] })),
  notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }), viewerProps: vi.fn(), getMinuteVersionBody: vi.fn(async (): Promise<unknown> => null),
  getMinuteVersions: vi.fn(async () => ({ ok: true, rows: [] })),
  getHiddenProjectIds: vi.fn(async (): Promise<ReadonlySet<string>> => new Set()),
  // 회의록→WBS — 연결된 작업 로더(실패를 결과로 준다)와 보이는 프로젝트 목록(관리 프로젝트를 거르는 재료)
  getMinuteLinkedWbsItems: vi.fn(), listProjects: vi.fn(),
}))
vi.mock('@/lib/authz/workspaceScope', () => ({ loadWorkspaceScope: h.loadWorkspaceScope }))
vi.mock('@/lib/authz/visibility', () => ({ getHiddenProjectIds: h.getHiddenProjectIds }))
vi.mock('@/lib/modules/pageGate', () => ({ requireModulePage: h.requireModulePage }))
vi.mock('@/lib/modules/gate', () => ({ moduleSetFor: h.moduleSetFor }))
vi.mock('next/navigation', () => ({ notFound: h.notFound }))
vi.mock('@/lib/data/minutes', () => ({
  getMinuteDetail: h.getMinuteDetail, getMinuteAnnotations: vi.fn(async () => ({ highlights: [], insights: [] })),
  getMinuteVersions: h.getMinuteVersions, getMinuteWikiImpact: h.getMinuteWikiImpact,
  getMinuteVersionBody: h.getMinuteVersionBody, getMinuteFolderPath: vi.fn(async () => []),
}))
vi.mock('@/lib/data/issues', () => ({ getMinuteLinkedIssues: h.getMinuteLinkedIssues }))
vi.mock('@/lib/data/wbsLinks', () => ({ getMinuteLinkedWbsItems: h.getMinuteLinkedWbsItems }))
vi.mock('@/lib/data/members', () => ({ getProjectRoster: vi.fn(async () => ({ ok: true, rows: [] })), getMyProjectIds: vi.fn(async () => []) }))
vi.mock('@/lib/auth', () => ({ getSession: vi.fn(async () => ({ id: 'u1' })) }))
vi.mock('@/app/actions/project', () => ({ listProjects: h.listProjects }))
vi.mock('@/app/actions/preferences', () => ({ getAccountPrefs: vi.fn(async () => ({})) }))
vi.mock('@/components/minutes/MinuteViewer', () => ({ MinuteViewer: (p: unknown) => { h.viewerProps(p); return null } }))

import MinuteDetailPage from '@/app/(app)/w/[slug]/minutes/[id]/page'
import { makeActor } from '../fixtures/actor'

const WA = { id: '00000000-0000-0000-7e57-000000001681', slug: 'acme', name: 'Acme' }
const MID = '00000000-0000-0000-7e57-000000001682', PID = '00000000-0000-0000-7e57-000000001683'
const WBS_LINK = {
  linkId: 'l1', itemId: 'w1', code: 'A-1', name: 'n', projectId: PID, minuteVersionId: 'v1', bodyHash: 'bh', blockIndex: 0, blockHash: 'h0', sourceKind: 'manual',
}
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
  h.getHiddenProjectIds.mockResolvedValue(new Set())
  h.getMinuteLinkedWbsItems.mockResolvedValue({ ok: true, rows: [WBS_LINK] })
  h.listProjects.mockResolvedValue([])
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
      expect(h.getMinuteLinkedWbsItems).not.toHaveBeenCalled()
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
  // DD1(CC 재리뷰 P3-1) — 화면 숨김(FA1)의 상세 표면. 목록·검색·내보내기가 거르는 명단 밖 비공개 프로젝트 회의록을 id(북마크·알림·출처 링크)로도 열지 않는다
  it('행의 프로젝트(minutes.project_id)가 명단 밖 비공개면 404 — 모듈 관문 바로 뒤, 본문·판·주석 로더 미호출', async () => {
    h.getHiddenProjectIds.mockResolvedValue(new Set([PID]))
    await expect(run()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(h.requireModulePage).toHaveBeenCalledWith({ workspaceId: WA.id }, 'minutes')
    expect(h.moduleSetFor).not.toHaveBeenCalled()
    expect(h.getMinuteVersions).not.toHaveBeenCalled()
    expect(h.getMinuteLinkedIssues).not.toHaveBeenCalled()
    expect(h.getMinuteLinkedWbsItems).not.toHaveBeenCalled()
    expect(h.viewerProps).not.toHaveBeenCalled()
  })
  it('비공개 판정 실패는 던진다(fail-closed — 범위 오류 경계) — 숨김을 모른 채 본문을 그리지 않는다', async () => {
    h.getHiddenProjectIds.mockRejectedValue(new Error('hidden down'))
    await expect(run()).rejects.toThrow('hidden down')
    expect(h.getMinuteVersions).not.toHaveBeenCalled()
    expect(h.viewerProps).not.toHaveBeenCalled()
  })
  it('대조 — 다른 프로젝트가 숨었거나(명단 안) 프로젝트 없는 회의록이면 그대로 연다', async () => {
    h.getHiddenProjectIds.mockResolvedValue(new Set(['00000000-0000-0000-7e57-000000001685']))
    await run()
    expect(h.viewerProps).toHaveBeenCalledTimes(1)
    vi.clearAllMocks()
    h.getHiddenProjectIds.mockResolvedValue(new Set([PID]))
    h.getMinuteDetail.mockResolvedValue(detail(WA.id, null))
    h.moduleSetFor.mockResolvedValue(new Set(ALL))
    await run()
    expect(h.viewerProps).toHaveBeenCalledTimes(1)
  })
  it('숨김 기준은 행 자신의 project_id(ownProjectId) — 회의 폴백 projectId 가 아니다', async () => {
    const d = detail(WA.id)
    h.getMinuteDetail.mockResolvedValue({ ...d, minute: { ...d.minute, projectId: '00000000-0000-0000-7e57-000000001686', ownProjectId: PID } })
    h.getHiddenProjectIds.mockResolvedValue(new Set([PID]))
    await expect(run()).rejects.toThrow('NEXT_NOT_FOUND')
  })
})

// 회의록→WBS(설계 2026-10-21-minutes-to-wbs §3.3·§5.6·§8) — 연결된 작업과 "WBS 로 등록할 수 있는 프로젝트"를 뷰어에 내려준다.
describe('/w/[slug]/minutes/[id] — 연결된 WBS 작업·등록 가능 프로젝트', () => {
  const lastViewerProps = () => h.viewerProps.mock.calls.at(-1)![0] as Record<string, unknown>
  const P2 = '00000000-0000-0000-7e57-000000001687', P3 = '00000000-0000-0000-7e57-000000001688'
  const asActor = async (actor: ReturnType<typeof makeActor> | null) => {
    h.loadWorkspaceScope.mockResolvedValue(actor
      ? { ws: WA, actor, degraded: false, role: 'member' }
      : { ws: WA, actor: null, degraded: true, role: null })
    await run()
    return lastViewerProps().wbsAdminProjectIds
  }

  it('회의록 모듈이 켜졌으면 연결된 작업을 싣고 사유는 null — 로더는 이 회의록 id 로 부른다', async () => {
    await run()
    expect(h.getMinuteLinkedWbsItems).toHaveBeenCalledWith(MID)
    expect(h.viewerProps).toHaveBeenCalledWith(expect.objectContaining({ linkedWbsItems: [WBS_LINK], linkedWbsItemsError: null }))
  })

  it('그 회의록의 프로젝트에서 회의록 모듈이 꺼졌으면 연결된 작업을 싣지 않는다(연결 표는 회의록 모듈 소유)', async () => {
    h.moduleSetFor.mockResolvedValue(new Set(['dashboard', 'wbs', 'members', 'settings', 'issues', 'wiki']))
    await run()
    expect(h.viewerProps).toHaveBeenCalledWith(expect.objectContaining({ linkedWbsItems: [], linkedWbsItemsError: null }))
  })

  it('조회 실패는 빈 목록과 사유로 넘기고 로그를 남긴다 — "연결 없음"으로 그리지 않는다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.getMinuteLinkedWbsItems.mockResolvedValue({ ok: false, error: '연결된 작업 목록을 읽지 못했습니다.' })
    await run()
    expect(h.viewerProps).toHaveBeenCalledWith(expect.objectContaining({ linkedWbsItems: [], linkedWbsItemsError: '연결된 작업 목록을 읽지 못했습니다.' }))
    expect(spy).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`\\[minutes\\].*WBS.*${MID}`)))
    spy.mockRestore()
  })

  it('정상이면 페이지가 연결 조회 실패를 로그하지 않는다', async () => {
    // 이 파일은 달력 판독(minuteScopeTimezone)을 목으로 두지 않아 그쪽 로그가 따로 남는다 — WBS 로그만 본다
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await run()
    expect(spy.mock.calls.filter(([msg]) => String(msg).includes('WBS'))).toEqual([])
    spy.mockRestore()
  })

  describe('wbsAdminProjectIds — 액션 가드(requireProjectAdmin)와 같은 판정, 보이는 프로젝트(listProjects) 안에서만', () => {
    beforeEach(() => { h.listProjects.mockResolvedValue([{ id: PID, name: 'P' }, { id: P2, name: 'Q' }]) })

    it('프로젝트 관리자 — 관리자인 프로젝트 중 보이는 것만(목록 밖 P3 은 뺀다, 멤버인 P2 는 아니다)', async () => {
      expect(await asActor(makeActor({
        workspaceRoles: new Map([[WA.id, 'member']]),
        projectWorkspace: new Map([[PID, WA.id], [P2, WA.id], [P3, WA.id]]),
        projectRoles: new Map([[PID, 'admin'], [P2, 'member'], [P3, 'admin']]),
      }))).toEqual([PID])
    })

    it('워크스페이스 관리자 — 그 워크스페이스의 보이는 프로젝트 전부(관리자 승계)', async () => {
      const ids = await asActor(makeActor({
        workspaceRoles: new Map([[WA.id, 'admin']]),
        projectWorkspace: new Map([[PID, WA.id], [P2, WA.id]]),
      })) as string[]
      expect([...ids].sort()).toEqual([PID, P2].sort())
    })

    it('플랫폼 관리자 — 보이는 프로젝트 전부', async () => {
      expect(await asActor(makeActor({ isSuperuser: true, workspaceRoles: new Map([[WA.id, 'member']]) }))).toEqual([PID, P2])
    })

    it('멤버뿐이거나 권한을 모르면(열화 — actor null) 빈 목록', async () => {
      expect(await asActor(makeActor({
        workspaceRoles: new Map([[WA.id, 'member']]),
        projectWorkspace: new Map([[PID, WA.id]]),
        projectRoles: new Map([[PID, 'member']]),
      }))).toEqual([])
      expect(await asActor(null)).toEqual([])
    })
  })
})
