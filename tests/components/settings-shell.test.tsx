// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '../shell/_dom'
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
import { SettingsShell } from '@/components/settings/SettingsShell'
import { SettingsSaveBar } from '@/components/settings/SettingsSaveBar'

describe('SettingsShell', () => {
  let host: HTMLDivElement, root: Root
  afterEach(() => { act(() => root.unmount()); host.remove() })
  it('설정 키와 설명으로 범주를 거른다', () => {
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
    act(() => root.render(<SettingsShell items={[{ id: 'general', label: '일반' }, { id: 'modules', label: '모듈' }]}>
      <section id="general" data-settings-search="branding.logo">로고 설정</section>
      <section id="modules" data-settings-search="modules.allowed">허용 범위</section>
    </SettingsShell>))
    const input = host.querySelector<HTMLInputElement>('#settings-search')!
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'branding.logo')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(host.querySelector<HTMLElement>('#general')!.hidden).toBe(false)
    expect(host.querySelector<HTMLElement>('#modules')!.hidden).toBe(true)
    expect(host.querySelector('nav a')?.getAttribute('href')).toBe('#general')
  })
})

// 개정 §5.9.3 모양(SP3b 스펙 §6.4, W19) — 현재 범주·폭 800·저장 바 예약
let ioCb: ((e: { target: Element; isIntersecting: boolean }[]) => void) | null = null
let roCb: ((e: { target: Element; contentRect: { height: number } }[]) => void) | null = null
const items = [{ id: 'a', label: '일반' }, { id: 'b', label: '메뉴' }]
const body = <>
  <section id="a" data-settings-search="x">일반 본문</section>
  <section id="b" data-settings-search="y">메뉴 본문<SettingsSaveBar><button type="button">저장</button></SettingsSaveBar></section>
</>

describe('SettingsShell — 개정 §5.9.3 모양(스펙 §6.4)', () => {
  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', class { constructor(cb: typeof ioCb) { ioCb = cb } observe() {} disconnect() {} })
    vi.stubGlobal('ResizeObserver', class { constructor(cb: typeof roCb) { roCb = cb } observe() {} disconnect() {} })
  })
  afterEach(() => { vi.unstubAllGlobals(); ioCb = null; roCb = null })

  it('보이는 범주에 aria-current="location", 하나뿐', () => {
    render(<SettingsShell items={items}>{body}</SettingsShell>)
    act(() => ioCb!([{ target: document.getElementById('b')!, isIntersecting: true }]))
    expect(screen.getByRole('link', { name: '메뉴' }).getAttribute('aria-current')).toBe('location')
    expect(screen.getByRole('link', { name: '일반' }).getAttribute('aria-current')).toBeNull()
  })
  it('띠에 범주 둘이 걸리면 목차 순서로 마지막(끝까지 내린 짧은 마지막 범주), 그것이 빠지면 앞 범주로', () => {
    render(<SettingsShell items={items}>{body}</SettingsShell>)
    const a = document.getElementById('a')!, b = document.getElementById('b')!
    act(() => ioCb!([{ target: b, isIntersecting: true }, { target: a, isIntersecting: true }]))
    expect(screen.getByRole('link', { name: '메뉴' }).getAttribute('aria-current')).toBe('location')
    act(() => ioCb!([{ target: b, isIntersecting: false }]))
    expect(screen.getByRole('link', { name: '일반' }).getAttribute('aria-current')).toBe('location')
  })
  it('본문 최대 폭 800, 저장 바 높이만큼 아래 여백·입력 스크롤 여백', () => {
    const h = renderToStaticMarkup(<SettingsShell items={items}>{body}</SettingsShell>)
    expect(h).toContain('max-w-[800px]'); expect(h).toContain('pb-(--settings-save-bar-h)'); expect(h).toContain('scroll-mb-(--settings-save-bar-h)')
  })
  it('저장 바 높이를 루트 변수로 내리고 감싼 main 의 초점 스크롤 여백도 맞춘다(ResizeObserver)', () => {
    const { container, unmount } = render(<main><SettingsShell items={items}>{body}</SettingsShell></main>)
    act(() => roCb!([{ target: container.querySelector('[data-save-bar]')!, contentRect: { height: 57.2 } }]))
    const main = container.querySelector('main')!
    expect((main.firstElementChild as HTMLElement).style.getPropertyValue('--settings-save-bar-h')).toBe('58px')
    expect(main.style.scrollPaddingBottom).toBe('66px')
    unmount()
    expect(main.style.scrollPaddingBottom).toBe('')                 // 화면을 떠나면 main 에 남기지 않는다
  })
  it('목차는 전역 바에 맞닿지 않게 도구 줄 높이 + 1rem 에 붙는다(UI-2b 이월)', () => {
    const h = renderToStaticMarkup(<SettingsShell items={items}>{body}</SettingsShell>)
    expect(h).toContain('lg:sticky lg:top-[calc(var(--frame-sticky-top)+1rem)]')
  })
})

describe('SettingsSaveBar', () => {
  it('data-save-bar 표지(FAB 숨김 관찰 — D33), main 안 sticky bottom-0, 층 z-10 이하(D54)', () => {
    const h = renderToStaticMarkup(<SettingsSaveBar summary="변경 2개"><button type="button">저장</button></SettingsSaveBar>)
    expect(h).toContain('data-save-bar'); expect(h).toMatch(/class="[^"]*\bsticky\b[^"]*\bbottom-0\b/); expect(h).toContain('z-10')
    expect(h).not.toContain('z-['); expect(h).toContain('변경 2개'); expect(h).toContain('bg-surface')
  })
  it('배경이 다른 상자(panel-soft 폼) 안에서는 subtle 배경', () => {
    expect(renderToStaticMarkup(<SettingsSaveBar tone="subtle"><button type="button">저장</button></SettingsSaveBar>)).toContain('bg-surface-subtle')
  })
})
