/**
 * XlsxFormEngine.render (정본 §4.3.2·§4.4.2·§4.4.3·§4.4.5).
 * 셀 값만 바꾼다. 개행은 셀 안에 둔다. {{#rows}} 는 duplicateRow.
 * {{#slide}} 는 스캔 오류라 렌더 전에 멈춘다. 수식 이동은 라이브러리 동작 그대로다(미검증).
 */
import ExcelJS from 'exceljs'
import { formatCatalogValue, resolveCatalogPath } from '../catalog'
import type { CatalogModel } from '../catalog/types'
import { scanFormTemplate } from './scan'
import { parseTokenBody } from './scanner'
import {
  FormRenderError,
  type FormKind,
  type RenderMapping,
  type RenderOptions,
} from './types'

interface Ctx { scope: string[]; items: unknown[] }

function kindOf(model: CatalogModel): FormKind {
  if ('wbs_items' in model) return 'wbs_export_xlsx'
  if ('report' in model) return 'weekly_report_xlsx'
  throw new FormRenderError('MISSING_PATH', undefined, undefined, 'XLSX render got a model that is not an xlsx catalog')
}

function fail(code: 'MISSING_PATH' | 'TYPE_MISMATCH', token: string | undefined, message: string): never {
  throw new FormRenderError(code, undefined, token, message)
}

function readAbs(model: unknown, path: string): unknown {
  let cur: unknown = model
  for (const part of path.split('.')) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur
}

function rawOf(model: CatalogModel, path: string, ctx: Ctx): unknown {
  if (path.startsWith('.')) {
    const item = ctx.items[ctx.items.length - 1]
    return path === '.' ? item : readAbs(item, path.slice(1))
  }
  return readAbs(model, path)
}

class Renderer {
  constructor(
    private readonly model: CatalogModel,
    private readonly kind: FormKind,
    private readonly mapping: RenderMapping,
    private readonly options: RenderOptions,
  ) {}

  private mapped(token: string, path: string, ctx: Ctx): string {
    return this.mapping[[...ctx.scope, token].join('/')] ?? this.mapping[token] ?? path
  }

  private resolve(token: string, path: string, ctx: Ctx) {
    const effective = this.mapped(token, path, ctx)
    const resolved = resolveCatalogPath(this.kind, effective, ctx.scope, undefined, this.mapping)
    if (!resolved) fail('MISSING_PATH', token, `No catalog path for '${token}'`)
    return { effective, resolved }
  }

  list(token: string, path: string, ctx: Ctx): unknown[] {
    const { effective, resolved } = this.resolve(token, path, ctx)
    const type = resolved.field.type
    if (type !== 'list<text>' && type !== 'list<record>') fail('TYPE_MISMATCH', token, `'${token}' is not a list`)
    const raw = rawOf(this.model, effective, ctx)
    if (raw === null || raw === undefined) return []
    if (!Array.isArray(raw)) fail('TYPE_MISMATCH', token, `'${token}' value is not a list`)
    return raw
  }

  fillText(text: string, ctx: Ctx): ExcelJS.CellValue {
    let current = this.expandItems(text, ctx)
    const only = /^\s*\{\{([\s\S]*?)\}\}\s*$/.exec(current)
    if (only) {
      const parsed = parseTokenBody(only[1])
      if (parsed.ok && parsed.kind === 'value') {
        const { effective, resolved } = this.resolve(parsed.token, parsed.path, ctx)
        return formatCatalogValue(rawOf(this.model, effective, ctx), resolved.field.type, 'xlsx', this.options) as ExcelJS.CellValue
      }
    }
    let guard = 0
    while (guard++ < 100) {
      const start = current.indexOf('{{')
      if (start === -1) break
      const close = current.indexOf('}}', start + 2)
      if (close === -1) throw new FormRenderError('MALFORMED_TOKEN', undefined, current.slice(start), 'Unclosed delimiter')
      const parsed = parseTokenBody(current.slice(start + 2, close))
      if (!parsed.ok) throw new FormRenderError('MALFORMED_TOKEN', undefined, current.slice(start, close + 2), parsed.error)
      let value = ''
      if (parsed.kind === 'value') {
        const { effective, resolved } = this.resolve(parsed.token, parsed.path, ctx)
        const formatted = formatCatalogValue(rawOf(this.model, effective, ctx), resolved.field.type, 'xlsx', this.options)
        value = formatted instanceof Date ? formatted.toISOString().slice(0, 10) : String(formatted)
      }
      current = current.slice(0, start) + value + current.slice(close + 2)
    }
    return current
  }

  private expandItems(text: string, ctx: Ctx): string {
    const found = matchItems(text)
    if (!found) return text
    const parsed = parseTokenBody(found.body)
    if (!parsed.ok || parsed.kind !== 'items') fail('MISSING_PATH', found.raw, 'items')
    const list = this.cap(this.list(parsed.token, parsed.path, ctx))
    if (list.length === 0) {
      const replaced = text.slice(0, found.start) + this.options.empty_text + text.slice(found.end)
      return this.expandItems(replaced, ctx)
    }
    const lines = list.map((item) => {
      const child: Ctx = { scope: [...ctx.scope, parsed.token], items: [...ctx.items, item] }
      return String(this.fillText(found.inner, child))
    })
    const replaced = text.slice(0, found.start) + lines.join('\n') + text.slice(found.end)
    return this.expandItems(replaced, ctx)
  }

