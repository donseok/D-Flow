// @vitest-environment jsdom
// 칸반 이동의 실패·충돌·응답 유실(개정 §5.8.7 칸반 — D6-§2-kanban, SPU1 Q05·Q10). 실패해도 카드는 의도한 위치에 남고 재시도가 실제로
// 나간다. 그새 다른 사람이 바꿨으면 비교를 띄우고, 응답을 잃으면 서버 값을 읽어 가린다 — 어느 길로도 알리지 않고 덮지 않는다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ComputedItem } from '@/lib/domain/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const h = vi.hoisted(() => ({ actual: vi.fn(), snapshot: vi.fn(), toast: vi.fn(), refresh: vi.fn() }))
vi.mock('@/app/actions/wbs', () => ({ updateActual: h.actual, getWbsCellSnapshot: h.snapshot }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh, push: vi.fn() }), useSearchParams: () => new URLSearchParams('') }))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ locale: 'ko', t: (k: string) => k }) }))
vi.mock('@/components/app/TeamsProvider', () => ({ useTeamCodes: () => ['PMO'], useTeams: () => [], useTeamSlot: () => () => ({ fg: 'text-neutral', bar: 'bg-neutral', chip: 'bg-neutral-weak text-neutral' }) }))
vi.mock('@/components/chat/BotPageContextProvider', () => ({ useBotPageContext: () => {} }))
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ toast: h.toast }) }))

import { KanbanBoard } from '@/components/kanban/KanbanBoard'
import { editSessionStore } from '@/lib/sync/editSession'
import { makeProjectActorView } from '../fixtures/actor'

const ADMIN = makeProjectActorView({ userId: 'u-admin', projectRole: 'admin', memberId: 'm-admin', rosterTeamIds: ['t-pmo'], rosterTeamCodes: ['PMO'], primaryTeamCode: 'PMO' })
const leaf = (pct: number): ComputedItem => ({
  id: 'L50', parentId: null, code: 'L50', sortOrder: 0, name: '설계 검토', biz: null, deliverable: null,
  plannedStart: '2026-07-01', plannedEnd: '2026-07-30', weight: null, actualPct: pct, owners: [{ team: 'PMO', kind: 'primary' }], isOwnerSplit: false,
  plannedPct: 0, rolledActualPct: pct, achievement: null, status: 'in_progress', children: [], depth: 0,
})

