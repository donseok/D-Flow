/** 위키 로컬 초안 키 — 사용자별(v2). 옛 키(wiki-draft:<pid>:<tid>)는 누가 쓴 것인지 몰라 공용 PC 에서 남의 초안이 떴다.
 *  D52(과제 36) 뒤로 쓰는 키는 아래 draftKey(워크스페이스 포함)다 — wikiDraftKey 는 이행 원천(legacyWikiDraftKey)으로만 남는다. */
import { DEFAULT_DRAFT_POLICY, DRAFT_V2_PREFIX, buildDraftKey, readDraftRaw, writeDraftRaw, type LocalDraftPolicy } from './storage'

export const WIKI_DRAFT_PREFIX = 'wiki-draft'
const V2 = `${WIKI_DRAFT_PREFIX}:v2:`

export function wikiDraftKey(userId: string, projectId: string, topicId: string | null): string {
  return `${V2}${userId}:${projectId}:${topicId ?? 'new'}`
}

type KeyStore = Pick<Storage, 'length' | 'key' | 'removeItem'>

/** 조건에 맞는 키를 먼저 모은 뒤 지운다 — 순회 중 삭제하면 인덱스가 당겨져 하나씩 건너뛴다. */
function removeWhere(storage: KeyStore, match: (key: string) => boolean): number {
  const keys: string[] = []
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i)
    if (k !== null && match(k)) keys.push(k)
  }
  for (const k of keys) storage.removeItem(k)
  return keys.length
}

export function clearLegacyWikiDrafts(storage: KeyStore): number {
  return removeWhere(storage, k => k.startsWith(`${WIKI_DRAFT_PREFIX}:`) && !k.startsWith(V2))
}


/** 로컬 초안 키(개정 §5.8.5) — draft:v2:<userId>:<workspaceId>:<projectId>:<kind>:<id>. 위키가 첫 사례(D52). 키 규격과 정책 판정은
 *  공용 초안 저장소(./storage)가 정본이다(SPU1) — 여기는 위키의 surface·대상 id 와 옛 키 이행만 안다 */
export const DRAFT_PREFIX = DRAFT_V2_PREFIX
export function draftKey(userId: string, workspaceId: string, projectId: string, topicId: string | null): string {
  return buildDraftKey({ userId, workspaceId, projectId, surface: 'wiki', targetId: topicId ?? 'new' })
}
/** 옛 사용자별 키(워크스페이스 없음) — 읽기 이행에만 쓴다 */
export const legacyWikiDraftKey = wikiDraftKey

type DraftStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
/** 새 키 → 없으면 옛 키. 옛 키에서 읽었으면 새 키로 쓰고 옛 키는 남긴다 — 사용자가 복구·폐기를 고르기 전에는 지우지 않는다(복구 순서).
 *  읽기·쓰기는 공용 저장소의 정책 판정을 지난다: 정책이 막으면 아무것도 읽지 않고 옮기지 않으며, 보존기간을 넘긴 초안(새·옛 키)은 지운다 */
export function readDraftWithMigration(
  storage: DraftStore, newKey: string, oldKey: string, policy: LocalDraftPolicy = DEFAULT_DRAFT_POLICY,
): { draft: string | null; from: 'new' | 'old' | null } {
  if (!policy.allowed) return { draft: null, from: null }
  const n = readDraftRaw(storage, newKey, policy)
  if (n !== null) return { draft: n, from: 'new' }
  const o = readDraftRaw(storage, oldKey, policy)
  if (o === null) return { draft: null, from: null }
  writeDraftRaw(storage, newKey, o, policy)   // 저장 실패는 편집을 막지 않는다 — 옛 키가 남아 다음에 다시 옮긴다
  return { draft: o, from: 'old' }
}
export function settleLegacyDraft(storage: Pick<Storage, 'removeItem'>, oldKey: string): void {
  try { storage.removeItem(oldKey) } catch { /* 저장소를 못 쓰는 환경 */ }
}
/** 로그아웃 — 이 브라우저의 초안 전부(새 접두 + 옛 위키 접두). 세션 만료나 /login 진입에서는 부르지 않는다(주인의 초안을 부순다) */
export function clearAllDrafts(storage: KeyStore): number {
  return removeWhere(storage, (k) => k.startsWith(DRAFT_PREFIX) || k.startsWith(`${WIKI_DRAFT_PREFIX}:`))
}
