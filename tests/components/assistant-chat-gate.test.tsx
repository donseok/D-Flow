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
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ t: (key: string) => key }) }))
vi.mock('@/app/actions/wbs', () => ({ updateActual: vi.fn(), updateWbsFields: vi.fn() }))

import { BotPageContextProvider } from '@/components/chat/BotPageContextProvider'
import { AssistantChat } from '@/components/chat/AssistantChat'
import { ShellScope, ShellScopeProvider } from '@/components/app/ShellScope'

const ON = '12345678-1234-1234-1234-123456789abc'
const OFF = '87654321-4321-4321-4321-cba987654321'
const fetchMock = vi.fn()
/** probe 응답 상태 — 세 번째 갈래(404 아닌 오류)를 케이스마다 고른다. 네트워크 오류는 0으로 두고 `.catch` 가 받는다. */
let probeStatus = 200
let container: HTMLDivElement
let root: Root
const tree = () => (
  // 프로젝트 목록은 게시 저장소에서(과제 31 — AssistantChat 의 projects prop 삭제)
  <ShellScopeProvider><ShellScope workspace={null} projectId={null} projects={[{ id: ON, name: 'ERP' }, { id: OFF, name: 'MES' }]} />
    <BotPageContextProvider><AssistantChat /></BotPageContextProvider></ShellScopeProvider>
)
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
const fab = () => container.querySelector('button[aria-label="chat.open"]')
const panel = () => container.querySelector('[role="dialog"]')
const input = () => container.querySelector('textarea') as HTMLTextAreaElement | null
const openPanel = async () => {
  await act(async () => { (fab() as HTMLButtonElement).click(); await settle() })
}
/** textarea 는 React 제어 입력이라 value 설정 후 input 이벤트를 쏴야 상태가 바뀐다. */
const type = async (text: string) => {
  await act(async () => {
    const el = input() as HTMLTextAreaElement
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    setter?.call(el, text)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    await settle()
  })
}
const send = async () => {
  await act(async () => {
    ;(container.querySelector('button[aria-label="chat.send"]') as HTMLButtonElement).click()
    await settle()
  })
}

