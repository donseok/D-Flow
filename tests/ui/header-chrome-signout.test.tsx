// @vitest-environment jsdom
// 로그아웃 = 이 브라우저의 위키 초안 정리 — 공용 PC 에서 다음 사용자에게 초안이 남지 않게.
// 초안은 세션을 끊기 **전에** 지운다(signOut 이 실패·지연돼도 초안은 이미 없다).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  draftsAtSignOut: [] as string[],
  signOut: vi.fn(),
  routerReplace: vi.fn(),
  routerRefresh: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/p/p1/wiki',
  useRouter: () => ({
    push: vi.fn(),
    replace: (...a: unknown[]) => { mocks.calls.push('replace'); mocks.routerReplace(...a) },
    refresh: () => { mocks.calls.push('refresh'); mocks.routerRefresh() },
  }),
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}))
vi.mock('@/components/providers/ThemeProvider', () => ({
  useTheme: () => ({ preference: null, resolved: 'light', ready: true, setPreference: vi.fn() }),
}))
vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ locale: 'ko', setLocale: vi.fn(), t: (key: string) => key }),
}))
vi.mock('@/app/actions/notifications', () => ({
  markAllNotificationsRead: vi.fn(async () => ({ ok: true })),
}))
vi.mock('@/app/actions/inbox', () => ({
  markInboxSeen: vi.fn(async () => ({ ok: true })),
  markAllInboxRead: vi.fn(async () => ({ ok: true })),
  markInboxItemRead: vi.fn(async () => ({ ok: true })),
}))
vi.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => ({ auth: { signOut: mocks.signOut } }),
}))
vi.mock('@/lib/hooks/useInboxRealtime', () => ({ useInboxRealtime: () => {} }))
vi.mock('@/components/app/HeaderAnnouncementTicker', () => ({
  HeaderAnnouncementTicker: () => null,
}))
vi.mock('@/components/account/ChangePasswordModal', () => ({
  ChangePasswordModal: () => null,
}))
vi.mock('@/lib/prefs/debouncedSave', () => ({ queueUiPref: vi.fn() }))

import { HeaderChrome } from '@/components/app/HeaderChrome'
import { ProjectNavigationProvider } from '@/components/app/ProjectNavigationContext'
import { ShellStateProvider } from '@/components/app/ShellStateProvider'

const projects = [{ id: 'p1', name: 'Acme 프로젝트', status: 'active' as const }]
const identity = { roleLabel: '멤버', teamCodes: [], isSuperuser: false, showUsage: false, showPortfolio: false }

describe('HeaderChrome 로그아웃', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    mocks.calls.length = 0
    mocks.draftsAtSignOut.length = 0
    mocks.signOut.mockReset()
    mocks.signOut.mockImplementation(async () => {
      mocks.calls.push('signOut')
      // signOut 시점에 남아 있는 초안 키 — 순서 계약(초안 정리가 먼저)의 증거
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k?.startsWith('wiki-draft:')) mocks.draftsAtSignOut.push(k)
      }
      return { error: null }
    })
    localStorage.clear()
    localStorage.setItem('wiki-draft:v2:u1:p1:t1', '{"body":"새 초안"}')
    localStorage.setItem('wiki-draft:p1:t1', '{"body":"옛 초안"}')
    localStorage.setItem('other', 'keep')
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        inbox: { items: [], unseen: 0 },
        notifications: { items: [], count: 0 },
        unreadAnnouncements: 0,
        headerAnnouncements: [],
      }),
    })))
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  async function clickLogout() {
    await act(async () => root.render(
      <ProjectNavigationProvider projects={projects} initialLastProjectId="p1">
        <ShellStateProvider>
          <HeaderChrome identity={identity} projects={projects} userName="alice" />
        </ShellStateProvider>
      </ProjectNavigationProvider>,
    ))
    await act(async () => {}) // /api/shell 응답 flush
    await act(async () => container.querySelector<HTMLButtonElement>('[data-profile-trigger]')!.click())
    const logout = [...container.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.includes('chrome.logout'))
    expect(logout).toBeDefined()
    await act(async () => logout!.click())
  }

  it('위키 초안(새·옛 키)을 지우고 다른 키는 남긴 뒤 세션을 끊는다', async () => {
    await clickLogout()
    expect(localStorage.getItem('wiki-draft:v2:u1:p1:t1')).toBeNull()
    expect(localStorage.getItem('wiki-draft:p1:t1')).toBeNull()
    expect(localStorage.getItem('other')).toBe('keep')
    expect(mocks.signOut).toHaveBeenCalledTimes(1)
    expect(mocks.draftsAtSignOut).toEqual([])
    expect(mocks.calls).toEqual(['signOut', 'replace', 'refresh'])
    expect(mocks.routerReplace).toHaveBeenCalledWith('/login')
  })

  it('저장소 접근이 throw 해도 로그아웃은 진행한다', async () => {
    mocks.signOut.mockImplementation(async () => ({ error: null }))
    const spy = vi.spyOn(Storage.prototype, 'key').mockImplementation(() => { throw new Error('SecurityError') })
    try {
      await clickLogout()
    } finally {
      spy.mockRestore()
    }
    expect(mocks.signOut).toHaveBeenCalledTimes(1)
    expect(mocks.routerReplace).toHaveBeenCalledWith('/login')
  })
})
