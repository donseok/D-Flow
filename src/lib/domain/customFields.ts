/**
 * SP5c 사용자 정의 필드의 순수 계약(개정 §3.6).
 * 값 오류는 SQL custom_value_error와 같은 이유 코드로 돌려준다.
 * 정의 없는 프로젝트는 빈 목록. 설정 레지스트리/DB/서버를 런타임 import하지 않는다.
 */
import type { Parsed } from '@/lib/settings/def'
import { VOCAB_COLORS, type VocabColor } from '@/lib/settings/vocab'

export const FIELD_ENTITIES = ['wbs_item', 'issue', 'weekly_row'] as const
export type FieldEntity = (typeof FIELD_ENTITIES)[number]
export const FIELD_TYPES = ['text', 'multiline', 'number', 'date', 'boolean', 'select', 'multiselect'] as const
export type FieldType = (typeof FIELD_TYPES)[number]
export type FieldValue = string | number | boolean | string[]
export type CustomValues = Record<string, FieldValue>
export interface FieldOption { code: string; label: string; color?: VocabColor; sort: number; active: boolean }
export interface FieldLimits { maxLength?: number; min?: number; max?: number; decimals?: number; unit?: string; maxItems?: number }
export interface FieldDef {
  key: string; label: string; description: string; type: FieldType; required: boolean
  default?: FieldValue; options?: FieldOption[]; limits?: FieldLimits
  editable_by: 'member' | 'admin'; show_in_list: boolean; searchable: boolean
  carry_over?: boolean; sort: number; active: boolean
}
export const CUSTOM_FIELD_LIMITS = { active: 30, total: 60, list: 8, options: 100, maxItems: 20, bytes: 16384, number: 1e12 } as const
export const FIELD_KEY_RE = /^[a-z][a-z0-9_]{0,31}$/
export const FIELD_OPTION_RE = /^[a-z0-9][a-z0-9_-]{0,29}$/
const own = (v: object, key: string) => Object.prototype.hasOwnProperty.call(v, key)
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
// PostgreSQL char_length counts code points, not UTF-16 surrogate pairs.
const length = (v: string) => Array.from(v).length
const integer = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max
const boundedNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= CUSTOM_FIELD_LIMITS.number
const fail = <T>(error: string): Parsed<T> => ({ ok: false, error })

/** Decimal representation, including exponent notation; no floating point multiplication/epsilon rounding. */
function decimalPlaces(v: number): number {
  const [mantissa, exponent = '0'] = String(v).toLowerCase().split('e')
  return Math.max(0, (mantissa.split('.')[1]?.length ?? 0) - Number(exponent))
}
function realDate(v: string): boolean {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v) || v.startsWith('0000-')) return false
  const d = new Date(`${v}T00:00:00.000Z`)
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v
}

export type CustomValueError = 'null' | 'type' | 'empty' | 'newline' | 'length' | 'number' | 'decimals' | 'range' | 'date' | 'option' | 'inactive_option' | 'duplicate' | 'items'
/** null = valid. Null values are forbidden: absence means removing the key. */
export function validateCustomValue(def: FieldDef, value: unknown, prev?: unknown): CustomValueError | null {
  if (value === null || value === undefined) return 'null'
  const limits = def.limits ?? {}
  switch (def.type) {
    case 'text': case 'multiline':
      if (typeof value !== 'string') return 'type'
      if (value === '' && (def.type === 'text' || def.required)) return 'empty'
      if (def.type === 'text' && /[\r\n]/.test(value)) return 'newline'
      return length(value) > (limits.maxLength ?? (def.type === 'text' ? 200 : 2000)) ? 'length' : null
    case 'number':
      if (typeof value !== 'number') return 'type'
      if (!boundedNumber(value)) return 'number'
      if (decimalPlaces(value) > (limits.decimals ?? 0)) return 'decimals'
      return (limits.min !== undefined && value < limits.min) || (limits.max !== undefined && value > limits.max) ? 'range' : null
    case 'date': return typeof value !== 'string' ? 'type' : realDate(value) ? null : 'date'
    case 'boolean': return typeof value === 'boolean' ? null : 'type'
    case 'select': {
      if (typeof value !== 'string') return 'type'
      const option = def.options?.find(o => o.code === value)
      return !option ? 'option' : option.active || value === prev ? null : 'inactive_option'
    }
    case 'multiselect': {
      if (!Array.isArray(value) || value.some(v => typeof v !== 'string')) return 'type'
      if (new Set(value).size !== value.length) return 'duplicate'
      if (value.length > (limits.maxItems ?? 10)) return 'items'
      if (def.required && value.length === 0) return 'empty'
      for (const code of value) {
        const option = def.options?.find(o => o.code === code)
        if (!option) return 'option'
        if (!option.active && !(Array.isArray(prev) && prev.includes(code))) return 'inactive_option'
      }
      return null
    }
  }
}

