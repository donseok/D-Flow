// @vitest-environment jsdom
// WBS 시트 셀 저장의 충돌·응답 유실(개정 §5.8, SPU1 완료 조건 Q05·Q10). A 가 50 → 60 을 쓰는 중에 B 가 70 을 저장하면 A 에게 비교가 뜨고,
// 어느 길로도 알리지 않고 덮어쓰지 않는다. 응답을 잃으면 서버 값을 읽어 반영 여부를 가리고 무조건 다시 보내지 않는다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ComputedItem } from '@/lib/domain/types'
import { makeProjectActorView } from '../fixtures/actor'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const h = vi.hoisted(() => ({ actual: vi.fn(), weight: vi.fn(), snapshot: vi.fn(), refresh: vi.fn() }))
vi.mock('@/app/actions/wbs', () => ({ updateActual: h.actual, updateWeight: h.weight, getWbsCellSnapshot: h.snapshot, addWbsItem: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh, push: vi.fn() }) }))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ locale: 'ko', t: (k: string) => k }) }))
vi.mock('@/components/wbs/RowDetailPanel', () => ({ RowDetailPanel: () => null }))
vi.mock('@/lib/prefs/debouncedSave', () => ({ queueWbsCollapse: vi.fn() }))

import { WbsGanttSheet } from '@/components/wbs/WbsGanttSheet'
import { editSessionStore } from '@/lib/sync/editSession'
import { sheetUndoManager } from '@/lib/sync/sheetUndo'
import { calInputUtcMon } from '../helpers/calendarFixture'

const admin = makeProjectActorView({ userId: 'u-a', projectRole: 'admin', memberId: 'm-a', rosterTeamIds: ['tp'], rosterTeamCodes: ['PMO'], primaryTeamCode: 'PMO' })
const leaf: ComputedItem = {
  id: 't1', parentId: null, code: '1', sortOrder: 0, name: '설계 검토', biz: null, deliverable: null,
  plannedStart: '2026-07-01', plannedEnd: '2026-07-10', weight: 0.4, actualPct: 50, owners: [{ team: 'PMO', kind: 'primary' }], isOwnerSplit: false,
  plannedPct: 0, rolledActualPct: 50, achievement: null, status: 'in_progress', children: [], depth: 0,
}

