/**
 * 공통 편집·저장 상태 머신 (COM-2 클라이언트)
 * 스펙: docs/superpowers/specs/2026-09-27-platform-revision-configurability-design.md §5.8
 * 편집 세션 형식은 이 파일 하나다(옛 src/lib/edit/session.ts 의 타입 사본은 쓰는 곳이 없어 지웠다 — SPU1).
 */

/** 값 CAS 표면(셀은 revision 이 없다 — §5.8.2)의 결과 판정. 응답을 잃었을 때 다시 읽은 서버 값(latest)과 내 값·편집 시작 값으로 가린다:
 *  내 값과 같으면 반영됨(다시 보내지 않는다), 시작 값 그대로면 미반영(재시도 가능), 둘 다 아니면 그새 다른 사람이 바꾼 것(비교로). */
export type CasOutcome = 'applied' | 'not_applied' | 'conflict'
export function classifyCasOutcome<V>(
  v: { mine: V; base: V; latest: V },
  same: (a: V, b: V) => boolean = Object.is,
): CasOutcome {
  if (same(v.latest, v.mine)) return 'applied'
  if (same(v.latest, v.base)) return 'not_applied'
  return 'conflict'
}

export type EditStatus =
  | 'idle'
  | 'editing'
  | 'saving'
  | 'saved'
  | 'failed'
  | 'conflict'
  | 'outcome_unknown'

export type ConnectionState = 'online' | 'offline'

export interface EditSession {
  id: string
  surface: string
  targetId: string
  status: EditStatus
  state: EditStatus
  error?: { kind?: string; message?: string } | string
  lastSavedAt: number | null
  updatedAt: number
}

export interface SyncSummary {
  connectionState: ConnectionState
  /** 저장 전 초안(editing) — 미저장이 남아 있으면 '동기화됨'이 아니다(§5.8.3) */
  editingCount: number
  savingCount: number
  failedCount: number
  conflictCount: number
  outcomeUnknownCount: number
  lastSavedAt: number | null
  needsAttentionCount: number
  isFullySynced: boolean
}

type Listener = () => void

class EditSessionStore {
  private sessions = new Map<string, EditSession>()
  private listeners = new Set<Listener>()
  private connectionState: ConnectionState = 'online'
  private lastVerifiedOnlineAt: number | null = null

  constructor() {
    if (typeof window !== 'undefined') {
      this.connectionState = window.navigator.onLine ? 'online' : 'offline'
      this.lastVerifiedOnlineAt = Date.now()
      window.addEventListener('online', () => this.setConnectionState('online'))
      window.addEventListener('offline', () => this.setConnectionState('offline'))
    }
  }

  public setConnectionState(state: ConnectionState): void {
    if (this.connectionState !== state) {
      this.connectionState = state
      if (state === 'online') {
        this.lastVerifiedOnlineAt = Date.now()
      }
      this.notify()
    }
  }

  public getConnectionState(): ConnectionState {
    return this.connectionState
  }

  public getLastVerifiedOnlineAt(): number | null {
    return this.lastVerifiedOnlineAt
  }

  public getSession(id: string): EditSession | undefined {
    return this.sessions.get(id)
  }

  public setSession(
    id: string,
    surface: string,
    targetId: string,
    status: EditStatus,
    options?: { error?: { kind?: string; message?: string } | string } | string
  ): EditSession {
    const prev = this.sessions.get(id)
    const now = Date.now()
    const lastSavedAt = status === 'saved' ? now : (prev?.lastSavedAt ?? null)
    const error = typeof options === 'string' ? options : options?.error

    const session: EditSession = {
      id,
      surface,
      targetId,
      status,
      state: status,
      error,
      lastSavedAt,
      updatedAt: now,
    }

    this.sessions.set(id, session)
    this.notify()
    return session
  }

  public removeSession(id: string): void {
    if (this.sessions.delete(id)) {
      this.notify()
    }
  }

  /** 화면이 내려갈 때 그 표면의 끝난 적 없는 세션을 걷는다 — 편집기가 사라진 초안·실패가 헤더에 영영 남지 않게 */
  public removeWhere(pred: (session: EditSession) => boolean): void {
    let changed = false
    for (const [id, session] of this.sessions) {
      if (pred(session)) { this.sessions.delete(id); changed = true }
    }
    if (changed) this.notify()
  }

  public clearAll(): void {
    this.sessions.clear()
    this.notify()
  }

  private cachedSummary: SyncSummary | null = null

  public getSummary(): SyncSummary {
    if (!this.cachedSummary) {
      this.cachedSummary = this.computeSummary()
    }
    return this.cachedSummary
  }

  private computeSummary(): SyncSummary {
    let editingCount = 0
    let savingCount = 0
    let failedCount = 0
    let conflictCount = 0
    let outcomeUnknownCount = 0
    let latestSavedAt: number | null = this.lastVerifiedOnlineAt

    for (const session of this.sessions.values()) {
      if (session.status === 'editing') editingCount++
      else if (session.status === 'saving') savingCount++
      else if (session.status === 'failed') failedCount++
      else if (session.status === 'conflict') conflictCount++
      else if (session.status === 'outcome_unknown') outcomeUnknownCount++

      if (session.lastSavedAt && (!latestSavedAt || session.lastSavedAt > latestSavedAt)) {
        latestSavedAt = session.lastSavedAt
      }
    }

    const needsAttentionCount = failedCount + conflictCount + outcomeUnknownCount
    const isFullySynced =
      this.connectionState === 'online' &&
      editingCount === 0 &&
      savingCount === 0 &&
      needsAttentionCount === 0

    return {
      connectionState: this.connectionState,
      editingCount,
      savingCount,
      failedCount,
      conflictCount,
      outcomeUnknownCount,
      lastSavedAt: latestSavedAt,
      needsAttentionCount,
      isFullySynced,
    }
  }

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify(): void {
    this.cachedSummary = this.computeSummary()
    for (const listener of this.listeners) {
      try {
        listener()
      } catch {
        // 리스너 오류 격리
      }
    }
  }
}

export const editSessionStore = new EditSessionStore()