const REQUIRED = ['key', 'label', 'description', 'type', 'required', 'editable_by', 'show_in_list', 'searchable', 'sort', 'active'] as const
const OPTIONAL = ['default', 'options', 'limits', 'carry_over']
const LIMIT_KEYS: Readonly<Record<FieldType, readonly string[]>> = {
  text: ['maxLength'], multiline: ['maxLength'], number: ['min', 'max', 'decimals', 'unit'],
  date: [], boolean: [], select: [], multiselect: ['maxItems'],
}

/** Strict stored-definition parser. Optional defaults stay absent; explicit null is rejected. */
export function parseFieldDefs(entity: FieldEntity, raw: unknown): Parsed<FieldDef[]> {
  if (!Array.isArray(raw) || raw.length > CUSTOM_FIELD_LIMITS.total) return fail('필드 목록은 최대 60개입니다.')
  const out: FieldDef[] = []
  const keys = new Set<string>()
  for (const item of raw) {
    if (!object(item) || REQUIRED.some(k => !own(item, k)) || Object.keys(item).some(k => ![...REQUIRED, ...OPTIONAL].includes(k))) return fail('필드 정의가 빠졌거나 모르는 속성이 있습니다.')
    if (typeof item.key !== 'string' || !FIELD_KEY_RE.test(item.key) || keys.has(item.key)) return fail('필드 key 형식이 잘못됐거나 중복됩니다.')
    keys.add(item.key)
    if (typeof item.label !== 'string' || length(item.label.trim()) < 1 || length(item.label.trim()) > 40) return fail(`${item.key}: 이름은 1~40자입니다.`)
    if (typeof item.description !== 'string' || length(item.description) > 300) return fail(`${item.key}: 설명은 최대 300자입니다.`)
    if (!(FIELD_TYPES as readonly unknown[]).includes(item.type)) return fail(`${item.key}: 모르는 필드 유형입니다.`)
    if (['required', 'show_in_list', 'searchable', 'active'].some(k => typeof item[k] !== 'boolean')) return fail(`${item.key}: 참·거짓 속성이 잘못됐습니다.`)
    if (item.editable_by !== 'member' && item.editable_by !== 'admin') return fail(`${item.key}: 편집 권한은 member 또는 admin입니다.`)
    if (!integer(item.sort, 0, 9999)) return fail(`${item.key}: 순서는 0~9999 정수입니다.`)
    if (own(item, 'carry_over') && (entity !== 'weekly_row' || typeof item.carry_over !== 'boolean')) return fail(`${item.key}: 이월 설정은 주간 행에만 쓸 수 있습니다.`)
    const type = item.type as FieldType
    const def: FieldDef = {
      key: item.key, label: item.label.trim(), description: item.description, type,
      required: item.required as boolean, editable_by: item.editable_by,
      show_in_list: item.show_in_list as boolean, searchable: item.searchable as boolean,
      sort: item.sort as number, active: item.active as boolean,
      ...(entity === 'weekly_row' ? { carry_over: item.carry_over === true } : {}),
    }
    if (own(item, 'limits')) {
      if (!object(item.limits) || Object.keys(item.limits).some(k => !LIMIT_KEYS[type].includes(k))) return fail(`${def.key}: 유형에 맞지 않는 제한입니다.`)
      const l = item.limits
      if (own(l, 'maxLength') && !integer(l.maxLength, 1, type === 'text' ? 2000 : 4000)) return fail(`${def.key}: 최대 길이가 잘못됐습니다.`)
      if (own(l, 'decimals') && !integer(l.decimals, 0, 4)) return fail(`${def.key}: 소수 자릿수는 0~4입니다.`)
      if (own(l, 'maxItems') && !integer(l.maxItems, 1, 20)) return fail(`${def.key}: 최대 선택 개수는 1~20입니다.`)
      if (['min', 'max'].some(k => own(l, k) && !boundedNumber(l[k]))) return fail(`${def.key}: 숫자 범위가 잘못됐습니다.`)
      if (typeof l.min === 'number' && typeof l.max === 'number' && l.min > l.max) return fail(`${def.key}: 최솟값이 최댓값보다 큽니다.`)
      if (own(l, 'unit') && (typeof l.unit !== 'string' || length(l.unit.trim()) < 1 || length(l.unit.trim()) > 10)) return fail(`${def.key}: 단위는 1~10자입니다.`)
      def.limits = { ...l, ...(typeof l.unit === 'string' ? { unit: l.unit.trim() } : {}) } as FieldLimits
    }
    if (type === 'select' || type === 'multiselect') {
      if (!Array.isArray(item.options) || item.options.length < 1 || item.options.length > 100) return fail(`${def.key}: 선택지는 1~100개입니다.`)
      const codes = new Set<string>()
      def.options = []
      for (const o of item.options) {
        if (!object(o) || ['code', 'label', 'sort', 'active'].some(k => !own(o, k)) || Object.keys(o).some(k => !['code', 'label', 'sort', 'active', 'color'].includes(k))) return fail(`${def.key}: 선택지 속성이 잘못됐습니다.`)
        if (typeof o.code !== 'string' || !FIELD_OPTION_RE.test(o.code) || codes.has(o.code)) return fail(`${def.key}: 선택지 code 형식이 잘못됐거나 중복됩니다.`)
        codes.add(o.code)
        if (typeof o.label !== 'string' || length(o.label.trim()) < 1 || length(o.label.trim()) > 40 || !integer(o.sort, 0, 9999) || typeof o.active !== 'boolean') return fail(`${def.key}: 선택지 이름·순서·활성이 잘못됐습니다.`)
        if (own(o, 'color') && !(VOCAB_COLORS as readonly unknown[]).includes(o.color)) return fail(`${def.key}: 색은 의미 토큰이어야 합니다.`)
        def.options.push({ code: o.code, label: o.label.trim(), sort: o.sort as number, active: o.active, ...(own(o, 'color') ? { color: o.color as VocabColor } : {}) })
      }
    } else if (own(item, 'options')) return fail(`${def.key}: 선택 유형만 선택지를 가집니다.`)
    if (def.required && !own(item, 'default')) return fail(`${def.key}: 필수 필드는 기본값이 필요합니다.`)
    if (own(item, 'default')) {
      const error = validateCustomValue(def, item.default)
      if (error) return fail(`${def.key}: 기본값이 잘못됐습니다(${error}).`)
      def.default = Array.isArray(item.default) ? [...item.default] : item.default as FieldValue
    }
    out.push(def)
  }
  if (out.filter(d => d.active).length > CUSTOM_FIELD_LIMITS.active) return fail('활성 필드는 최대 30개입니다.')
  if (out.filter(d => d.show_in_list).length > CUSTOM_FIELD_LIMITS.list) return fail('목록 표시 필드는 최대 8개입니다.')
  return { ok: true, value: out }
}

