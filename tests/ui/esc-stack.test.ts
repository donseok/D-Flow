// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { escStack, ESC_PRIORITY } from '@/lib/ui/escStack'

describe('escStack (글로벌 Esc 계층 스택)', () => {
  beforeEach(() => {
    escStack.clear()
  })

  it('우선순위가 높은 핸들러부터 한 층씩 실행된다 (Picker -> Cell -> Modal)', () => {
    const modalHandler = vi.fn()
    const cellHandler = vi.fn()
    const pickerHandler = vi.fn()

    // 등록 순서는 무관하게 우선순위 적용
    const unregisterModal = escStack.register({ priority: ESC_PRIORITY.MODAL, handler: modalHandler })
    const unregisterPicker = escStack.register({ priority: ESC_PRIORITY.PICKER, handler: pickerHandler })
    const unregisterCell = escStack.register({ priority: ESC_PRIORITY.CELL, handler: cellHandler })

    // 첫 번째 Esc -> Picker만 실행
    escStack.dispatch()
    expect(pickerHandler).toHaveBeenCalledTimes(1)
    expect(cellHandler).not.toHaveBeenCalled()
    expect(modalHandler).not.toHaveBeenCalled()

    // Picker 닫힘 가정 (등록 해제)
    unregisterPicker()

    // 두 번째 Esc -> Cell만 실행
    escStack.dispatch()
    expect(pickerHandler).toHaveBeenCalledTimes(1)
    expect(cellHandler).toHaveBeenCalledTimes(1)
    expect(modalHandler).not.toHaveBeenCalled()

    // Cell 닫힘 가정
    unregisterCell()

    // 세 번째 Esc -> Modal 실행
    escStack.dispatch()
    expect(modalHandler).toHaveBeenCalledTimes(1)

    unregisterModal()
  })

  it('동일 우선순위일 경우 나중에 등록된 핸들러가 먼저 실행된다', () => {
    const order: number[] = []
    const unreg1 = escStack.register({ priority: ESC_PRIORITY.MODAL, handler: () => { order.push(1) } })
    const unreg2 = escStack.register({ priority: ESC_PRIORITY.MODAL, handler: () => { order.push(2) } })

    escStack.dispatch()
    expect(order).toEqual([2])

    unreg2()
    escStack.dispatch()
    expect(order).toEqual([2, 1])

    unreg1()
  })

  it('한글 조합 중(isComposing: true 또는 keyCode: 229)일 때는 실행되지 않는다', () => {
    const handler = vi.fn()
    escStack.register({ priority: ESC_PRIORITY.MODAL, handler })

    // 1. isComposing = true
    escStack.dispatch({ isComposing: true })
    expect(handler).not.toHaveBeenCalled()

    // 2. keyCode = 229
    escStack.dispatch({ keyCode: 229 } as unknown as KeyboardEventInit)
    expect(handler).not.toHaveBeenCalled()

    // 3. 정상 Esc
    escStack.dispatch()
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('핸들러가 true를 반환하면 다음 상위 핸들러로 전파된다', () => {
    const high = vi.fn(() => true) // 전파 허용
    const low = vi.fn()

    escStack.register({ priority: ESC_PRIORITY.CELL, handler: high })
    escStack.register({ priority: ESC_PRIORITY.MODAL, handler: low })

    escStack.dispatch()
    expect(high).toHaveBeenCalledTimes(1)
    expect(low).toHaveBeenCalledTimes(1)
  })
})