describe('WbsGanttSheet — 셀 저장 충돌과 응답 유실(Q05·Q10)', () => {
  let container: HTMLDivElement, root: Root
  beforeEach(async () => {
    vi.clearAllMocks()
    editSessionStore.clearAll()
    editSessionStore.setConnectionState('online')
    sheetUndoManager.clear()
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
    await act(async () => root.render(
      <WbsGanttSheet levelLabels={['Task']} items={[leaf]} calendar={calInputUtcMon} today="2026-07-03" actorView={admin} projectId="p1" />,
    ))
  })
  afterEach(async () => { await act(async () => root.unmount()); container.remove() })

  const input = (field: 'Actual' | 'Weight') => container.querySelector<HTMLInputElement>(`input[aria-label="wbs.ariaEdit${field}"]`)
  const dialog = () => document.querySelector<HTMLElement>('[data-testid="conflict-resolver"]')
  const choose = (action: 'mine' | 'latest' | 'continue') => act(async () => dialog()!.querySelector<HTMLButtonElement>(`[data-conflict-action="${action}"]`)!.click())
  const values = () => (['mine', 'latest', 'base'] as const).map(w => dialog()!.querySelector(`[data-conflict-value="${w}"]`)?.textContent)
  const session = (field: 'actual' | 'weight') => editSessionStore.getSession(`wbs:t1:${field}`)?.status
  /** 실적% 셀에 들어가 값을 치고 Enter — A 의 50 → 60 */
  async function typeActual(v: string) {
    await act(async () => container.querySelector<HTMLElement>('[title="wbs.editActualTitle"]')!.click())
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(input('Actual'), v)
      input('Actual')!.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => { input('Actual')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
  }

  it('Q05 — 그새 서버 값이 70 이 됐으면 저장하지 않고 비교를 띄운다. 편집기와 내 입력 60 은 그대로다', async () => {
    h.actual.mockResolvedValueOnce({ ok: false, conflict: true, error: 'x', latest: 70 })
    await typeActual('60')
    expect(h.actual).toHaveBeenCalledTimes(1)
    expect(h.actual).toHaveBeenCalledWith('t1', 60, 50)
    expect(dialog()).not.toBeNull()
    expect(values()).toEqual(['60%', '70%', '50%'])
    expect(dialog()!.textContent).toContain('설계 검토')
    expect(input('Actual')?.value).toBe('60')
    expect(h.refresh).not.toHaveBeenCalled()
    expect(session('actual')).toBe('conflict')
    expect(editSessionStore.getSummary().isFullySynced).toBe(false)
    expect(sheetUndoManager.canUndo()).toBe(false)
  })

  it('Q05 — 내 값으로 저장: 본 서버 값(70)을 기대값으로 한 번만 다시 쓴다', async () => {
    h.actual.mockResolvedValueOnce({ ok: false, conflict: true, error: 'x', latest: 70 })
    await typeActual('60')
    h.actual.mockResolvedValueOnce({ ok: true })
    await choose('mine')
    expect(h.actual).toHaveBeenCalledTimes(2)
    expect(h.actual).toHaveBeenLastCalledWith('t1', 60, 70)
    expect(dialog()).toBeNull()
    expect(input('Actual')).toBeNull()
    expect(session('actual')).toBe('saved')
    // 되돌리기는 서버가 확인한 저장만 — 역명령의 기대값은 내가 쓴 60, 돌아갈 값은 내가 덮은 70 이다
    expect(sheetUndoManager.getLatestActive()).toMatchObject({ previousValue: 70, appliedValue: 60 })
  })

  it('Q05 — 다시 저장하는 사이 또 바뀌었으면(80) 또 비교한다 — 기대값 없이 밀어 넣지 않는다', async () => {
    h.actual.mockResolvedValueOnce({ ok: false, conflict: true, error: 'x', latest: 70 })
    await typeActual('60')
    h.actual.mockResolvedValueOnce({ ok: false, conflict: true, error: 'x', latest: 80 })
    await choose('mine')
    expect(h.actual).toHaveBeenCalledTimes(2)
    expect(values()).toEqual(['60%', '80%', '70%'])
    expect(input('Actual')?.value).toBe('60')
  })

  it('Q05 — 서버 값 받기: 쓰지 않는다. 편집기를 닫고 새로 읽는다', async () => {
    h.actual.mockResolvedValueOnce({ ok: false, conflict: true, error: 'x', latest: 70 })
    await typeActual('60')
    await choose('latest')
    expect(h.actual).toHaveBeenCalledTimes(1)
    expect(dialog()).toBeNull()
    expect(input('Actual')).toBeNull()
    expect(h.refresh).toHaveBeenCalledTimes(1)
    expect(session('actual')).toBeUndefined()
  })

  it('Q05 — 계속 편집: 쓰지 않고 내 입력이 남는다. 다시 저장하면 옛 기준(50) 그대로라 다시 비교한다', async () => {
    h.actual.mockResolvedValueOnce({ ok: false, conflict: true, error: 'x', latest: 70 })
    await typeActual('60')
    await choose('continue')
    expect(h.actual).toHaveBeenCalledTimes(1)
    expect(dialog()).toBeNull()
    expect(input('Actual')?.value).toBe('60')
    expect(session('actual')).toBe('editing')
    expect(editSessionStore.getSummary().isFullySynced).toBe(false)
    h.actual.mockResolvedValueOnce({ ok: false, conflict: true, error: 'x', latest: 70 })
    await act(async () => { input('Actual')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    expect(h.actual).toHaveBeenLastCalledWith('t1', 60, 50)
    expect(dialog()).not.toBeNull()
  })

  it('비교가 떠 있는 동안의 포커스 이탈(blur)은 저장이 아니다', async () => {
    h.actual.mockResolvedValueOnce({ ok: false, conflict: true, error: 'x', latest: 70 })
    await typeActual('60')
    await act(async () => { input('Actual')!.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })
    expect(h.actual).toHaveBeenCalledTimes(1)
  })

  it('충돌인데 서버 값이 이미 내 값이면(앞선 내 저장이 반영돼 있었다) 비교 없이 저장됨으로 닫는다', async () => {
    h.actual.mockResolvedValueOnce({ ok: false, conflict: true, error: 'x', latest: 60 })
    await typeActual('60')
    expect(dialog()).toBeNull()
    expect(input('Actual')).toBeNull()
    expect(h.actual).toHaveBeenCalledTimes(1)
    expect(session('actual')).toBe('saved')
  })

  it('서버가 현재 값을 주지 못한 충돌은 비교할 것이 없다 — 알리고 새로 읽는다(쓰지 않는다)', async () => {
    h.actual.mockResolvedValueOnce({ ok: false, conflict: true, error: 'x' })
    await typeActual('60')
    expect(dialog()).toBeNull()
    expect(h.actual).toHaveBeenCalledTimes(1)
    expect(h.refresh).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('wbs.toastYourValue: 60')
  })

  it('Q10 — 응답을 잃었고 서버 값이 내 값(60)이면 반영된 것이다. 다시 보내지 않는다', async () => {
    h.actual.mockRejectedValueOnce(new Error('network'))
    h.snapshot.mockResolvedValueOnce({ ok: true, actualPct: 60, weight: 0.4, custom: {} })
    await typeActual('60')
    expect(h.actual).toHaveBeenCalledTimes(1)
    expect(h.snapshot).toHaveBeenCalledWith('t1')
    expect(input('Actual')).toBeNull()
    expect(session('actual')).toBe('saved')
    expect(sheetUndoManager.canUndo()).toBe(true)
  })

  it('Q10 — 응답을 잃었고 서버 값이 그대로(50)면 미반영이다. 입력을 지키고 다시 저장할 수 있다', async () => {
    h.actual.mockRejectedValueOnce(new Error('network'))
    h.snapshot.mockResolvedValueOnce({ ok: true, actualPct: 50, weight: 0.4, custom: {} })
    await typeActual('60')
    expect(h.actual).toHaveBeenCalledTimes(1)
    expect(input('Actual')?.value).toBe('60')
    expect(session('actual')).toBe('failed')
    expect(container.textContent).toContain('common.outcomeNotApplied')
    expect(sheetUndoManager.canUndo()).toBe(false)
    h.actual.mockResolvedValueOnce({ ok: true })
    await act(async () => { input('Actual')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    expect(h.actual).toHaveBeenLastCalledWith('t1', 60, 50)
    expect(session('actual')).toBe('saved')
  })

  it('Q10 — 응답을 잃었고 서버 값이 제3의 값(70)이면 비교로 간다', async () => {
    h.actual.mockRejectedValueOnce(new Error('network'))
    h.snapshot.mockResolvedValueOnce({ ok: true, actualPct: 70, weight: 0.4, custom: {} })
    await typeActual('60')
    expect(h.actual).toHaveBeenCalledTimes(1)
    expect(values()).toEqual(['60%', '70%', '50%'])
  })

  it('Q10 — 결과 조회도 실패하면 확인 필요로 남는다(실패로도 성공으로도 단정하지 않는다). 입력은 그대로다', async () => {
    h.actual.mockRejectedValueOnce(new Error('network'))
    h.snapshot.mockRejectedValueOnce(new Error('network'))
    await typeActual('60')
    expect(h.actual).toHaveBeenCalledTimes(1)
    expect(input('Actual')?.value).toBe('60')
    expect(session('actual')).toBe('outcome_unknown')
    expect(editSessionStore.getSummary().outcomeUnknownCount).toBe(1)
    expect(container.textContent).toContain('common.outcomeUnknown')
    // 다시 저장하면 같은 기대값(50)의 CAS 다 — 앞선 저장이 반영돼 있었다면 서버가 충돌로 답하고(값 60), 화면은 그것을 반영으로 읽는다
    h.actual.mockResolvedValueOnce({ ok: false, conflict: true, error: 'x', latest: 60 })
    await act(async () => { input('Actual')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    expect(h.actual).toHaveBeenCalledTimes(2)
    expect(h.actual).toHaveBeenLastCalledWith('t1', 60, 50)
    expect(dialog()).toBeNull()
    expect(session('actual')).toBe('saved')
  })

  it('가중치 셀도 같다 — 충돌은 비교로, 내 값으로 저장은 본 값(0.7)을 기대값으로', async () => {
    await act(async () => container.querySelector<HTMLElement>('[title="wbs.editWeightTitle"]')!.click())
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(input('Weight'), '60')
      input('Weight')!.dispatchEvent(new Event('input', { bubbles: true }))
    })
    h.weight.mockResolvedValueOnce({ ok: false, conflict: true, error: 'x', latest: 0.7 })
    await act(async () => { input('Weight')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    expect(h.weight).toHaveBeenCalledWith('t1', 0.6, 0.4)
    expect(values()).toEqual(['60%', '70%', '40%'])
    h.weight.mockResolvedValueOnce({ ok: true })
    await choose('mine')
    expect(h.weight).toHaveBeenCalledTimes(2)
    expect(h.weight).toHaveBeenLastCalledWith('t1', 0.6, 0.7)
    expect(input('Weight')).toBeNull()
  })

  it('편집을 시작하면 저장 전 초안이라 동기화됨이 아니다. Esc 로 취소하면 돌아온다', async () => {
    expect(editSessionStore.getSummary().isFullySynced).toBe(true)
    await act(async () => container.querySelector<HTMLElement>('[title="wbs.editActualTitle"]')!.click())
    expect(editSessionStore.getSummary()).toMatchObject({ editingCount: 1, isFullySynced: false })
    await act(async () => { input('Actual')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(editSessionStore.getSummary()).toMatchObject({ editingCount: 0, isFullySynced: true })
  })

  it('화면이 내려가면 끝나지 않은 셀 세션을 걷는다 — 사라진 편집기의 초안이 헤더에 남지 않는다', async () => {
    await act(async () => container.querySelector<HTMLElement>('[title="wbs.editActualTitle"]')!.click())
    expect(editSessionStore.getSummary().editingCount).toBe(1)
    await act(async () => root.render(<div />))
    expect(editSessionStore.getSummary()).toMatchObject({ editingCount: 0, isFullySynced: true })
  })
})
