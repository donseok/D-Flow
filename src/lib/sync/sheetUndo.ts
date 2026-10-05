/**
 * WBS 및 주간 시트 되돌리기(Undo) CAS 계약 (D6-§8-undo)
 *
 * 1. 셀 편집 즉시 pending undo 스택에 쌓되, 서버 확인(ok) 뒤에만 활성화(active)한다.
 * 2. 되돌리기 시 "내가 쓴 값 = 현재 서버 값"을 전제로 하는 CAS로 역명령을 실행하여
 *    다른 사용자의 후속 변경을 무통보 덮어쓰지 않는다.
 */

export interface SheetUndoEntry<V = unknown> {
  id: string
  sessionId: string
  targetId: string
  field: string
  previousValue: V
  appliedValue: V
  status: 'pending' | 'active' | 'reverted' | 'conflict'
  createdAt: number
  /**
   * CAS 역명령 함수.
   * 현재 값이 appliedValue인지 확인하고 previousValue로 복원.
   */
  revert: (args: { expectedCurrent: V; targetValue: V }) => Promise<{
    ok: boolean
    conflict?: boolean
    error?: string
  }>
}

export type UndoListener = () => void

export class SheetUndoManager {
  private entries: SheetUndoEntry[] = []
  private listeners = new Set<UndoListener>()

  private notify() {
    for (const listener of this.listeners) {
      try {
        listener()
      } catch {
        // 리스너 오류 무시
      }
    }
  }

  subscribe(listener: UndoListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** 셀 저장 시작 시 pending 상태로 등록 */
  pushPending<V>(entry: {
    sessionId: string
    targetId: string
    field: string
    previousValue: V
    appliedValue: V
    revert: (args: { expectedCurrent: V; targetValue: V }) => Promise<{ ok: boolean; conflict?: boolean; error?: string }>
  }): string {
    const id = `undo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const newEntry: SheetUndoEntry = {
      id,
      sessionId: entry.sessionId,
      targetId: entry.targetId,
      field: entry.field,
      previousValue: entry.previousValue,
      appliedValue: entry.appliedValue,
      status: 'pending',
      createdAt: Date.now(),
      revert: entry.revert as SheetUndoEntry['revert'],
    }
    this.entries.push(newEntry)
    this.notify()
    return id
  }

  /** 서버 확인 성공(ok) 시 undo 활성화 */
  confirmActive(sessionId: string): boolean {
    const entry = this.entries.find(e => e.sessionId === sessionId && e.status === 'pending')
    if (!entry) return false
    entry.status = 'active'
    this.notify()
    return true
  }

  /** 서버 확인 실패 시 pending 제거 */
  rejectPending(sessionId: string): boolean {
    const idx = this.entries.findIndex(e => e.sessionId === sessionId && e.status === 'pending')
    if (idx === -1) return false
    this.entries.splice(idx, 1)
    this.notify()
    return true
  }

  /** 활성화된 되돌리기 가능한 항목 수 */
  get activeCount(): number {
    return this.entries.filter(e => e.status === 'active').length
  }

  canUndo(): boolean {
    return this.activeCount > 0
  }

  getLatestActive(): SheetUndoEntry | null {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      if (this.entries[i].status === 'active') {
        return this.entries[i]
      }
    }
    return null
  }

  /**
   * CAS 기반 되돌리기 실행
   * @param getCurrentValue 현재 셀의 값을 반환하는 함수 (CAS 검사용)
   */
  async undo(getCurrentValue?: (targetId: string, field: string) => unknown): Promise<{
    ok: boolean
    conflict?: boolean
    error?: string
    entry?: SheetUndoEntry
  }> {
    const target = this.getLatestActive()
    if (!target) {
      return { ok: false, error: '되돌릴 수 있는 작업이 없습니다.' }
    }

    // 1. 클라이언트 측 즉시 CAS 검사 (현재 셀 값이 내가 적용한 값과 같은지 확인)
    if (getCurrentValue) {
      const currentVal = getCurrentValue(target.targetId, target.field)
      if (currentVal !== undefined && currentVal !== target.appliedValue) {
        target.status = 'conflict'
        this.notify()
        return {
          ok: false,
          conflict: true,
          error: '다른 사용자의 후속 변경이 있어 되돌릴 수 없습니다 (CAS 충돌).',
          entry: target,
        }
      }
    }

    // 2. 서버 측 CAS 역명령 실행
    try {
      const res = await target.revert({
        expectedCurrent: target.appliedValue,
        targetValue: target.previousValue,
      })

      if (res.ok) {
        target.status = 'reverted'
        this.entries = this.entries.filter(e => e.id !== target.id)
        this.notify()
        return { ok: true, entry: target }
      }

      if (res.conflict) {
        target.status = 'conflict'
        this.notify()
        return {
          ok: false,
          conflict: true,
          error: res.error ?? '서버 값이 이미 변경되어 되돌릴 수 없습니다.',
          entry: target,
        }
      }

      return {
        ok: false,
        error: res.error ?? '되돌리기에 실패했습니다.',
        entry: target,
      }
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : '되돌리기 중 오류가 발생했습니다.',
        entry: target,
      }
    }
  }

  clear() {
    this.entries = []
    this.notify()
  }
}

export const sheetUndoManager = new SheetUndoManager()
