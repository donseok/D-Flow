import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sheetUndoManager } from '@/lib/sync/sheetUndo'

describe('sheetUndoManager (CAS 기반 되돌리기 계약)', () => {
  beforeEach(() => {
    sheetUndoManager.clear()
  })

  it('저장 요청 시 pending 상태로 쌓이며 서버 확인(ok) 전에는 활성화되지 않는다', () => {
    sheetUndoManager.pushPending({
      sessionId: 's-1',
      targetId: 'item-1',
      field: 'actualPct',
      previousValue: 50,
      appliedValue: 60,
      revert: vi.fn(),
    })

    // pending 상태는 바로 되돌리기 불가
    expect(sheetUndoManager.canUndo()).toBe(false)
    expect(sheetUndoManager.activeCount).toBe(0)

    // 서버 확인 후 활성화
    const activated = sheetUndoManager.confirmActive('s-1')
    expect(activated).toBe(true)
    expect(sheetUndoManager.canUndo()).toBe(true)
    expect(sheetUndoManager.activeCount).toBe(1)
  })

  it('서버 저장이 실패하면 pending 항목이 제거된다', () => {
    sheetUndoManager.pushPending({
      sessionId: 's-1',
      targetId: 'item-1',
      field: 'actualPct',
      previousValue: 50,
      appliedValue: 60,
      revert: vi.fn(),
    })

    const rejected = sheetUndoManager.rejectPending('s-1')
    expect(rejected).toBe(true)
    expect(sheetUndoManager.canUndo()).toBe(false)
  })

  it('현재 값 == 내가 쓴 값(appliedValue)일 때 정상적으로 되돌리기가 수행된다', async () => {
    const revertFn = vi.fn().mockResolvedValue({ ok: true })

    sheetUndoManager.pushPending({
      sessionId: 's-1',
      targetId: 'item-1',
      field: 'actualPct',
      previousValue: 50,
      appliedValue: 60,
      revert: revertFn,
    })
    sheetUndoManager.confirmActive('s-1')

    // 현재 셀 값이 60이라고 알림
    const getCurrentValue = vi.fn(() => 60)

    const res = await sheetUndoManager.undo(getCurrentValue)
    expect(res.ok).toBe(true)
    expect(revertFn).toHaveBeenCalledWith({
      expectedCurrent: 60,
      targetValue: 50,
    })
    // 되돌린 후 스택에서 제거
    expect(sheetUndoManager.canUndo()).toBe(false)
  })

  it('다른 사용자가 그 사이에 값을 변경한 경우(CAS 불일치) 무통보 덮어쓰기를 막고 충돌을 반환한다', async () => {
    const revertFn = vi.fn().mockResolvedValue({ ok: true })

    sheetUndoManager.pushPending({
      sessionId: 's-1',
      targetId: 'item-1',
      field: 'actualPct',
      previousValue: 50,
      appliedValue: 60,
      revert: revertFn,
    })
    sheetUndoManager.confirmActive('s-1')

    // 다른 사용자가 70으로 바꿈
    const getCurrentValue = vi.fn(() => 70)

    const res = await sheetUndoManager.undo(getCurrentValue)
    expect(res.ok).toBe(false)
    expect(res.conflict).toBe(true)
    // 서버 revert 함수는 호출되지 않아야 함
    expect(revertFn).not.toHaveBeenCalled()
  })

  it('서버 측에서 CAS 충돌이 발생한 경우에도 conflict를 반환한다', async () => {
    const revertFn = vi.fn().mockResolvedValue({ ok: false, conflict: true, error: '서버 충돌' })

    sheetUndoManager.pushPending({
      sessionId: 's-1',
      targetId: 'item-1',
      field: 'actualPct',
      previousValue: 50,
      appliedValue: 60,
      revert: revertFn,
    })
    sheetUndoManager.confirmActive('s-1')

    const getCurrentValue = vi.fn(() => 60)

    const res = await sheetUndoManager.undo(getCurrentValue)
    expect(res.ok).toBe(false)
    expect(res.conflict).toBe(true)
    expect(res.error).toContain('서버 충돌')
  })
})
