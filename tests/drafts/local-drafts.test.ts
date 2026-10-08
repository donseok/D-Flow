import { beforeEach, describe, expect, it } from 'vitest'
import {
  buildDraftKey,
  parseDraftKey,
  saveDraft,
  getDraft,
  clearDraft,
  sweepExpiredDrafts,
  clearUserDrafts,
  DRAFTS_OFF_POLICY,
  isDraftExpired,
  readDraftRaw,
  savedAtMs,
  writeDraftRaw,
} from '@/lib/drafts/storage'
import { draftKey, readDraftWithMigration } from '@/lib/drafts/wikiDrafts'

class MemoryStorage implements Storage {
  private store = new Map<string, string>()

  get length() {
    return this.store.size
  }

  clear() {
    this.store.clear()
  }

  getItem(key: string) {
    return this.store.get(key) ?? null
  }

  key(index: number) {
    return Array.from(this.store.keys())[index] ?? null
  }

  removeItem(key: string) {
    this.store.delete(key)
  }

  setItem(key: string, value: string) {
    this.store.set(key, value)
  }
}

describe('local-drafts storage (개정 §5.8.5)', () => {
  let storage: MemoryStorage

  beforeEach(() => {
    storage = new MemoryStorage()
  })

  it('키 규격: draft:v2:<userId>:<workspaceId>:<projectId|_>:<surface>:<targetId>', () => {
    const keyWithProject = buildDraftKey({
      userId: 'u1',
      workspaceId: 'w1',
      projectId: 'p1',
      surface: 'wbs',
      targetId: 'cell-1',
    })
    expect(keyWithProject).toBe('draft:v2:u1:w1:p1:wbs:cell-1')

    const keyWithoutProject = buildDraftKey({
      userId: 'u1',
      workspaceId: 'w1',
      projectId: null,
      surface: 'wiki',
      targetId: 'topic-new',
    })
    expect(keyWithoutProject).toBe('draft:v2:u1:w1:_:wiki:topic-new')

    const parsed = parseDraftKey(keyWithProject)
    expect(parsed).toEqual({
      userId: 'u1',
      workspaceId: 'w1',
      projectId: 'p1',
      surface: 'wbs',
      targetId: 'cell-1',
    })
  })

  it('policy.allowed 가 false 이면 저장을 거부한다', () => {
    const saved = saveDraft(storage, {
      userId: 'u1',
      workspaceId: 'w1',
      surface: 'comment',
      targetId: 'issue-1',
      content: '초안 내용',
      policy: { allowed: false, retention_days: 7 },
    })
    expect(saved).toBe(false)
    expect(storage.length).toBe(0)
  })

  it('정상 저장 및 조회가 동작한다', () => {
    saveDraft(storage, {
      userId: 'u1',
      workspaceId: 'w1',
      projectId: 'p1',
      surface: 'issue',
      targetId: 'new',
      content: '이슈 본문 초안',
    })

    const draft = getDraft(storage, {
      userId: 'u1',
      workspaceId: 'w1',
      projectId: 'p1',
      surface: 'issue',
      targetId: 'new',
    })
    expect(draft).not.toBeNull()
    expect(draft?.content).toBe('이슈 본문 초안')
  })

  it('clearDraft 로 특정 대상의 초안을 삭제한다', () => {
    saveDraft(storage, {
      userId: 'u1',
      workspaceId: 'w1',
      projectId: 'p1',
      surface: 'issue',
      targetId: 'new',
      content: '삭제할 초안',
    })

    clearDraft(storage, {
      userId: 'u1',
      workspaceId: 'w1',
      projectId: 'p1',
      surface: 'issue',
      targetId: 'new',
    })

    const draft = getDraft(storage, {
      userId: 'u1',
      workspaceId: 'w1',
      projectId: 'p1',
      surface: 'issue',
      targetId: 'new',
    })
    expect(draft).toBeNull()
  })

  it('보존 기간(retention_days)을 초과한 초안은 조회 시 null을 반환하고 삭제된다', () => {
    const key = buildDraftKey({
      userId: 'u1',
      workspaceId: 'w1',
      surface: 'wbs',
      targetId: 'item-1',
    })

    // 10일 전 저장된 초안 수동 주입
    const tenDaysAgo = Date.now() - 10 * 24 * 60 * 60 * 1000
    storage.setItem(key, JSON.stringify({ content: '낡은 초안', savedAt: tenDaysAgo }))

    // 7일 보존 정책으로 조회 -> 만료 삭제
    const draft = getDraft(storage, {
      userId: 'u1',
      workspaceId: 'w1',
      surface: 'wbs',
      targetId: 'item-1',
      policy: { allowed: true, retention_days: 7 },
    })

    expect(draft).toBeNull()
    expect(storage.getItem(key)).toBeNull()
  })

  it('sweepExpiredDrafts 로 만료된 초안을 일괄 정리한다', () => {
    const now = Date.now()
    const fiveDaysAgo = now - 5 * 24 * 60 * 60 * 1000
    const tenDaysAgo = now - 10 * 24 * 60 * 60 * 1000

    storage.setItem(
      buildDraftKey({ userId: 'u1', workspaceId: 'w1', surface: 's1', targetId: 't1' }),
      JSON.stringify({ content: '유효', savedAt: fiveDaysAgo })
    )
    storage.setItem(
      buildDraftKey({ userId: 'u1', workspaceId: 'w1', surface: 's2', targetId: 't2' }),
      JSON.stringify({ content: '만료', savedAt: tenDaysAgo })
    )

    const swept = sweepExpiredDrafts(storage, 7)
    expect(swept).toBe(1)
    expect(storage.length).toBe(1)
  })

  it('clearUserDrafts 는 특정 사용자의 초안만 모두 삭제한다', () => {
    storage.setItem(
      buildDraftKey({ userId: 'user-A', workspaceId: 'w1', surface: 's1', targetId: 't1' }),
      JSON.stringify({ content: 'A의 초안', savedAt: Date.now() })
    )
    storage.setItem(
      buildDraftKey({ userId: 'user-B', workspaceId: 'w1', surface: 's1', targetId: 't1' }),
      JSON.stringify({ content: 'B의 초안', savedAt: Date.now() })
    )

    const cleared = clearUserDrafts(storage, 'user-A')
    expect(cleared).toBe(1)
    expect(storage.length).toBe(1)
  })

  describe('정책 판정은 이 저장소 한 곳(security.local_drafts — 개정 §5.8.5)', () => {
    const DAY = 24 * 60 * 60 * 1000
    const ON = { allowed: true, retention_days: 7 }
    const OFF = { allowed: false, retention_days: 7 }
    const wiki = (savedAt: unknown) => JSON.stringify({ title: 't', bodyMd: 'b', kind: 'overview', savedAt })

    it('allowed:false 면 getDraft 도 읽지 않는다 — 이미 있는 초안을 지우지도 않는다', () => {
      const params = { userId: 'u1', workspaceId: 'w1', surface: 'issue', targetId: 'new' }
      saveDraft(storage, { ...params, content: '초안' })
      expect(getDraft(storage, { ...params, policy: OFF })).toBeNull()
      expect(storage.length).toBe(1)
      expect(getDraft(storage, { ...params, policy: ON })?.content).toBe('초안')
    })

    it('DRAFTS_OFF_POLICY(정책을 못 읽음)는 초안을 끈다', () => {
      expect(DRAFTS_OFF_POLICY.allowed).toBe(false)
      expect(writeDraftRaw(storage, 'draft:v2:u1:w1:p1:wiki:t1', wiki(new Date().toISOString()), DRAFTS_OFF_POLICY)).toBe(false)
      expect(storage.length).toBe(0)
    })

    it('writeDraftRaw·readDraftRaw — 허용일 때만 쓰고 읽는다', () => {
      const key = 'draft:v2:u1:w1:p1:wiki:t1'
      const raw = wiki(new Date().toISOString())
      expect(writeDraftRaw(storage, key, raw, OFF)).toBe(false)
      expect(storage.getItem(key)).toBeNull()
      expect(writeDraftRaw(storage, key, raw, ON)).toBe(true)
      expect(readDraftRaw(storage, key, ON)).toBe(raw)
      expect(readDraftRaw(storage, key, OFF)).toBeNull()
      expect(storage.getItem(key)).toBe(raw)                 // 정책이 막아도 지우지 않는다
    })

    it('readDraftRaw 는 보존기간을 넘긴 초안을 지우고 null — 경계(정확히 N일)는 남긴다', () => {
      const key = 'draft:v2:u1:w1:p1:wiki:t1'
      const now = Date.parse('2026-10-08T00:00:00.000Z')
      storage.setItem(key, wiki(new Date(now - 7 * DAY).toISOString()))
      expect(readDraftRaw(storage, key, ON, now)).not.toBeNull()
      storage.setItem(key, wiki(new Date(now - 7 * DAY - 1).toISOString()))
      expect(readDraftRaw(storage, key, ON, now)).toBeNull()
      expect(storage.getItem(key)).toBeNull()
      storage.setItem(key, wiki(new Date(now - 7 * DAY - 1).toISOString()))
      expect(readDraftRaw(storage, key, { allowed: true, retention_days: 30 }, now)).not.toBeNull()
    })

    it('저장 시각은 숫자·ISO 문자열 둘 다 읽고, 저장 시각을 모르는 값은 만료로 보지 않는다(근거 없이 지우지 않는다)', () => {
      expect(savedAtMs(1_700_000_000_000)).toBe(1_700_000_000_000)
      expect(savedAtMs('2026-10-01T00:00:00.000Z')).toBe(Date.parse('2026-10-01T00:00:00.000Z'))
      for (const v of ['', 'not-a-date', null, undefined, {}, Number.NaN]) expect(savedAtMs(v)).toBeNull()
      const now = Date.parse('2026-10-08T00:00:00.000Z')
      expect(isDraftExpired(wiki('2026-10-07T00:00:00.000Z'), 7, now)).toBe(false)
      expect(isDraftExpired(wiki('2026-09-30T23:59:59.999Z'), 7, now)).toBe(true)
      expect(isDraftExpired(JSON.stringify({ content: 'x', savedAt: now - 8 * DAY }), 7, now)).toBe(true)
      for (const raw of [wiki(''), '{not json', 'null', 'plain']) expect(isDraftExpired(raw, 7, now)).toBe(false)
    })

    it('sweepExpiredDrafts — ISO 저장 시각도 치우고, scope 를 주면 그 사용자·워크스페이스만 본다', () => {
      const old = wiki(new Date(Date.now() - 20 * DAY).toISOString())
      storage.setItem('draft:v2:u1:w1:p1:wiki:t1', old)
      storage.setItem('draft:v2:u1:w2:p1:wiki:t1', old)
      storage.setItem('draft:v2:u2:w1:p1:wiki:t1', old)
      storage.setItem('draft:v2:u1:w1:p1:wiki:t2', wiki(new Date().toISOString()))
      storage.setItem('draft:v2:u1:w1:p1:wiki:t3', wiki(''))          // 저장 시각 없음 — 나이를 몰라 건드리지 않는다
      expect(sweepExpiredDrafts(storage, 7, { userId: 'u1', workspaceId: 'w1' })).toBe(1)
      expect(storage.getItem('draft:v2:u1:w1:p1:wiki:t1')).toBeNull()
      expect(storage.length).toBe(4)
    })

    it('위키 초안 키는 이 저장소의 키 규격으로 만든다(한 규격)', () => {
      expect(draftKey('u1', 'w1', 'p1', 't1')).toBe(buildDraftKey({ userId: 'u1', workspaceId: 'w1', projectId: 'p1', surface: 'wiki', targetId: 't1' }))
      expect(draftKey('u1', 'w1', 'p1', null)).toBe('draft:v2:u1:w1:p1:wiki:new')
    })

    it('옛 키 이행도 정책을 지난다 — 막히면 읽지도 옮기지도 않는다', () => {
      const raw = wiki(new Date().toISOString())
      storage.setItem('wiki-draft:v2:u1:p1:t1', raw)
      expect(readDraftWithMigration(storage, 'draft:v2:u1:w1:p1:wiki:t1', 'wiki-draft:v2:u1:p1:t1', OFF)).toEqual({ draft: null, from: null })
      expect(storage.getItem('draft:v2:u1:w1:p1:wiki:t1')).toBeNull()
      expect(storage.getItem('wiki-draft:v2:u1:p1:t1')).toBe(raw)
      expect(readDraftWithMigration(storage, 'draft:v2:u1:w1:p1:wiki:t1', 'wiki-draft:v2:u1:p1:t1', ON)).toEqual({ draft: raw, from: 'old' })
      expect(storage.getItem('draft:v2:u1:w1:p1:wiki:t1')).toBe(raw)
    })
  })
})
