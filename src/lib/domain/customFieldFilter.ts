import type { FieldDef, FieldValue } from './customFields'
import { parseCustomValues } from './customFieldValues'
import { validateCustomValue } from './customFields'

/** An empty criterion means no filter. Text contains; typed scalar values equal; multi-select requires every chosen code. */
export function matchesCustomFieldFilter(raw: unknown, def: FieldDef | undefined, criterion: FieldValue | undefined): boolean {
  if (!def || !def.active || criterion === undefined) return true
  if (validateCustomValue(def, criterion, criterion) !== null) return false
  const parsed = parseCustomValues(raw)
  if (!parsed.ok) return false
  const value = parsed.value[def.key]
  if (def.type === 'text' || def.type === 'multiline') {
    return typeof value === 'string' && typeof criterion === 'string'
      && value.toLowerCase().includes(criterion.toLowerCase())
  }
  if (def.type === 'multiselect') return Array.isArray(value) && Array.isArray(criterion)
    && criterion.every(code => value.includes(code))
  return value === criterion
}
