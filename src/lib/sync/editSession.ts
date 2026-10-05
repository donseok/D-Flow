/**
 * 공통 편집·저장 상태 머신 (COM-2 클라이언트)
 * 스펙: docs/superpowers/specs/2026-09-27-platform-revision-configurability-design.md §5.8
 */

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
    let savingCount = 0
    let failedCount = 0
    let conflictCount = 0
    let outcomeUnknownCount = 0
    let latestSavedAt: number | null = this.lastVerifiedOnlineAt

    for (const session of this.sessions.values()) {
      if (session.status === 'saving') savingCount++
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
      savingCount === 0 &&
      needsAttentionCount === 0

    return {
      connectionState: this.connectionState,
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
