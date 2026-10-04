import { describe, expect, it } from 'vitest'
import { mapCustomFieldDbError, parseCustomValues, validateCustomValues } from '@/lib/domain/customFieldValues'
import type { FieldDef } from '@/lib/domain/customFields'
const def = (patch: Partial<FieldDef> = {}): FieldDef => ({ key: 'quantity', label: 'Quantity', description: '', type: 'number', required: false, editable_by: 'member', show_in_list: false, searchable: false, active: true, sort: 0, ...patch })
describe('whole-row field edits', () => {
  it.each([null, [], 'x', { a: null }, { a: NaN }, { a: Infinity }, { a: {} }, { a: [1] }])('rejects malformed stored/input values: %j', raw => expect(parseCustomValues(raw).ok).toBe(false))
  it('keeps zero/false and prototype-named keys, and clones arrays', () => {
    const raw = { quantity: 0, constructor: false, tags: ['a'] }, parsed = parseCustomValues(raw)
    expect(parsed).toEqual({ ok: true, value: raw }); if (parsed.ok) parsed.value.tags = ['b']; expect(raw.tags).toEqual(['a'])
  })
  it('unknown and null values remain explicit errors', () => {
    expect(validateCustomValues([def()], { other: 0, quantity: null }, {}, false)).toEqual({ ok: false, errors: { other: 'unknown', quantity: 'null' } })
  })
  it('required removals do not insert a default on UPDATE', () => {
    expect(validateCustomValues([def({ required: true, default: 0 })], {}, { quantity: 1 }, true)).toEqual({ ok: false, errors: { quantity: 'required' } })
  })
  it('inactive values are preserved, and both changed and removed values are denied', () => {
    const defs = [def({ active: false }), def({ key: 'next' })]
    expect(validateCustomValues(defs, { quantity: 0, next: 2 }, { quantity: 0 }, false).ok).toBe(true)
    for (const next of [{ quantity: 1 }, {}]) expect(validateCustomValues(defs, next, { quantity: 0 }, true)).toEqual({ ok: false, errors: { quantity: 'inactive' } })
  })
  it('a member can retain an admin field but cannot change or remove it', () => {
    const defs = [def({ editable_by: 'admin' }), def({ key: 'next' })]
    expect(validateCustomValues(defs, { quantity: 0, next: 2 }, { quantity: 0 }, false).ok).toBe(true)
    for (const next of [{ quantity: 1 }, {}]) expect(validateCustomValues(defs, next, { quantity: 0 }, false)).toEqual({ ok: false, errors: { quantity: 'admin_only' } })
    expect(validateCustomValues(defs, { quantity: 1 }, { quantity: 0 }, true).ok).toBe(true)
  })
  it('inactive options may be retained while active options are added', () => {
    const defs = [def({ type: 'multiselect', options: [{ code: 'old', label: 'Old', active: false, sort: 0 }, { code: 'new', label: 'New', active: true, sort: 1 }] })]
    expect(validateCustomValues(defs, { quantity: ['old', 'new'] }, { quantity: ['old'] }, false).ok).toBe(true)
    expect(validateCustomValues(defs, { quantity: ['old'] }, {}, false)).toEqual({ ok: false, errors: { quantity: 'inactive_option' } })
  })
  it('unchanged optional empty multiline values do not disappear during another edit', () => {
    expect(validateCustomValues([def({ type: 'multiline', active: false }), def({ key: 'next' })], { quantity: '', next: 0 }, { quantity: '' }, false)).toEqual({ ok: true, value: { quantity: '', next: 0 } })
  })
  it('prototype keys obey field permissions without prototype lookups', () => {
    expect(validateCustomValues([def({ key: 'constructor', type: 'boolean', editable_by: 'admin' })], { constructor: true }, { constructor: false }, false)).toEqual({ ok: false, errors: { constructor: 'admin_only' } })
  })
})

describe('DB field errors', () => {
  it.each([['CUSTOM_FIELD_INVALID:quantity:length', { quantity: 'length' }], ['CUSTOM_FIELD_REQUIRED:quantity', { quantity: 'required' }], ['CUSTOM_FIELD_ADMIN_ONLY:constructor', { constructor: 'admin_only' }]])('maps %s to a safe field reason', (message, expected) => expect(mapCustomFieldDbError({ message })).toEqual(expected))
  it.each(['CUSTOM_FIELD_INVALID:quantity:private', 'CUSTOM_FIELD_UNKNOWN:quantity:private', 'CUSTOM_FIELD_REQUIRED:Quantity', 'private DB message', 'CUSTOM_FIELD_SIZE'])('does not expose arbitrary details: %s', message => expect(mapCustomFieldDbError({ message })).toBeNull())
})
