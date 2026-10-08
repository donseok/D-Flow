// @vitest-environment jsdom
// 내 회의 — 조회 실패는 '이번 달 회의 없음'이 아니라 사유와 재시도로 보인다(M5, 에러 처리 3원칙 ①).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Meeting } from '@/lib/domain/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

// 시나리오가 마운트 전에 currentSearch 만 바꿔 딥링크 쿼리를 넣는다.
let currentSearch = ''
// router 는 실제 useRouter 처럼 렌더마다 같은 객체다 — 뷰가 router 를 effect 의존성으로 쓴다.
const mocks = vi.hoisted(() => {
  const routerRefresh = vi.fn()
  return { fetchMyMeetings: vi.fn(), routerRefresh, router: { refresh: routerRefresh, push: vi.fn() } }
})
vi.mock('next/navigation', () => ({
  useRouter: () => mocks.router,
  useSearchParams: () => new URLSearchParams(currentSearch),
}))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ locale: 'ko', t: (key: string) => key }) }))
vi.mock('@/app/actions/meetings', () => ({
  fetchMyMeetings: mocks.fetchMyMeetings,
  fetchMeetingDetail: vi.fn(async () => null),
  cancelOccurrence: vi.fn(async () => ({ ok: true })),
  deleteMeeting: vi.fn(async () => ({ ok: true })),
}))
vi.mock('@/app/actions/minutes', () => ({ fetchMeetingMinutesLite: vi.fn(async () => []) }))
vi.mock('@/app/actions/announcements', () => ({ createAnnouncementFromMeeting: vi.fn(async () => ({ ok: true })) }))

import { MyMeetingsView } from '@/components/meetings/MyMeetingsView'
import { SUNDAY_CAL } from '../fixtures/calendarView'
import { ANY_CATS } from '../fixtures/vocab'

function meeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: 'm1', projectId: 'p1', title: '주간 회의', meetingDate: '2026-07-21',
    startTime: '10:00', endTime: '11:00', location: null, category: 'routine', body: '',
    recurrence: 'none', recurrenceUntil: null, createdBy: 'u1', createdByName: 'alice',
    createdAt: '2026-07-01T00:00:00Z', updatedAt: '2026-07-01T00:00:00Z', attendeeIds: [],
    projectName: 'Acme', isMine: true,
    ...overrides,
  }
}

