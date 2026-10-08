import { describe, expect, it } from 'vitest'
import {
  DEFAULT_VOCAB, VOCAB_KEYS, defaultVocab, parseVocab, summarizeAttendance, vocabChangeError, vocabColor, vocabLabel, activeVocab,
} from '@/lib/settings/vocab'
import { PROJECT_SETTINGS } from '@/lib/settings/registry'

// SP5 B4 — 어휘 5키의 순수 계약. 기본값은 B4 이전 상수와 같은 code·순서여야 한다(키 없는 프로젝트의 화면·DB 판정이 그대로).
// 옛 상수(ATTENDANCE_META·MEETING_META·ISSUE_SEVERITY_META·ISSUE_SOURCE_TYPES·ISSUE_ANALYSIS_CAUSE_CATEGORIES)는 B4 묶음3 에서 지웠다 — 그 값을 오라클로 박제한다.
const OLD = {
  attendance: ['work', 'remote', 'annual', 'half', 'quarter', 'sick', 'trip', 'official', 'absent'],
  meetings: ['general', 'routine', 'kickoff', 'review', 'report', 'external'],
  severities: ['high', 'medium', 'low'],
  sources: ['minutes', 'interview', 'deliverable', 'as_is_analysis', 'data_analysis', 'other'],
  causes: ['strategy_policy', 'process', 'organization', 'it'],
}
describe('기본값 = B4 이전 상수', () => {
  it('code 집합이 같다', () => {
    expect(DEFAULT_VOCAB['attendance.types'].map(e => e.code).sort()).toEqual([...OLD.attendance].sort())
    expect(DEFAULT_VOCAB['meetings.categories'].map(e => e.code).sort()).toEqual([...OLD.meetings].sort())
    expect(DEFAULT_VOCAB['issues.severities'].map(e => e.code).sort()).toEqual([...OLD.severities].sort())
    expect(DEFAULT_VOCAB['issues.sources'].map(e => e.code)).toEqual(OLD.sources)
    expect(DEFAULT_VOCAB['issues.cause_categories'].map(e => e.code)).toEqual(OLD.causes)
  })
  it('근태 등록 선택지·회의 순서·심각도 순위가 옛 표시 순서와 같다', () => {
    expect(activeVocab(DEFAULT_VOCAB['attendance.types']).filter(e => e.selectable).map(e => e.code))
      .toEqual(['work', 'annual', 'half', 'quarter', 'sick', 'trip'])
    expect(activeVocab(DEFAULT_VOCAB['meetings.categories']).map(e => e.code)).toEqual(['routine', 'general', 'kickoff', 'review', 'report', 'external'])
    expect(activeVocab(DEFAULT_VOCAB['issues.severities']).map(e => e.code)).toEqual(['high', 'medium', 'low'])
  })
  it('근태 집계가 옛 summarize 와 같다', () => {
    const recs = ['work', 'remote', 'annual', 'half', 'quarter', 'sick', 'trip', 'official', 'absent', 'ghost'].map(type => ({ type }))
    expect(summarizeAttendance(DEFAULT_VOCAB['attendance.types'], recs)).toEqual({ total: 10, leave: 4, trip: 1, remote: 1 })
  })
  it('기본값은 각자 parse 를 통과하고, 사본은 공유 배열이 아니다', () => {
    for (const k of VOCAB_KEYS) expect(parseVocab(k, defaultVocab(k)).ok).toBe(true)
    expect(defaultVocab('issues.severities')).not.toBe(defaultVocab('issues.severities'))
    expect(defaultVocab('issues.severities')[0]).not.toBe(DEFAULT_VOCAB['issues.severities'][0])
  })
  it('다섯 정의가 레지스트리에 프로젝트 키로 있다(guarded, vocab 위젯)', () => {
    for (const k of VOCAB_KEYS) {
      const d = PROJECT_SETTINGS.find(x => x.key === k)!
      expect(d).toMatchObject({ scope: 'project', editor: 'project_admin', impact: ['guarded'], widget: { kind: 'vocab' } })
    }
    expect(PROJECT_SETTINGS.find(x => x.key === 'issues.sources')!.widget).toEqual({ kind: 'vocab', fixedCodes: ['minutes'] })
  })
})

