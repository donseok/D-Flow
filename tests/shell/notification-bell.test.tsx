// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from './_dom'
const h = vi.hoisted(() => ({
  scope: null as null | { projectId: string | null },
  inbox: [] as { recipientId: string; seen: boolean; read: boolean; title: string; href: string | null }[],
  setInbox: vi.fn(), setNotifs: vi.fn(), seen: vi.fn(async () => ({ ok: true })),
  ann: 4 as number | null,
}))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ t: (k: string) => k }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/app/actions/notifications', () => ({ markAllNotificationsRead: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/app/actions/inbox', () => ({ markInboxSeen: h.seen, markAllInboxRead: vi.fn(async () => ({ ok: true })), markInboxItemRead: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/components/app/ShellScope', () => ({ useShellScope: () => h.scope }))
vi.mock('@/components/app/ShellStateProvider', () => ({
  useShellState: () => ({ inbox: h.inbox, setInbox: h.setInbox, inboxLoading: false, inboxFailed: false, notifs: [], setNotifs: h.setNotifs, notifLoading: false,
    badges: { myWorkReview: null, projectApprovals: null, projectUnreadAnnouncements: h.ann } }),
}))
import { NotificationBell } from '@/components/app/NotificationBell'

beforeEach(() => { vi.clearAllMocks(); h.scope = null; h.ann = 4; h.inbox = [{ recipientId: 'r1', seen: false, read: false, title: '알림', href: null }] })
const badge = () => document.querySelector('[data-bell-badge]')?.textContent ?? null

describe('NotificationBell', () => {
  it('프로젝트 밖이면 공지 안읽음을 합산하지 않는다(범위 없음 = 모름)', () => {
    render(<NotificationBell />)
    expect(badge()).toBe('1')
  })
  it('프로젝트 범위면 개인 unseen + 공지 안읽음', () => {
    h.scope = { projectId: 'p1' }
    render(<NotificationBell />)
    expect(badge()).toBe('5')
  })
  it('열면 seen 소등을 낙관 반영하고 패널에 초점, Esc 로 닫히고 벨로 초점', () => {
    render(<NotificationBell />)
    const bell = screen.getByRole('button', { name: 'chrome.notifications' })
    fireEvent.click(bell)
    expect(h.setInbox).toHaveBeenCalled(); expect(h.seen).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull(); expect(document.activeElement).toBe(bell)
  })
  it('새 계약 — 공지 안읽음은 badges.projectUnreadAnnouncements, 모르면(null) 합산에서 빼고 패널은 빈 상태라고 하지 않는다', () => {
    h.scope = { projectId: 'p1' }; h.ann = null; h.inbox = []
    render(<NotificationBell />)
    expect(badge()).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'chrome.notifications' }))
    const panel = screen.getByRole('dialog').textContent ?? ''
    expect(panel).toContain('inbox.announcementsUnknown'); expect(panel).not.toContain('inbox.empty')
  })
})
