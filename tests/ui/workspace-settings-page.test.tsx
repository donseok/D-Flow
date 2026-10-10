import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CAL_FIELDS_UTC_SUN } from '../helpers/calendarFixture'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement, ReactNode } from 'react'

const h = vi.hoisted(() => ({
  access: vi.fn(), config: vi.fn(), history: vi.fn(), events: vi.fn(),
  eventsList: vi.fn<(p: Record<string, unknown>) => null>(() => null),
  allowEditor: vi.fn<(p: Record<string, unknown>) => ReactNode>(() => <div id="mock-allow-editor" />),
  attEditor: vi.fn<(p: Record<string, unknown>) => ReactNode>(() => null),
  rootEditor: vi.fn<(p: Record<string, unknown>) => ReactNode>(() => null),
  shell: vi.fn<(p: { items: { id: string; label: string }[]; children: ReactNode }) => ReactNode>(({ children }) => <>{children}</>),
  redirect: vi.fn((to: string): never => { throw new Error(`NEXT_REDIRECT ${to}`) }),
  calendarPanel: vi.fn<(p: Record<string, unknown>) => null>(() => null),
  widgetsEditor: vi.fn<(p: Record<string, unknown>) => null>(() => null),
  draftsEditor: vi.fn<(p: Record<string, unknown>) => null>(() => null),
  notifyEditor: vi.fn<(p: Record<string, unknown>) => null>(() => null),
}))
vi.mock('@/lib/settings/workspacePageAccess', () => ({ workspacePageAccess: (...a: unknown[]) => h.access(...a) }))
vi.mock('@/lib/settings/workspaceConfig', () => ({ getWorkspaceConfig: (...a: unknown[]) => h.config(...a) }))
vi.mock('@/app/actions/settings', () => ({ listSettingsHistory: (...a: unknown[]) => h.history(...a) }))
vi.mock('@/app/actions/authzEvents', () => ({ listAuthzEvents: (...a: unknown[]) => h.events(...a) }))
vi.mock('@/components/settings/AuthzEventsList', () => ({ AuthzEventsList: (p: Record<string, unknown>) => h.eventsList(p) }))
vi.mock('next/navigation', () => ({ redirect: h.redirect }))
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }))
vi.mock('@/components/ui/SectionCard', () => ({ SectionCard: ({ id, children }: { id: string; children: ReactNode }) => <section id={id}>{children}</section> }))
vi.mock('@/components/settings/SettingsShell', () => ({ SettingsShell: (p: { items: { id: string; label: string }[]; children: ReactNode }) => h.shell(p) }))
vi.mock('@/components/settings/ModuleAllowEditor', () => ({ ModuleAllowEditor: h.allowEditor }))
vi.mock('@/components/settings/WorkspaceFieldsEditor', () => ({ WorkspaceFieldsEditor: () => null }))
vi.mock('@/components/settings/LogoEditor', () => ({ LogoEditor: () => null }))
vi.mock('@/components/settings/WorkspaceNameEditor', () => ({
  WorkspaceNameEditor: (p: { workspaceId: string; slug: string; initialName: string }) => <div data-name-editor={`${p.workspaceId}|${p.slug}|${p.initialName}`} />,
}))
vi.mock('@/components/settings/AccentEditor', () => ({ AccentEditor: () => null }))
vi.mock('@/components/settings/MenuOrderEditor', () => ({ MenuOrderEditor: () => null }))
vi.mock('@/components/settings/PortalWidgetsEditor', () => ({ PortalWidgetsEditor: (p: Record<string, unknown>) => h.widgetsEditor(p) }))
vi.mock('@/components/settings/LocalDraftsEditor', () => ({ LocalDraftsEditor: (p: Record<string, unknown>) => h.draftsEditor(p) }))
vi.mock('@/components/settings/NotifyPolicyEditor', () => ({ NotifyPolicyEditor: (p: Record<string, unknown>) => h.notifyEditor(p) }))
vi.mock('@/components/settings/SettingsHistoryList', () => ({ SettingsHistoryList: () => null }))
vi.mock('@/components/settings/AttachmentPolicyEditor', () => ({ AttachmentPolicyEditor: (p: Record<string, unknown>) => h.attEditor(p) }))
vi.mock('@/components/settings/RootFoldersEditor', () => ({ RootFoldersEditor: (p: Record<string, unknown>) => h.rootEditor(p) }))
vi.mock('@/components/settings/CalendarSettingsPanel', () => ({ CalendarSettingsPanel: (p: Record<string, unknown>) => h.calendarPanel(p) }))
vi.mock('@/components/settings/ConfigLoadError', () => ({ ConfigLoadError: ({ error }: { error: string }) => <p data-load-error>{error}</p> }))

