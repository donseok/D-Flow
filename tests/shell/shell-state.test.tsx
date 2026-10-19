// @vitest-environment jsdom
// ShellStateProvider 새 계약(D34·R25) — 게시 저장소(useShellScope)의 워크스페이스·프로젝트로 /api/shell 을 이동당 1회 부른다.
// 범위가 없으면(첫 게시 전·(global)) 배지는 null(모름)이고 인박스만 읽는다. 늦게 온 옛 응답은 버린다(시퀀스 가드 — 옛 header-chrome-inbox 의 케이스).
import { act } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from './_dom'

const h = vi.hoisted(() => ({ realtime: null as null | (() => void), pathname: '/w/acme', scope: null as null | { workspace: { id: string; slug?: string } | null; projectId: string | null } }))
vi.mock('next/navigation', () => ({ usePathname: () => h.pathname }))
vi.mock('@/components/app/ShellScope', () => ({ useShellScope: () => h.scope }))
vi.mock('@/lib/hooks/useInboxRealtime', () => ({ useInboxRealtime: (refresh: () => void) => { h.realtime = refresh } }))
import { ShellStateProvider, scopeMatchesPath, useShellState, useShellBadges } from '@/components/app/ShellStateProvider'

const WA = '00000000-0000-0000-7e57-000000001771', P = '00000000-0000-0000-7e57-000000001772'
let seen: ReturnType<typeof useShellState> | null = null
function Reader() { seen = useShellState(); return null }
const payload = (over: Record<string, unknown> = {}) => ({
  inbox: { items: [{ recipientId: 'r1', seen: false, read: false }], unseen: 1 },
  notifications: { items: [{ id: 'n1', read: false }], count: 1 },
  badges: { myWorkReview: 4, projectApprovals: 1, projectUnreadAnnouncements: 2 }, ...over,
})
let fetchMock: ReturnType<typeof vi.fn>
const flush = () => act(() => new Promise<void>((r) => setTimeout(r, 10)))
beforeEach(() => {
  vi.clearAllMocks(); seen = null; h.pathname = '/w/acme'; h.scope = null
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => payload() }))
  vi.stubGlobal('fetch', fetchMock)
})

