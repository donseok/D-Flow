import { beforeEach, describe, expect, it } from 'vitest'
import {
  buildDraftKey,
  parseDraftKey,
  saveDraft,
  getDraft,
  clearDraft,
  sweepExpiredDrafts,
  clearUserDrafts,
} from '@/lib/drafts/storage'

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
})
