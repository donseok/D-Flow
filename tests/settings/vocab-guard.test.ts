import { describe, expect, it } from 'vitest'
import { ERR_VOCAB_RETRY, vocabCodeError, vocabInactiveMessage, vocabWriteFailure } from '@/lib/settings/vocabGuard'
import { defaultVocab } from '@/lib/settings/vocab'

// SP5 B4 — 서버 액션의 어휘 관문(저장 전 판정)과 DB 트리거 오류의 문구 매핑. 규칙은 트리거(enforce_project_vocab)와 같다.
describe('vocabCodeError — 저장 전 판정', () => {
  const sev = defaultVocab('issues.severities').map(e => (e.code === 'low' ? { ...e, active: false } : e))
  it('활성 code 는 통과, 비활성·목록 밖·빈 값은 거부', () => {
    expect(vocabCodeError('issues.severities', sev, 'high')).toBeNull()
    expect(vocabCodeError('issues.severities', sev, 'low')).toBe(vocabInactiveMessage('issues.severities'))
    expect(vocabCodeError('issues.severities', sev, 'ghost')).toBe(vocabInactiveMessage('issues.severities'))
    expect(vocabCodeError('issues.severities', sev, '')).not.toBeNull()
    expect(vocabCodeError('issues.severities', sev, 7)).not.toBeNull()
  })
  it('값을 그대로 두는 수정은 비활성이어도 통과(트리거와 같은 규칙)', () => {
    expect(vocabCodeError('issues.severities', sev, 'low', 'low')).toBeNull()
    expect(vocabCodeError('issues.severities', sev, 'low', 'high')).not.toBeNull()
  })
})

describe('vocabWriteFailure — 트리거 원문을 화면에 흘리지 않는다', () => {
  it('PROJECT_VOCAB_INACTIVE:<key>:<code> → 그 키의 문구', () => {
    expect(vocabWriteFailure({ code: '23514', message: 'PROJECT_VOCAB_INACTIVE:meetings.categories:offsite' }))
      .toBe(vocabInactiveMessage('meetings.categories'))
  })
  it('교착·격리 가드는 재시도 문구', () => {
    expect(vocabWriteFailure({ code: '40P01', message: 'deadlock detected' })).toBe(ERR_VOCAB_RETRY)
    expect(vocabWriteFailure({ code: '25001', message: 'PROJECT_VOCAB_ISOLATION' })).toBe(ERR_VOCAB_RETRY)
  })
  it('어휘와 무관한 오류·모르는 키는 null(호출부의 기존 매핑)', () => {
    expect(vocabWriteFailure({ code: '23505', message: 'duplicate key' })).toBeNull()
    expect(vocabWriteFailure({ code: '23514', message: 'PROJECT_VOCAB_INACTIVE:x.y:z' })).toBeNull()
    expect(vocabWriteFailure(null)).toBeNull()
  })
})

describe('inUseFieldErrors — 어휘 참조 detail(0023)', async () => {
  const { inUseFieldErrors } = await import('@/lib/settings/errors')
  it('지운 code·집계 분류 변경의 건수를 키 오류로', () => {
    const removed = inUseFieldErrors(JSON.stringify({ key: 'meetings.categories', code: 'review', reason: 'removed', count: 3 }))
    expect(removed).toEqual([expect.objectContaining({ key: 'meetings.categories', code: 'review', refCount: 3 })])
    expect(removed[0].message).toContain('3건')
    const countsAs = inUseFieldErrors(JSON.stringify({ key: 'attendance.types', code: 'remote', reason: 'counts_as', count: 1 }))
    expect(countsAs[0].message).toContain('집계 분류')
  })
  it('모양이 다르면 일반 문구(건수 없음)', () => {
    expect(inUseFieldErrors(JSON.stringify({ key: 'meetings.categories', code: 'x', reason: 'other', count: 1 }))[0].refCount).toBeUndefined()
  })
})
