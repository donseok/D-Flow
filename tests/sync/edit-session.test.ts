import { describe, it, expect, beforeEach } from 'vitest'
import { classifyCasOutcome, editSessionStore } from '@/lib/sync/editSession'

describe('editSessionStore', () => {
  beforeEach(() => {
    editSessionStore.clearAll()
    editSessionStore.setConnectionState('online')
  })

  it('기본 상태에서는 세션이 없고 fullySynced 이다', () => {
    const summary = editSessionStore.getSummary()
    expect(summary.connectionState).toBe('online')
    expect(summary.savingCount).toBe(0)
    expect(summary.needsAttentionCount).toBe(0)
    expect(summary.isFullySynced).toBe(true)
  })

  it('saving 상태 세션이 있으면 savingCount가 증가하고 isFullySynced는 false가 된다', () => {
    editSessionStore.setSession('session-1', 'wbs', 'item-10', 'saving')
    const summary = editSessionStore.getSummary()
    expect(summary.savingCount).toBe(1)
    expect(summary.isFullySynced).toBe(false)
  })

  it('saved 상태로 전이되면 lastSavedAt이 갱신되고 isFullySynced는 true가 된다', () => {
    const session = editSessionStore.setSession('session-1', 'wbs', 'item-10', 'saved')
    expect(session.lastSavedAt).toBeGreaterThan(0)
    const summary = editSessionStore.getSummary()
    expect(summary.savingCount).toBe(0)
    expect(summary.needsAttentionCount).toBe(0)
    expect(summary.isFullySynced).toBe(true)
  })

  it('failed, conflict, outcome_unknown 상태는 needsAttentionCount로 집계된다', () => {
    editSessionStore.setSession('s-1', 'wbs', 'i-1', 'failed', '네트워크 오류')
    editSessionStore.setSession('s-2', 'wbs', 'i-2', 'conflict', '충돌 발생')
    editSessionStore.setSession('s-3', 'wbs', 'i-3', 'outcome_unknown')

    const summary = editSessionStore.getSummary()
    expect(summary.failedCount).toBe(1)
    expect(summary.conflictCount).toBe(1)
    expect(summary.outcomeUnknownCount).toBe(1)
    expect(summary.needsAttentionCount).toBe(3)
    expect(summary.isFullySynced).toBe(false)
  })

  it('오프라인 상태에서는 isFullySynced가 false가 된다', () => {
    editSessionStore.setConnectionState('offline')
    const summary = editSessionStore.getSummary()
    expect(summary.connectionState).toBe('offline')
    expect(summary.isFullySynced).toBe(false)
  })

  it('구독자에게 변경 사항이 통지된다', () => {
    let callCount = 0
    const unsubscribe = editSessionStore.subscribe(() => {
      callCount++
    })

    editSessionStore.setSession('s-1', 'wbs', 'i-1', 'saving')
    expect(callCount).toBe(1)

    editSessionStore.setSession('s-1', 'wbs', 'i-1', 'saved')
    expect(callCount).toBe(2)

    unsubscribe()
    editSessionStore.setSession('s-1', 'wbs', 'i-1', 'idle')
    expect(callCount).toBe(2)
  })

  it('editing(저장 전 초안)은 editingCount 로 집계되고 isFullySynced 를 내린다 — 확인 필요에는 들지 않는다', () => {
    editSessionStore.setSession('s-1', 'wbs_cell', 'i-1', 'editing')
    expect(editSessionStore.getSummary()).toMatchObject({ editingCount: 1, needsAttentionCount: 0, isFullySynced: false })
    editSessionStore.removeSession('s-1')
    expect(editSessionStore.getSummary()).toMatchObject({ editingCount: 0, isFullySynced: true })
  })

  it('removeWhere 는 고른 세션만 걷고 한 번만 통지한다. 고른 것이 없으면 통지하지 않는다', () => {
    editSessionStore.setSession('a', 'wbs_cell', 'i-1', 'editing')
    editSessionStore.setSession('b', 'wbs_cell', 'i-2', 'saving')
    editSessionStore.setSession('c', 'kanban', 'i-3', 'failed')
    let calls = 0
    const off = editSessionStore.subscribe(() => { calls++ })
    editSessionStore.removeWhere(x => x.surface === 'wbs_cell' && x.status !== 'saving' && x.status !== 'saved')
    expect([editSessionStore.getSession('a'), editSessionStore.getSession('b')?.status, editSessionStore.getSession('c')?.status]).toEqual([undefined, 'saving', 'failed'])
    expect(calls).toBe(1)
    editSessionStore.removeWhere(() => false)
    expect(calls).toBe(1)
    off()
  })
})

describe('classifyCasOutcome — 응답을 잃은 값 CAS 저장의 결과 판정(Q10)', () => {
  it('서버 값이 내 값이면 반영됨, 편집 시작 값 그대로면 미반영, 둘 다 아니면 충돌', () => {
    expect(classifyCasOutcome({ mine: 60, base: 50, latest: 60 })).toBe('applied')
    expect(classifyCasOutcome({ mine: 60, base: 50, latest: 50 })).toBe('not_applied')
    expect(classifyCasOutcome({ mine: 60, base: 50, latest: 70 })).toBe('conflict')
  })
  it('같음 판정을 넘겨받는다(null 과 0 을 같게 보는 실적% 등)', () => {
    const same = (a: number | null, b: number | null) => Number(a ?? 0) === Number(b ?? 0)
    expect(classifyCasOutcome<number | null>({ mine: 0, base: 50, latest: null }, same)).toBe('applied')
    expect(classifyCasOutcome<number | null>({ mine: 60, base: null, latest: 0 }, same)).toBe('not_applied')
  })
})