import WorkspaceSettingsPage from '@/app/(app)/w/[slug]/settings/page'
import { ConfigUnavailableError } from '@/lib/settings/errors'
import { WORKSPACE_SETTINGS } from '@/lib/settings/registry'
import { resolveKeys } from '@/lib/settings/resolve'

const WID = '0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d'
const config = (values: Record<string, unknown> = {}) => ({
  workspaceId: WID, revision: 7, schemaVersion: 1, schemaAhead: false, unknownKeys: [], ...CAL_FIELDS_UTC_SUN,
  keys: resolveKeys({ scope: 'workspace', id: WID, values, defs: WORKSPACE_SETTINGS, env: { NODE_ENV: 'test' } }).keys,
})
const access = (over: Record<string, unknown> = {}) => ({ id: WID, slug: 'alpha', name: 'Alpha', isSuperuser: false, isAdmin: true, ...over })
const render = async () => renderToStaticMarkup((await WorkspaceSettingsPage({ params: Promise.resolve({ slug: 'alpha' }) })) as ReactElement)

beforeEach(() => {
  vi.clearAllMocks()
  h.access.mockResolvedValue(access())
  h.config.mockResolvedValue(config())
  h.history.mockResolvedValue({ ok: true, rows: [], nextBefore: null })
  h.events.mockResolvedValue({ ok: true, rows: [], nextBefore: null })
})

