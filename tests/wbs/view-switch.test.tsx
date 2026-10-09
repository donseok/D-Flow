import { renderToStaticMarkup, renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeActor } from '../fixtures/actor'
const h = vi.hoisted(() => ({ wbs: vi.fn(), actor: vi.fn(), pc: vi.fn(), mod: vi.fn(), reason: vi.fn() }))
vi.mock('@/lib/modules/pageGate', () => ({ requireModulePage: vi.fn(async () => {}) }))
vi.mock('@/lib/modules/gate', () => ({ requireModule: h.mod, moduleState: vi.fn(async () => 'off') }))
vi.mock('@/lib/data/wbs', () => ({ getComputedWbs: h.wbs }))
vi.mock('@/lib/calendar/load', () => ({ toCalendarInput: (v: unknown) => v }))
vi.mock('@/lib/authz', () => ({ getActorForView: h.actor }))
vi.mock('@/app/actions/project', () => ({ listProjects: async () => [{ id: 'p1', name: 'Acme' }] }))
vi.mock('@/app/actions/preferences', () => ({ getWbsCollapse: async () => null, getAccountPrefs: async () => ({}) }))
vi.mock('@/lib/auth', () => ({ getSession: async () => null }))
vi.mock('@/lib/settings/pageConfig', () => ({ loadProjectConfigForPage: h.pc }))
vi.mock('@/lib/data/members', () => ({ getProjectRoster: async () => ({ ok: true, rows: [] }) }))
vi.mock('@/lib/wbs/boardAvailability', () => ({ boardUnavailableReason: h.reason }))
vi.mock('@/components/wbs/WbsGanttSheet', () => ({ WbsGanttSheet: (p: { defaultView: string }) => <div data-sheet={p.defaultView} /> }))
vi.mock('@/components/kanban/KanbanBoard', () => ({ KanbanBoard: () => <div data-kanban-board /> }))
vi.mock('@/components/wbs/WbsRealtimeRefresh', () => ({ WbsRealtimeRefresh: () => <i data-realtime /> }))
vi.mock('@/components/app/ProjectPageShell', () => ({ ProjectPageShell: (p: { hero: React.ReactNode; pinned: React.ReactNode; children: React.ReactNode }) => <>{p.hero}{p.pinned}{p.children}</> }))
vi.mock('@/lib/i18n/server', () => ({ getServerLocale: async () => 'ko' }))
import { resolveWbsView, viewHref } from '@/lib/wbs/view'
import { ViewSwitch } from '@/components/wbs/ViewSwitch'
import WbsPage from '@/app/(app)/p/[projectId]/wbs/page'

vi.mock('@/components/providers/LocaleProvider', async () => {
  const { t } = await import('@/lib/i18n/dict')
  const ko = (k: string) => t('ko', k as Parameters<typeof t>[1])   // 렌더마다 같은 함수(effect 의존성 안정)
  return { useLocale: () => ({ locale: 'ko', t: ko, setLocale: () => {} }) }
})
const cfg = (over = {}) => ({ projectId: 'p1', workspaceId: 'w1', revision: 1, schemaAhead: false, teams: [], keys: {
  'core.level_labels': { status: 'set', value: ['단계', '작업'] }, 'core.milestone_keywords': { status: 'default', value: [] },
  'views.default': { status: 'set', value: { wbs: 'board' } }, ...over,
} })
beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockReset()
  h.wbs.mockResolvedValue({ items: [], dependencies: [], unresolvedDepends: {}, calendar: {}, today: '2026-10-04' })
  h.actor.mockResolvedValue(makeActor({ projectWorkspace: new Map([['p1', 'w1']]), projectRoles: new Map([['p1', 'admin']]) }))
  h.pc.mockResolvedValue({ ok: true, cfg: cfg() }); h.mod.mockResolvedValue({ ok: true }); h.reason.mockResolvedValue('project_off')
})
describe('작업 계획 보기 결정', () => {
  it('URL → 설정 → 표, focus 링크는 저장된 보드에 삼켜지지 않는다', () => {
    expect(resolveWbsView({ view: 'timeline', stored: 'board', boardOn: true }).view).toBe('timeline')
    expect(resolveWbsView({ stored: 'timeline', boardOn: true }).view).toBe('timeline')
    expect(resolveWbsView({ stored: null, boardOn: true }).view).toBe('sheet')
    expect(resolveWbsView({ focus: 'row', stored: 'board', boardOn: true }).view).toBe('sheet')
    expect(resolveWbsView({ view: 'bad', stored: 'timeline', boardOn: true }).view).toBe('timeline')
  })
  it('명시적 보드 요청만 꺼짐 안내, 복사된 기본 보드+칸반 없음은 표로 복귀', () => {
    expect(resolveWbsView({ view: 'board', stored: null, boardOn: false })).toEqual({ view: 'sheet', notice: 'board_off' })
    expect(resolveWbsView({ stored: 'board', boardOn: false })).toEqual({ view: 'sheet', notice: null })
  })
  it('전환은 focus/view를 제거하고 다른 반복 쿼리를 지킨다', () => {
    expect(viewHref('/p/x/wbs', { focus: 'r', view: 'sheet', group: 'phase', team: ['A', 'B'] }, 'board')).toBe('/p/x/wbs?group=phase&team=A&team=B&view=board')
    const html = renderToStaticMarkup(<ViewSwitch basePath="/p/x/wbs" query={{}} current="timeline" boardOn />)
    expect(html.match(/<a /g)).toHaveLength(3); expect(html).toMatch(/<a[^>]*aria-current="page"[^>]*href="\/p\/x\/wbs\?view=timeline"/)
    expect(renderToStaticMarkup(<ViewSwitch basePath="/p/x/wbs" query={{}} current="sheet" boardOn={false} />)).not.toContain('view=board')
  })
})
const render = async (q = {}) => renderToString(await WbsPage({ params: Promise.resolve({ projectId: 'p1' }), searchParams: Promise.resolve(q) }))
describe('작업 계획의 보드 통합', () => {
  it('저장된 보드 + 실시간, 보드에는 작업 추가 버튼 없음', async () => {
    const html = await render(); expect(html).toContain('data-kanban-board'); expect(html).toContain('data-realtime'); expect(html).not.toContain('작업 추가')
  })
  it('표·간트에는 제목 h1 하나와 관리자 작업 추가', async () => {
    const html = await render({ view: 'timeline' }); expect(html.match(/<h1/g)).toHaveLength(1); expect(html).toContain('작업 계획'); expect(html).toContain('작업 추가'); expect(html).toContain('data-sheet="timeline"')
  })
  it.each([['project_off', '이 프로젝트에서는 보드를 사용하지 않습니다'], ['workspace_denied', '워크스페이스에서 보드를 허용하지 않습니다'], ['unknown', '보드 사용 여부를 확인하지 못했습니다']])('보드 거부 사유 %s', async (reason, text) => {
    h.mod.mockResolvedValue({ ok: false }); h.reason.mockResolvedValue(reason)
    const html = await render({ view: 'board' }); expect(html).toContain('data-sheet="sheet"'); expect(html).toContain(text); expect(html).not.toContain('view=board')
  })
  it('기본 보기 손상은 표 + 설정 알림', async () => {
    h.pc.mockResolvedValue({ ok: true, cfg: cfg({ 'views.default': { status: 'invalid', error: 'x' } }) })
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    try { const html = await render(); expect(html).toContain('data-sheet="sheet"'); expect(html).toContain('data-config-state="invalid"'); expect(err).toHaveBeenCalled() } finally { err.mockRestore() }
  })
})
