import { describe, expect, it } from 'vitest'
// WBS 사용자 정의 값 변경 이력(개정 §3.6.7 '이력' 행) — change_logs.field = 'custom.<key>'. 저장 표현은 라벨·로케일 중립이고
// 표시는 지금의 정의로 화면과 같은 서식을 쓴다.
import type { FieldDef } from '@/lib/domain/customFields'
import { CUSTOM_LOG_PREFIX, customFieldChanges, customLogValue, formatCustomLogValue } from '@/lib/domain/customFieldValues'

const def = (over: Partial<FieldDef>): FieldDef => ({
  key: 'qty', label: '수량', description: '', type: 'number', required: false, editable_by: 'member',
  show_in_list: false, searchable: false, sort: 0, active: true, ...over,
} as FieldDef)
const FMT = { locale: 'ko', yes: '예', no: '아니오', empty: '—' }

describe('customFieldChanges', () => {
  it('바뀐 키만 — 추가·변경·제거, key 순', () => {
    expect(customFieldChanges({ a: 'x', b: 1, c: 'same', gone: 'old' }, { a: 'y', b: 2, c: 'same', added: true })).toEqual([
      { field: 'custom.a', old: 'x', new: 'y' },
      { field: 'custom.added', old: null, new: 'true' },
      { field: 'custom.b', old: '1', new: '2' },
      { field: 'custom.gone', old: 'old', new: null },
    ])
  })

  it('같은 값이면 기록이 없다(다중선택은 순서까지 같을 때)', () => {
    expect(customFieldChanges({ n: 0, b: false, t: '', m: ['a', 'b'] }, { n: 0, b: false, t: '', m: ['a', 'b'] })).toEqual([])
    expect(customFieldChanges({}, {})).toEqual([])
  })

  it('0·false 는 값이다 — 없음(null)과 구분해 남긴다', () => {
    expect(customFieldChanges({}, { n: 0, b: false })).toEqual([
      { field: 'custom.b', old: null, new: 'false' }, { field: 'custom.n', old: null, new: '0' },
    ])
    expect(customFieldChanges({ n: 0, b: false }, {})).toEqual([
      { field: 'custom.b', old: 'false', new: null }, { field: 'custom.n', old: '0', new: null },
    ])
    expect(customFieldChanges({ n: 0 }, { n: 1 })).toEqual([{ field: 'custom.n', old: '0', new: '1' }])
  })

  it('다중선택은 code 의 JSON 배열로 — 라벨 개명과 무관하다', () => {
    expect(customFieldChanges({ m: ['a'] }, { m: ['a', 'b'] })).toEqual([{ field: 'custom.m', old: '["a"]', new: '["a","b"]' }])
    expect(customLogValue(['x,y', 'z'])).toBe('["x,y","z"]')
  })

  it('필드명 접두는 스펙의 custom.<key> 다', () => {
    expect(CUSTOM_LOG_PREFIX).toBe('custom.')
  })
})

describe('formatCustomLogValue — 이력 표시', () => {
  const select = def({ key: 's', type: 'select', options: [{ code: 'pass', label: '합격', sort: 0, active: true }, { code: 'old', label: '옛 판정', sort: 1, active: false }] })
  const multi = def({ key: 'm', type: 'multiselect', options: [{ code: 'a', label: '가', sort: 0, active: true }, { code: 'b', label: '나', sort: 1, active: true }] })

  it('지금의 정의로 화면과 같은 서식 — 단위·자릿수·옵션 라벨(비활성 포함)·예/아니오', () => {
    expect(formatCustomLogValue(def({ limits: { decimals: 1, unit: 'm³' } }), '12.5', FMT)).toBe('12.5 m³')
    expect(formatCustomLogValue(def({}), '0', FMT)).toBe('0')
    expect(formatCustomLogValue(def({ type: 'boolean' }), 'false', FMT)).toBe('아니오')
    expect(formatCustomLogValue(select, 'old', FMT)).toBe('옛 판정')
    expect(formatCustomLogValue(multi, '["a","b"]', FMT)).toBe('가, 나')
    expect(formatCustomLogValue(def({ type: 'date' }), '2026-10-08', FMT)).toBe('2026-10-08')
  })

  it('값 없음(null)은 빈 표시', () => {
    expect(formatCustomLogValue(def({}), null, FMT)).toBe('—')
    expect(formatCustomLogValue(undefined, null, FMT)).toBe('—')
  })

  it('정의가 없거나(지운 필드) 그 유형으로 읽히지 않는 옛 값은 원문 그대로 — 꾸며내지 않는다', () => {
    expect(formatCustomLogValue(undefined, 'pass', FMT)).toBe('pass')
    expect(formatCustomLogValue(def({}), '옛 텍스트', FMT)).toBe('옛 텍스트')            // 유형이 text → number 로 바뀐 필드
    expect(formatCustomLogValue(def({ type: 'boolean' }), '예전값', FMT)).toBe('예전값')
    expect(formatCustomLogValue(multi, 'a', FMT)).toBe('a')
    expect(formatCustomLogValue(select, 'removed', FMT)).toBe('removed')              // 지운 옵션 — code 그대로
  })
})
