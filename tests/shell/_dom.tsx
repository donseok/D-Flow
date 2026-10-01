// 셸 jsdom 테스트의 작은 렌더·이벤트 도구 — 리포에 @testing-library 가 없어(package.json 무변경) createRoot + act 위에 필요한 만큼만 둔다.
// 이름·모양은 testing-library 를 흉내 낸다(render·screen·fireEvent·waitFor). 이 파일은 *.test 가 아니라 vitest 가 따로 돌리지 않는다.
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach } from 'vitest'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const mounted: { root: Root; container: HTMLElement }[] = []

export function render(ui: ReactElement) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => { root.render(ui) })
  const entry = { root, container }
  mounted.push(entry)
  return {
    container,
    rerender(next: ReactElement) { act(() => { root.render(next) }) },
    unmount() { act(() => { root.unmount() }); container.remove() },
  }
}

export function cleanup() {
  while (mounted.length) {
    const { root, container } = mounted.pop()!
    act(() => { root.unmount() })
    container.remove()
  }
}
afterEach(() => cleanup())

const IMPLICIT: Record<string, string> = { button: 'button', a: 'link', nav: 'navigation', dialog: 'dialog' }
function roleOf(el: Element): string | null {
  const explicit = el.getAttribute('role')
  if (explicit) return explicit
  const tag = el.tagName.toLowerCase()
  if (tag === 'a') return el.hasAttribute('href') ? 'link' : null
  return IMPLICIT[tag] ?? null
}
function nameOf(el: Element): string {
  return el.getAttribute('aria-label') ?? (el.textContent ?? '').trim()
}
function matches(text: string, want: string | RegExp): boolean {
  return typeof want === 'string' ? text === want : want.test(text)
}

function allByRole(role: string, opts?: { name?: string | RegExp }): HTMLElement[] {
  return [...document.body.querySelectorAll<HTMLElement>('*')].filter((el) => roleOf(el) === role && (!opts?.name || matches(nameOf(el), opts.name)))
}

export const screen = {
  getAllByRole(role: string, opts?: { name?: string | RegExp }): HTMLElement[] {
    const found = allByRole(role, opts)
    if (!found.length) throw new Error(`role=${role} 없음`)
    return found
  },
  getByRole(role: string, opts?: { name?: string | RegExp }): HTMLElement {
    const found = allByRole(role, opts)
    if (found.length !== 1) throw new Error(`role=${role} 이 ${found.length}개`)
    return found[0]
  },
  queryByRole(role: string, opts?: { name?: string | RegExp }): HTMLElement | null {
    return allByRole(role, opts)[0] ?? null
  },
  getByText(text: string | RegExp): HTMLElement {
    const found = [...document.body.querySelectorAll<HTMLElement>('*')].filter((el) =>
      [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && matches((n.textContent ?? '').trim(), text)))
    if (!found.length) throw new Error(`text=${String(text)} 없음`)
    return found[0]
  },
}

function dispatch(el: Element | Document, ev: Event) { act(() => { el.dispatchEvent(ev) }) }

export const fireEvent = {
  click(el: Element) { dispatch(el, new MouseEvent('click', { bubbles: true, cancelable: true })) },
  mouseDown(el: Element) { dispatch(el, new MouseEvent('mousedown', { bubbles: true, cancelable: true })) },
  keyDown(el: Element | Document, init: KeyboardEventInit) { dispatch(el, new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })) },
  focus(el: HTMLElement) { act(() => { el.focus() }) },
  /** 제어 입력 — React 가 값 추적기를 우회하지 않게 네이티브 setter 로 넣고 input 이벤트를 보낸다 */
  change(el: HTMLInputElement, { target }: { target: { value: string } }) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    act(() => { setter.call(el, target.value); el.dispatchEvent(new Event('input', { bubbles: true })) })
  },
}

export async function waitFor(fn: () => void, { timeout = 1000, interval = 10 } = {}): Promise<void> {
  const start = Date.now()
  for (;;) {
    try { fn(); return } catch (e) {
      if (Date.now() - start > timeout) throw e
      await act(async () => { await new Promise((r) => setTimeout(r, interval)) })
    }
  }
}