describe('/w/[slug]/settings 페이지', () => {
  it('머리 h1 은 사전 문구 — 조회 실패 갈래의 머리도 같다(u3-3 리뷰 P2-9)', async () => {
    expect(await render()).toMatch(/<h1[^>]*>워크스페이스 설정<\/h1>/)
    h.config.mockRejectedValueOnce(new ConfigUnavailableError('down'))
    vi.spyOn(console, 'error').mockImplementationOnce(() => {})
    expect(await render()).toMatch(/<h1[^>]*>워크스페이스 설정<\/h1>/)
  })
  it('워크스페이스 관리자가 아니면 그 워크스페이스 홈으로 돌려보내고 설정을 읽지 않는다', async () => {
    h.access.mockResolvedValue(access({ isAdmin: false }))
    await expect(render()).rejects.toThrow('NEXT_REDIRECT /w/alpha')
    expect(h.config).not.toHaveBeenCalled()
  })

  it('열 범주 목차를 스펙 순서로 낸다(달력 — SP5 과제 26, 회의록 첨부 — SP5 B3 과제 9, 회의록 폴더 — SP5 B2, 알림 — SP8 알림 정책, 보안 — SPU1 로컬 초안)', async () => {
    await render()
    expect(h.shell.mock.calls[0][0].items).toEqual([
      { id: 'workspace-general', label: '일반' }, { id: 'workspace-modules', label: '모듈·AI' },
      { id: 'workspace-invites', label: '초대' }, { id: 'workspace-calendar', label: '달력' },
      { id: 'workspace-minutes', label: '회의록' }, { id: 'workspace-minute-roots', label: '회의록 폴더' },
      { id: 'workspace-menu', label: '메뉴' }, { id: 'workspace-notify', label: '알림' }, { id: 'workspace-security', label: '보안' }, { id: 'workspace-history', label: '기록' },
    ])
  })

  it('회의록 첨부 정책 — 워크스페이스 범위·revision 으로 편집기를 그리고, 손상 값이면 복구 상태(invalid)로 넘긴다', async () => {
    await render()
    expect(h.attEditor).toHaveBeenLastCalledWith(expect.objectContaining({
      scope: { workspaceId: WID }, revision: 7, canEdit: true, invalid: false,
      policy: expect.objectContaining({ enabled: true, maxFileBytes: 20_971_520, maxCount: 10, allowedExtensions: null }),
    }))
    h.config.mockResolvedValue(config({ 'minutes.attachments': { enabled: 'yes' } }))
    await render()
    expect(h.attEditor).toHaveBeenLastCalledWith(expect.objectContaining({ policy: null, invalid: true }))
  })

  it('회의록 최상위 폴더(SP5 B2 — D21) — 되돌리기는 플랫폼 관리자만(canEdit), 손상 값은 invalid', async () => {
    await render()
    expect(h.rootEditor).toHaveBeenLastCalledWith(expect.objectContaining({ workspaceId: WID, revision: 7, value: { mode: 'teams' }, invalid: false, canEdit: false }))
    h.config.mockResolvedValue(config({ 'minutes.root_folders': { mode: 'custom', names: [] } }))
    await render()
    expect(h.rootEditor).toHaveBeenLastCalledWith(expect.objectContaining({ value: null, invalid: true }))
  })

  it('달력 절 — 워크스페이스 범위·세 키(요일은 규칙 하나로 승격)·브라우저 시간대 제안을 편집기에 넘긴다', async () => {
    h.config.mockResolvedValue(config({ 'calendar.timezone': 'Europe/Berlin', 'calendar.week_start': 'monday' }))
    await render()
    expect(h.calendarPanel).toHaveBeenCalledTimes(1)
    const p = h.calendarPanel.mock.calls[0][0]
    expect(p).toMatchObject({
      scope: { workspaceId: WID }, revision: 7, canEdit: true, suggestBrowserTimezone: true,
      timezone: { value: 'Europe/Berlin', source: 'set' },
      workingDays: { value: [1, 2, 3, 4, 5], source: 'default' },
      weekStart: { value: [{ day: 'monday', from: null }], source: 'set' },
    })
    expect(p.todayIso).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('달력 키가 손상이어도 편집기를 그린다(복구 경로) — 오늘은 모른다(null)', async () => {
    h.config.mockResolvedValue(config({ 'calendar.timezone': '+09:00' }))
    await render()
    expect(h.calendarPanel.mock.calls[0][0]).toMatchObject({ timezone: { value: null, source: 'invalid' }, todayIso: null })
  })

  it('모듈 허용 구역은 플랫폼 관리자에게만 보인다', async () => {
    await render()
    expect(h.allowEditor).not.toHaveBeenCalled()
    h.access.mockResolvedValue(access({ isSuperuser: true }))
    await render()
    expect(h.allowEditor).toHaveBeenCalledTimes(1)
    expect(h.allowEditor.mock.calls[0][0]).toMatchObject({ workspaceId: WID, revision: 7 })
  })

  it("'일반' 범주에 워크스페이스 이름 편집기 — 그 워크스페이스의 id·주소·지금 이름을 넘긴다(0055. 설정 키가 아니라 행의 이름이다)", async () => {
    const html = await render()
    expect(html).toContain(`data-name-editor="${WID}|alpha|Alpha"`)
    expect(html.indexOf('data-name-editor')).toBeGreaterThan(html.indexOf('id="workspace-general"'))
    expect(html.indexOf('data-name-editor')).toBeLessThan(html.indexOf('id="workspace-modules"'))
  })

  it('공용 팀 링크는 그 워크스페이스의 관리 화면으로 — 워크스페이스 관리자에게도 연다(SP3b D22)', async () => {
    const html = await render()
    expect(html).toContain('href="/w/alpha/admin/teams"')
    expect(html).not.toContain('href="/admin/teams"')
    h.access.mockResolvedValue(access({ isSuperuser: true }))
    expect(await render()).toContain('href="/w/alpha/admin/teams"')
  })

  it('설정 조회 실패는 404 나 빈 화면이 아니라 오류 화면이고 로그를 남긴다', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.config.mockRejectedValue(new ConfigUnavailableError('db down'))
    expect(await render()).toContain('data-load-error')
    expect(error).toHaveBeenCalledWith('[workspace settings] 설정 조회 실패:', expect.objectContaining({ workspaceId: WID }))
    error.mockRestore()
  })

  it('설정 조회 실패가 아닌 예외는 삼키지 않고 다시 던진다', async () => {
    h.config.mockRejectedValue(new Error('boom'))
    await expect(render()).rejects.toThrow('boom')
  })

  it('기록 범주에 설정 변경과 권한 변경 목록이 함께 있고, 권한 목록에는 이 워크스페이스의 첫 페이지를 넘긴다', async () => {
    h.events.mockResolvedValue({ ok: true, rows: [], nextBefore: null })
    const html = await render()
    expect(h.events).toHaveBeenCalledWith(WID)
    expect(h.eventsList).toHaveBeenCalledTimes(1)
    expect(h.eventsList.mock.calls[0][0]).toMatchObject({ workspaceId: WID, initial: { ok: true } })
    expect(html).toContain('권한 변경')
    expect(html).toContain('설정 변경')
  })

  it('권한 이력 조회가 실패해도 설정 화면은 열리고 오류가 목록 자리에 간다', async () => {
    h.events.mockResolvedValue({ ok: false, error: '권한 변경 이력을 불러오지 못했습니다.' })
    await render()
    expect(h.eventsList.mock.calls[0][0]).toMatchObject({ initial: { ok: false } })
  })

  it('메뉴 범주 안 홈 위젯 편집기 — 저장값(기본 = 레지스트리 순서 전부 켬)과 revision, 손상이면 사유를 넘긴다(SP3b UI-3 과제 6)', async () => {
    const html = await render()
    expect(html).toContain('id="workspace-portal-widgets"')
    expect(h.widgetsEditor.mock.calls[0][0]).toMatchObject({ workspaceId: WID, revision: 7, invalidReason: undefined })
    expect((h.widgetsEditor.mock.calls[0][0].initial as { id: string }[]).map((w) => w.id)).toEqual(['my_work', 'projects', 'review', 'upcoming', 'recent_docs', 'announcements'])
    h.widgetsEditor.mockClear()
    h.config.mockResolvedValue(config({ 'portal.widgets': 'oops' }))
    await render()
    expect(h.widgetsEditor.mock.calls[0][0]).toMatchObject({ initial: null })
    expect(typeof h.widgetsEditor.mock.calls[0][0].invalidReason).toBe('string')
  })

  it('보안 범주의 로컬 초안 편집기 — 저장값(기본 = 허용·7일)과 revision, 손상이면 사유를 넘긴다(SPU1, 개정 §5.8.5)', async () => {
    h.draftsEditor.mockClear()
    const html = await render()
    expect(html).toContain('id="workspace-security"')
    expect(h.draftsEditor.mock.calls[0][0]).toEqual({ workspaceId: WID, revision: 7, initial: { allowed: true, retention_days: 7 }, invalidReason: undefined })
    h.draftsEditor.mockClear()
    h.config.mockResolvedValue(config({ 'security.local_drafts': { allowed: false, retention_days: 14 } }))
    await render()
    expect(h.draftsEditor.mock.calls[0][0]).toMatchObject({ initial: { allowed: false, retention_days: 14 } })
    h.draftsEditor.mockClear()
    h.config.mockResolvedValue(config({ 'security.local_drafts': { allowed: 'yes', retention_days: 7 } }))
    await render()
    expect(h.draftsEditor.mock.calls[0][0]).toMatchObject({ initial: null, invalidReason: 'allowed 는 불리언이어야 합니다.' })
  })

  it('알림 범주의 알림 정책 편집기 — 저장값(기본 = {} 전부 켬)과 revision, 손상이면 사유를 넘긴다(SP8, 개정 §4.10)', async () => {
    h.notifyEditor.mockClear()
    const html = await render()
    expect(html).toContain('id="workspace-notify"')
    expect(h.notifyEditor.mock.calls[0][0]).toEqual({ workspaceId: WID, revision: 7, initial: {}, invalidReason: undefined })
    h.notifyEditor.mockClear()
    h.config.mockResolvedValue(config({ 'notify.policy': { 'issue.update': { enabled: false } } }))
    await render()
    expect(h.notifyEditor.mock.calls[0][0]).toMatchObject({ initial: { 'issue.update': { enabled: false } } })
    h.notifyEditor.mockClear()
    h.config.mockResolvedValue(config({ 'notify.policy': { 'work.reported': { enabled: false } } }))
    await render()
    expect(h.notifyEditor.mock.calls[0][0]).toMatchObject({ initial: null, invalidReason: '필수 알림은 끌 수 없습니다: work.reported' })
  })
})
