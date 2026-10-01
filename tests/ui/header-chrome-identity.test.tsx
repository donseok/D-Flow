// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  pathname: '/p/p1/dashboard',
  routerPush: vi.fn(),
  routerReplace: vi.fn(),
  routerRefresh: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({
    push: mocks.routerPush,
    replace: mocks.routerReplace,
    refresh: mocks.routerRefresh,
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
  useLocale: () => ({
    locale: 'ko',
    setLocale: vi.fn(),
    t: (key: string) => ({
      'nav.minutes': '회의록',
      'nav.myMeetings': '내 회의',
      'nav.workspace': '워크스페이스',
      'common.selectProject': '프로젝트 선택',
      'common.noProjects': '프로젝트 없음',
      'brand.tagline': '일하는 방식이 바뀐다',
      'chrome.theme': '화면 테마',
      'chrome.themeSystem': '시스템',
      'chrome.themeLight': '라이트',
      'chrome.themeDark': '다크',
    } as Record<string, string>)[key] ?? key,
  }),
}))
// 조회는 ShellStateProvider 의 /api/shell fetch 스텁이 맡는다 — 액션 목은 뮤테이션만.
vi.mock('@/app/actions/notifications', () => ({
  markAllNotificationsRead: vi.fn(async () => ({ ok: true })),
}))
vi.mock('@/app/actions/inbox', () => ({
  markInboxSeen: vi.fn(async () => ({ ok: true })),
  markAllInboxRead: vi.fn(async () => ({ ok: true })),
  markInboxItemRead: vi.fn(async () => ({ ok: true })),
}))
vi.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => ({ auth: { signOut: vi.fn() } }),
}))
// 실시간 구독은 향상 계층 — 테스트 대상 아님(supabase 채널 배선을 피한다).
vi.mock('@/lib/hooks/useInboxRealtime', () => ({ useInboxRealtime: () => {} }))
vi.mock('@/components/app/HeaderAnnouncementTicker', () => ({
  HeaderAnnouncementTicker: () => null,
}))
vi.mock('@/components/account/ChangePasswordModal', () => ({
  ChangePasswordModal: () => null,
}))
vi.mock('@/lib/prefs/debouncedSave', () => ({
  queueUiPref: vi.fn(),
}))

import { HeaderChrome, type HeaderIdentity } from '@/components/app/HeaderChrome'
import { ProjectNavigationProvider } from '@/components/app/ProjectNavigationContext'
import { ShellStateProvider } from '@/components/app/ShellStateProvider'

const projects = [{ id: 'p1', name: 'Acme 프로젝트', status: 'active' as const }]

function identity(teamCodes: string[] | null, roleLabel = '멤버'): HeaderIdentity {
  return { roleLabel, teamCodes, isSuperuser: false, showUsage: false, showPortfolio: false }
}

// 소속은 명단 대표 팀 목록(identity.teamCodes) — 0팀 '소속 미지정', 1팀 그 code, n팀 '첫 팀 외 n-1'.
describe('HeaderChrome 소속 표시', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
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
  })

  async function render(teamCodes: string[] | null, userName: string | null, roleLabel = '멤버') {
    await act(async () => root.render(
      <ProjectNavigationProvider projects={projects} initialLastProjectId="p1">
        <ShellStateProvider>
          <HeaderChrome identity={identity(teamCodes, roleLabel)} projects={projects} userName={userName} />
        </ShellStateProvider>
      </ProjectNavigationProvider>,
    ))
    await act(async () => {}) // /api/shell 응답 flush
  }

  const profileTrigger = () => container.querySelector<HTMLButtonElement>('[data-profile-trigger]')!

  async function profileSubtitle() {
    await act(async () => profileTrigger().click())
    return container.querySelector<HTMLElement>('[data-profile-subtitle]')!
  }

  async function mobileCardText() {
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="메뉴 열기"]')!.click())
    return container.querySelector<HTMLElement>('[data-identity-card]')!.textContent
  }

  it('프로필 팝오버에 화면 테마 3단(결정 #21) — 전역 바에는 테마·언어 버튼이 없다', async () => {
    await render(['PMO'], null)
    expect(container.querySelector('button[title="Language"]')).toBeNull()
    await act(async () => profileTrigger().click())
    const group = container.querySelector('[data-theme-section] [role="radiogroup"]')!
    expect([...group.querySelectorAll('[role="radio"]')].map((r) => r.textContent)).toEqual(['시스템', '라이트', '다크'])
  })

  it.each([
    [[], '소속 미지정'],
    [['PMO'], 'PMO'],
    [['DEV', 'PMO', 'QA'], 'DEV 외 2'],
  ])('이름이 없으면 프로필 버튼 부제·팝오버가 소속 %j 을 %s 로 보여 준다', async (codes, label) => {
    await render(codes, null)
    expect(profileTrigger().textContent).toBe(`멤버${label}`)
    expect((await profileSubtitle()).textContent).toBe(label)
  })

  it.each([
    [[], '멤버'],
    [['PMO'], '멤버 · PMO'],
    [['DEV', 'PMO'], '멤버 · DEV 외 1'],
  ])('이름이 있으면 팝오버 부제가 역할·소속 %j 을 %s 로 보여 준다(0팀은 역할만)', async (codes, text) => {
    await render(codes, 'Alice')
    expect(profileTrigger().textContent).toBe('Alice멤버')
    expect((await profileSubtitle()).textContent).toBe(text)
  })

  it('2팀 이상이면 팝오버 부제에 전체 팀 목록을 title 로 단다', async () => {
    await render(['DEV', 'PMO'], 'Alice')
    expect((await profileSubtitle()).getAttribute('title')).toBe('DEV, PMO')
  })

  it.each([
    [[], 'Alice', 'Alice멤버'],
    [['PMO'], 'Alice', 'Alice멤버 · PMO'],
    [['DEV', 'PMO'], null, '멤버DEV 외 1'],
  ])('모바일 메뉴 신원 카드가 소속 %j 을 표시한다', async (codes, name, text) => {
    await render(codes, name)
    expect(await mobileCardText()).toBe(text)
  })

  // 에러 처리 3원칙 ① — 권한을 못 읽은(degraded) 화면은 소속을 모른다. '소속 미지정'으로 주장하지 않는다.
  it('teamCodes 가 null(확인 불가)이면 소속을 — 로 두고 미지정이라 말하지 않는다', async () => {
    await render(null, null, '확인 불가')
    expect(profileTrigger().textContent).toBe('확인 불가—')
    expect((await profileSubtitle()).textContent).toBe('—')
    expect(container.textContent).not.toContain('소속 미지정')
  })

  it('teamCodes 가 null 이면 이름이 있어도 팝오버·모바일 카드는 역할만 보여 준다', async () => {
    await render(null, 'Alice', '확인 불가')
    expect((await profileSubtitle()).textContent).toBe('확인 불가')
    await act(async () => profileTrigger().click())
    expect(await mobileCardText()).toBe('Alice확인 불가')
  })
})