/** Stable field order; labels may change without changing identity. */
export function orderedFields(defs: readonly FieldDef[]): FieldDef[] {
  return [...defs].sort((a, b) => a.sort - b.sort || a.key.localeCompare(b.key))
}
/** Only active opt-in fields carry forward. Missing required defaults are the INSERT trigger's responsibility. */
export function carryCustomFields(defs: readonly FieldDef[], prev: CustomValues): CustomValues {
  return Object.fromEntries(defs.filter(d => d.active && d.carry_over && own(prev, d.key)).map(d => { const value = prev[d.key]; return [d.key, Array.isArray(value) ? [...value] : value] }))
}
/** Explicit empty input removes the key; never coerce false or zero to absence. Does not mutate caller data. */
export function normalizeCustomValues(raw: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== '' && v !== undefined))
}
/** Same formatter for lists, Excel display cells and AI index text; inactive option labels remain readable. */
export function formatCustomValue(def: FieldDef, value: FieldValue | undefined, opts: { locale?: string; yes?: string; no?: string; empty?: string } = {}): string {
  if (value === undefined) return opts.empty ?? ''
  if (def.type === 'boolean' && typeof value === 'boolean') return value ? opts.yes ?? '예' : opts.no ?? '아니오'
  if (def.type === 'number' && typeof value === 'number') {
    const decimals = def.limits?.decimals ?? 0
    const n = new Intl.NumberFormat(opts.locale ?? 'ko-KR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value)
    return `${n}${def.limits?.unit ? ` ${def.limits.unit}` : ''}`
  }
  if (def.type === 'select' || def.type === 'multiselect') {
    const codes = Array.isArray(value) ? value : [String(value)]
    return codes.map(code => def.options?.find(o => o.code === code)?.label ?? code).join(', ')
  }
  return String(value)
}
/** One `label: value` entry per active searchable field that has a value (a multiline value stays inside its entry). */
export function customSearchLines(defs: readonly FieldDef[], values: CustomValues, opts?: Parameters<typeof formatCustomValue>[2]): string[] {
  return orderedFields(defs).filter(d => d.active && d.searchable && own(values, d.key))
    .map(d => `${d.label}: ${formatCustomValue(d, values[d.key], opts)}`)
}
export function customSearchText(defs: readonly FieldDef[], values: CustomValues, opts?: Parameters<typeof formatCustomValue>[2]): string {
  return customSearchLines(defs, values, opts).join('\n')
}

/**
 * Detects whether field definition changes affect AI search indexing (reindexOn: ['label', 'searchable', 'options.label']).
 * Returns true if:
 * - A searchable field was added, removed, or had its `searchable` or `active` flag changed
 * - An active & searchable field had its `label` changed
 * - An active & searchable select/multiselect field had any of its option labels changed
 */
export function hasCustomFieldReindexChange(
  prevDefs: readonly FieldDef[] = [],
  nextDefs: readonly FieldDef[] = [],
): boolean {
  const prevMap = new Map(prevDefs.map(d => [d.key, d]))
  const nextMap = new Map(nextDefs.map(d => [d.key, d]))
  const allKeys = new Set([...prevMap.keys(), ...nextMap.keys()])
  for (const k of allKeys) {
    const p = prevMap.get(k)
    const n = nextMap.get(k)
    if (!p && !n) continue
    if (!p && n) {
      if (n.active && n.searchable) return true
      continue
    }
    if (p && !n) {
      if (p.active && p.searchable) return true
      continue
    }
    if (p && n) {
      if (p.searchable !== n.searchable) return true
      if (p.active !== n.active && (p.searchable || n.searchable)) return true
      if ((p.searchable || n.searchable) && (p.active || n.active)) {
        if (p.label !== n.label) return true
        const pOpts = p.options ?? []
        const nOpts = n.options ?? []
        const pOptMap = new Map(pOpts.map(o => [o.code, o.label]))
        const nOptMap = new Map(nOpts.map(o => [o.code, o.label]))
        const allCodes = new Set([...pOptMap.keys(), ...nOptMap.keys()])
        for (const code of allCodes) {
          if (pOptMap.get(code) !== nOptMap.get(code)) return true
        }
      }
    }
  }
  return false
}

