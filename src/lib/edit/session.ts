/** 편집 세션의 공통 형식. 상태 전이 리듀서와 화면 일반화는 SPU1에서 연결한다. */
export type EditState = 'synced' | 'editing' | 'invalid' | 'saving' | 'outcome_unknown' | 'failed' | 'conflict' | 'permission_changed'
export type ConnState = 'online' | 'connecting' | 'offline'

export interface EditSession<V> {
  targetId: string
  fieldId: string
  baseRevision: number | null
  original: V
  draft: V
  latest?: V
  commandId?: string
  state: EditState
  error?: { message: string; fieldErrors?: Record<string, string>; retryable: boolean }
}

export type MutationResult<V> =
  | { kind: 'ok'; commandId: string; revision: number | null; value?: V }
  | { kind: 'invalid'; commandId: string; fieldErrors: Record<string, string> }
  | { kind: 'conflict'; commandId: string; latest: V; latestRevision: number | null }
  | { kind: 'forbidden' | 'module_disabled'; commandId: string }
  | { kind: 'failed'; commandId: string; retryable: boolean; message: string }

export type CommandOutcome<V> = MutationResult<V> | { kind: 'pending' } | { kind: 'unknown' }
