// 위키 초안 키 이행(D52, 계획 과제 36) — 개정 §5.8.5 의 로컬 초안 키 규격(draft:v2:<user>:<ws>:<project>:<kind>:<id>)의 첫 사례.
import { describe, expect, it } from 'vitest'
import { clearAllDrafts, draftKey, legacyWikiDraftKey, readDraftWithMigration, settleLegacyDraft } from '@/lib/drafts/wikiDrafts'

function mem(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init))
  return { get length() { return m.size }, key: (i: number) => [...m.keys()][i] ?? null, getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v) }, removeItem: (k: string) => { m.delete(k) }, dump: () => Object.fromEntries(m) }
}
describe('위키 초안 키(D52, 개정 §5.8.5)', () => {
  it('새 키 형식', () => { expect(draftKey('u1', 'w1', 'p1', 't1')).toBe('draft:v2:u1:w1:p1:wiki:t1'); expect(draftKey('u1', 'w1', 'p1', null)).toBe('draft:v2:u1:w1:p1:wiki:new') })
  it('옛 키는 지금의 사용자별 키', () => { expect(legacyWikiDraftKey('u1', 'p1', 't1')).toBe('wiki-draft:v2:u1:p1:t1') })
  it('새 키가 없으면 옛 키에서 읽어 새 키로 옮기되 옛 키는 복구 결정 전까지 남긴다', () => {
    const s = mem({ [legacyWikiDraftKey('u1', 'p1', 't1')]: '{"bodyMd":"x","title":"t"}' })
    const r = readDraftWithMigration(s, draftKey('u1', 'w1', 'p1', 't1'), legacyWikiDraftKey('u1', 'p1', 't1'))
    expect(r).toEqual({ draft: '{"bodyMd":"x","title":"t"}', from: 'old' })
    expect(s.getItem(draftKey('u1', 'w1', 'p1', 't1'))).toBe('{"bodyMd":"x","title":"t"}')
    expect(s.getItem(legacyWikiDraftKey('u1', 'p1', 't1'))).not.toBeNull()
    settleLegacyDraft(s, legacyWikiDraftKey('u1', 'p1', 't1'))
    expect(s.getItem(legacyWikiDraftKey('u1', 'p1', 't1'))).toBeNull()
  })
  it('새 키가 있으면 그것(옛 키는 건드리지 않는다)', () => {
    const s = mem({ [draftKey('u1', 'w1', 'p1', 't1')]: 'new', [legacyWikiDraftKey('u1', 'p1', 't1')]: 'old' })
    expect(readDraftWithMigration(s, draftKey('u1', 'w1', 'p1', 't1'), legacyWikiDraftKey('u1', 'p1', 't1'))).toEqual({ draft: 'new', from: 'new' })
    expect(s.getItem(legacyWikiDraftKey('u1', 'p1', 't1'))).toBe('old')
  })
  it('둘 다 없으면 null', () => {
    expect(readDraftWithMigration(mem(), draftKey('u1', 'w1', 'p1', 't1'), legacyWikiDraftKey('u1', 'p1', 't1'))).toEqual({ draft: null, from: null })
  })
  it('새 키 쓰기가 던져도(저장소 가득) 옛 초안은 읽어 준다 — 편집을 막지 않는다', () => {
    const s = { ...mem({ [legacyWikiDraftKey('u1', 'p1', 't1')]: 'old' }), setItem: () => { throw new Error('quota') } }
    const old = mem({ [legacyWikiDraftKey('u1', 'p1', 't1')]: 'old' })
    expect(readDraftWithMigration({ getItem: old.getItem, setItem: s.setItem, removeItem: old.removeItem }, draftKey('u1', 'w1', 'p1', 't1'), legacyWikiDraftKey('u1', 'p1', 't1'))).toEqual({ draft: 'old', from: 'old' })
  })
  it('다른 사용자·다른 워크스페이스의 키는 겹치지 않는다', () => {
    expect(draftKey('u1', 'w1', 'p1', 't1')).not.toBe(draftKey('u2', 'w1', 'p1', 't1'))
    expect(draftKey('u1', 'w1', 'p1', 't1')).not.toBe(draftKey('u1', 'w2', 'p1', 't1'))
  })
  it('로그아웃 정리 — 두 접두 모두, 다른 키는 남긴다', () => {
    const s = mem({ 'draft:v2:u1:w1:p1:wiki:t': '1', 'wiki-draft:v2:u1:p1:t': '2', 'wiki-draft:p1:t': '3', other: 'keep', 'draftish': 'keep2' })
    expect(clearAllDrafts(s)).toBe(3)
    expect(s.dump()).toEqual({ other: 'keep', draftish: 'keep2' })
  })
})
