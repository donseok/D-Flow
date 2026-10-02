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

// AA3 — WBS 전체 화면 안에서 AI 를 여는 길(스펙 §5.5·§8.5(c), D56). 전체 화면 툴바의 토글이 레일 API(open('ai'))를 부른다.
// 1024 미만은 레일이 아니라 떠 있는 패널이라 그대로면 전체 화면(120) 아래(--z-rail 90)로 숨는다 — 전체 화면 안 레일 자리로 포털한다.
describe('AssistantChat — 전체 화면 안 AI(AA3)', () => {
  const openFs = async () => {
    const fs = document.createElement('div'); fs.setAttribute('data-wbs-fullscreen', 'open')
    const slot = document.createElement('div'); slot.setAttribute('data-rail-host', 'fullscreen'); fs.appendChild(slot)
    await act(async () => { document.body.appendChild(fs); await Promise.resolve() })
    return { fs, slot }
  }
  it('1024 미만 + 전체 화면 열림: aiAvailable 이 켜지고(툴바 토글이 보인다), open("ai") 면 패널이 전체 화면 안 자리에 뜬다 — FAB 는 없다', async () => {
    h.wide = false
    render(<RightRailProvider><RailApi /><BotPageContextProvider><AssistantChat /></BotPageContextProvider></RightRailProvider>)
    await waitFor(() => expect(fab()).not.toBeNull())
    expect(rail!.aiAvailable).toBe(false)                 // 전체 화면 밖 좁은 화면의 진입점은 FAB
    const { slot } = await openFs()
    await waitFor(() => expect(rail!.aiAvailable).toBe(true))
    expect(fab()).toBeNull()
    act(() => rail!.open('ai'))
    await waitFor(() => expect(slot.querySelector('[role="dialog"][aria-label="chat.dialog"]')).not.toBeNull())
    act(() => rail!.close('ai'))
    await waitFor(() => expect(slot.querySelector('[role="dialog"]')).toBeNull())
  })
  it('1024 이상 + 전체 화면: open("ai") 면 레일이 전체 화면 안 자리로 간다(기존 D56)', async () => {
    render(<RightRailProvider><RailApi /><BotPageContextProvider><AssistantChat /></BotPageContextProvider></RightRailProvider>)
    await waitFor(() => expect(rail!.aiAvailable).toBe(true))
    const { slot } = await openFs()
    act(() => rail!.open('ai'))
    await waitFor(() => expect(slot.querySelector('[aria-label="chat.dialog"]')).not.toBeNull())
  })
  it('탐침 404 면 전체 화면에서도 aiAvailable 은 꺼진다', async () => {
    h.wide = false; h.probe = 404
    render(<RightRailProvider><RailApi /><BotPageContextProvider><AssistantChat /></BotPageContextProvider></RightRailProvider>)
    await openFs()
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    expect(rail!.aiAvailable).toBe(false)
  })
})
