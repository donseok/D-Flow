// SP6 Phase S1 — forms.* 네 키의 저장 형태(정본 §4.4.7·§4.4.6, 개정 §2.8.2).
// parse 는 형태만 본다. template_id 가 그 프로젝트의 활성 행인지, 매핑이 스캔 토큰을 덮는지는
// DB 가 필요하므로 validateConfig·활성화 RPC 의 몫이다(정본 §4.6.3·§4.7.3).
import { CUSTOM_FIELD_KEY_RE, getCatalogForKind, resolveCatalogPath, type CatalogFieldMeta } from '@/lib/report/catalog'
import { parseTokenBody, isValidPath } from '@/lib/report/engine/scanner'
import {
  DEFAULT_RENDER_OPTIONS, type FormKind, type RenderOptions,
} from '@/lib/report/engine/types'
import { defineSetting, type Parsed, type SettingDef } from '../def'
import type { ModuleId } from '@/lib/modules/defaults'

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error })

export const FORM_SETTING_KEYS = [
  'forms.weekly_report_pptx',
  'forms.weekly_report_xlsx',
  'forms.issue_analysis_pptx',
  'forms.wbs_export_xlsx',
] as const
export type FormSettingKey = (typeof FORM_SETTING_KEYS)[number]

/** 양식 키를 선언한 모듈 — 렌더·업로드 관문은 이 모듈이 활성일 때만(정본 §4.7) */
export const FORM_SETTING_MODULE: Record<FormKind, ModuleId> = {
  weekly_report_pptx: 'weekly',
  weekly_report_xlsx: 'weekly',
  issue_analysis_pptx: 'issue_analysis',
  wbs_export_xlsx: 'wbs',
}

const FORM_KINDS = new Set<string>(Object.keys(FORM_SETTING_MODULE))
export function isFormKind(v: unknown): v is FormKind {
  return typeof v === 'string' && FORM_KINDS.has(v)
}

const OPTION_KEYS = ['max_lines_per_cell', 'max_rows_per_slide', 'item_cap', 'empty_text', 'continuation_label'] as const
const VALUE_KEYS = ['template_id', 'mapping', 'options'] as const
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const MAPPING_MAX = 500
const TEXT_MAX = 200
const COUNT_MAX = 10_000

export interface FormSetting {
  template_id: string | null
  mapping: Record<string, string>
  options: RenderOptions
}

export function defaultFormSetting(kind: FormKind): FormSetting {
  return { template_id: null, mapping: {}, options: { ...DEFAULT_RENDER_OPTIONS[kind] } }
}

function sameKeys(raw: object, allowed: readonly string[]): boolean {
  const keys = Object.keys(raw)
  return keys.length === allowed.length && allowed.every((k) => keys.includes(k))
}

interface CatalogShape { relative: Set<string>; hasTextList: boolean; hasCustom: boolean }

function walkFields(fields: Record<string, CatalogFieldMeta>, acc: CatalogShape) {
  for (const field of Object.values(fields)) {
    if (field.path.startsWith('.')) acc.relative.add(field.path)
    if (field.type === 'list<text>') acc.hasTextList = true
    if (field.customEntity) acc.hasCustom = true
    if (field.recordFields) walkFields(field.recordFields, acc)
  }
}

function catalogShape(kind: FormKind): CatalogShape {
  const acc: CatalogShape = { relative: new Set(), hasTextList: false, hasCustom: false }
  walkFields(getCatalogForKind(kind), acc)
  return acc
}

/** 매핑 값이 그 form_kind 카탈로그의 경로인지. 상대 경로(.field·.custom.<key>·.)는 그 양식 트리 안에 해석 자리가 있을 때만 */
export function isFormCatalogPath(kind: FormKind, path: string): boolean {
  if (!isValidPath(path)) return false
  // 절대 경로와 pptx 내장(slide.*)은 카탈로그 해석기가 정본이다(정본 §4.4.4·§4.5).
  if (!path.startsWith('.')) return resolveCatalogPath(kind, path) !== null
  const shape = catalogShape(kind)
  if (path === '.') return shape.hasTextList
  if (path.startsWith('.custom.')) {
    const key = path.slice('.custom.'.length)
    return shape.hasCustom && CUSTOM_FIELD_KEY_RE.test(key)
  }
  return shape.relative.has(path)
}

/** 매핑 키를 토큰 원문(공백 정규화) 복합 키로. 닫는 토큰·문법 오류는 null */
export function normalizeMappingKey(raw: string): string | null {
  if (raw.length > 400) return null
  const parts = raw.split('/')
  if (parts.length < 1 || parts.length > 4) return null
  const tokens: string[] = []
  for (const part of parts) {
    const trimmed = part.trim()
    const m = /^\{\{([\s\S]*)\}\}$/.exec(trimmed)
    if (!m) return null
    const parsed = parseTokenBody(m[1])
    if (!parsed.ok || parsed.kind === 'close_rows' || parsed.kind === 'close_items') return null
    tokens.push(parsed.token)
  }
  return tokens.join('/')
}

