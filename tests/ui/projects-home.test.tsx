/**
 * 전체 프로젝트(/w/[slug]/projects, SP3b 과제 25) — 슬러그 워크스페이스의 카드 목록.
 *
 * 옛 /projects 홈의 어두운 히어로(통계칩 TASKS/DONE/%·워크스페이스 설정 링크)는 이동 커밋에서 걷었다 — 통계 집계 테스트도 함께 없앴다.
 * 남은 판정: ① 첫 await 가 슬러그 판정 ② 슬러그 워크스페이스의 프로젝트만 ③ 상태 배지가 완료율 맵(트리 재로드 없음)과 같은 판정
 * ④ 생성 버튼은 그 워크스페이스의 관리자에게만, 생성 대상은 슬러그 워크스페이스 ⑤ ?new=1 이면 열린 채.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { computeCompletionMap } from '@/lib/domain/project-status'
import { t } from '@/lib/i18n/dict'

const mocks = vi.hoisted(() => ({
  listProjects: vi.fn<() => Promise<unknown[]>>(),
  degraded: false,
  loadWorkspaceScope: vi.fn<(slug: string) => Promise<unknown>>(),
  getProjectsCompletion: vi.fn<() => Promise<unknown>>(),
}))

vi.mock('@/app/actions/project', () => ({
  // 페이지는 listProjectsWithState(실패 사실을 같이 준다)를 쓴다 — 목록은 mocks.listProjects, 실패 여부는 mocks.degraded
  listProjectsWithState: async () => ({ projects: await mocks.listProjects(), degraded: mocks.degraded }),
  createProject: vi.fn(), // NewProjectModal 의 import 바인딩용 — 이 테스트에서 렌더되지 않는다
}))
vi.mock('@/lib/authz/workspaceScope', () => ({ loadWorkspaceScope: mocks.loadWorkspaceScope }))
vi.mock('@/lib/data/wbs', () => ({ getProjectsCompletion: mocks.getProjectsCompletion }))
vi.mock('@/lib/i18n/server', () => ({ getServerLocale: async () => 'ko' }))
// 생성 버튼은 워크스페이스 id·열림 여부만 확인한다 — 실물은 라우터·로케일 컨텍스트가 필요하다.
vi.mock('@/components/home/NewProjectModal', () => ({
  NewProjectModal: ({ workspaceId, defaultOpen, copyCandidates = [] }: { workspaceId: string; defaultOpen?: boolean; copyCandidates?: { id: string }[] }) =>
    <button data-new-project={workspaceId} data-default-open={String(Boolean(defaultOpen))} data-copy={copyCandidates.map((c) => c.id).join(',')}>new</button>,
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={String(href)} {...rest}>{children}</a>
  ),
}))

import ProjectsPage from '@/app/(app)/w/[slug]/projects/page'
import { makeActor, makeSuperuser, WS } from '../fixtures/actor'

const OTHER = 'ws-other'
// 종료일이 이미 지난 날짜 — projectLifecycleStatus 의 done/overdue 분기를 태운다
const ENDED = { start_date: '2000-01-01', end_date: '2000-12-31' }
const P1 = 'p1', P2 = 'p2', P3 = 'p3', PX = 'px'
const projectsInWs = [
  { id: P1, name: 'Alpha', workspace_id: WS, description: null, ...ENDED },
  { id: P2, name: 'Beta', workspace_id: WS, description: null, ...ENDED },
  { id: P3, name: 'Gamma', workspace_id: WS, description: null, ...ENDED },
]
const projectInOther = { id: PX, name: 'Elsewhere', workspace_id: OTHER, description: null, ...ENDED }

// P1: 전 리프 완료 / P2: 미완 리프(50, 99.5 — 원시값 done 판정) / P3: WBS 0건 / PX: 다른 워크스페이스
const realCompletionMap = () => computeCompletionMap([
  { id: 'a-root', parentId: null, projectId: P1, actualPct: null },
  { id: 'a-1', parentId: 'a-root', projectId: P1, actualPct: 100 },
  { id: 'a-2', parentId: 'a-root', projectId: P1, actualPct: 100 },
  { id: 'b-1', parentId: null, projectId: P2, actualPct: 50 },
  { id: 'b-2', parentId: null, projectId: P2, actualPct: 99.5 },
  { id: 'x-1', parentId: null, projectId: PX, actualPct: 100 },
])

const scopeOf = (actor: unknown, slug = 'acme') => ({ ws: { id: WS, slug, name: 'Acme' }, actor, degraded: actor === null, role: actor ? 'member' : null })
async function renderPage(searchParams: { new?: string } = {}, slug = 'acme'): Promise<string> {
  return renderToStaticMarkup(await ProjectsPage({ params: Promise.resolve({ slug }), searchParams: Promise.resolve(searchParams) }))
}
const count = (markup: string, needle: string) => markup.split(needle).length - 1

beforeEach(() => {
  mocks.degraded = false
  mocks.listProjects.mockResolvedValue([...projectsInWs, projectInOther])
  mocks.loadWorkspaceScope.mockResolvedValue(scopeOf(makeActor()))
  mocks.getProjectsCompletion.mockResolvedValue(realCompletionMap())
})
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks() })

describe('전체 프로젝트 — 머리·마크업(히어로 없음)', () => {
  it('h1 이 전체 프로젝트이고 개수 메타가 있다. 어두운 히어로·통계칩·uppercase 소제목이 없다', async () => {
    const markup = await renderPage()
    expect(markup).toMatch(/<h1[^>]*>전체 프로젝트<\/h1>/)
    expect(markup).toContain('3개')
    for (const gone of ['hero-glow', 'hero-card', 'hero-ink', 'Workspace ·', 'uppercase', 'project-library', 'TASKS', 'Tasks']) expect(markup, gone).not.toContain(gone)
  })
  it('카드는 이동 없이(hover 로 떠오르지 않는다) 상세 링크만 건다', async () => {
    const markup = await renderPage()
    expect(markup).not.toContain('translate')
    expect(markup).toContain('href="/p/p1/dashboard"')
  })
})

describe('전체 프로젝트 — 슬러그 워크스페이스만', () => {
  it('첫 await 가 슬러그 판정이고 그 뒤에 목록·완료율을 읽는다(비소속이면 목록을 읽지 않는다)', async () => {
    await renderPage({}, 'acme')
    expect(mocks.loadWorkspaceScope).toHaveBeenCalledWith('acme')
    expect(mocks.loadWorkspaceScope.mock.invocationCallOrder[0]).toBeLessThan(mocks.listProjects.mock.invocationCallOrder[0])
    mocks.listProjects.mockClear()
    mocks.loadWorkspaceScope.mockRejectedValue(new Error('NEXT_HTTP_ERROR_FALLBACK;404'))
    await expect(renderPage({}, 'nope')).rejects.toThrow('NEXT_HTTP_ERROR_FALLBACK;404')
    expect(mocks.listProjects).not.toHaveBeenCalled()
  })
  it('다른 워크스페이스의 프로젝트는 카드에도 개수에도 없다', async () => {
    const markup = await renderPage()
    expect(markup).not.toContain('Elsewhere')
    expect(markup).not.toContain('/p/px/')
    for (const p of projectsInWs) expect(count(markup, `>${p.name}</h3>`), p.name).toBe(1)
  })
  it('이 워크스페이스에 프로젝트가 없으면 빈 상태(다른 워크스페이스 프로젝트가 있어도)', async () => {
    mocks.listProjects.mockResolvedValue([projectInOther])
    const markup = await renderPage()
    expect(markup).not.toContain('Elsewhere')
    expect(markup).toContain('첫 프로젝트를 만들어 보세요')
    expect(markup).toContain('0개')
  })
})

describe('전체 프로젝트 — 상태 배지(완료율 맵, 트리 재로드 없음)', () => {
  it('전 리프 완료=done, 미완=overdue, WBS 0건+종료일 경과=done', async () => {
    const markup = await renderPage()
    expect(count(markup, 'bg-done-weak')).toBe(2)
    expect(count(markup, 'bg-delayed-weak')).toBe(1)
    expect(count(markup, 'bg-surface-2 text-ink-muted')).toBe(0)
  })
  it('완료율 맵 조회 실패(null)면 전 카드가 unknown — WBS 없음(빈 맵)으로 뭉개지 않는다', async () => {
    mocks.getProjectsCompletion.mockResolvedValue(null)
    const markup = await renderPage()
    expect(count(markup, 'bg-surface-2 text-ink-muted')).toBe(3)
    expect(count(markup, 'bg-done-weak')).toBe(0)
  })
})

describe('전체 프로젝트 — 생성은 그 워크스페이스의 관리자, 대상은 슬러그 워크스페이스(D26)', () => {
  it('워크스페이스 관리자에게 그 워크스페이스로 생성 버튼을 준다 — 열려 있지 않다', async () => {
    mocks.loadWorkspaceScope.mockResolvedValue(scopeOf(makeActor({ workspaceRoles: new Map([[WS, 'admin']]) })))
    const markup = await renderPage()
    expect(markup).toContain(`data-new-project="${WS}"`)
    expect(markup).toContain('data-default-open="false"')
  })
  it('다른 워크스페이스의 관리자일 뿐인 사람(이 워크스페이스에서는 멤버)에게는 버튼이 없다 — 소속 수와 무관', async () => {
    mocks.loadWorkspaceScope.mockResolvedValue(scopeOf(makeActor({ workspaceRoles: new Map([[WS, 'member'], [OTHER, 'admin']]) })))
    expect(await renderPage()).not.toContain('data-new-project')
  })
  it('소속이 여럿이어도 슬러그 워크스페이스로 만든다 — 사유 문구가 없다(유일 소속 판정 폐기)', async () => {
    mocks.loadWorkspaceScope.mockResolvedValue(scopeOf(makeSuperuser({ workspaceRoles: new Map([[WS, 'admin'], [OTHER, 'member']]) })))
    const markup = await renderPage()
    expect(markup).toContain(`data-new-project="${WS}"`)
    expect(markup).not.toContain('워크스페이스를 지정해야 합니다.')
    expect(markup).not.toContain('role="status"')
  })
  it('권한 조회가 열화(actor null)면 버튼이 없다(fail-closed)', async () => {
    mocks.loadWorkspaceScope.mockResolvedValue(scopeOf(null))
    expect(await renderPage()).not.toContain('data-new-project')
  })
  it('?new=1 이면 열린 채로, 아니면 닫힌 채로', async () => {
    mocks.loadWorkspaceScope.mockResolvedValue(scopeOf(makeActor({ workspaceRoles: new Map([[WS, 'admin']]) })))
    expect(await renderPage({ new: '1' })).toContain('data-default-open="true"')
    expect(await renderPage({ new: '0' })).toContain('data-default-open="false"')
  })
  it('복사 원본 후보는 이 워크스페이스 프로젝트뿐이다', async () => {
    mocks.loadWorkspaceScope.mockResolvedValue(scopeOf(makeActor({ workspaceRoles: new Map([[WS, 'admin']]) })))
    const markup = await renderPage()
    expect(markup).toContain(`data-copy="${[P1, P2, P3].join(',')}"`)
    expect(markup).not.toContain('Elsewhere')
  })
  it('이 워크스페이스에 프로젝트가 없어도(다른 곳에만 있어도) 빈 상태에서 시작 버튼, 후보는 비어 있다', async () => {
    mocks.loadWorkspaceScope.mockResolvedValue(scopeOf(makeActor({ workspaceRoles: new Map([[WS, 'admin']]) })))
    mocks.listProjects.mockResolvedValue([projectInOther])
    const markup = await renderPage()
    expect(markup).toContain(`data-new-project="${WS}"`)
    expect(markup).toContain('data-copy=""')
  })
  it('목록 조회 실패는 \'프로젝트 없음\'이 아니다 — 오류 상태, 빈 상태·생성 권유·개수 없음', async () => {
    mocks.loadWorkspaceScope.mockResolvedValue(scopeOf(makeActor({ workspaceRoles: new Map([[WS, 'admin']]) })))
    mocks.degraded = true
    mocks.listProjects.mockResolvedValue([])
    const markup = await renderPage({ new: '1' })
    expect(markup).toContain('data-status-kind="partial_error"')
    expect(markup).toContain('role="alert"')
    expect(markup).not.toContain('data-new-project')
    expect(markup).not.toContain(t('ko', 'home.emptyTitle'))
    expect(markup).not.toContain(`0${t('ko', 'home.countUnit')}`)
  })
})

describe("전체 프로젝트 — '최근 프로젝트' 섹션 없음(D6-§2)", () => {
  it('프로젝트가 4개 이상이어도 카드는 한 번씩만 나오고 recent-title 섹션이 없다', async () => {
    const many = [...projectsInWs,
      { id: 'p4', name: 'Delta', workspace_id: WS, description: null, ...ENDED },
      { id: 'p5', name: 'Epsilon', workspace_id: WS, description: null, ...ENDED }]
    mocks.listProjects.mockResolvedValue(many)
    const markup = await renderPage()
    expect(markup).not.toContain('recent-title')
    for (const p of many) expect(count(markup, `>${p.name}</h3>`), p.name).toBe(1)
  })
})
