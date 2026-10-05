/** Whole-row field edits: typed values, definition permissions and absence are checked before the JWT/CAS write. */
import { validateCustomValue, type CustomValues, type CustomValueError, type FieldDef, type FieldValue } from './customFields'
import type { Parsed } from '@/lib/settings/def'
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const own = (v: object, k: string) => Object.prototype.hasOwnProperty.call(v, k)
const value = (v: unknown): v is FieldValue => typeof v === 'string' || typeof v === 'boolean'
  || (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e12)
  || (Array.isArray(v) && v.every(x => typeof x === 'string'))
/** Does not fall back to {} for a corrupt stored value. Callers choose their visible error state. */
export function parseCustomValues(raw: unknown): Parsed<CustomValues> {
  if (!object(raw) || Object.values(raw).some(v => !value(v))) return { ok: false, error: '추가 정보는 필드별 문자열·숫자·예/아니오·선택 목록이어야 합니다.' }
  return { ok: true, value: Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? [...v] : v as FieldValue])) }
}
export type FieldRowError = CustomValueError | 'unknown' | 'required' | 'inactive' | 'admin_only' | 'shape'
export type FieldRowValidation = { ok: true; value: CustomValues } | { ok: false; errors: Record<string, FieldRowError> }
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
/** No default insertion on UPDATE. Clearing a control deletes its key; false, zero and retained inactive values remain intact. */
export function validateCustomValues(defs: readonly FieldDef[], next: unknown, prev: unknown, canAdmin: boolean): FieldRowValidation {
  const before = parseCustomValues(prev)
  if (!before.ok || !object(next)) return { ok: false, errors: { $: 'shape' } }
  const errors = new Map<string, FieldRowError>()
  const byKey = new Map(defs.map(d => [d.key, d]))
  for (const [key, v] of Object.entries(next)) {
    const def = byKey.get(key)
    if (!def) { errors.set(key, 'unknown'); continue }
    const invalid = validateCustomValue(def, v, before.value[key])
    if (invalid) errors.set(key, invalid)
  }
  for (const def of defs) {
    const changed = own(next, def.key) !== own(before.value, def.key) || !same(next[def.key], before.value[def.key])
    if (def.required && !own(next, def.key)) errors.set(def.key, 'required')
    if (changed && !def.active) errors.set(def.key, 'inactive')
    if (changed && def.editable_by === 'admin' && !canAdmin) errors.set(def.key, 'admin_only')
  }
  if (errors.size) return { ok: false, errors: Object.fromEntries(errors) }
  const parsed = parseCustomValues(next)
  return parsed.ok ? parsed : { ok: false, errors: { $: 'shape' } }
}

/** INSERT alone receives required defaults. Return only supplied keys so the DB remains their source. */
export function validateCustomInsertValues(defs: readonly FieldDef[], raw: unknown, canAdmin: boolean): FieldRowValidation {
  const supplied = parseCustomValues(raw)
  if (!supplied.ok) return { ok: false, errors: { $: 'shape' } }
  const errors: Record<string, FieldRowError> = {}
  for (const key of Object.keys(supplied.value)) {
    const def = defs.find(d => d.key === key)
    if (!def) errors[key] = 'unknown'
    else if (!def.active) errors[key] = 'inactive'
    else if (def.editable_by === 'admin' && !canAdmin) errors[key] = 'admin_only'
  }
  if (Object.keys(errors).length) return { ok: false, errors }
  const generated = Object.fromEntries(defs.filter(d => d.required && d.default !== undefined && !own(supplied.value, d.key))
    .map(d => [d.key, Array.isArray(d.default) ? [...d.default] : d.default]))
  const checked = validateCustomValues(defs, { ...generated, ...supplied.value }, generated, canAdmin)
  return checked.ok ? supplied : checked
}

/** Only documented DB prefixes and closed reason codes become field errors. Never return arbitrary DB detail to a form. */
export function mapCustomFieldDbError(error: { message?: string }): Record<string, FieldRowError> | null {
  const hit = /^CUSTOM_FIELD_(UNKNOWN|NULL|INVALID|INACTIVE|REQUIRED|ADMIN_ONLY):([a-z][a-z0-9_]{0,31})(?::([a-z_]+))?$/.exec(error.message ?? '')
  if (!hit) return null
  const fixed: Record<string, FieldRowError> = { UNKNOWN: 'unknown', NULL: 'null', INACTIVE: 'inactive', REQUIRED: 'required', ADMIN_ONLY: 'admin_only' }
  const values: readonly FieldRowError[] = ['null', 'type', 'empty', 'newline', 'length', 'number', 'decimals', 'range', 'date', 'option', 'inactive_option', 'duplicate', 'items']
  if (hit[1] === 'INVALID') return values.includes(hit[3] as FieldRowError) ? Object.fromEntries([[hit[2], hit[3] as FieldRowError]]) : null
  return hit[3] === undefined ? Object.fromEntries([[hit[2], fixed[hit[1]]]]) : null
}
