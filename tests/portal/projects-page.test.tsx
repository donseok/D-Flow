
import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ scope: vi.fn(), rows: vi.fn(), acc: vi.fn(), wsp: vi.fn(), zone: vi.fn() }))
vi.mock('@/lib/authz/workspaceScope', () => ({ loadWorkspaceScope: h.scope }))
vi.mock('@/lib/data/portal', () => ({ getProjectRows: h.rows, listWorkspaceProjects: vi.fn(async () => ({ ok: true, rows: [] })) }))
vi.mock('@/lib/calendar/viewZone', () => ({ viewTimezone: h.zone }))
vi.mock('@/app/actions/preferences', () => ({ getAccountPrefs: h.acc, getWorkspacePrefs: h.wsp }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => '/w/acme/projects', useSearchParams: () => new URLSearchParams() }))
vi.mock('@/components/home/NewProjectModal', () => ({ NewProjectModal: (p: { defaultOpen?: boolean }) => <button data-new-project data-open={String(!!p.defaultOpen)}>새 프로젝트</button> }))
import Page from '@/app/(app)/w/[slug]/projects/page'

const WS = { id: '00000000-0000-0000-7e57-000000001860', slug: 'acme', name: 'Acme' }
const row = (id: string, over = {}) => ({ id, name: `P-${id.slice(-2)}`, description: null, status: 'active', statusReason: '완료 1/4', startDate: '2026-09-01', endDate: '2026-12-31',
  isFavorite: false, progress: { done: 1, total: 4 }, nextDue: '2026-10-05', ...over })
const member = { userId: 'u', isSuperuser: false, workspaceRoles: new Map([[WS.id, 'member']]), projectRoles: new Map(), projectWorkspace: new Map(), memberIds: new Map() }
const admin = { ...member, workspaceRoles: new Map([[WS.id, 'admin']]) }
beforeEach(() => {
  for (const f of Object.values(h)) f.mockReset()
  h.scope.mockResolvedValue({ ws: WS, actor: member, degraded: false, role: 'member' })
  h.rows.mockResolvedValue({ ok: true, rows: [row('00000000-0000-0000-7e57-000000001861')], nextCursor: null })
  h.acc.mockResolvedValue({}); h.wsp.mockResolvedValue({}); h.zone.mockResolvedValue({ ok: true, timeZone: 'UTC' })
})
const render = async (q: Record<string, string> = {}) => renderToString(await Page({ params: Promise.resolve({ slug: 'acme' }), searchParams: Promise.resolve(q) }))

describe('/w/[slug]/projects v1(스펙 §6.2)', () => {
  it('행 목록이 기본 — ☆·이름·상태 칩·기간·진척 열, 히어로·hover 이동 없음', async () => {
    const html = await render()
    expect(html).toContain('<table'); for (const th of ['즐겨찾기', '이름', '상태', '기간', '진척']) expect(html).toContain(th)
    expect(html).toContain('완료 1/4'); expect(html).not.toMatch(/hero-|-translate-y/)
    expect(html.match(/<h1/g)).toHaveLength(1)
  })
  it('카드 보기는 계정 선호 projectsView=cards', async () => {
    h.acc.mockResolvedValue({ projectsView: 'cards' })
    const html = await render()
    expect(html).not.toContain('<table'); expect(html).toContain('data-project-card')
  })
  it('검색·상태·즐겨찾기만은 서버 쿼리로 로더에', async () => {
    await render({ q: 'ac%', status: 'overdue', fav: '1' })
    expect(h.rows).toHaveBeenCalledWith(WS.id, member, { q: 'ac%', status: 'overdue', favoritesOnly: true, cursor: null, limit: 50, t: expect.any(Function) })   // t — 현황 사유 한 줄의 화면 언어
  })
  it('모르는 상태 값은 무시한다', async () => {
    await render({ status: 'bogus' })
    expect(h.rows).toHaveBeenCalledWith(WS.id, member, expect.objectContaining({ status: undefined }))
  })
  it('50행을 넘으면 더 보기 — 다른 쿼리를 지킨다', async () => {
    h.rows.mockResolvedValue({ ok: true, rows: [row('00000000-0000-0000-7e57-000000001861')], nextCursor: 'c1' })
    const html = await render({ q: 'a', fav: '1' })
    expect(html).toMatch(/href="\/w\/acme\/projects\?q=a&amp;fav=1&amp;cursor=c1"/)
  })
  it('생성은 워크스페이스 관리자에게만, ?new=1 이면 열린 채로', async () => {
    expect(await render()).not.toContain('data-new-project')
    h.scope.mockResolvedValue({ ws: WS, actor: admin, degraded: false, role: 'admin' })
    expect(await render({ new: '1' })).toContain('data-open="true"')
  })
  it('조회 실패는 화면 상태(0건으로 그리지 않는다), 거른 결과 0건과 전체 0건은 다른 문구', async () => {
    h.rows.mockResolvedValue({ ok: false, error: 'down' }); expect(await render()).toContain('data-status-kind="partial_error"')
    h.rows.mockResolvedValue({ ok: true, rows: [], nextCursor: null })
    expect(await render({ q: 'zzz' })).toContain('조건에 맞는 프로젝트가 없습니다')
    expect(await render()).toContain('아직 프로젝트가 없습니다')
  })
  it('열화(actor null) — 로더를 부르지 않는다', async () => {
    h.scope.mockResolvedValue({ ws: WS, actor: null, degraded: true, role: null })
    await render(); expect(h.rows).not.toHaveBeenCalled()
  })
})


describe('프로젝트 목록의 실패 경계', () => {
  it('소속 없음은 프로젝트/설정을 읽기 전에 닫힌다', async () => {
    h.scope.mockRejectedValue(new Error('404'))
    await expect(render()).rejects.toThrow('404')
    expect(h.rows).not.toHaveBeenCalled(); expect(h.wsp).not.toHaveBeenCalled()
  })
  it('워크스페이스 시간대 손상은 기존 설정 오류 화면을 보존한다', async () => {
    h.zone.mockResolvedValue({ ok: false, error: 'CONFIG_INVALID', key: 'calendar.timezone' })
    expect(await render()).toContain('calendar.timezone')
    expect(h.rows).not.toHaveBeenCalled()
  })
  it('즐겨찾기 선행 조회 실패는 목록을 유지하되 조작은 막는다', async () => {
    h.wsp.mockRejectedValue(new Error('down'))
    const html = await render()
    expect(h.wsp).toHaveBeenCalledWith(WS.id, { strict: true })
    expect(html).toContain('<table'); expect(html).toContain('즐겨찾기를 불러오지 못했습니다')
    expect(html).toContain('aria-disabled="true"')
  })
  it('복사 후보는 50행 쪽 나눔과 독립이며 실패하면 생성 제한을 알린다', async () => {
    const { listWorkspaceProjects } = await import('@/lib/data/portal')
    h.scope.mockResolvedValue({ ws: WS, actor: admin, degraded: false, role: 'admin' })
    vi.mocked(listWorkspaceProjects).mockResolvedValueOnce({ ok: false, error: 'down' })
    const html = await render()
    expect(listWorkspaceProjects).toHaveBeenCalledWith(WS.id, admin)
    expect(html).toContain('빈 프로젝트로만 만들 수 있습니다'); expect(html).toContain('data-new-project')
  })
})