beforeEach(() => {
  nav.pathname = `/p/${ON}/wbs`
  probeStatus = 200
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input)
    // probe 의 세 갈래: 200(켜짐) · 404(모듈 꺼짐) · 그 밖의 상태(서버 오류).
    // "404 가 아닌 오류는 숨기지 않는다" 의 응답 경로는 404·200 이라는 **두 값만** 존재하는 것으로 우겨질 수 있었다.
    if (url.includes('probe=1')) {
      if (url.includes(OFF)) return Response.json({ error: 'off' }, { status: 404 })
      if (probeStatus !== 200) return Response.json({ error: 'boom' }, { status: probeStatus })
      return Response.json({ ok: true })
    }
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

/**
 * 404 분기는 "스트림을 끊고 패널을 닫고 그리지 않는다" 세 행이다. 그중 `abort()`·`setOpen(false)` 두 줄을 지워도
 * 172 파일이 초록이었다 — 지워도 `available !== true` 로 `return null` 이 일어나 DOM 에서 사라지므로
 * "패널을 닫는다"가 아니라 "패널이 보이지 않는다"만 증명했기 때문이다.
 *
 * 반쪽 고정 두 가지가 한 쌍이다:
 *  - 진행 중 스트림이 실제로 **abort** 된다 (숨겨진 채 끝까지 돌면 남은 청크가 `ai_messages` 를 남긴다),
 *  - 모듈이 다시 켜졌을 때 **열림 상태가 지워져 있다** — 패널은 닫혔고 FAB 만 살아 있다.
 *    이것이 `return null`(숨김)과 `setOpen(false)`(상태 지움)를 갈라 두 줄을 따로 물린다.
 */
describe('AssistantChat 404 분기 — 스트림을 끊고 패널을 닫는다', () => {
  /** 이 컴포넌트가 실제로 부르는 스트림 URL 을 걸어 streamAbortRef 를 채운다. */
  const hangStream = () => {
    const signal = { current: undefined as AbortSignal | undefined }
    fetchMock.mockImplementation((request: RequestInfo | URL, init?: RequestInit) => {
      const url = String(request)
      if (url.includes('probe=1')) {
        return Promise.resolve(url.includes(OFF)
          ? Response.json({ error: 'off' }, { status: 404 })
          : Response.json({ ok: true }))
      }
      if (url.startsWith('/api/chat/context')) {
        return Promise.resolve(Response.json({ currentProject: null, totalProjects: 2, weekStartCount: 0 }))
      }
      if (url.startsWith('/api/chat/v2/stream')) {
        signal.current = init?.signal ?? undefined
        return new Promise<Response>(() => {})   // 응답 없이 걸어 둔다 — 진행 중 스트림
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    return signal
  }

  it('진행 중 스트림을 실제로 걸고 404 면 그 요청을 abort 한다', async () => {
    const signal = hangStream()
    await act(async () => { root.render(tree()); await settle() })
    await openPanel()
    await type('이번 주 작업 알려줘')
    await send()
    expect(signal.current, '스트림이 실제로 걸렸다').toBeDefined()
    expect(signal.current!.aborted).toBe(false)

    nav.pathname = `/p/${OFF}/wbs`
    await act(async () => { root.render(tree()); await settle() })
    // 언마운트 클린업은 이 분기에서 도는 게 아니다 — 컴포넌트는 살아 있고, 전환 시점에 진행 중이던 요청이 끊겨야 한다.
    // (숨겨진 채 끝까지 돌면 남은 청크가 `ai_messages` 를 남긴다.)
    expect(signal.current!.aborted).toBe(true)
    // **알려진 한계**: 이 단언은 "전환 시점에 진행 중 스트림이 끊긴다" 는 계약을 물리지만, 404 분기의 `abort()` 한 줄을
    // **구별하지는 못한다** — 프로젝트 전환 훅(`[open, currentProjectId]`)이 그 전에 같은 컨트롤러를 abort 한다
    // (B8 fix 라운드 실측: 404 분기의 abort 만 떼면 초록, 두 곳 다 떼면 빨강). 404 분기 쪽 abort 를 따로 물리려면
    // 전환이 아니라 **그 채로 404** 가 다시 오는 경로가 필요한데, 탐침 effect 의 deps 가 `[currentProjectId]` 뿐이라
    // 같은 프로젝트에서 재탐침이 일어나지 않는다(P12 — 폴링 없음). 즉 이 줄은 지금 다른 abort 뒤의 **이중 안전장치**다.
    // contracts 를 코드와 같은 무게로 고정한다는 리포 규칙상 남겨 두되, 단독으로는 못 잡는다는 사실을 여기 적는다.
  })

  it('모듈이 다시 켜지면 패널은 닫힌 채로 FAB 만 살아 있다 — 열림 상태가 지워졌다', async () => {
    hangStream()
    await act(async () => { root.render(tree()); await settle() })
    await openPanel()
    expect(input()).not.toBeNull()

    nav.pathname = `/p/${OFF}/wbs`
    await act(async () => { root.render(tree()); await settle() })
    expect(fab()).toBeNull()
    expect(panel()).toBeNull()

    // 같은 켜진 프로젝트로 되돌린다 — `return null` 이 풀리면(available 이 다시 true) 패널이 되살아나는지 본다.
    nav.pathname = `/p/${ON}/wbs`
    await act(async () => { root.render(tree()); await settle() })
    expect(fab()).not.toBeNull()
    expect(panel(), 'setOpen(false) 가 없으면 이전 대화와 열린 패널이 되살아난다').toBeNull()
  })
})

describe('AssistantChat — 404 가 아닌 오류는 숨기지 않는다', () => {
  it('500 이라도 위젯을 숨기지 않는다', async () => {
    // `/api/chat/context` 의 500 은 `buildBotContext` 의 service_role 분석이 죽은 경로다(그리고 배포 중 일시 오류면 충분하다).
    // 404 분기가 fail-closed 라서 이 방향으로 밀리면 "조용히 사라짐" 이 되고, 이 effect 는 `[currentProjectId]` 에서만
    // 돌아 **폴링 복구가 없다** — 새고침 전까지 챗을 못 쓴다. 서버는 정상이지만 UI 만 죽은 상태로 오해받는다.
    probeStatus = 500
    await act(async () => { root.render(tree()); await settle() })
    expect(fab()).not.toBeNull()
  })

  it('401 로 와도 위젯을 숨기지 않는다 — 404 만 숨긴다', async () => {
    probeStatus = 401
    await act(async () => { root.render(tree()); await settle() })
    expect(fab()).not.toBeNull()
  })

  it('전환 중에는 직전 판정을 유지한다 — 새 탐침 응답이 오기 전까지 FAB 이 그대로 있다', async () => {
    // deps 배열에 `setAvailable(null)` 이 들어갈까봐 못 박는 결정이다. 리셋이 생기면 위젯이 매 전환마다
    // 한 번 사라졌다 다시 뜨고, 그것을 단언하는 테스트가 없다 — "유지"가 아니라 "아무것도 안 함"이라서 어느 쪽도 못 잡는다.
    await act(async () => { root.render(tree()); await settle() })
    expect(fab()).not.toBeNull()
    // 꺼진 프로젝트로 바꾸되 **탐침 응답을 내지 않은 채**(pending Promise)로 둔다.
    fetchMock.mockImplementation((request: RequestInfo | URL) => {
      const url = String(request)
      if (url.includes('probe=1')) return new Promise<Response>(() => {})
      return Promise.resolve(Response.json({ currentProject: null, totalProjects: 2, weekStartCount: 0 }))
    })
    nav.pathname = `/p/${OFF}/wbs`
    await act(async () => { root.render(tree()); await settle() })
    expect(fab()).not.toBeNull()
  })
})

/**
 * 세션 라우트의 범위(과제 34, D26) — 프로젝트 없는 화면의 챗 요청은 셸 범위의 워크스페이스를 싣는다. 프로젝트 화면은 싣지 않는다 —
 * 게시가 경로보다 한 커밋 늦어 이전 워크스페이스가 실리면 서버가 조합 불일치(404)로 닫아 위젯이 꺼진다(적대 ③ 의 클라이언트 쪽).
 */
describe('AssistantChat — 요청의 워크스페이스(과제 34)', () => {
  const WA = { id: '00000000-0000-0000-7e57-000000001795', slug: 'acme', name: 'Acme' }
  const WB = { id: '00000000-0000-0000-7e57-000000001796', slug: 'beta', name: 'Beta' }
  const scoped = (workspace: typeof WA | null) => (
    <ShellScopeProvider><ShellScope workspace={workspace} projectId={null} projects={[{ id: ON, name: 'ERP' }]} />
      <BotPageContextProvider><AssistantChat /></BotPageContextProvider></ShellScopeProvider>
  )
  const probes = () => fetchMock.mock.calls.map(([u]) => String(u)).filter((u) => u.includes('probe=1'))

  it('워크스페이스 화면 — 탐침·문맥·스트림 요청에 게시 범위의 워크스페이스를 싣는다', async () => {
    nav.pathname = '/w/acme/minutes'
    const bodies: unknown[] = []
    fetchMock.mockImplementation(async (request: RequestInfo | URL, init?: RequestInit) => {
      const url = String(request)
      if (url.includes('probe=1')) return Response.json({ ok: true })
      if (url.startsWith('/api/chat/context')) return Response.json({ currentProject: null, totalProjects: 2, weekStartCount: 0 })
      if (url.startsWith('/api/chat/v2/stream')) { bodies.push(JSON.parse(String(init?.body))); return new Promise<Response>(() => {}) }
      throw new Error(`unexpected fetch: ${url}`)
    })
    await act(async () => { root.render(scoped(WA)); await settle() })
    expect(probes().at(-1)).toBe(`/api/chat/context?projectId=&workspaceId=${WA.id}&probe=1`)
    await openPanel()
    expect(fetchMock).toHaveBeenCalledWith(`/api/chat/context?projectId=&workspaceId=${WA.id}`, { cache: 'no-store' })
    await type('이번 주 작업 알려줘')
    await send()
    expect(bodies[0]).toMatchObject({ projectId: null, workspaceId: WA.id, pageContext: { projectId: null, workspaceId: WA.id } })
  })

  it('프로젝트 화면 — 게시 범위가 남아 있어도 워크스페이스를 싣지 않는다(프로젝트가 판정)', async () => {
    nav.pathname = `/p/${ON}/wbs`
    await act(async () => { root.render(scoped(WB)); await settle() })
    expect(probes()).toEqual([`/api/chat/context?projectId=${ON}&probe=1`])
  })

  it('경로 슬러그와 다른 게시 범위(한 커밋 늦은 게시)는 묻지 않고, 범위가 맞춰지면 그 워크스페이스로 탐침한다', async () => {
    nav.pathname = '/w/beta'
    await act(async () => { root.render(scoped(WA)); await settle() })
    expect(probes()).toEqual([])
    await act(async () => { root.render(scoped(WB)); await settle() })
    expect(probes()).toEqual([`/api/chat/context?projectId=&workspaceId=${WB.id}&probe=1`])
  })

  // U2b-5 리뷰 수정 CC4 — (global) 은 검증된 쿠키 워크스페이스를 게시한다(레이아웃). 그래도 범위가 없는 화면(소속 0 등)은 보낼 수 있는 요청이
  // 없으므로 진입점을 닫는다 — 직전 판정을 남겨 두면 새 질문이 서버 400 문구('워크스페이스를 지정해야 합니다')로 말풍선에 뜬다
  it('범위가 없는 화면은 묻지 않고(서버 400 을 쌓지 않는다) 진입점을 닫는다 — 범위 화면에서 넘어와도 닫고, 범위가 돌아오면 다시 연다', async () => {
    nav.pathname = '/account'
    await act(async () => { root.render(scoped(null)); await settle() })
    expect(probes()).toEqual([])
    expect(fab()).toBeNull()
    act(() => root.unmount()); root = createRoot(container)
    nav.pathname = '/w/acme'
    await act(async () => { root.render(scoped(WA)); await settle() })
    expect(fab()).not.toBeNull()
    nav.pathname = '/account'
    await act(async () => { root.render(scoped(null)); await settle() })
    expect(probes()).toEqual([`/api/chat/context?projectId=&workspaceId=${WA.id}&probe=1`])
    expect(fab()).toBeNull()
    nav.pathname = '/w/acme'
    await act(async () => { root.render(scoped(WA)); await settle() })
    expect(fab()).not.toBeNull()
  })
  it('(global) 이 게시한 범위로 프로젝트 없는 질문을 보낸다 — 400 이 아니다', async () => {
    nav.pathname = '/account'
    await act(async () => { root.render(scoped(WA)); await settle() })
    expect(probes()).toEqual([`/api/chat/context?projectId=&workspaceId=${WA.id}&probe=1`])
    expect(fab()).not.toBeNull()
  })
  it('범위가 비는 순간(게시가 한 커밋 늦은 범위 경로)에 보내면 서버로 가지 않고 안내 문장을 낸다 — 서버 400 문구를 말풍선에 싣지 않는다', async () => {
    nav.pathname = '/w/acme'
    await act(async () => { root.render(scoped(WA)); await settle() })
    await openPanel()
    nav.pathname = '/w/beta'   // 경로는 B, 게시는 아직 A — 요청 워크스페이스 없음(requestWorkspaceId)
    await act(async () => { root.render(scoped(WA)); await settle() })
    expect(input()).not.toBeNull()
    const before = fetchMock.mock.calls.length
    await type('이번 주 작업 알려줘')
    await send()
    expect(fetchMock.mock.calls.slice(before).map(([u]) => String(u)).filter((u) => !u.includes('probe=1'))).toEqual([])
    expect(container.textContent).toContain('chat.error.noScope')
  })
})
