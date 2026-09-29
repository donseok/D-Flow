// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() })

const nav = vi.hoisted(() => ({ pathname: '/p/12345678-1234-1234-1234-123456789abc/wbs' }))
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(''),
  useRouter: () => ({ refresh: vi.fn() }),
}))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ t: (key: string) => key, locale: 'ko' }) }))
vi.mock('@/app/actions/wbs', () => ({ updateActual: vi.fn(), updateWbsFields: vi.fn() }))

import { BotPageContextProvider } from '@/components/chat/BotPageContextProvider'
import { AssistantChat } from '@/components/chat/AssistantChat'

const ON = '12345678-1234-1234-1234-123456789abc'
const OFF = '87654321-4321-4321-4321-cba987654321'
const fetchMock = vi.fn()
let container: HTMLDivElement
let root: Root
const tree = () => (
  <BotPageContextProvider><AssistantChat projects={[{ id: ON, name: 'ERP' }, { id: OFF, name: 'MES' }]} /></BotPageContextProvider>
)
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
const fab = () => container.querySelector('button[aria-label="chat.open"]')

beforeEach(() => {
  nav.pathname = `/p/${ON}/wbs`
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('probe=1')) return url.includes(OFF) ? Response.json({ error: 'off' }, { status: 404 }) : Response.json({ ok: true })
    if (url.startsWith('/api/chat/context')) return Response.json({ currentProject: null, totalProjects: 2, weekStartCount: 0 })
    throw new Error(`unexpected fetch: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals() })

describe('AssistantChat 모듈 탐침', () => {
  it('첫 탐침 응답 전에는 버튼이 깜빡이며 나타나지 않는다', async () => {
    let resolveProbe!: (response: Response) => void
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveProbe = resolve }))
    await act(async () => { root.render(tree()) })
    expect(fab()).toBeNull()
    await act(async () => { resolveProbe(Response.json({ ok: true })); await settle() })
    expect(fab()).not.toBeNull()
  })

  it('마운트 때 탐침을 한 번 부르고 통과하면 위젯을 그린다', async () => {
    await act(async () => { root.render(tree()); await settle() })
    expect(fetchMock).toHaveBeenCalledWith(`/api/chat/context?projectId=${ON}&probe=1`, { cache: 'no-store' })
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('probe=1'))).toHaveLength(1)
    expect(fab()).not.toBeNull()
  })

  it('404 면 첫 화면부터 위젯을 그리지 않는다', async () => {
    nav.pathname = `/p/${OFF}/wbs`
    await act(async () => { root.render(tree()); await settle() })
    expect(fab()).toBeNull()
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })

  it('열어 둔 채 꺼진 프로젝트로 옮기면 패널을 닫고 숨긴다', async () => {
    await act(async () => { root.render(tree()); await settle() })
    await act(async () => { (fab() as HTMLButtonElement).click(); await settle() })
    expect(container.querySelector('textarea')).not.toBeNull()
    nav.pathname = `/p/${OFF}/wbs`
    await act(async () => { root.render(tree()); await settle() })
    expect(container.querySelector('textarea')).toBeNull()
    expect(fab()).toBeNull()
  })

  it('404 가 아닌 네트워크 오류에는 위젯을 숨기지 않는다', async () => {
    fetchMock.mockImplementationOnce(async () => { throw new TypeError('network') })
    await act(async () => { root.render(tree()); await settle() })
    expect(fab()).not.toBeNull()
  })
})
