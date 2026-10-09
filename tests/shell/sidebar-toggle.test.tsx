// @vitest-environment jsdom
// AA2 — 사이드바 접기 토글(옛 Sidebar 의 PanelLeft 토글 복구). 계정 키 sidebarCollapsed 를 쓰는 사용자 경로다(§5.4.2) — 1024~1279 기본 64px 레일을
// 펼칠 수 있어야 한다. 선호 없음(null)이면 지금 보이는 상태(1280 이상 = 펼침)의 반대로 명시 선호를 쓴다.
// AA5(충실도 리뷰 P3-7) — 레일 바깥은 이름 없는 <aside>(complementary 랜드마크)가 아니라 <div>, 랜드마크는 이름 있는 <nav> 하나.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render } from './_dom'
vi.mock('@/components/providers/LocaleProvider', async () => (await import('../helpers/locale-mock')).movedKoLocale())
import { SideRail } from '@/components/app/NavList'
import { renderToString } from 'react-dom/server'

const mq = (xl: boolean) => vi.stubGlobal('matchMedia', vi.fn((q: string) => ({ matches: /min-width:\s*1280px/.test(q) ? xl : false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
afterEach(() => vi.unstubAllGlobals())
const toggle = () => document.querySelector('[data-sidebar-toggle]') as HTMLButtonElement | null

describe('SideRail 접기 토글(AA2)', () => {
  it('setter 가 없으면 토글을 그리지 않는다', () => {
    mq(true); render(<SideRail collapsed={false} label="워크스페이스">x</SideRail>)
    expect(toggle()).toBeNull()
  })
  it('명시 펼침 → "사이드바 접기"·aria-expanded=true, 누르면 접힘(true) 저장', () => {
    mq(true); const on = vi.fn()
    render(<SideRail collapsed={false} label="워크스페이스" onToggleCollapsed={on}>x</SideRail>)
    expect(toggle()!.getAttribute('aria-expanded')).toBe('true'); expect(toggle()!.getAttribute('aria-label')).toBe('사이드바 접기')
    fireEvent.click(toggle()!); expect(on).toHaveBeenCalledWith(true)
  })
  it('명시 접힘 → "사이드바 펼치기"·aria-expanded=false, 누르면 펼침(false)', () => {
    mq(true); const on = vi.fn()
    render(<SideRail collapsed label="워크스페이스" onToggleCollapsed={on}>x</SideRail>)
    expect(toggle()!.getAttribute('aria-expanded')).toBe('false'); expect(toggle()!.getAttribute('aria-label')).toBe('사이드바 펼치기')
    fireEvent.click(toggle()!); expect(on).toHaveBeenCalledWith(false)
  })
  it('선호 없음 — 1024~1279(레일)면 펼치기(false), 1280 이상이면 접기(true)', () => {
    mq(false); const on = vi.fn()
    const a = render(<SideRail collapsed={null} label="워크스페이스" onToggleCollapsed={on}>x</SideRail>)
    expect(toggle()!.getAttribute('aria-expanded')).toBe('false'); fireEvent.click(toggle()!); expect(on).toHaveBeenLastCalledWith(false)
    a.unmount(); mq(true)
    render(<SideRail collapsed={null} label="워크스페이스" onToggleCollapsed={on}>x</SideRail>)
    expect(toggle()!.getAttribute('aria-expanded')).toBe('true'); fireEvent.click(toggle()!); expect(on).toHaveBeenLastCalledWith(true)
  })
  it('BB4 — 선호 없음의 SSR·첫 렌더는 aria-expanded 를 내지 않는다(1280 이상에서 틀린 false 를 읽히지 않게), 효과 뒤 실제 상태', () => {
    const html = renderToString(<SideRail collapsed={null} label="워크스페이스" onToggleCollapsed={() => {}}>x</SideRail>)
    expect(html).toContain('data-sidebar-toggle')
    expect(html).not.toContain('aria-expanded')
    expect(html).toContain('aria-label="사이드바 접기·펼치기"')
    // 명시 선호는 첫 렌더부터 안다
    expect(renderToString(<SideRail collapsed={false} label="워크스페이스" onToggleCollapsed={() => {}}>x</SideRail>)).toContain('aria-expanded="true"')
  })
  it('키보드 — 네이티브 button(Enter·Space 기본 동작), aria-controls 가 내비를 가리킨다', () => {
    mq(true); render(<SideRail collapsed={false} label="워크스페이스" onToggleCollapsed={() => {}}>x</SideRail>)
    expect(toggle()!.tagName).toBe('BUTTON'); expect(toggle()!.getAttribute('type')).toBe('button')
    const id = toggle()!.getAttribute('aria-controls')!
    expect(document.getElementById(id)?.tagName).toBe('NAV')
  })
  it('AA5 — 바깥은 aside 가 아니라 div, 이름 있는 nav 랜드마크 하나', () => {
    mq(true); render(<SideRail collapsed={false} label="워크스페이스">x</SideRail>)
    expect(document.querySelector('aside')).toBeNull()
    expect(document.querySelector('nav[aria-label="워크스페이스"]')).not.toBeNull()
  })
})
