// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/components/providers/LocaleProvider', async () => {
  const { t } = await import('@/lib/i18n/dict')
  const ko = (k: string) => t('ko', k as Parameters<typeof t>[1])   // 렌더마다 같은 함수(effect 의존성 안정)
  return { useLocale: () => ({ locale: 'ko', t: ko, setLocale: () => {} }) }
})

const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/w/acme/my-work',
}))

vi.mock('@/components/app/ShellStateProvider', () => ({
  useShellState: () => ({
    inbox: [
      {
        recipientId: 'r-1',
        title: '신규 검토 요청',
        detail: '1.1 설계 작업 승인 대기',
        read: false,
        seen: false,
        href: '/p/p1/agents',
      },
    ],
    setInbox: vi.fn(),
    inboxLoading: false,
    inboxFailed: false,
    notifs: [],
    setNotifs: vi.fn(),
    notifLoading: false,
  }),
}))

vi.mock('@/app/actions/inbox', () => ({
  markInboxItemRead: vi.fn(async () => ({ ok: true })),
  markAllInboxRead: vi.fn(async () => ({ ok: true })),
}))

import { MyWorkTabNav, MyWorkInboxView } from '@/components/portal/MyWorkTabs'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.clearAllMocks()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

describe('MyWorkTabNav & MyWorkInboxView (개정 §5.9.1, SPU2)', () => {
  it('MyWorkTabNav는 3단 탭을 렌더링하고 활성 탭에 aria-selected=true를 부여한다', async () => {
    await act(async () => {
      root.render(
        <MyWorkTabNav
          slug="acme"
          currentTab="review"
          reviewCount={3}
        />
      )
    })

    const tabs = document.querySelectorAll('[role="tab"]')
    expect(tabs).toHaveLength(3)

    const workTab = tabs[0]
    const reviewTab = tabs[1]
    const inboxTab = tabs[2]

    expect(workTab.textContent).toContain('내 작업')
    expect(workTab.getAttribute('aria-selected')).toBe('false')

    expect(reviewTab.textContent).toContain('검토 대기')
    expect(reviewTab.textContent).toContain('3') // 뱃지 수치
    expect(reviewTab.getAttribute('aria-selected')).toBe('true')

    expect(inboxTab.textContent).toContain('알림')
    expect(inboxTab.getAttribute('aria-selected')).toBe('false')
  })

  it('MyWorkInboxView는 알림 목록을 렌더링한다', async () => {
    await act(async () => {
      root.render(<MyWorkInboxView />)
    })

    const text = container.textContent
    expect(text).toContain('신규 검토 요청')
    expect(text).toContain('1.1 설계 작업 승인 대기')
  })
})
