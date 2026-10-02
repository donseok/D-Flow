import { describe, expect, it } from 'vitest'
import { clearAllDrafts, clearLegacyWikiDrafts, wikiDraftKey } from '@/lib/drafts/wikiDrafts'

/** Map 기반 가짜 Storage — 삭제하면 뒤 키의 인덱스가 당겨지는 것까지 진짜 localStorage 와 같다. */
function memoryStorage(keys: string[]) {
  const map = new Map(keys.map(k => [k, '{}']))
  return {
    get length() { return map.size },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v) },
    removeItem: (k: string) => { map.delete(k) },
    keys: () => [...map.keys()],
  }
}

describe('wikiDraftKey', () => {
  it('사용자·프로젝트·문서를 모두 담는다(v2)', () => {
    expect(wikiDraftKey('u1', 'p1', 't1')).toBe('wiki-draft:v2:u1:p1:t1')
  })

  it('새 문서는 new 로 둔다', () => {
    expect(wikiDraftKey('u1', 'p1', null)).toBe('wiki-draft:v2:u1:p1:new')
  })
})

describe('clearLegacyWikiDrafts', () => {
  it('사용자 없는 옛 키만 지우고 v2 와 다른 키는 남긴다', () => {
    const s = memoryStorage(['wiki-draft:p1:t1', 'wiki-draft:v2:u1:p1:t1', 'other-key'])
    expect(clearLegacyWikiDrafts(s)).toBe(1)
    expect(s.keys()).toEqual(['wiki-draft:v2:u1:p1:t1', 'other-key'])
  })

  it('연속된 옛 키를 하나도 건너뛰지 않는다(순회 중 삭제 회귀)', () => {
    const s = memoryStorage(['wiki-draft:p1:a', 'wiki-draft:p1:b', 'wiki-draft:p1:c', 'other-key'])
    expect(clearLegacyWikiDrafts(s)).toBe(3)
    expect(s.keys()).toEqual(['other-key'])
  })
})

describe('clearAllDrafts(로그아웃 — D52 뒤 clearAllWikiDrafts 를 대신한다)', () => {
  it('옛 키·v2 키·새 draft:v2 키를 모두 지우고 다른 키는 남긴다', () => {
    const s = memoryStorage(['wiki-draft:p1:t1', 'wiki-draft:v2:u1:p1:t1', 'wiki-draft:v2:u2:p1:new', 'draft:v2:u1:w1:p1:wiki:t1', 'other-key'])
    expect(clearAllDrafts(s)).toBe(4)
    expect(s.keys()).toEqual(['other-key'])
  })
})
