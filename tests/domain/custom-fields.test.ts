import { describe, expect, it } from 'vitest'
import golden from '../fixtures/parity/custom-fields-cases.json'
import { carryCustomFields, customSearchText, formatCustomValue, normalizeCustomValues, orderedFields, parseFieldDefs, validateCustomValue, type FieldDef } from '@/lib/domain/customFields'

const defs = golden.defs as Record<string, FieldDef>
const field = (patch: Partial<FieldDef> = {}): FieldDef => ({ ...defs.text, ...patch })

describe('custom field value TS↔SQL golden contract', () => {
  it.each(golden.cases)('$name', c => {
    expect(validateCustomValue(defs[c.def], c.value, 'prev' in c ? c.prev : undefined)).toBe(c.error)
  })
  it('NaN/infinity cannot enter JSON numeric fields', () => {
    for (const v of [NaN, Infinity, -Infinity]) expect(validateCustomValue(defs.number, v)).toBe('number')
  })
  it('all golden definitions pass the stored parser', () => {
    for (const d of Object.values(defs)) expect(parseFieldDefs('issue', [d]).ok).toBe(true)
  })
})

describe('stored field definitions', () => {
  it('empty = no project fields; label/unit trim, weekly carry defaults false; parser does not mutate', () => {
    expect(parseFieldDefs('issue', [])).toEqual({ ok: true, value: [] })
    const input = field({ label: '  수량  ', type: 'number', limits: { unit: ' m³ ', decimals: 1 } })
    expect(parseFieldDefs('weekly_row', [input])).toMatchObject({ ok: true, value: [{ label: '수량', carry_over: false, limits: { unit: 'm³' } }] })
    expect(input.label).toBe('  수량  ')
    expect(input.limits?.unit).toBe(' m³ ')
  })
  it.each([
    { key: 'A' }, { key: 'a'.repeat(33) }, { label: ' ' }, { description: 'a'.repeat(301) },
    { type: 'url' }, { active: 'true' }, { editable_by: 'owner' }, { sort: -1 }, { sort: 0.5 },
    { unknown: true }, { limits: { decimals: 2 } }, { limits: { maxLength: 2001 } },
    { limits: { maxLength: null } }, { options: [] }, { required: true }, { default: null },
    { default: '' }, { carry_over: false },
  ])('rejects invalid definition %j', patch => {
    expect(parseFieldDefs('issue', [{ ...field(), ...patch }]).ok).toBe(false)
  })
  it('required false/zero defaults are valid, null is not', () => {
    for (const d of [field({ type: 'boolean', required: true, default: false }), field({ type: 'number', required: true, default: 0 })]) {
      expect(parseFieldDefs('issue', [d]).ok).toBe(true)
    }
  })
  it('strict option parsing: duplicate code, raw color, unknown/null attrs, invalid/disabled defaults', () => {
    const select = defs.select
    for (const options of [[], Array(101).fill(select.options![0]), [select.options![0], select.options![0]],
      [{ ...select.options![0], code: 'bad code' }], [{ ...select.options![0], color: '#fff' }],
      [{ ...select.options![0], color: null }], [{ ...select.options![0], extra: 1 }]]) {
      expect(parseFieldDefs('issue', [{ ...select, options }]).ok).toBe(false)
    }
    expect(parseFieldDefs('issue', [{ ...select, default: 'legacy' }]).ok).toBe(false)
    expect(parseFieldDefs('issue', [{ ...select, required: true, default: 'pending' }]).ok).toBe(true)
  })
  it('numeric boundaries and per-type limits are strict', () => {
    for (const limits of [{ min: 2, max: 1 }, { decimals: 5 }, { min: Infinity }, { max: -1e13 }, { unit: '' }, { maxItems: 1 }]) {
      expect(parseFieldDefs('wbs_item', [field({ type: 'number', limits })]).ok).toBe(false)
    }
    expect(parseFieldDefs('issue', [field({ type: 'multiline', limits: { maxLength: 4000 } })]).ok).toBe(true)
    expect(parseFieldDefs('issue', [field({ type: 'multiline', limits: { maxLength: 4001 } })]).ok).toBe(false)
    expect(parseFieldDefs('issue', [{ ...defs.multiselect, limits: { maxItems: 21 } }]).ok).toBe(false)
    expect(parseFieldDefs('issue', [field({ type: 'date', limits: { maxLength: 10 } })]).ok).toBe(false)
  })
  it('enforces 30 active / 60 total / 8 list columns and unique keys', () => {
    const many = (n: number, active = true, list = false) => Array.from({ length: n }, (_, i) => field({ key: `f${i}`, active, show_in_list: list }))
    expect(parseFieldDefs('issue', many(30)).ok).toBe(true)
    expect(parseFieldDefs('issue', many(31)).ok).toBe(false)
    expect(parseFieldDefs('issue', many(60, false)).ok).toBe(true)
    expect(parseFieldDefs('issue', many(61, false)).ok).toBe(false)
    expect(parseFieldDefs('issue', many(8, true, true)).ok).toBe(true)
    expect(parseFieldDefs('issue', many(9, true, true)).ok).toBe(false)
    expect(parseFieldDefs('issue', [field(), field()]).ok).toBe(false)
  })
  it('Unicode length agrees with PostgreSQL char_length', () => {
    expect(parseFieldDefs('issue', [field({ label: '😀'.repeat(40) })]).ok).toBe(true)
    expect(parseFieldDefs('issue', [field({ label: '😀'.repeat(41) })]).ok).toBe(false)
  })
})

describe('field projection and formatting', () => {
  it('carry selects active opt-in values only; array data is copied', () => {
    const d = [field({ key: 'keep', carry_over: true }), field({ key: 'drop' }), field({ key: 'inactive', carry_over: true, active: false })]
    const values = { keep: ['pending'], drop: 2, inactive: 3 }
    const result = carryCustomFields(d, values)
    expect(result).toEqual({ keep: ['pending'] })
    ;(result.keep as string[]).push('pass')
    expect(values.keep).toEqual(['pending'])
  })
  it('empty input removes key while false/zero and explicit null survive for validation', () => {
    expect(normalizeCustomValues({ empty: '', absent: undefined, zero: 0, false: false, bad: null })).toEqual({ zero: 0, false: false, bad: null })
  })
  it('locale formatting, renamed/inactive options and stable identity', () => {
    expect(formatCustomValue(defs.quantity, 12.3)).toBe('12.3 m³')
    expect(formatCustomValue(defs.boolean, false, { no: 'No' })).toBe('No')
    expect(formatCustomValue(defs.date, '2024-02-29')).toBe('2024-02-29')
    expect(formatCustomValue(defs.select, 'legacy')).toBe('과거')
    expect(formatCustomValue(defs.multiselect, ['pass', 'legacy'])).toBe('통과, 과거')
    expect(formatCustomValue(defs.text, undefined, { empty: '—' })).toBe('—')
    const renamed = { ...defs.select, label: '실험 결과', options: defs.select.options!.map(o => ({ ...o, label: `새 ${o.label}` })) }
    expect(customSearchText([renamed], { value: 'pass' })).toBe('실험 결과: 새 통과')
    expect(customSearchText([{ ...renamed, active: false }], { value: 'pass' })).toBe('')
    expect(customSearchText([{ ...renamed, searchable: false }], { value: 'pass' })).toBe('')
  })
  it('sort returns a copy and uses key tie-breaker', () => {
    const input = [field({ key: 'b' }), field({ key: 'a' })]
    expect(orderedFields(input).map(d => d.key)).toEqual(['a', 'b'])
    expect(input.map(d => d.key)).toEqual(['b', 'a'])
  })
})