describe('parseVocab — 엄격 검증', () => {
  const sev = () => defaultVocab('issues.severities')
  it.each([
    ['목록 아님', {}],
    ['빈 목록', []],
    ['모르는 필드', [{ ...sev()[0], extra: 1 }]],
    ['필드 누락', [{ code: 'x', label: 'x', active: true }]],
    ['code 형식', [{ ...sev()[0], code: 'High' }]],
    ['code 중복', [sev()[0], { ...sev()[1], code: 'high' }]],
    ['rank 중복', [sev()[0], { ...sev()[1], rank: 1 }]],
    ['색 토큰 밖', [{ ...sev()[0], color: '#ff0000' }]],
    ['라벨 비어 있음', [{ ...sev()[0], label: '  ' }]],
    ['활성 0개', sev().map(e => ({ ...e, active: false }))],
  ])('%s → 거부', (_n, raw) => {
    expect(parseVocab('issues.severities', raw).ok).toBe(false)
  })
  it("출처 'minutes' 는 지우거나 끌 수 없다", () => {
    const src = defaultVocab('issues.sources')
    expect(parseVocab('issues.sources', src.filter(e => e.code !== 'minutes')).ok).toBe(false)
    expect(parseVocab('issues.sources', src.map(e => e.code === 'minutes' ? { ...e, active: false } : e)).ok).toBe(false)
  })
  it('등록 가능한 활성 근태 유형이 하나는 있어야 한다', () => {
    expect(parseVocab('attendance.types', defaultVocab('attendance.types').map(e => ({ ...e, selectable: false }))).ok).toBe(false)
  })
  it('라벨 공백을 정규화하고 새 code 를 받는다', () => {
    const r = parseVocab('issues.severities', [...sev(), { code: 'critical', label: '  치명 ', rank: 0, color: 'delayed', active: true }])
    expect(r.ok && r.value.find(e => e.code === 'critical')?.label).toBe('치명')
  })
})

describe('편집 규칙 — 이전 값과 비교', () => {
  it('원인 분류는 지울 수 없고 비활성만 된다', () => {
    const prev = defaultVocab('issues.cause_categories')
    expect(vocabChangeError('issues.cause_categories', prev, prev.slice(1))).toMatch(/strategy_policy/)
    expect(vocabChangeError('issues.cause_categories', prev, prev.map((e, i) => i === 0 ? { ...e, active: false } : e))).toBeNull()
  })
  it('다른 키의 삭제는 TS 가 막지 않는다(참조 건수는 DB 가 판정)', () => {
    const prev = defaultVocab('meetings.categories')
    expect(vocabChangeError('meetings.categories', prev, prev.slice(1))).toBeNull()
  })
})

describe('표시', () => {
  const t = (k: string) => `T(${k})`
  it('기본 라벨이면 사전 문구, 바꾼 라벨은 그대로, 목록 밖 code 는 code', () => {
    const list = defaultVocab('meetings.categories')
    expect(vocabLabel('meetings.categories', list, 'routine', t as never)).toBe('T(meet.cat.routine)')
    const renamed = list.map(e => e.code === 'routine' ? { ...e, label: '주간 회의' } : e)
    expect(vocabLabel('meetings.categories', renamed, 'routine', t as never)).toBe('주간 회의')
    expect(vocabLabel('meetings.categories', list, 'gone', t as never)).toBe('gone')
    expect(vocabLabel('issues.cause_categories', defaultVocab('issues.cause_categories'), 'it', t as never)).toBe('I · IT')
  })
  it('색은 의미 토큰 클래스, 모르면 neutral', () => {
    expect(vocabColor(defaultVocab('issues.severities'), 'high').chip).toBe('bg-danger-weak text-danger')
    expect(vocabColor(defaultVocab('issues.severities'), 'x').chip).toBe('bg-neutral-weak text-neutral')
  })
})