describe('KanbanBoard — 이동 실패·충돌·응답 유실', () => {
  let container: HTMLDivElement, root: Root
  const show = (pct: number) => act(async () => root.render(<KanbanBoard projectId="p1" items={[leaf(pct)]} actorView={ADMIN} today="2026-07-25" />))
  beforeEach(async () => {
    vi.clearAllMocks()
    editSessionStore.clearAll()
    editSessionStore.setConnectionState('online')
    window.localStorage.clear()
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
    await show(50)
  })
  afterEach(async () => { await act(async () => root.unmount()); container.remove() })

  const complete = () => act(async () => [...container.querySelectorAll('button')].find(b => b.textContent?.includes('kanban.complete'))!.click())
  const banner = () => container.querySelector<HTMLElement>('[data-testid="kanban-failed-move"]')
  const bannerButton = (text: string) => [...banner()!.querySelectorAll('button')].find(b => b.textContent?.includes(text))!
  const dialog = () => document.querySelector<HTMLElement>('[data-testid="conflict-resolver"]')
  const choose = (action: 'mine' | 'latest' | 'continue') => act(async () => dialog()!.querySelector<HTMLButtonElement>(`[data-conflict-action="${action}"]`)!.click())
  const values = () => (['mine', 'latest', 'base'] as const).map(w => dialog()!.querySelector(`[data-conflict-value="${w}"]`)?.textContent)
  const session = () => editSessionStore.getSession('kanban:L50')?.status

  it('실패하면 카드는 의도한 위치(100%)에 남고 실패 표시가 붙는다. 헤더는 확인 필요다', async () => {
    h.actual.mockResolvedValueOnce({ ok: false, error: 'x' })
    await complete()
    expect(banner()).not.toBeNull()
    expect(container.textContent).toContain('100%')
    expect(session()).toBe('failed')
    expect(editSessionStore.getSummary()).toMatchObject({ needsAttentionCount: 1, isFullySynced: false })
  })

  it('재시도는 실제로 다시 나간다 — 의도한 값(100)을 서버가 준 원본 값(50) 기준으로', async () => {
    h.actual.mockResolvedValueOnce({ ok: false, error: 'x' })
    await complete()
    h.actual.mockResolvedValueOnce({ ok: true })
    await act(async () => bannerButton('재시도').click())
    expect(h.actual).toHaveBeenCalledTimes(2)
    expect(h.actual).toHaveBeenLastCalledWith('L50', 100, 50)
    expect(banner()).toBeNull()
    expect(session()).toBe('saved')
  })

  it('원위치는 쓰지 않고 의도를 거둔다', async () => {
    h.actual.mockResolvedValueOnce({ ok: false, error: 'x' })
    await complete()
    await act(async () => bannerButton('원위치').click())
    expect(h.actual).toHaveBeenCalledTimes(1)
    expect(banner()).toBeNull()
    expect(session()).toBeUndefined()
    expect(editSessionStore.getSummary().isFullySynced).toBe(true)
  })

  it('Q05 — 그새 서버 값이 70 이 됐으면 비교를 띄운다. 내 값으로 저장은 70 을 기대값으로 한 번만 쓴다', async () => {
    h.actual.mockResolvedValueOnce({ ok: false, conflict: true, error: 'x', latest: 70 })
    await complete()
    expect(values()).toEqual(['100%', '70%', '50%'])
    expect(session()).toBe('conflict')
    expect(h.refresh).not.toHaveBeenCalled()
    h.actual.mockResolvedValueOnce({ ok: true })
    await choose('mine')
    expect(h.actual).toHaveBeenCalledTimes(2)
    expect(h.actual).toHaveBeenLastCalledWith('L50', 100, 70)
    expect(dialog()).toBeNull()
    expect(banner()).toBeNull()
  })

  it('Q05 — 서버 값 받기는 쓰지 않고 새로 읽는다. 계속 편집은 쓰지 않고 실패 표시(의도)를 남긴다', async () => {
    h.actual.mockResolvedValueOnce({ ok: false, conflict: true, error: 'x', latest: 70 })
    await complete()
    await choose('continue')
    expect(h.actual).toHaveBeenCalledTimes(1)
    expect(banner()).not.toBeNull()
    expect(container.textContent).toContain('100%')
    // 표시의 재시도는 옛 기준(50)으로 나간다 — 서버가 다시 충돌로 답하면 다시 비교한다(기대값 없이 밀어 넣지 않는다)
    h.actual.mockResolvedValueOnce({ ok: false, conflict: true, error: 'x', latest: 70 })
    await act(async () => bannerButton('재시도').click())
    expect(h.actual).toHaveBeenLastCalledWith('L50', 100, 50)
    await choose('latest')
    expect(h.actual).toHaveBeenCalledTimes(2)
    expect(banner()).toBeNull()
    expect(h.refresh).toHaveBeenCalledTimes(1)
    expect(session()).toBeUndefined()
  })

  it('Q10 — 응답을 잃었고 서버 값이 내 값(100)이면 반영된 것이다. 다시 보내지 않는다', async () => {
    h.actual.mockRejectedValueOnce(new Error('network'))
    h.snapshot.mockResolvedValueOnce({ ok: true, actualPct: 100, weight: null, custom: {} })
    await complete()
    expect(h.actual).toHaveBeenCalledTimes(1)
    expect(h.snapshot).toHaveBeenCalledWith('L50')
    expect(banner()).toBeNull()
    expect(session()).toBe('saved')
  })

  it('Q10 — 응답을 잃었고 서버 값이 그대로(50)면 미반영이다. 의도를 남기고 재시도할 수 있다', async () => {
    h.actual.mockRejectedValueOnce(new Error('network'))
    h.snapshot.mockResolvedValueOnce({ ok: true, actualPct: 50, weight: null, custom: {} })
    await complete()
    expect(h.actual).toHaveBeenCalledTimes(1)
    expect(banner()?.textContent).toContain('common.outcomeNotApplied')
    expect(session()).toBe('failed')
  })

  it('Q10 — 응답을 잃었고 제3의 값(70)이면 비교로, 결과 조회도 실패하면 확인 필요(outcome_unknown)로 남는다', async () => {
    h.actual.mockRejectedValueOnce(new Error('network'))
    h.snapshot.mockResolvedValueOnce({ ok: true, actualPct: 70, weight: null, custom: {} })
    await complete()
    expect(values()).toEqual(['100%', '70%', '50%'])
    await choose('latest')
    h.actual.mockRejectedValueOnce(new Error('network'))
    h.snapshot.mockRejectedValueOnce(new Error('network'))
    await complete()
    expect(banner()?.textContent).toContain('common.outcomeUnknown')
    expect(session()).toBe('outcome_unknown')
    // 재시도는 같은 기대값의 CAS 다 — 앞선 이동이 반영돼 있었다면 서버가 충돌(값 100)로 답하고 화면은 반영으로 읽는다
    h.actual.mockResolvedValueOnce({ ok: false, conflict: true, error: 'x', latest: 100 })
    await act(async () => bannerButton('재시도').click())
    expect(dialog()).toBeNull()
    expect(banner()).toBeNull()
    expect(session()).toBe('saved')
  })

  it('재시도 전에 서버가 이미 그 값이 됐으면(새 props) 쓰지 않고 실패 표시만 걷는다', async () => {
    h.actual.mockResolvedValueOnce({ ok: false, error: 'x' })
    await complete()
    await show(100)
    expect(banner()).not.toBeNull()
    await act(async () => bannerButton('재시도').click())
    expect(h.actual).toHaveBeenCalledTimes(1)
    expect(banner()).toBeNull()
  })
})
