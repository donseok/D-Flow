// @vitest-environment jsdom
// 사이드바 어포던스 — '+ 새 프로젝트' 는 생성 권한자(워크스페이스 관리자·플랫폼 관리자)에게만,
// 홈은 현재 위치 표시(aria-current)를 달고, '/projects' 로 가는 메뉴 링크는 홈 하나뿐이다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('next/navigation', () => ({
  usePathname: () => '/projects',
  useRouter: () => ({ push: vi.fn() }),
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ t: (k: string) => k }) }))
vi.mock('@/lib/prefs/debouncedSave', () => ({ queueUiPref: vi.fn() }))
// 실시간 구독은 향상 계층 — 테스트 대상 아님(supabase 클라이언트 생성을 피한다).
vi.mock('@/lib/hooks/useInboxRealtime', () => ({ useInboxRealtime: () => {} }))

import { Sidebar, SIDEBAR_TOGGLE_EVENT } from '@/components/app/Sidebar'
import { ProjectNavigationProvider } from '@/components/app/ProjectNavigationContext'
import { ShellStateProvider } from '@/components/app/ShellStateProvider'

describe('Sidebar 어포던스', () => {
  let container: HTMLDivElement, root: Root
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        inbox: { items: [], unseen: 0 },
        notifications: { items: [], count: 0 },
        unreadAnnouncements: 0,
        headerAnnouncements: [],
      }),
    })))
  })
  afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals() })

  async function mount(props: { canCreateProject?: boolean } = {}, collapsed = false) {
    await act(async () => root.render(
      <ProjectNavigationProvider projects={[]}>
        <ShellStateProvider>
          <Sidebar projects={[]} {...props} />
        </ShellStateProvider>
      </ProjectNavigationProvider>,
    ))
    await act(async () => {}) // /api/shell 응답 flush
    if (collapsed) {
      await act(async () => { window.dispatchEvent(new CustomEvent(SIDEBAR_TOGGLE_EVENT, { detail: { collapsed: true } })) })
    }
  }

  const newProjectLink = () => container.querySelector('a[aria-label="common.newProject"]')

  it.each([false, true])('생성 권한이 없으면(멤버·degraded — prop 생략) \'+ 새 프로젝트\' 가 없다 — 접힘 %s', async collapsed => {
    await mount({}, collapsed)
    expect(newProjectLink()).toBeNull()
  })

  it.each([false, true])('생성 권한이 있으면 \'+ 새 프로젝트\' 가 있다 — 접힘 %s', async collapsed => {
    await mount({ canCreateProject: true }, collapsed)
    expect(newProjectLink()).not.toBeNull()
  })

  it('/projects 에서 홈 링크 하나만 aria-current="page" 다', async () => {
    await mount()
    const current = container.querySelectorAll('a[aria-current]')
    expect(current).toHaveLength(1)
    expect(current[0].getAttribute('aria-current')).toBe('page')
    expect(current[0].getAttribute('href')).toBe('/projects')
    expect(current[0].textContent).toContain('nav.home')
  })

  it("'/projects' 로 가는 메뉴 링크는 홈 하나다 — '전체 프로젝트' 중복 없음", async () => {
    await mount({ canCreateProject: true })
    const sideLinks = [...container.querySelectorAll<HTMLAnchorElement>('a.side-link[href="/projects"]')]
    expect(sideLinks).toHaveLength(1)
    expect(sideLinks[0].textContent).toContain('nav.home')
    expect(container.textContent).not.toContain('nav.allProjects')
  })
})
