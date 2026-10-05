// @vitest-environment jsdom
import { act, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { useWbsGridFocus } from '@/components/wbs/useWbsGridFocus'

function keyEvent(over: Partial<ReactKeyboardEvent> = {}): ReactKeyboardEvent {
  return {
    key: '',
    shiftKey: false,
    preventDefault: () => {},
    stopPropagation: () => {},
    nativeEvent: new globalThis.KeyboardEvent('keydown'),
    ...over,
  } as unknown as ReactKeyboardEvent
}

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

function renderHook<T>(callback: () => T) {
  const result = { current: null as unknown as T }
  function TestComponent() {
    result.current = callback()
    return null
  }
  const div = document.createElement('div')
  document.body.append(div)
  const root = createRoot(div)
  act(() => {
    root.render(<TestComponent />)
  })
  return {
    result,
    rerender: () => {
      act(() => {
        root.render(<TestComponent />)
      })
    },
    unmount: () => {
      act(() => {
        root.unmount()
      })
      div.remove()
    },
  }
}

describe('useWbsGridFocus (WBS 그리드 키보드 & itemId+fieldId 포커스 모델)', () => {
  const initialRows = [{ id: 'item-1' }, { id: 'item-2' }, { id: 'item-3' }]
  const columns = ['name', 'weight', 'pactual', 'deliverable']

  it('기본 상태에서는 activeCell이 null이다', () => {
    const { result } = renderHook(() =>
      useWbsGridFocus({
        rows: initialRows,
        columns,
      })
    )

    expect(result.current.activeCell).toBeNull()
    expect(result.current.isEditing).toBe(false)
  })

  it('방향키를 누르면 activeCell이 셀 단위로 이동한다', () => {
    const { result } = renderHook(() =>
      useWbsGridFocus({
        rows: initialRows,
        columns,
      })
    )

    // 첫 방향키 입력 시 (0, 0) 첫 셀 선택
    act(() => {
      result.current.onKeyDown(keyEvent({ key: 'ArrowDown' }))
    })
    expect(result.current.activeCell).toEqual({ rowId: 'item-1', col: 'name' })

    // ArrowDown -> 다음 행으로 이동
    act(() => {
      result.current.onKeyDown(keyEvent({ key: 'ArrowDown' }))
    })
    expect(result.current.activeCell).toEqual({ rowId: 'item-2', col: 'name' })

    // ArrowRight -> 다음 열로 이동
    act(() => {
      result.current.onKeyDown(keyEvent({ key: 'ArrowRight' }))
    })
    expect(result.current.activeCell).toEqual({ rowId: 'item-2', col: 'weight' })

    // ArrowUp -> 이전 행으로 이동
    act(() => {
      result.current.onKeyDown(keyEvent({ key: 'ArrowUp' }))
    })
    expect(result.current.activeCell).toEqual({ rowId: 'item-1', col: 'weight' })

    // ArrowLeft -> 이전 열로 이동
    act(() => {
      result.current.onKeyDown(keyEvent({ key: 'ArrowLeft' }))
    })
    expect(result.current.activeCell).toEqual({ rowId: 'item-1', col: 'name' })
  })

  it('행 데이터가 재정렬되거나 갱신되어도 itemId + fieldId 포커스를 보존한다', () => {
    let currentRows = [{ id: 'item-1' }, { id: 'item-2' }, { id: 'item-3' }]

    const { result, rerender } = renderHook(() =>
      useWbsGridFocus({
        rows: currentRows,
        columns,
      })
    )

    // item-2, weight 에 포커스 지정
    act(() => {
      result.current.onCellClick('item-2', 'weight')
    })
    expect(result.current.activeCell).toEqual({ rowId: 'item-2', col: 'weight' })

    // 순서 변경 (item-2가 첫 번째 행으로 이동)
    currentRows = [{ id: 'item-2' }, { id: 'item-3' }, { id: 'item-1' }]
    rerender()

    // 여전히 item-2, weight에 포커스가 유지됨
    expect(result.current.activeCell).toEqual({ rowId: 'item-2', col: 'weight' })
    expect(result.current.isCellFocused('item-2', 'weight')).toBe(true)
    expect(result.current.isCellFocused('item-1', 'weight')).toBe(false)
  })

  it('편집 가능한 셀에서 Enter 입력 시 isEditing이 true가 되고 onStartEdit가 호출된다', () => {
    const onStartEdit = vi.fn()
    const { result } = renderHook(() =>
      useWbsGridFocus({
        rows: initialRows,
        columns,
        editableColumns: ['weight'],
        onStartEdit,
      })
    )

    act(() => {
      result.current.onCellClick('item-1', 'weight')
    })

    act(() => {
      result.current.onKeyDown(keyEvent({ key: 'Enter' }))
    })

    expect(result.current.isEditing).toBe(true)
    expect(onStartEdit).toHaveBeenCalledWith('item-1', 'weight')
  })

  it('편집 모드에서 Enter 입력 시 커밋되고 아래 행으로 이동한다', () => {
    const onCommitEdit = vi.fn()
    const { result } = renderHook(() =>
      useWbsGridFocus({
        rows: initialRows,
        columns,
        onCommitEdit,
      })
    )

    act(() => {
      result.current.onCellClick('item-1', 'weight')
      result.current.startEdit()
    })
    expect(result.current.isEditing).toBe(true)

    // 편집 모드에서 Enter
    act(() => {
      result.current.onKeyDown(keyEvent({ key: 'Enter' }))
    })

    expect(result.current.isEditing).toBe(false)
    expect(onCommitEdit).toHaveBeenCalled()
    // 아래 행으로 이동
    expect(result.current.activeCell).toEqual({ rowId: 'item-2', col: 'weight' })
  })

  it('편집 모드에서 Tab 입력 시 다음 열로 이동한다', () => {
    const onCommitEdit = vi.fn()
    const { result } = renderHook(() =>
      useWbsGridFocus({
        rows: initialRows,
        columns,
        onCommitEdit,
      })
    )

    act(() => {
      result.current.onCellClick('item-1', 'weight')
      result.current.startEdit()
    })

    // 편집 모드에서 Tab
    act(() => {
      result.current.onKeyDown(keyEvent({ key: 'Tab', shiftKey: false }))
    })

    expect(result.current.isEditing).toBe(false)
    expect(onCommitEdit).toHaveBeenCalled()
    // 다음 열로 이동
    expect(result.current.activeCell).toEqual({ rowId: 'item-1', col: 'pactual' })
  })

  it('Shift+방향키로 셀 범위를 확장할 수 있다', () => {
    const { result } = renderHook(() =>
      useWbsGridFocus({
        rows: initialRows,
        columns,
      })
    )

    // item-1, name 에서 시작
    act(() => {
      result.current.onCellClick('item-1', 'name')
    })

    // Shift+Down -> item-2까지 선택
    act(() => {
      result.current.onKeyDown(keyEvent({ key: 'ArrowDown', shiftKey: true }))
    })
    // Shift+Right -> weight 열까지 선택
    act(() => {
      result.current.onKeyDown(keyEvent({ key: 'ArrowRight', shiftKey: true }))
    })

    // 사각형 영역 안의 셀들은 isCellSelected = true
    expect(result.current.isCellSelected('item-1', 'name')).toBe(true)
    expect(result.current.isCellSelected('item-1', 'weight')).toBe(true)
    expect(result.current.isCellSelected('item-2', 'name')).toBe(true)
    expect(result.current.isCellSelected('item-2', 'weight')).toBe(true)

    // 영역 밖의 셀들은 false
    expect(result.current.isCellSelected('item-3', 'name')).toBe(false)
    expect(result.current.isCellSelected('item-1', 'pactual')).toBe(false)
  })

  it('Esc 키 입력 시 포커스가 해제된다', () => {
    const { result } = renderHook(() =>
      useWbsGridFocus({
        rows: initialRows,
        columns,
      })
    )

    act(() => {
      result.current.onCellClick('item-1', 'name')
    })
    expect(result.current.activeCell).not.toBeNull()

    // Esc 이벤트 발생
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })

    expect(result.current.activeCell).toBeNull()
  })
})
