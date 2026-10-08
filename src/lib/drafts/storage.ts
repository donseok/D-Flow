/**
 * 로컬 초안 저장소 및 수명 주기 관리 (SPU1, 개정 §5.8.5)
 *
 * 키 규격: draft:v2:<userId>:<workspaceId>:<projectId|_>:<surface>:<targetId>
 * 워크스페이스 security.local_drafts 정책(allowed, retention_days)의 판정은 이 파일 한 곳이다 — 초안을 쓰는 표면(지금은 위키 편집기)은
 * 아래 함수만 지난다. allowed:false 면 쓰지도 읽지도 않는다(개인 설정으로 완화할 수 없다). 이미 있는 초안을 그 자리에서 지우지는 않는다 —
 * 정리 경로는 로그아웃·권한 회수·보존기간 초과 셋이다(§5.8.5). 정책을 못 읽은 화면은 DRAFTS_OFF_POLICY 로 닫는다(fail-closed).
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

/** 정책을 읽지 못했을 때 — 초안 기능을 끈다(쓰기·읽기 없음). 보존기간은 기본값(쓰이지 않는다) */
export const DRAFTS_OFF_POLICY: LocalDraftPolicy = {
  allowed: false,
  retention_days: DEFAULT_DRAFT_POLICY.retention_days,
}

const DAY_MS = 24 * 60 * 60 * 1000

/** 저장 시각 → epoch ms. 숫자(saveDraft)·ISO 문자열(위키 초안) 둘 다 읽는다. 모르면 null */
export function savedAtMs(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string' || v === '') return null
  const ms = Date.parse(v)
  return Number.isNaN(ms) ? null : ms
}

/** 초안 값(JSON 문자열)이 보존기간을 넘겼는가 — 저장 시각을 읽을 수 있을 때만 판정한다. 저장 시각이 없는 값(옛 형식)은 나이를 몰라
 *  만료로 보지 않는다(쓴 사람의 초안을 근거 없이 지우지 않는다 — 그런 값은 복구·폐기 결정이나 로그아웃 때 정리된다) */
export function isDraftExpired(raw: string, retentionDays: number, now: number = Date.now()): boolean {
  let at: number | null = null
  try { at = savedAtMs((JSON.parse(raw) as { savedAt?: unknown } | null)?.savedAt) } catch { /* 저장 시각을 모른다 */ }
  return at !== null && now - at > retentionDays * DAY_MS
}

/**
 * 자기 값 형태를 갖는 표면(위키: { title, bodyMd, kind, savedAt })의 쓰기 — 값은 savedAt 을 담은 JSON 문자열이어야 한다.
 * 정책이 막으면 쓰지 않는다. 저장소 오류는 삼킨다(편집을 막지 않는다).
 */
export function writeDraftRaw(storage: Pick<Storage, 'setItem'>, key: string, raw: string, policy: LocalDraftPolicy): boolean {
  if (!policy.allowed) return false
  try {
    storage.setItem(key, raw)
    return true
  } catch {
    return false
  }
}

/** 읽기 — 정책이 막으면 읽지 않는다(지우지도 않는다). 보존기간을 넘긴 초안은 지우고 null */
export function readDraftRaw(
  storage: Pick<Storage, 'getItem' | 'removeItem'>, key: string, policy: LocalDraftPolicy, now: number = Date.now(),
): string | null {
  if (!policy.allowed) return null
  const raw = storage.getItem(key)
  if (raw === null) return null
  if (isDraftExpired(raw, policy.retention_days, now)) {
    storage.removeItem(key)
    return null
  }
  return raw
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

/** 초안 조회 — 정책이 막으면 읽지 않는다. 만료된 경우 자동 삭제 후 null 반환 */
export function getDraft(
  storage: StorageLike,
  params: DraftKeyParams & {
    policy?: LocalDraftPolicy
  }
): StoredDraft | null {
  if (!(params.policy ?? DEFAULT_DRAFT_POLICY).allowed) return null
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

/**
 * 만료된 초안 일괄 청소. scope 를 주면 그 사용자·워크스페이스의 초안만 본다 — 보존기간은 워크스페이스 정책이라 다른 워크스페이스의
 * 초안에 이 값을 적용하지 않는다. 저장 시각은 숫자·ISO 문자열 둘 다 읽는다. 저장 시각이 없는 값은 건드리지 않는다(isDraftExpired 와 같다).
 */
export function sweepExpiredDrafts(storage: StorageLike, retentionDays: number = 7, scope?: { userId: string; workspaceId: string }): number {
  const maxAgeMs = retentionDays * DAY_MS
  const now = Date.now()
  const prefix = scope ? `${DRAFT_V2_PREFIX}${scope.userId}:${scope.workspaceId}:` : DRAFT_V2_PREFIX
  const keysToRemove: string[] = []

  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i)
    if (k && k.startsWith(prefix)) {
      const raw = storage.getItem(k)
      if (raw) {
        try {
          const at = savedAtMs((JSON.parse(raw) as { savedAt?: unknown } | null)?.savedAt)
          if (at !== null && now - at > maxAgeMs) {
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
