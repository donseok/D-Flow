/** 위키 로컬 초안 키 — 사용자별(v2). 옛 키(wiki-draft:<pid>:<tid>)는 누가 쓴 것인지 몰라 공용 PC 에서 남의 초안이 떴다. */
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

/** 로그아웃 시 — 이 브라우저의 위키 초안 전부. 세션 만료나 /login 진입에서는 부르지 않는다(주인의 초안을 부순다). */
export function clearAllWikiDrafts(storage: KeyStore): number {
  return removeWhere(storage, k => k.startsWith(`${WIKI_DRAFT_PREFIX}:`))
}
