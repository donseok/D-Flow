import { describe, it, expect, beforeEach } from 'vitest'
import { editSessionStore } from '@/lib/sync/editSession'

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
})