  private cap(list: unknown[]): unknown[] {
    const cap = this.options.item_cap
    if (cap <= 0 || list.length <= cap) return list
    const note = `외 ${list.length - cap}건`
    if (list.every((v) => typeof v === 'string')) return [...list.slice(0, cap), note]
    return [...list.slice(0, cap), note]
  }
}

function matchItems(text: string): { start: number; end: number; body: string; raw: string; inner: string } | null {
  const re = /\{\{([\s\S]*?)\}\}/g
  let depth = 0
  let open: { start: number; end: number; body: string; raw: string } | null = null
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const parsed = parseTokenBody(m[1])
    if (!parsed.ok) continue
    if (parsed.kind === 'items' && depth === 0) {
      open = { start: m.index, end: m.index + m[0].length, body: m[1], raw: parsed.token }
      depth = 1
    } else if (parsed.kind === 'items') depth += 1
    else if (parsed.kind === 'close_items' && depth > 0) {
      depth -= 1
      if (depth === 0 && open) {
        return { start: open.start, end: m.index + m[0].length, body: open.body, raw: open.raw, inner: text.slice(open.end, m.index) }
      }
    }
  }
  if (open) throw new FormRenderError('UNCLOSED_BLOCK', undefined, open.raw, `'${open.raw}' has no {{/items}}`)
  return null
}

function cellText(value: ExcelJS.CellValue): string | null {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'richText' in value && Array.isArray((value as ExcelJS.CellRichTextValue).richText)) {
    return (value as ExcelJS.CellRichTextValue).richText.map((part) => part.text).join('')
  }
  return null
}

function rowToken(row: ExcelJS.Row): { token: string; path: string } | null {
  let found: { token: string; path: string } | null = null
  row.eachCell((cell) => {
    const text = cellText(cell.value)
    const m = text ? /\{\{#rows[ \t]+([\s\S]*?)\}\}/.exec(text) : null
    if (!m || found) return
    const parsed = parseTokenBody(`#rows ${m[1]}`)
    if (parsed.ok && parsed.kind === 'rows') found = { token: parsed.token, path: parsed.path }
  })
  return found
}

function fillRow(row: ExcelJS.Row, renderer: Renderer, ctx: Ctx): void {
  row.eachCell((cell) => {
    const text = cellText(cell.value)
    if (text === null || !text.includes('{{')) return
    const stripped = text.replace(/\{\{#rows[ \t]+[\s\S]*?\}\}/g, '').replace(/\{\{\/rows\}\}/g, '')
    cell.value = renderer.fillText(stripped, ctx)
  })
}

export async function renderXlsx(
  template: Uint8Array,
  model: CatalogModel,
  mapping: RenderMapping,
  options: RenderOptions,
): Promise<Uint8Array> {
  const scanned = await scanFormTemplate(template, 'xlsx')
  const error = scanned.issues.find((i) => i.severity === 'error')
  if (error) throw new FormRenderError(error.code, error.location, error.token, error.message)
  const kind = kindOf(model)
  for (const placeholder of scanned.placeholders) {
    const path = mapping[[...placeholder.scope, placeholder.token].join('/')] ?? mapping[placeholder.token] ?? placeholder.path
    if (!resolveCatalogPath(kind, path, placeholder.scope, undefined, mapping)) {
      throw new FormRenderError('MISSING_PATH', placeholder.location, placeholder.token, `No catalog path for '${placeholder.token}'`)
    }
  }
  const renderer = new Renderer(model, kind, mapping, options)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(Buffer.from(template) as never)
  const base: Ctx = { scope: [], items: [] }
  for (const sheet of workbook.worksheets) {
    const hits: number[] = []
    sheet.eachRow((row, n) => { if (rowToken(row)) hits.push(n) })
    for (const n of hits.sort((a, b) => b - a)) {
      const row = sheet.getRow(n)
      const token = rowToken(row)
      if (!token) continue
      const list = renderer.list(token.token, token.path, base)
      if (list.length === 0) {
        sheet.spliceRows(n, 1)
        continue
      }
      if (list.length > 1) sheet.duplicateRow(n, list.length - 1, true)
      list.forEach((item, index) => {
        fillRow(sheet.getRow(n + index), renderer, { scope: [token.token], items: [item] })
      })
    }
    sheet.eachRow((row) => fillRow(row, renderer, base))
  }
  const out = await workbook.xlsx.writeBuffer()
  return new Uint8Array(out as ArrayBuffer)
}

export const xlsxEngine = {
  format: 'xlsx' as const,
  scan: (template: Uint8Array) => scanFormTemplate(template, 'xlsx'),
  render: renderXlsx,
}
