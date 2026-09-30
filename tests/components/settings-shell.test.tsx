// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
import { SettingsShell } from '@/components/settings/SettingsShell'

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