describe('ShellStateProvider(새 계약)', () => {
  it('범위 없음((global) 화면) — 쿼리 없이 부르고 배지는 null(모름), 인박스는 채운다', async () => {
    h.pathname = '/account'
    render(<ShellStateProvider><Reader /></ShellStateProvider>); await flush()
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(fetchMock.mock.calls[0][0]).toBe('/api/shell?')
    expect(seen!.badges).toEqual({ myWorkReview: null, projectApprovals: null, projectUnreadAnnouncements: null })
    expect(seen!.inbox).toHaveLength(1)
  })
  it('워크스페이스·프로젝트 범위 — ?ws=&project= 로 부르고 배지 셋을 싣는다', async () => {
    h.scope = { workspace: { id: WA, slug: 'acme' }, projectId: P }; h.pathname = `/p/${P}/dashboard`
    render(<ShellStateProvider><Reader /></ShellStateProvider>); await flush()
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/shell?ws=${WA}&project=${P}`)
    expect(seen!.badges).toEqual({ myWorkReview: 4, projectApprovals: 1, projectUnreadAnnouncements: 2 })
    expect(seen!.notifs).toHaveLength(1)
  })
  it('이동당 1회(R25) — 같은 범위에서 경로만 바뀌면 한 번 더', async () => {
    h.scope = { workspace: { id: WA, slug: 'acme' }, projectId: null }
    const r = render(<ShellStateProvider><Reader /></ShellStateProvider>); await flush()
    h.pathname = '/w/acme/minutes'; r.rerender(<ShellStateProvider><Reader /></ShellStateProvider>); await flush()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
  it('범위를 넘는 이동(경로가 먼저, 게시가 나중 — 스트리밍 사이 간격 포함)도 조회는 1회 — 새 범위로', async () => {
    h.scope = { workspace: { id: WA, slug: 'acme' }, projectId: null }
    const r = render(<ShellStateProvider><Reader /></ShellStateProvider>); await flush()
    fetchMock.mockClear()
    h.pathname = `/p/${P}/wbs`; r.rerender(<ShellStateProvider><Reader /></ShellStateProvider>)
    await flush()                                                                  // 게시 전 간격 — 옛 범위로 부르지 않는다
    expect(fetchMock).not.toHaveBeenCalled()
    h.scope = { workspace: { id: WA, slug: 'acme' }, projectId: P }; r.rerender(<ShellStateProvider><Reader /></ShellStateProvider>)
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(fetchMock.mock.calls[0][0]).toBe(`/api/shell?ws=${WA}&project=${P}`)
  })
  it('응답 실패면 인박스 failed, 배지는 직전 값을 0 으로 바꾸지 않는다', async () => {
    h.scope = { workspace: { id: WA, slug: 'acme' }, projectId: null }
    const r = render(<ShellStateProvider><Reader /></ShellStateProvider>); await flush()
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({}) })
    h.pathname = '/w/acme/x'; r.rerender(<ShellStateProvider><Reader /></ShellStateProvider>); await flush()
    expect(seen!.inboxFailed).toBe(true); expect(seen!.badges.myWorkReview).toBe(4)
  })
  it('프로젝트를 벗어나면 파생 알림·프로젝트 배지를 비우고 로딩 게이트가 풀린다 — 늦게 온 옛 응답은 버린다', async () => {
    h.scope = { workspace: { id: WA, slug: 'acme' }, projectId: P }; h.pathname = `/p/${P}/dashboard`
    let resolveFirst: () => void = () => {}
    fetchMock.mockImplementationOnce(() => new Promise((res) => { resolveFirst = () => res({ ok: true, json: async () => payload() }) }))
    const r = render(<ShellStateProvider><Reader /></ShellStateProvider>); await flush()
    expect(seen!.inboxLoading || seen!.notifLoading).toBe(true)
    h.scope = { workspace: { id: WA, slug: 'acme' }, projectId: null }; h.pathname = '/w/acme'
    fetchMock.mockImplementationOnce(async () => ({ ok: true, json: async () => payload({ notifications: null, badges: { myWorkReview: 4, projectApprovals: null, projectUnreadAnnouncements: null } }) }))
    r.rerender(<ShellStateProvider><Reader /></ShellStateProvider>); await flush()
    expect(seen!.inboxLoading || seen!.notifLoading).toBe(false)
    expect(seen!.notifs).toEqual([]); expect(seen!.badges.projectApprovals).toBeNull()
    await act(async () => { resolveFirst() })
    expect(seen!.notifs).toEqual([]); expect(seen!.badges.projectUnreadAnnouncements).toBeNull()
  })
  it('게시가 오지 않는 화면(열화 최소 셸 등)도 잠시 뒤에는 부른다(벨이 멈추지 않게)', async () => {
    vi.useFakeTimers()
    try {
      h.scope = { workspace: { id: WA, slug: 'acme' }, projectId: null }; h.pathname = `/p/${P}/wbs`
      render(<ShellStateProvider><Reader /></ShellStateProvider>)
      await act(async () => { await vi.advanceTimersByTimeAsync(100) })
      expect(fetchMock).not.toHaveBeenCalled()
      await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    } finally { vi.useRealTimers() }
  })
  it('scopeMatchesPath — /p 는 그 프로젝트, /w 는 그 워크스페이스(프로젝트 없음), 그 밖은 기다리지 않는다', () => {
    expect(scopeMatchesPath(`/p/${P}/wbs`, 'acme', P)).toBe(true); expect(scopeMatchesPath(`/p/${P}/wbs`, 'acme', null)).toBe(false)
    expect(scopeMatchesPath('/w/acme/minutes', 'acme', null)).toBe(true); expect(scopeMatchesPath('/w/acme', 'acme', P)).toBe(false); expect(scopeMatchesPath('/w/bravo', 'acme', null)).toBe(false)
    expect(scopeMatchesPath('/account', null, null)).toBe(true)
  })
})


describe('셸 갱신 최적화', () => {
  it('알림 목록·loading 갱신과 같은 배지는 내비 소비자를 다시 렌더하지 않는다', async () => {
    h.scope = { workspace: { id: WA, slug: 'acme' }, projectId: null }
    let renders = 0
    function BadgesReader() { useShellBadges(); renders += 1; return null }
    render(<ShellStateProvider><Reader /><BadgesReader /></ShellStateProvider>)
    await flush()
    const before = renders
    act(() => seen!.refresh())
    await flush()
    expect(renders).toBe(before)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('같은 범위를 다시 읽는 동안 기존 인박스를 로딩 화면으로 바꾸지 않는다', async () => {
    h.scope = { workspace: { id: WA, slug: 'acme' }, projectId: null }
    const r = render(<ShellStateProvider><Reader /></ShellStateProvider>); await flush()
    fetchMock.mockImplementationOnce(() => new Promise(() => {}))
    h.pathname = '/w/acme/minutes'
    r.rerender(<ShellStateProvider><Reader /></ShellStateProvider>); await flush()
    expect(seen!.inboxLoading).toBe(false)
    expect(seen!.inbox).toHaveLength(1)
  })

  it('새 범위가 스트리밍 중이면 이전 요청을 취소하고 늦은 결과를 채택하지 않는다', async () => {
    h.scope = { workspace: { id: WA, slug: 'acme' }, projectId: null }
    let finish = () => {}
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({ ok: true, json: async () => payload() }) }))
    const r = render(<ShellStateProvider><Reader /></ShellStateProvider>); await flush()
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal
    h.pathname = `/p/${P}/wbs`
    r.rerender(<ShellStateProvider><Reader /></ShellStateProvider>)
    expect(signal.aborted).toBe(true)
    await act(async () => finish())
    expect(seen!.inbox).toEqual([])
    expect(seen!.badges.myWorkReview).toBeNull()
    r.unmount()
  })

  it('연속 실시간 이벤트는 한 번만 재조회하고 구독 콜백은 이동해도 바뀌지 않는다', async () => {
    vi.useFakeTimers()
    try {
      h.scope = { workspace: { id: WA, slug: 'acme' }, projectId: null }
      const r = render(<ShellStateProvider><Reader /></ShellStateProvider>)
      await act(async () => { await vi.advanceTimersByTimeAsync(1) })
      const callback = h.realtime!
      act(() => { callback(); callback(); callback() })
      await act(async () => { await vi.advanceTimersByTimeAsync(151) })
      expect(fetchMock).toHaveBeenCalledTimes(2)
      h.pathname = '/w/acme/minutes'
      r.rerender(<ShellStateProvider><Reader /></ShellStateProvider>)
      expect(h.realtime).toBe(callback)
    } finally { vi.useRealTimers() }
  })
})
