// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, waitFor } from '../shell/_dom'

Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() })
const h = vi.hoisted(() => ({ wide: true, probe: 200 }))
vi.mock('next/navigation', () => ({ usePathname: () => '/w/acme', useSearchParams: () => new URLSearchParams(''), useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ t: (key: string) => key, locale: 'ko' }) }))
vi.mock('@/app/actions/wbs', () => ({ updateActual: vi.fn(), updateWbsFields: vi.fn() }))
import { AssistantChat, useAiRailButton } from '@/components/chat/AssistantChat'
import { RightRailProvider, useRightRail } from '@/components/app/RightRail'
import { BotPageContextProvider } from '@/components/chat/BotPageContextProvider'

function Bar() { return <div data-bar>{useAiRailButton()}</div> }
let rail: ReturnType<typeof useRightRail> | null = null
function RailApi() { rail = useRightRail(); return null }

beforeEach(() => {
  document.body.innerHTML = '<div id="app-rail"></div>'
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 })
  window.matchMedia = vi.fn((q: string) => ({ matches: q.includes('1024') ? h.wide : false, media: q, addEventListener: vi.fn(), removeEventListener: vi.fn(), onchange: null, addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn() })) as never
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('probe=1')) return new Response(null, { status: h.probe })
    if (url.startsWith('/api/chat/context')) return Response.json({ currentProject: null, totalProjects: 2, weekStartCount: 0 })
    return new Response(null, { status: 500 })
  }) as never
})
afterEach(() => { h.wide = true; h.probe = 200; rail = null })

const fab = () => document.querySelector('button[aria-label="chat.open"][aria-haspopup="dialog"]')
const aiButton = () => document.querySelector('[data-bar] [data-ai-open]') as HTMLButtonElement | null
const panelInRail = () => document.querySelector('#app-rail [aria-label="chat.dialog"]')

describe('AssistantChat — 레일 이관(D33·D56)', () => {
  it('① 1024 이상 + 레일 자리: FAB 없음, 전역 바 버튼 → 레일 안 패널', async () => {
    render(<RightRailProvider><Bar /><BotPageContextProvider><AssistantChat /></BotPageContextProvider></RightRailProvider>)
    await waitFor(() => expect(aiButton()).not.toBeNull())
    expect(fab()).toBeNull()
    fireEvent.click(aiButton()!)
    await waitFor(() => expect(panelInRail()).not.toBeNull())
  })
  it('② 1024 미만: FAB 이 있고, 저장 바가 보이면 FAB 를 그리지 않는다', async () => {
    h.wide = false
    render(<RightRailProvider><Bar /><BotPageContextProvider><AssistantChat /></BotPageContextProvider></RightRailProvider>)
    await waitFor(() => expect(fab()).not.toBeNull())
    expect(aiButton()).toBeNull()
    const bar = document.createElement('div'); bar.setAttribute('data-save-bar', '')
    await act(async () => { document.body.appendChild(bar); await Promise.resolve() })
    await waitFor(() => expect(fab()).toBeNull())
    await act(async () => { bar.remove(); await Promise.resolve() })
    await waitFor(() => expect(fab()).not.toBeNull())
  })
  it('③ 탐침 404 면 FAB·버튼 둘 다 없다', async () => {
    h.probe = 404
    render(<RightRailProvider><Bar /><BotPageContextProvider><AssistantChat /></BotPageContextProvider></RightRailProvider>)
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    expect(fab()).toBeNull(); expect(aiButton()).toBeNull()
  })
  it('④ 레일을 닫았다 다시 열어도 대화가 남는다', async () => {
    render(<RightRailProvider><Bar /><RailApi /><BotPageContextProvider><AssistantChat /></BotPageContextProvider></RightRailProvider>)
    await waitFor(() => expect(aiButton()).not.toBeNull())
    fireEvent.click(aiButton()!)
    await waitFor(() => expect(panelInRail()?.textContent).toContain('chat.welcome.greeting'))
    const ctxCalls = () => (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter((c) => !String(c[0]).includes('probe=1')).length
    expect(ctxCalls()).toBe(1)
    act(() => rail!.close())
    await waitFor(() => expect(panelInRail()).toBeNull())
    fireEvent.click(aiButton()!)
    await waitFor(() => expect(panelInRail()?.textContent).toContain('chat.welcome.greeting'))
    expect(ctxCalls()).toBe(1)                     // 다시 불러오지 않았다 — 대화 상태 보존
  })
  it('⑤ 레일 자리가 없으면(옛 셸) 넓어도 FAB·옛 패널 그대로', async () => {
    document.body.innerHTML = ''
    render(<BotPageContextProvider><AssistantChat /></BotPageContextProvider>)
    await waitFor(() => expect(fab()).not.toBeNull())
    fireEvent.click(fab()!)
    await waitFor(() => expect(document.querySelector('[role="dialog"][aria-label="chat.dialog"]')).not.toBeNull())
  })
})