describe('MyMeetingsView — 조회 실패', () => {
  let container: HTMLDivElement
  let root: Root
  let errSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    currentSearch = ''
    mocks.fetchMyMeetings.mockReset()
    mocks.routerRefresh.mockReset()
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount()); container.remove()
    document.body.querySelectorAll('[role="dialog"]').forEach(node => node.remove())
    errSpy.mockRestore()
  })

  const alertEl = () => container.querySelector('[role="alert"]')
  const retryBtn = () => [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('common.retry'))
  const flush = async () => { await Promise.resolve(); await Promise.resolve() }
  const FAIL = { ok: false, error: '회의 일정을 불러오지 못했습니다.' }
  const monthBtn = (dir: 'prev' | 'next') => container.querySelector<HTMLButtonElement>(`button[aria-label="meet.${dir}Month"]`)!
  // 달력 격자가 그려졌는가 — 요일 머리글로 본다(목 t 는 키를 그대로 돌려준다).
  const hasGrid = () => container.textContent!.includes('att.weekday.sun')
  /** 풀어 줄 때까지 끝나지 않는 조회 — 읽는 중의 화면을 붙잡아 본다. */
  function holdFetch() {
    let release: (v: unknown) => void = () => {}
    mocks.fetchMyMeetings.mockReturnValueOnce(new Promise(r => { release = r }))
    return (v: unknown) => act(async () => { release(v); await flush() })
  }
  async function mount(props: Partial<Parameters<typeof MyMeetingsView>[0]> = {}) {
    await act(async () => {
      root.render(<MyMeetingsView workspaceId="ws-1" calendar={SUNDAY_CAL} initialMeetings={[]} initialExceptions={[]} todayIso="2026-07-19" currentUserId={null} {...props} initialCategories={ANY_CATS} />)
      await Promise.resolve()
    })
  }
  async function openListTab() {
    const listTab = [...container.querySelectorAll<HTMLButtonElement>('button[role="tab"]')].find(b => b.textContent === 'meet.view.list')!
    await act(async () => { listTab.click() })
  }

  it('initialFailed 면 경고와 재시도, 재시도가 성공하면 경고가 사라진다', async () => {
    mocks.fetchMyMeetings.mockResolvedValue({ ok: true, meetings: [], exceptions: [], categories: {} })
    await act(async () => {
      root.render(<MyMeetingsView workspaceId="ws-1" calendar={SUNDAY_CAL} initialMeetings={[]} initialExceptions={[]} initialFailed todayIso="2026-07-19" currentUserId={null} initialCategories={ANY_CATS} />)
      await Promise.resolve()
    })
    const alert = container.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain('common.loadFailed.meetings')
    const retry = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('common.retry'))
    await act(async () => { retry!.click(); await Promise.resolve(); await Promise.resolve() })
    expect(mocks.fetchMyMeetings).toHaveBeenCalledTimes(1)
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('달을 옮겨 다시 읽다가 실패하면 경고가 뜬다', async () => {
    mocks.fetchMyMeetings.mockResolvedValue({ ok: false, error: '회의 일정을 불러오지 못했습니다.' })
    await act(async () => {
      root.render(<MyMeetingsView workspaceId="ws-1" calendar={SUNDAY_CAL} initialMeetings={[]} initialExceptions={[]} todayIso="2026-07-19" currentUserId={null} initialCategories={ANY_CATS} />)
      await Promise.resolve()
    })
    expect(container.querySelector('[role="alert"]')).toBeNull()
    const next = container.querySelector<HTMLButtonElement>('button[aria-label="meet.nextMonth"]')
    await act(async () => { next!.click(); await Promise.resolve(); await Promise.resolve() })
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('common.loadFailed.meetings')
  })

  it('실패한 달에는 앞 달의 회의도, 앞 달 기준의 프로젝트 칩도 남지 않는다', async () => {
    mocks.fetchMyMeetings.mockResolvedValue({ ok: false, error: '회의 일정을 불러오지 못했습니다.' })
    await mount({ initialMeetings: [
      meeting(),
      meeting({ id: 'm2', projectId: 'p2', projectName: 'Acme 2', title: '월간 회의', meetingDate: '2026-07-22' }),
    ] })
    expect(container.textContent).toContain('주간 회의')
    expect(container.querySelectorAll('button[aria-pressed]')).toHaveLength(3)
    const next = container.querySelector<HTMLButtonElement>('button[aria-label="meet.nextMonth"]')
    await act(async () => { next!.click(); await flush() })
    expect(alertEl()).not.toBeNull()
    expect(container.textContent).not.toContain('주간 회의')
    expect(container.textContent).not.toContain('월간 회의')
    expect(container.querySelectorAll('button[aria-pressed]')).toHaveLength(0)
  })

  it('조회 실패면 목록 탭에 빈 상태(회의 없음)를 그리지 않는다 — 내 회의만·전체 프로젝트 둘 다', async () => {
    await mount({ initialFailed: true })
    await openListTab()
    expect(alertEl()).not.toBeNull()
    expect(container.textContent).not.toContain('meet.empty.mineTitle')
    expect(container.textContent).not.toContain('meet.empty.mineDesc')
    const allTab = [...container.querySelectorAll<HTMLButtonElement>('button[role="tab"]')].find(b => b.textContent === 'meet.allProjects')!
    await act(async () => { allTab.click() })
    expect(container.textContent).not.toContain('meet.empty.title')
    expect(container.textContent).not.toContain('meet.empty.desc')
  })

  it('목록 탭은 달을 읽는 동안 빈 상태가 아니라 읽는 중을 보이고, 다 읽으면 결과를 그린다(SP5 B2 — D39)', async () => {
    await mount()
    await openListTab()
    const release = holdFetch()
    await act(async () => { monthBtn('next').click(); await flush() })
    expect(container.querySelector('[data-my-meetings-loading]')?.textContent).toContain('meet.list.loading')
    expect(container.textContent).not.toContain('meet.empty.mineTitle')
    await release({ ok: true, meetings: [], exceptions: [], categories: {} })
    expect(container.querySelector('[data-my-meetings-loading]')).toBeNull()
    expect(container.textContent).toContain('meet.empty.mineTitle')
  })

  it('조회 성공 + 회의 0건이면 종전대로 빈 상태이고 경고는 없다', async () => {
    await mount()
    await openListTab()
    expect(alertEl()).toBeNull()
    expect(container.textContent).toContain('meet.empty.mineTitle')
  })

  it('재시도가 또 실패하면 경고와 재시도 버튼이 남는다', async () => {
    mocks.fetchMyMeetings.mockResolvedValue({ ok: false, error: '회의 일정을 불러오지 못했습니다.' })
    await mount({ initialFailed: true })
    await act(async () => { retryBtn()!.click(); await flush() })
    expect(mocks.fetchMyMeetings).toHaveBeenCalledTimes(1)
    expect(alertEl()?.textContent).toContain('common.loadFailed.meetings')
    expect(retryBtn()).toBeTruthy()
  })

  it('재시도가 도는 동안 버튼은 붙어 있고 aria-busy 로 알린다', async () => {
    let release: (v: unknown) => void = () => {}
    mocks.fetchMyMeetings.mockReturnValue(new Promise(r => { release = r }))
    await mount({ initialFailed: true })
    await act(async () => { retryBtn()!.click(); await flush() })
    expect(retryBtn()?.getAttribute('aria-busy')).toBe('true')
    // 도는 중의 누름은 무시한다 — 같은 조회를 겹쳐 보내지 않는다.
    await act(async () => { retryBtn()!.click(); await flush() })
    expect(mocks.fetchMyMeetings).toHaveBeenCalledTimes(1)
    await act(async () => { release({ ok: true, meetings: [], exceptions: [], categories: {} }); await flush() })
    expect(alertEl()).toBeNull()
  })

  // 아래 셋: 서버 렌더를 다시 읽히는 목적은 화면 갱신이 아니다(페이지 머리에는 조회 결과에서 나오는 값이 없다) —
  // 실패한 서버 결과가 라우터 캐시(staleTimes.dynamic 30초)에 남아 재방문·뒤로가기 때 경고째 다시 쓰이지 않게 한다.
  it('서버 첫 조회가 실패했던 화면은 재시도가 성공하면 서버 렌더도 다시 읽힌다 — 실패한 서버 결과를 캐시에 남기지 않는다', async () => {
    mocks.fetchMyMeetings.mockResolvedValue({ ok: true, meetings: [], exceptions: [], categories: {} })
    await mount({ initialFailed: true })
    await act(async () => { retryBtn()!.click(); await flush() })
    expect(mocks.routerRefresh).toHaveBeenCalledTimes(1)
  })

  it('서버 첫 조회가 실패했어도 달을 옮겨 읽기에 성공하면 서버 렌더를 다시 읽힌다', async () => {
    mocks.fetchMyMeetings.mockResolvedValue({ ok: true, meetings: [], exceptions: [], categories: {} })
    await mount({ initialFailed: true })
    const next = container.querySelector<HTMLButtonElement>('button[aria-label="meet.nextMonth"]')
    await act(async () => { next!.click(); await flush() })
    expect(alertEl()).toBeNull()
    expect(mocks.routerRefresh).toHaveBeenCalledTimes(1)
  })

  it('재시도가 또 실패하면 서버 렌더를 다시 읽히지 않는다', async () => {
    mocks.fetchMyMeetings.mockResolvedValue({ ok: false, error: '회의 일정을 불러오지 못했습니다.' })
    await mount({ initialFailed: true })
    await act(async () => { retryBtn()!.click(); await flush() })
    expect(mocks.routerRefresh).not.toHaveBeenCalled()
  })

  it('달 이동 실패의 재시도는 그 달만 다시 읽는다 — 서버 렌더는 멀쩡하므로 건드리지 않는다', async () => {
    mocks.fetchMyMeetings.mockResolvedValue({ ok: false, error: '회의 일정을 불러오지 못했습니다.' })
    await mount()
    const next = container.querySelector<HTMLButtonElement>('button[aria-label="meet.nextMonth"]')
    await act(async () => { next!.click(); await flush() })
    mocks.fetchMyMeetings.mockResolvedValue({ ok: true, meetings: [meeting({ title: '8월 회의', meetingDate: '2026-08-10' })], exceptions: [], categories: ANY_CATS })
    await act(async () => { retryBtn()!.click(); await flush() })
    expect(mocks.fetchMyMeetings).toHaveBeenCalledTimes(2)
    expect(mocks.fetchMyMeetings).toHaveBeenLastCalledWith('ws-1', '2026-07-26', '2026-09-05')
    expect(mocks.routerRefresh).not.toHaveBeenCalled()
    expect(alertEl()).toBeNull()
    expect(container.textContent).toContain('8월 회의')
  })

  it('호출 자체가 던져도(네트워크 등) 경고로 보이고 로그에 남는다', async () => {
    mocks.fetchMyMeetings.mockRejectedValue(new Error('fetch failed'))
    await mount()
    const next = container.querySelector<HTMLButtonElement>('button[aria-label="meet.nextMonth"]')
    await act(async () => { next!.click(); await flush() })
    expect(alertEl()?.textContent).toContain('common.loadFailed.meetings')
    expect(errSpy.mock.calls.some((c: unknown[]) => String(c[0]).includes('[MyMeetingsView]'))).toBe(true)
  })

  it('정상 결과만 오가면 로그를 남기지 않는다 — 실패 로그가 소음이 되지 않게', async () => {
    mocks.fetchMyMeetings.mockResolvedValue({ ok: true, meetings: [], exceptions: [], categories: {} })
    await mount()
    const next = container.querySelector<HTMLButtonElement>('button[aria-label="meet.nextMonth"]')
    await act(async () => { next!.click(); await flush() })
    expect(alertEl()).toBeNull()
    expect(errSpy).not.toHaveBeenCalled()
  })

  it('조회 실패는 딥링크 대상이 없다는 뜻이 아니다 — 재시도가 성공하면 그 회의 상세를 연다', async () => {
    currentSearch = 'focus=m1'
    mocks.fetchMyMeetings.mockResolvedValue({ ok: true, meetings: [meeting()], exceptions: [], categories: ANY_CATS })
    await mount({ initialFailed: true })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    await act(async () => { retryBtn()!.click(); await flush() })
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('주간 회의')
  })

  it('재시도가 성공해 경고가 사라지면 포커스가 body 로 떨어지지 않는다', async () => {
    mocks.fetchMyMeetings.mockResolvedValue({ ok: true, meetings: [], exceptions: [], categories: {} })
    await mount({ initialFailed: true })
    retryBtn()!.focus()
    expect(document.activeElement).toBe(retryBtn())
    await act(async () => { retryBtn()!.click(); await flush() })
    expect(alertEl()).toBeNull()
    expect(document.activeElement).not.toBe(document.body)
    expect(container.contains(document.activeElement)).toBe(true)
  })

  describe('경고는 실패한 그 달의 것이다', () => {
    it('실패한 달에서 달을 옮기면, 새 달을 읽는 동안에는 앞 달의 경고를 보이지 않는다', async () => {
      await mount({ initialFailed: true })
      expect(alertEl()).not.toBeNull()
      const release = holdFetch()
      await act(async () => { monthBtn('next').click(); await flush() })
      expect(mocks.fetchMyMeetings).toHaveBeenCalledWith('ws-1', '2026-07-26', '2026-09-05')
      // 8월은 아직 실패하지 않았다 — 읽는 중이다.
      expect(alertEl()).toBeNull()
      expect(hasGrid()).toBe(true)
      // 읽는 중에는 아직 성공한 것이 아니다 — 서버 렌더를 다시 읽히지 않는다.
      expect(mocks.routerRefresh).not.toHaveBeenCalled()
      await release(FAIL)
      expect(alertEl()?.textContent).toContain('common.loadFailed.meetings')
      expect(mocks.routerRefresh).not.toHaveBeenCalled()
    })

    it('읽는 중인 달은 목록 탭에 빈 상태(회의 없음)를 그리지 않는다 — 실패 뒤든 정상 뒤든', async () => {
      await mount({ initialFailed: true })
      await openListTab()
      const release = holdFetch()
      await act(async () => { monthBtn('next').click(); await flush() })
      expect(alertEl()).toBeNull()
      expect(container.textContent).not.toContain('meet.empty.mineTitle')
      await release({ ok: true, meetings: [], exceptions: [], categories: {} })
      // 다 읽었고 0건이면 그때 빈 상태다.
      expect(container.textContent).toContain('meet.empty.mineTitle')

      const release2 = holdFetch()
      await act(async () => { monthBtn('next').click(); await flush() })
      expect(container.textContent).not.toContain('meet.empty.mineTitle')
      await release2({ ok: true, meetings: [], exceptions: [], categories: {} })
      expect(container.textContent).toContain('meet.empty.mineTitle')
    })

    it('서버 첫 조회(이번 달)가 실패했어도 딥링크가 다른 달이면, 그 달을 읽는 동안 경고를 보이지 않는다', async () => {
      currentSearch = 'focus=m1&date=2026-09-10'
      const release = holdFetch()
      await mount({ initialFailed: true })
      expect(mocks.fetchMyMeetings).toHaveBeenCalledWith('ws-1', '2026-08-30', '2026-10-10')
      // 실패한 것은 서버가 읽은 7월이지 지금 보이는 9월이 아니다.
      expect(alertEl()).toBeNull()
      await release({ ok: true, meetings: [meeting({ meetingDate: '2026-09-10' })], exceptions: [], categories: ANY_CATS })
      expect(alertEl()).toBeNull()
      expect(document.querySelector('[role="dialog"]')?.textContent).toContain('주간 회의')
    })

    it('실패한 달로 돌아오면 그 달의 경고가 다시 보인다 — 다시 읽는 동안 버튼은 aria-busy', async () => {
      await mount({ initialFailed: true })
      holdFetch()
      await act(async () => { monthBtn('next').click(); await flush() })
      expect(alertEl()).toBeNull()
      const release = holdFetch()
      await act(async () => { monthBtn('prev').click(); await flush() })
      expect(alertEl()?.textContent).toContain('common.loadFailed.meetings')
      expect(retryBtn()?.getAttribute('aria-busy')).toBe('true')
      await release({ ok: true, meetings: [], exceptions: [], categories: {} })
      expect(alertEl()).toBeNull()
    })

    it('다른 달이 이어서 실패하면 경고는 새로 붙는다 — 같은 노드에 같은 글자로 남으면 보조기술이 두 번째 실패를 알리지 못한다', async () => {
      mocks.fetchMyMeetings.mockResolvedValueOnce(FAIL)
      await mount()
      await act(async () => { monthBtn('next').click(); await flush() })
      const august = alertEl()
      expect(august).not.toBeNull()

      const release = holdFetch()
      await act(async () => { monthBtn('next').click(); await flush() })
      expect(alertEl()).toBeNull()
      await release(FAIL)
      const september = alertEl()
      expect(september?.textContent).toContain('common.loadFailed.meetings')
      expect(september).not.toBe(august)
      expect(august!.isConnected).toBe(false)
    })

    it('같은 달의 재시도가 또 실패하면 경고는 같은 노드로 남는다 — 버튼의 포커스를 잃지 않는다', async () => {
      mocks.fetchMyMeetings.mockResolvedValue(FAIL)
      await mount({ initialFailed: true })
      const before = alertEl()
      retryBtn()!.focus()
      await act(async () => { retryBtn()!.click(); await flush() })
      expect(alertEl()).toBe(before)
      expect(document.activeElement).toBe(retryBtn())
    })
  })

  describe('못 읽은 달은 빈 달력으로 그리지 않는다', () => {
    it('initialFailed 면 달력 탭에 격자 없이 경고만, 재시도가 성공하면 격자가 돌아온다', async () => {
      mocks.fetchMyMeetings.mockResolvedValue({ ok: true, meetings: [meeting()], exceptions: [], categories: ANY_CATS })
      await mount({ initialFailed: true })
      expect(alertEl()).not.toBeNull()
      expect(hasGrid()).toBe(false)
      await act(async () => { retryBtn()!.click(); await flush() })
      expect(alertEl()).toBeNull()
      expect(hasGrid()).toBe(true)
      expect(container.textContent).toContain('주간 회의')
    })

    it('달을 옮겨 읽다가 실패하면 격자를 걷고 경고만 남긴다', async () => {
      mocks.fetchMyMeetings.mockResolvedValue(FAIL)
      await mount({ initialMeetings: [meeting()] })
      expect(hasGrid()).toBe(true)
      await act(async () => { monthBtn('next').click(); await flush() })
      expect(alertEl()).not.toBeNull()
      expect(hasGrid()).toBe(false)
    })

    it('조회 성공 + 회의 0건은 빈 달력을 그대로 그린다 — 실패가 아니다', async () => {
      mocks.fetchMyMeetings.mockResolvedValue({ ok: true, meetings: [], exceptions: [], categories: {} })
      await mount()
      expect(hasGrid()).toBe(true)
      await act(async () => { monthBtn('next').click(); await flush() })
      expect(alertEl()).toBeNull()
      expect(hasGrid()).toBe(true)
    })
  })
})
