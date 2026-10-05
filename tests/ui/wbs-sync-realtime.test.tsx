import { beforeEach, describe, expect, it, vi } from 'vitest'
import { editSessionStore } from '@/lib/sync/editSession'
import { sheetUndoManager } from '@/lib/sync/sheetUndo'

describe('WBS 동기화·되돌리기·실시간 규칙 (D6-§8)', () => {
  beforeEach(() => {
    editSessionStore.clearAll()
    editSessionStore.setConnectionState('online')
    sheetUndoManager.clear()
  })

  it('실시간 규칙 2: 편집 중인 셀에 원격 변경이 도착하면 충돌 세션으로 보관된다', () => {
    // 1. 사용자가 셀 편집 시작
    const sessionId = 'wbs:item-1:actual'
    editSessionStore.setSession(sessionId, 'wbs_cell', 'item-1:actual', 'editing')
    expect(editSessionStore.getSession(sessionId)?.state).toBe('editing')

    // 2. 원격 변경(payload) 수신 시 충돌 후보로 전환
    editSessionStore.setSession(sessionId, 'wbs_cell', 'item-1:actual', 'conflict', {
      error: { kind: 'conflict', message: '다른 사용자가 값을 변경했습니다.' },
    })

    const session = editSessionStore.getSession(sessionId)
    expect(session?.state).toBe('conflict')
    const errKind = typeof session?.error === 'object' ? session.error?.kind : undefined
    expect(errKind).toBe('conflict')
    // needsAttentionCount가 1 이상이 되어 SyncStatus에서 확인 필요로 표시됨
    expect(editSessionStore.getSummary().needsAttentionCount).toBe(1)
  })

  it('실시간 규칙 5: 끊겼다 재연결 시(onReconnect) 연결 상태가 online으로 회복된다', () => {
    editSessionStore.setConnectionState('offline')
    expect(editSessionStore.getSummary().connectionState).toBe('offline')

    // onReconnect 트리거
    editSessionStore.setConnectionState('online')
    expect(editSessionStore.getSummary().connectionState).toBe('online')
  })

  it('되돌리기(Undo CAS): 셀 저장 성공 후 undo 실행 시 올바른 CAS 역명령이 실행된다', async () => {
    const revertMock = vi.fn().mockResolvedValue({ ok: true })

    const sessionId = 'wbs:item-1:actual'
    sheetUndoManager.pushPending({
      sessionId,
      targetId: 'item-1',
      field: 'actual',
      previousValue: 20,
      appliedValue: 80,
      revert: revertMock,
    })

    // 서버 저장 전에는 undo 불가
    expect(sheetUndoManager.canUndo()).toBe(false)

    // 서버 저장 성공 -> active
    sheetUndoManager.confirmActive(sessionId)
    expect(sheetUndoManager.canUndo()).toBe(true)

    // undo 실행
    const undoRes = await sheetUndoManager.undo()
    expect(undoRes.ok).toBe(true)
    expect(revertMock).toHaveBeenCalledWith({
      expectedCurrent: 80,
      targetValue: 20,
    })
    expect(sheetUndoManager.canUndo()).toBe(false)
  })
})
