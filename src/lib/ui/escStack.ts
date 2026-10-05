import { useEffect, useRef } from 'react'

/**
 * Esc 키 계층 스택 우선순위 (D6-§7-exit)
 * 날짜 선택기·메뉴 (PICKER: 30) → 셀·필드 (CELL: 20) → 인스펙터·모달 (MODAL: 10)
 */
export const ESC_PRIORITY = {
  PICKER: 30,
  CELL: 20,
  MODAL: 10,
  BASE: 0,
} as const

export interface EscEntry {
  id: string
  priority: number
  handler: (e: KeyboardEvent) => boolean | void
}

class EscStackManager {
  private entries: EscEntry[] = []
  private listenerInstalled = false

  private handleKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return

    // 한글 조합 중(IME) 단축키 오작동 차단
    if (e.isComposing || (e as { isComposing?: boolean }).isComposing || e.keyCode === 229) {
      return
    }

    // 우선순위가 높은 순, 동일 우선순위면 가장 최근(뒤에 등록된) 엔트리부터 순회
    const sorted = [...this.entries].sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority
      return this.entries.indexOf(b) - this.entries.indexOf(a)
    })

    for (const entry of sorted) {
      e.preventDefault()
      e.stopPropagation()
      const propagate = entry.handler(e)
      // handler가 명시적으로 true를 반환하지 않으면 상위 계층으로의 전파 중단 (한 번에 한 층씩 닫힘)
      if (propagate !== true) {
        break
      }
    }
  }

  private ensureListener() {
    if (!this.listenerInstalled && typeof window !== 'undefined') {
      window.addEventListener('keydown', this.handleKeyDown, { capture: true })
      this.listenerInstalled = true
    }
  }

  private cleanListener() {
    if (this.listenerInstalled && this.entries.length === 0 && typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.handleKeyDown, { capture: true })
      this.listenerInstalled = false
    }
  }

  register(entry: { id?: string; priority?: number; handler: (e: KeyboardEvent) => boolean | void }): () => void {
    const id = entry.id ?? Math.random().toString(36).slice(2)
    const priority = entry.priority ?? ESC_PRIORITY.BASE
    const newEntry: EscEntry = { id, priority, handler: entry.handler }

    this.entries.push(newEntry)
    this.ensureListener()

    return () => {
      this.entries = this.entries.filter(e => e !== newEntry)
      this.cleanListener()
    }
  }

  getEntries(): readonly EscEntry[] {
    return this.entries
  }

  clear() {
    this.entries = []
    this.cleanListener()
  }

  /** 테스트 환경이나 프로그래밍 방식으로 Esc 디스패치 */
  dispatch(eventInit?: KeyboardEventInit) {
    if (typeof window === 'undefined') return
    const evt = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
      ...eventInit,
    })
    this.handleKeyDown(evt)
  }
}

export const escStack = new EscStackManager()

/**
 * Esc 핸들러 등록 훅.
 * 컴포넌트 마운트 시 등록하고 언마운트 또는 비활성화 시 해제.
 */
export function useEscHandler(
  handler: (e: KeyboardEvent) => boolean | void,
  options: { id?: string; priority?: number; enabled?: boolean } = {}
) {
  const { id, priority = ESC_PRIORITY.BASE, enabled = true } = options
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useEffect(() => {
    if (!enabled) return
    return escStack.register({
      id,
      priority,
      handler: (e) => handlerRef.current(e),
    })
  }, [id, priority, enabled])
}