function parseOptions(raw: unknown): Parsed<RenderOptions> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return fail('options 는 객체여야 합니다.')
  if (!sameKeys(raw, OPTION_KEYS)) return fail('options 키는 max_lines_per_cell·max_rows_per_slide·item_cap·empty_text·continuation_label 만입니다.')
  const o = raw as Record<string, unknown>
  const lines = o.max_lines_per_cell
  const rows = o.max_rows_per_slide
  const cap = o.item_cap
  // xlsx 는 렌더가 두 상한을 무시하지만(정본 §4.4.6) 저장 형태는 네 종류가 같다. 0(무제한)은 pptx 표를 한 장에 밀어 넣으므로 받지 않는다.
  if (!Number.isInteger(lines) || (lines as number) < 1 || (lines as number) > COUNT_MAX) return fail('max_lines_per_cell 은 1 이상의 정수여야 합니다.')
  if (!Number.isInteger(rows) || (rows as number) < 1 || (rows as number) > COUNT_MAX) return fail('max_rows_per_slide 는 1 이상의 정수여야 합니다.')
  if (!Number.isInteger(cap) || (cap as number) < 0 || (cap as number) > COUNT_MAX) return fail('item_cap 은 0 이상의 정수여야 합니다.')
  if (typeof o.empty_text !== 'string' || o.empty_text.length > TEXT_MAX || /[\u0000-\u001F]/.test(o.empty_text)) return fail('empty_text 는 200자 이내 문자열이어야 합니다.')
  if (typeof o.continuation_label !== 'string' || o.continuation_label.length > TEXT_MAX || /[\u0000-\u001F]/.test(o.continuation_label)) return fail('continuation_label 은 200자 이내 문자열이어야 합니다.')
  return {
    ok: true,
    value: {
      max_lines_per_cell: lines as number,
      max_rows_per_slide: rows as number,
      item_cap: cap as number,
      empty_text: o.empty_text,
      continuation_label: o.continuation_label,
    },
  }
}

function parseMapping(kind: FormKind, raw: unknown): Parsed<Record<string, string>> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return fail('mapping 은 객체여야 합니다.')
  const entries = Object.entries(raw as Record<string, unknown>)
  if (entries.length > MAPPING_MAX) return fail(`매핑은 ${MAPPING_MAX}개 이하여야 합니다.`)
  const out: Record<string, string> = {}
  for (const [key, value] of entries) {
    if (typeof value !== 'string') return fail('매핑 값은 카탈로그 경로 문자열이어야 합니다.')
    const norm = normalizeMappingKey(key)
    if (!norm) return fail(`매핑 키가 토큰 복합 키가 아닙니다: ${key}`)
    if (norm in out) return fail(`매핑 키가 정규화 뒤 중복입니다: ${norm}`)
    if (!isFormCatalogPath(kind, value)) return fail(`매핑 값이 이 양식의 카탈로그 경로가 아닙니다: ${value}`)
    out[norm] = value
  }
  return { ok: true, value: out }
}

export function parseFormSetting(kind: FormKind, raw: unknown): Parsed<FormSetting> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return fail('양식 설정은 객체여야 합니다.')
  if (!sameKeys(raw, VALUE_KEYS)) return fail('양식 설정 키는 template_id·mapping·options 만입니다.')
  const body = raw as Record<string, unknown>
  let template_id: string | null
  if (body.template_id === null) template_id = null
  else if (typeof body.template_id === 'string' && UUID_RE.test(body.template_id.toLowerCase())) template_id = body.template_id.toLowerCase()
  else return fail('template_id 는 null 또는 UUID 여야 합니다.')
  const mapping = parseMapping(kind, body.mapping)
  if (!mapping.ok) return mapping
  const options = parseOptions(body.options)
  if (!options.ok) return options
  return { ok: true, value: { template_id, mapping: mapping.value, options: options.value } }
}

export function formSettingDef<const K extends FormSettingKey>(key: K, kind: FormKind): SettingDef<FormSetting, FormSetting, K> {
  return defineSetting<K, FormSetting>({
    key, scope: 'project', module: FORM_SETTING_MODULE[kind], default: defaultFormSetting(kind),
    parse: (raw) => parseFormSetting(kind, raw),
    // 편집 화면(FormTemplatesManager)은 업로드·활성화 액션과 함께 둔다.
    widget: { kind: 'custom', component: 'FormTemplatesManager' },
    editor: 'project_admin', apply: 'immediate', impact: ['none'], sql: null,
  })
}
