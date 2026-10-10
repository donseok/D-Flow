// @vitest-environment jsdom
// 옛 tests/ui/header-chrome-inbox.test.tsx 의 케이스를 새 셸로 옮김(과제 31 처리표) — 벨 + 진짜 ShellStateProvider(/api/shell 새 계약) 통합.
// 배지 합산(개인 unseen + 파생 안읽음 + 프로젝트 공지 안읽음), 벨 열람 = seen 소등(항목 read 와 별개), seen 저장 실패면 복원.
import { act } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from './_dom'

const h = vi.hoisted(() => ({
  pathname: '/p/p1/dashboard',
  scope: { workspace: { id: 'w1', slug: 'acme' }, projectId: 'p1' } as { workspace: { id: string; slug: string } | null; projectId: string | null },
  markInboxSeen: vi.fn(async () => ({ ok: true })), markAllInboxRead: vi.fn(async () => ({ ok: true })), markInboxItemRead: vi.fn(async () => ({ ok: true })),
}))
vi.mock('next/navigation', () => ({ usePathname: () => h.pathname, useRouter: () => ({ push: vi.fn() }) }))
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ t: (k: string) => k }) }))
vi.mock('@/app/actions/notifications', () => ({ markAllNotificationsRead: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/app/actions/inbox', () => ({ markInboxSeen: h.markInboxSeen, markAllInboxRead: h.markAllInboxRead, markInboxItemRead: h.markInboxItemRead }))
vi.mock('@/lib/hooks/useInboxRealtime', () => ({ useInboxRealtime: () => {} }))
vi.mock('@/components/app/ShellScope', () => ({ useShellScope: () => h.scope }))

import { NotificationBell } from '@/components/app/NotificationBell'
import { ShellStateProvider } from '@/components/app/ShellStateProvider'

const payload = () => ({
  inbox: { items: [{ recipientId: 'r1', type: 'issue.assigned', category: 'issue', title: '이슈 A', detail: null, href: '/p/p1/issues', createdAt: '2026-08-11', seen: false, read: false }], unseen: 1 },
  notifications: { items: [{ id: 'n1', type: 'delayed', severity: 'danger', title: '지연 항목', detail: 'd', read: false }], count: 1 },
  badges: { myWorkReview: null, projectApprovals: 0, projectUnreadAnnouncements: 2 },
})
const bell = () => document.querySelector<HTMLButtonElement>('button[aria-label="chrome.notifications"]')!
async function mount() { render(<ShellStateProvider><NotificationBell /></ShellStateProvider>); await act(() => new Promise<void>((r) => setTimeout(r, 10))) }

beforeEach(() => {
  vi.clearAllMocks(); h.pathname = '/p/p1/dashboard'; h.scope = { workspace: { id: 'w1', slug: 'acme' }, projectId: 'p1' }
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => payload() })))
})

describe('벨 + 셸 상태(새 계약)', () => {
  it('배지는 개인 unseen + 파생 안읽음 + 공지 안읽음(1+1+2=4)', async () => {
    await mount()
    expect(bell().textContent).toContain('4')
  })
  it('벨을 열면 seen 소등을 낙관 반영하고 markInboxSeen — 항목은 패널에 그대로', async () => {
    await mount()
    await act(async () => { bell().click() })
    expect(h.markInboxSeen).toHaveBeenCalledTimes(1)
    expect(bell().textContent).toContain('3')
    expect(document.body.textContent).toContain('이슈 A')
  })
  it('markInboxSeen 실패({ok:false})면 낙관 반영을 되돌린다', async () => {
    h.markInboxSeen.mockResolvedValueOnce({ ok: false })
    await mount()
    await act(async () => { bell().click() })
    expect(bell().textContent).toContain('4')
  })
  it('워크스페이스 범위(프로젝트 없음)면 공지 안읽음을 합산하지 않는다', async () => {
    h.scope = { workspace: { id: 'w1', slug: 'acme' }, projectId: null }; h.pathname = '/w/acme'
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ...payload(), notifications: null, badges: { myWorkReview: 0, projectApprovals: null, projectUnreadAnnouncements: null } }) })))
    await mount()
    expect(bell().textContent).toContain('1')
  })
})
