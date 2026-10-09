// tests/components/agent-tabs.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
// 화면 문구는 진짜 ko 사전으로 읽는다 — 한국어 단언이 사전 이전 뒤에도 같은 글자를 본다
vi.mock('@/components/providers/LocaleProvider', async () => {
  const { t } = await import('@/lib/i18n/dict')
  const ko = (k: string) => t('ko', k as Parameters<typeof t>[1])   // 렌더마다 같은 함수(effect 의존성 안정)
  return { useLocale: () => ({ locale: 'ko', t: ko, setLocale: () => {} }) }
})

const nav = vi.hoisted(() => ({ pathname: '/p/p1/agents' }))
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname }))
import { AgentTabs } from '@/components/agent-hub/AgentTabs'

let host: HTMLDivElement, root: Root
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })

const tab = (k: string) => host.querySelector(`[data-agent-tab="${k}"]`) as HTMLAnchorElement

describe('AgentTabs', () => {
  it('에이전트 스튜디오가 첫 탭, 위임·승인이 둘째 탭이다 — 스튜디오가 에이전트 메뉴의 기본 화면(2026-09-19)', () => {
    nav.pathname = '/p/p1/agents/office'
    act(() => root.render(<AgentTabs projectId="p1" />))
    const keys = [...host.querySelectorAll('[data-agent-tab]')].map(a => a.getAttribute('data-agent-tab'))
    expect(keys).toEqual(['office', 'hub'])
  })
  it('허브 경로에서는 위임·승인이 활성, 스튜디오 링크는 /agents/office', () => {
    nav.pathname = '/p/p1/agents'
    act(() => root.render(<AgentTabs projectId="p1" />))
    expect(tab('hub').getAttribute('href')).toBe('/p/p1/agents')
    expect(tab('hub').getAttribute('aria-current')).toBe('page')
    expect(tab('hub').textContent).toBe('위임·승인')
    expect(tab('office').getAttribute('href')).toBe('/p/p1/agents/office')
    expect(tab('office').getAttribute('aria-current')).toBeNull()
    expect(tab('office').textContent).toBe('에이전트 스튜디오')
  })
  it('스튜디오 경로에서는 에이전트 스튜디오가 활성', () => {
    nav.pathname = '/p/p1/agents/office'
    act(() => root.render(<AgentTabs projectId="p1" />))
    expect(tab('office').getAttribute('aria-current')).toBe('page')
    expect(tab('hub').getAttribute('aria-current')).toBeNull()
  })
})
