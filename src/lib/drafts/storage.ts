/**
 * 로컬 초안 저장소 및 수명 주기 관리 (SPU1, 개정 §5.8.5)
 *
 * 키 규격: draft:v2:<userId>:<workspaceId>:<projectId|_>:<surface>:<targetId>
 * 워크스페이스 security.local_drafts 정책(allowed, retention_days)을 적용합니다.
 */

export const DRAFT_V2_PREFIX = 'draft:v2:'

export interface DraftKeyParams {
  userId: string
  workspaceId: string
  projectId?: string | null
  surface: string
  targetId: string
}

export interface StoredDraft {
  content: string
  savedAt: number
}

export interface LocalDraftPolicy {
  allowed: boolean
  retention_days: number
}

export const DEFAULT_DRAFT_POLICY: LocalDraftPolicy = {
  allowed: true,
  retention_days: 7,
}

export function buildDraftKey(params: DraftKeyParams): string {
  const pId = params.projectId && params.projectId.trim() !== '' ? params.projectId : '_'
  return `${DRAFT_V2_PREFIX}${params.userId}:${params.workspaceId}:${pId}:${params.surface}:${params.targetId}`
}

export function parseDraftKey(key: string): (DraftKeyParams & { projectId: string | null }) | null {
  if (!key.startsWith(DRAFT_V2_PREFIX)) return null
  const body = key.slice(DRAFT_V2_PREFIX.length)
  const parts = body.split(':')
  if (parts.length < 5) return null
  const [userId, workspaceId, rawProjectId, surface, ...targetParts] = parts
  const targetId = targetParts.join(':')
  return {
    userId,
    workspaceId,
    projectId: rawProjectId === '_' ? null : rawProjectId,
    surface,
    targetId,
  }
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>

/** 초안 저장 — policy.allowed가 false이면 저장 거부 */
export function saveDraft(
  storage: StorageLike,
  params: DraftKeyParams & {
    content: string
    policy?: LocalDraftPolicy
  }
): boolean {
  const policy = params.policy ?? DEFAULT_DRAFT_POLICY
  if (!policy.allowed) {
    return false
  }

  const key = buildDraftKey(params)
  const data: StoredDraft = {
    content: params.content,
    savedAt: Date.now(),
  }

  try {
    storage.setItem(key, JSON.stringify(data))
    return true
  } catch {
    return false
  }
}

/** 초안 조회 — 만료된 경우 자동 삭제 후 null 반환 */
export function getDraft(
  storage: StorageLike,
  params: DraftKeyParams & {
    policy?: LocalDraftPolicy
  }
): StoredDraft | null {
  const key = buildDraftKey(params)
  const raw = storage.getItem(key)
  if (!raw) return null

  try {
    const data = JSON.parse(raw) as StoredDraft
    if (typeof data.content !== 'string' || typeof data.savedAt !== 'number') {
      storage.removeItem(key)
      return null
    }

    const policy = params.policy ?? DEFAULT_DRAFT_POLICY
    const maxAgeMs = policy.retention_days * 24 * 60 * 60 * 1000
    if (Date.now() - data.savedAt > maxAgeMs) {
      // 보존기간 초과 만료
      storage.removeItem(key)
      return null
    }

    return data
  } catch {
    storage.removeItem(key)
    return null
  }
}

/** 초안 명시 삭제 */
export function clearDraft(storage: Pick<Storage, 'removeItem'>, params: DraftKeyParams): void {
  const key = buildDraftKey(params)
  try {
    storage.removeItem(key)
  } catch {}
}

/** 만료된 초안 일괄 청소 */
export function sweepExpiredDrafts(storage: StorageLike, retentionDays: number = 7): number {
  const maxAgeMs = retentionDays * 24 * 60 * 60 * 1000
  const now = Date.now()
  const keysToRemove: string[] = []

  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i)
    if (k && k.startsWith(DRAFT_V2_PREFIX)) {
      const raw = storage.getItem(k)
      if (raw) {
        try {
          const data = JSON.parse(raw) as StoredDraft
          if (typeof data.savedAt === 'number' && now - data.savedAt > maxAgeMs) {
            keysToRemove.push(k)
          }
        } catch {
          keysToRemove.push(k)
        }
      }
    }
  }

  for (const k of keysToRemove) {
    storage.removeItem(k)
  }
  return keysToRemove.length
}

/** 특정 유저의 모든 초안 삭제 (로그아웃 등) */
export function clearUserDrafts(storage: StorageLike, userId: string): number {
  const prefix = `${DRAFT_V2_PREFIX}${userId}:`
  const keysToRemove: string[] = []

  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i)
    if (k && k.startsWith(prefix)) {
      keysToRemove.push(k)
    }
  }

  for (const k of keysToRemove) {
    storage.removeItem(k)
  }
  return keysToRemove.length
}
