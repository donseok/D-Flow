// @vitest-environment jsdom
// 저장 충돌 비교 상자(개정 §5.8.1 Conflict, Q05) — 세 선택·포커스·Esc 계층. 닫는 길(Esc·바깥)은 '계속 편집'이라 입력을 버리지 않는다.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConflictResolver } from '@/components/ui/ConflictResolver'
import { escStack, ESC_PRIORITY } from '@/lib/ui/escStack'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
const handlers = { mine: vi.fn(), latest: vi.fn(), cont: vi.fn() }
const dialog = () => document.querySelector<HTMLElement>('[data-testid="conflict-resolver"]')
const button = (action: 'mine' | 'latest' | 'continue') => dialog()!.querySelector<HTMLButtonElement>(`[data-conflict-action="${action}"]`)!
const value = (which: 'mine' | 'latest' | 'base') => dialog()!.querySelector(`[data-conflict-value="${which}"]`)?.textContent

async function show(open: boolean, base?: string) {
  await act(async () => root.render(
    <div>
      <input data-origin />
      <ConflictResolver
        open={open} target="1-3. 착수 보고회"
        fields={[{ key: 'actual', label: '실적%', mine: '60%', latest: '70%', ...(base === undefined ? {} : { base }) }]}
        onKeepMine={handlers.mine} onTakeLatest={handlers.latest} onContinue={handlers.cont}
      />
    </div>,
  ))
}

beforeEach(() => {
  vi.clearAllMocks()
  escStack.clear()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

describe('ConflictResolver', () => {
  it('닫혀 있으면 아무것도 그리지 않는다', async () => {
    await show(false)
    expect(dialog()).toBeNull()
  })

  it('내 값·서버의 현재 값·편집 시작 때 값을 나란히 보이고 alertdialog 로 알린다', async () => {
    await show(true, '50%')
    expect(dialog()!.getAttribute('role')).toBe('alertdialog')
    expect(dialog()!.getAttribute('aria-modal')).toBe('true')
    expect(document.getElementById(dialog()!.getAttribute('aria-labelledby')!)?.textContent).toBe('common.conflictTitle')
    expect(dialog()!.textContent).toContain('1-3. 착수 보고회')
    expect([value('mine'), value('latest'), value('base')]).toEqual(['60%', '70%', '50%'])
  })

  it('편집 시작 값을 모르면 그 칸을 그리지 않는다. 빈 값은 비어 있음으로 적는다', async () => {
    await act(async () => root.render(
      <ConflictResolver open fields={[{ key: 'memo', label: '메모', mine: '', latest: '남의 값' }]}
        onKeepMine={handlers.mine} onTakeLatest={handlers.latest} onContinue={handlers.cont} />,
    ))
    expect(value('base')).toBeUndefined()
    expect(value('mine')).toBe('common.conflictEmpty')
  })

  it('세 선택은 각자의 처리기만 부른다', async () => {
    await show(true)
    await act(async () => button('mine').click())
    await act(async () => button('latest').click())
    await act(async () => button('continue').click())
    expect([handlers.mine.mock.calls.length, handlers.latest.mock.calls.length, handlers.cont.mock.calls.length]).toEqual([1, 1, 1])
  })

  it('열리면 가장 안전한 선택(계속 편집)에 포커스가 가고, 닫히면 원래 자리로 돌아간다', async () => {
    await show(false)
    const origin = container.querySelector<HTMLInputElement>('[data-origin]')!
    origin.focus()
    await show(true)
    expect(document.activeElement).toBe(button('continue'))
    await show(false)
    expect(document.activeElement).toBe(origin)
  })

  it('Tab 은 상자 안에서 돈다 — 마지막에서 처음으로, Shift+Tab 은 처음에서 마지막으로', async () => {
    await show(true)
    const tab = (shiftKey: boolean) => act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true })) })
    button('mine').focus()
    await tab(false)
    expect(document.activeElement).toBe(button('continue'))
    await tab(true)
    expect(document.activeElement).toBe(button('mine'))
    // 밖으로 샌 포커스는 안으로 회수한다
    container.querySelector<HTMLInputElement>('[data-origin]')!.focus()
    await tab(false)
    expect(document.activeElement).toBe(button('continue'))
  })

  it('Esc 는 계속 편집이다 — 아래 층(셀·모달)의 Esc 처리기는 불리지 않는다', async () => {
    const cell = vi.fn()
    const modal = vi.fn()
    escStack.register({ priority: ESC_PRIORITY.CELL, handler: cell })
    escStack.register({ priority: ESC_PRIORITY.MODAL, handler: modal })
    await show(true)
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })) })
    expect(handlers.cont).toHaveBeenCalledTimes(1)
    expect(handlers.mine).not.toHaveBeenCalled()
    expect(handlers.latest).not.toHaveBeenCalled()
    expect(cell).not.toHaveBeenCalled()
    expect(modal).not.toHaveBeenCalled()
  })

  it('한글 조합 중의 Esc 는 닫지 않는다', async () => {
    await show(true)
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true, cancelable: true })) })
    expect(handlers.cont).not.toHaveBeenCalled()
  })

  it('저장 중에는 세 버튼이 모두 잠긴다', async () => {
    await act(async () => root.render(
      <ConflictResolver open busy fields={[{ key: 'a', label: 'A', mine: '1', latest: '2' }]}
        onKeepMine={handlers.mine} onTakeLatest={handlers.latest} onContinue={handlers.cont} />,
    ))
    expect((['mine', 'latest', 'continue'] as const).map(a => button(a).disabled)).toEqual([true, true, true])
  })

  it('상자 안의 누름·키는 React 부모(아래 셀·행의 처리기)로 올라가지 않는다', async () => {
    const parentClick = vi.fn()
    const parentKey = vi.fn()
    await act(async () => root.render(
      <div onClick={parentClick} onKeyDown={parentKey}>
        <ConflictResolver open fields={[{ key: 'a', label: 'A', mine: '1', latest: '2' }]}
          onKeepMine={handlers.mine} onTakeLatest={handlers.latest} onContinue={handlers.cont} />
      </div>,
    ))
    await act(async () => button('mine').click())
    await act(async () => { button('mine').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    expect(handlers.mine).toHaveBeenCalledTimes(1)
    expect(parentClick).not.toHaveBeenCalled()
    expect(parentKey).not.toHaveBeenCalled()
  })
})
