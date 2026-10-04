/**
 * FormEngine.scan (정본 §4.3.1·§4.4.1·§4.4.2·§4.7.2).
 * pptx 는 slideN.xml 의 a:p 만, xlsx 는 워크시트 셀 값(문자열·리치텍스트)만.
 * 카탈로그·매핑 판정(UNKNOWN_TOKEN·TYPE_MISMATCH·RECOMMENDED_MISSING)은 활성화가 한다.
 * 여기의 TYPE_MISMATCH 는 {{#items}} 3단뿐이다(§4.4.5).
 */
import JSZip from 'jszip'
import { parseTokenBody } from './scanner'
import {
  type FormFormat,
  type Placeholder,
  type PlaceholderLocation,
  type ScanIssue,
  type ScanReport,
} from './types'

const ENGINE = 'forms-engine.v1' as const
const SHAPE_TAGS = new Set(['p:sp', 'p:grpSp', 'p:graphicFrame', 'p:pic', 'p:cxnSp'])
const SLIDE_FILE = /^ppt\/slides\/slide(\d+)\.xml$/
const SHEET_FILE = /^xl\/worksheets\/sheet(\d+)\.xml$/

type StackEntry = { token: string; kind: 'rows' | 'items' | 'slide'; row?: number }

function decodeXml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
}

function attr(raw: string, name: string): string | undefined {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(raw)
  return m?.[1]
}

interface Run { text: string }
interface Para { runs: Run[]; location: PlaceholderLocation; row?: number }

function scanParagraph(
  runs: readonly Run[],
  location: PlaceholderLocation,
  stack: StackEntry[],
  row: number | undefined,
  inTable: boolean,
): { placeholders: Placeholder[]; issues: ScanIssue[] } {
  const placeholders: Placeholder[] = []
  const issues: ScanIssue[] = []
  let full = ''
  const bounds: { start: number; end: number }[] = []
  for (const r of runs) {
    const start = full.length
    full += r.text
    bounds.push({ start, end: full.length })
  }
  let pos = 0
  while (pos < full.length) {
    const openIdx = full.indexOf('{{', pos)
    if (openIdx === -1) break
    const closeIdx = full.indexOf('}}', openIdx + 2)
    if (closeIdx === -1) {
      const raw = full.slice(openIdx)
      issues.push({ code: 'MALFORMED_TOKEN', severity: 'error', message: `Unclosed delimiter '${raw}'`, location, token: raw })
      break
    }
    const rawToken = full.slice(openIdx, closeIdx + 2)
    const parsed = parseTokenBody(full.slice(openIdx + 2, closeIdx))
    if (!parsed.ok) {
      issues.push({ code: 'MALFORMED_TOKEN', severity: 'error', message: parsed.error, location, token: rawToken })
      pos = closeIdx + 2
      continue
    }
    if (parsed.kind === 'close_items' || parsed.kind === 'close_rows') {
      const want = parsed.kind === 'close_items' ? 'items' : 'rows'
      const top = stack[stack.length - 1]
      if (!top || top.kind !== want) {
        issues.push({
          code: 'UNCLOSED_BLOCK', severity: 'error',
          message: `Unexpected closing tag '${parsed.token}' with no matching open block`,
          location, token: parsed.token,
        })
      } else if (want === 'rows' && top.row !== row) {
        issues.push({
          code: 'ROWS_SPAN_ROWS', severity: 'error',
          message: `'{{/rows}}' is on a different row from '${top.token}'`,
          location, token: parsed.token,
        })
        stack.pop()
      } else {
        stack.pop()
      }
    } else {
      implicitCloseRows(stack, row)
      if (parsed.kind === 'items' && stack.filter((s) => s.kind === 'items').length >= 2) {
        issues.push({
          code: 'TYPE_MISMATCH', severity: 'error',
          message: `'${parsed.token}' nests {{#items}} more than two levels`,
          location, token: parsed.token,
        })
      }
      if (parsed.kind === 'slide' && stack.some((s) => s.kind === 'slide')) {
        issues.push({
          code: 'MULTIPLE_SLIDE_BLOCKS', severity: 'error',
          message: `Multiple {{#slide}} blocks found on slide ${location.slide ?? ''}`.trim(),
          location, token: parsed.token,
        })
      }
      const placeholder: Placeholder = {
        token: parsed.token, kind: parsed.kind, path: parsed.path, scope: stack.map((s) => s.token),
        location, mergedRuns: false,
      }
      const startAt = openIdx
      const endAt = closeIdx + 2
      const startRun = bounds.findIndex((b) => startAt >= b.start && startAt < b.end)
      const endRun = bounds.findIndex((b) => endAt > b.start && endAt <= b.end)
      if (startRun !== -1 && endRun !== -1 && startRun !== endRun) {
        placeholder.mergedRuns = true
        issues.push({
          code: 'SPLIT_RUN', severity: 'warning',
          message: `Token '${parsed.token}' was split across runs (${startRun} to ${endRun}) and merged`,
          location, token: parsed.token,
        })
      }
      if (parsed.kind === 'rows' && !inTable) {
        issues.push({
          code: 'ROWS_OUTSIDE_TABLE', severity: 'error',
          message: `'${parsed.token}' is outside a table`,
          location, token: parsed.token,
        })
      }
      placeholders.push(placeholder)
      if (parsed.kind === 'rows' || parsed.kind === 'items' || parsed.kind === 'slide') {
        stack.push({ token: parsed.token, kind: parsed.kind, row })
      }
    }
    pos = closeIdx + 2
  }
  return { placeholders, issues }
}

function implicitCloseRows(stack: StackEntry[], row: number | undefined): void {
  while (stack.length > 0 && stack[stack.length - 1].kind === 'rows' && stack[stack.length - 1].row !== row) stack.pop()
}

function endTextBody(stack: StackEntry[], location: PlaceholderLocation, issues: ScanIssue[]): void {
  while (stack.length > 0 && stack[stack.length - 1].kind === 'items') {
    const top = stack.pop()!
    issues.push({
      code: 'UNCLOSED_BLOCK', severity: 'error',
      message: `'${top.token}' has no {{/items}} in this text body`,
      location, token: top.token,
    })
  }
}

function endContainer(stack: StackEntry[]): void {
  while (stack.length > 0 && (stack[stack.length - 1].kind === 'rows' || stack[stack.length - 1].kind === 'slide')) stack.pop()
}

function walkXml(xml: string, visit: {
  start: (name: string, attrs: string) => void
  end: (name: string) => void
  text: (value: string) => void
}): void {
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<\/([A-Za-z0-9:_-]+)\s*>|<([A-Za-z0-9:_-]+)([^>]*?)(\/)?>|([^<]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) {
    if (m[1]) visit.end(m[1])
    else if (m[2]) {
      visit.start(m[2], m[3] ?? '')
      if (m[4] === '/') visit.end(m[2])
    } else if (m[5]) visit.text(m[5])
  }
}

function scanPptxSlide(xml: string, slide: number, relXml: string | undefined, issues: ScanIssue[]): Placeholder[] {
  const placeholders: Placeholder[] = []
  const stack: StackEntry[] = []
  const shapeIds: (string | undefined)[] = []
  const tables: { row: number; col: number; rowVert: boolean }[] = []
  let inTx = false
  let inP = false
  let inT = false
  let paraIndex = -1
  let runs: Run[] = []
  let buf = ''
  let txParas: Para[] = []
  let txShape: string | undefined
  let txTable: { row: number; col: number } | undefined

  const flushText = () => {
    if (!inT) return
    if (!runs.length) runs.push({ text: '' })
    runs[runs.length - 1].text += decodeXml(buf)
    buf = ''
  }

  const locationFor = (paragraph: number): PlaceholderLocation => {
    const loc: PlaceholderLocation = { slide, paragraph }
    if (txShape !== undefined) loc.shapeId = txShape
    if (txTable) loc.table = { ...txTable }
    return loc
  }

  const finishParagraph = () => {
    if (!inP) return
    flushText()
    inT = false
    const row = txTable?.row
    txParas.push({ runs, location: locationFor(paraIndex), row })
    runs = []
    inP = false
  }

  const finishTx = () => {
    finishParagraph()
    for (const para of txParas) {
      const found = scanParagraph(para.runs, para.location, stack, para.row, !!txTable)
      placeholders.push(...found.placeholders)
      issues.push(...found.issues)
    }
    const loc = locationFor(Math.max(paraIndex, 0))
    endTextBody(stack, loc, issues)
    txParas = []
    inTx = false
  }

  walkXml(xml, {
    start(name, attrs) {
      if (SHAPE_TAGS.has(name)) shapeIds.push(undefined)
      if (name === 'p:cNvPr' && shapeIds.length && shapeIds[shapeIds.length - 1] === undefined) {
        shapeIds[shapeIds.length - 1] = attr(attrs, 'id')
      }
      if (name === 'a:tbl') tables.push({ row: -1, col: -1, rowVert: false })
      if (name === 'a:tr' && tables.length) {
        const t = tables[tables.length - 1]
        t.row += 1
        t.col = -1
        t.rowVert = false
      }
      if (name === 'a:tc' && tables.length) {
        const t = tables[tables.length - 1]
        t.col += 1
        const span = Number(attr(attrs, 'rowSpan') ?? '1')
        if ((Number.isFinite(span) && span > 1) || attr(attrs, 'vMerge') !== undefined) t.rowVert = true
      }
      if (name === 'a:vMerge' && tables.length) tables[tables.length - 1].rowVert = true
      if (name === 'a:txBody' || name === 'p:txBody') {
        finishTx()
        inTx = true
        paraIndex = -1
        txParas = []
        txShape = shapeIds[shapeIds.length - 1]
        const t = tables[tables.length - 1]
        txTable = t && t.row >= 0 && t.col >= 0 ? { row: t.row, col: t.col } : undefined
      }
      if (name === 'a:p' && inTx) {
        finishParagraph()
        inP = true
        paraIndex += 1
        runs = []
      }
      if ((name === 'a:r' || name === 'a:fld') && inP) {
        flushText()
        runs.push({ text: '' })
      }
      if (name === 'a:br' && inP) {
        flushText()
        if (!runs.length) runs.push({ text: '' })
        runs[runs.length - 1].text += '\n'
      }
      if (name === 'a:t' && inP) { flushText(); inT = true; buf = '' }
    },
    end(name) {
      if (name === 'a:t') { flushText(); inT = false }
      if (name === 'a:p') finishParagraph()
      if (name === 'a:txBody' || name === 'p:txBody') finishTx()
      if (name === 'a:tr' && tables.length) {
        const t = tables[tables.length - 1]
        if (t.rowVert) {
          const shape = shapeIds[shapeIds.length - 1]
          for (const p of placeholders) {
            if (p.kind !== 'rows' || p.location.slide !== slide || p.location.table?.row !== t.row) continue
            if (p.location.shapeId !== shape) continue
            if (issues.some((i) => i.code === 'VERTICAL_MERGE_IN_ROWS' && i.location === p.location && i.token === p.token)) continue
            issues.push({
              code: 'VERTICAL_MERGE_IN_ROWS', severity: 'error',
              message: `'${p.token}' repeats a row that is vertically merged`,
              location: p.location, token: p.token,
            })
          }
        }
      }
      if (name === 'a:tbl') tables.pop()
      if (SHAPE_TAGS.has(name)) shapeIds.pop()
    },
    text(value) { if (inT) buf += value },
  })
  finishTx()
  endContainer(stack)
  if (placeholders.some((p) => p.kind === 'slide') && relXml && /relationships\/(?:chart|oleObject)"/.test(relXml)) {
    issues.push({
      code: 'SHARED_PART_ON_CLONE', severity: 'warning',
      message: `Slide ${slide} {{#slide}} references an OLE or chart part`,
      location: { slide },
    })
  }
  const slideTokens = placeholders.filter((p) => p.kind === 'slide')
  for (const extra of slideTokens.slice(1)) {
    if (!issues.some((i) => i.code === 'MULTIPLE_SLIDE_BLOCKS' && i.token === extra.token && i.location === extra.location)) {
      issues.push({
        code: 'MULTIPLE_SLIDE_BLOCKS', severity: 'error',
        message: `Multiple {{#slide}} blocks found on slide ${slide}`,
        location: extra.location, token: extra.token,
      })
    }
  }
  return placeholders
}

function roundtripIssues(names: string[], sheets: { name: string; xml: string }[]): ScanIssue[] {
  const issues: ScanIssue[] = []
  const prefixes = ['xl/charts/', 'xl/pivotTables/', 'xl/pivotCache/', 'xl/drawings/', 'xl/externalLinks/']
  for (const prefix of prefixes) {
    if (names.some((n) => n.startsWith(prefix))) {
      issues.push({ code: 'ROUNDTRIP_LOSS', severity: 'warning', message: `${prefix} 파트가 있어 저장 때 빠질 수 있습니다.` })
    }
  }
  for (const sheet of sheets) {
    if (sheet.xml.includes('<conditionalFormatting') || sheet.xml.includes('<dataValidations') || sheet.xml.includes('<extLst')) {
      issues.push({
        code: 'ROUNDTRIP_LOSS', severity: 'warning',
        message: `${sheet.name} 에 조건부 서식·데이터 유효성·확장 목록이 있어 저장 때 빠질 수 있습니다.`,
      })
    }
  }
  return issues
}

function sheetNames(workbookXml: string, relsXml: string): Map<string, string> {
  const rels = new Map<string, string>()
  for (const m of relsXml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = attr(m[1], 'Id')
    const target = attr(m[1], 'Target')
    if (id && target) rels.set(id, target.replace(/^\//, '').replace(/^xl\//, ''))
  }
  const out = new Map<string, string>()
  for (const m of workbookXml.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const name = attr(m[1], 'name')
    const id = attr(m[1], 'r:id') ?? attr(m[1], 'id')
    const target = id ? rels.get(id) : undefined
    if (name && target) out.set(target.startsWith('worksheets/') ? target : `worksheets/${target.split('/').pop()}`, name)
  }
  return out
}

function sharedRuns(xml: string): Run[][] {
  const out: Run[][] = []
  for (const si of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    const body = si[1]
    const runs: Run[] = []
    if (/<r\b/.test(body)) {
      for (const r of body.matchAll(/<r\b[^>]*>([\s\S]*?)<\/r>/g)) {
        const texts = [...r[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => decodeXml(t[1]))
        runs.push({ text: texts.join('') })
      }
    } else {
      const texts = [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => decodeXml(t[1]))
      runs.push({ text: texts.join('') })
    }
    out.push(runs.length ? runs : [{ text: '' }])
  }
  return out
}

function colRow(cell: string): { row: number } | null {
  const m = /^[A-Z]+(\d+)$/.exec(cell)
  if (!m) return null
  return { row: Number(m[1]) }
}

function verticalMergeRows(xml: string): Set<number> {
  const rows = new Set<number>()
  for (const m of xml.matchAll(/<mergeCell\b[^>]*ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"[^>]*\/?>/g)) {
    const r1 = Number(m[2])
    const r2 = Number(m[4])
    if (r2 > r1) for (let r = r1; r <= r2; r += 1) rows.add(r)
  }
  return rows
}

function scanSheet(
  xml: string,
  sheet: string,
  strings: Run[][],
  stack: StackEntry[],
): { placeholders: Placeholder[]; issues: ScanIssue[] } {
  const placeholders: Placeholder[] = []
  const issues: ScanIssue[] = []
  const merged = verticalMergeRows(xml)
  const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g
  let m: RegExpExecArray | null
  while ((m = cellRe.exec(xml))) {
    const attrs = m[1]
    const inner = m[2] ?? ''
    const ref = attr(attrs, 'r')
    if (!ref) continue
    const kind = attr(attrs, 't')
    let runs: Run[] | null = null
    if (kind === 's') {
      const v = /<v>(\d+)<\/v>/.exec(inner)
      if (v) runs = strings[Number(v[1])] ?? [{ text: '' }]
    } else if (kind === 'inlineStr') {
      const is = /<is\b[^>]*>([\s\S]*?)<\/is>/.exec(inner)
      runs = is ? sharedRuns(`<si>${is[1]}</si>`)[0] : [{ text: '' }]
    } else if (kind === 'str') {
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner)
      if (v) runs = [{ text: decodeXml(v[1]) }]
    }
    if (!runs) continue
    const row = colRow(ref)?.row
    const location: PlaceholderLocation = { sheet, cell: ref }
    const found = scanParagraph(runs, location, stack, row, true)
    placeholders.push(...found.placeholders)
    issues.push(...found.issues)
    endTextBody(stack, location, issues)
    for (const p of found.placeholders) {
      if (p.kind === 'rows' && row !== undefined && merged.has(row)) {
        issues.push({
          code: 'VERTICAL_MERGE_IN_ROWS', severity: 'error',
          message: `'${p.token}' repeats a row that is vertically merged`,
          location, token: p.token,
        })
      }
      if (p.kind === 'slide') {
        issues.push({
          code: 'SLIDE_IN_XLSX', severity: 'error',
          message: `{{#slide}} token is not supported in XLSX forms: '${p.token}'`,
          location, token: p.token,
        })
      }
    }
  }
  endContainer(stack)
  return { placeholders, issues }
}

async function readZip(template: Uint8Array): Promise<JSZip> {
  return JSZip.loadAsync(template)
}

export async function scanFormTemplate(template: Uint8Array, format: FormFormat): Promise<ScanReport> {
  const zip = await readZip(template)
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir)
  const placeholders: Placeholder[] = []
  const issues: ScanIssue[] = []
  if (format === 'pptx') {
    const slides = names.filter((n) => SLIDE_FILE.test(n)).sort((a, b) => Number(SLIDE_FILE.exec(a)![1]) - Number(SLIDE_FILE.exec(b)![1]))
    for (const name of slides) {
      const n = Number(SLIDE_FILE.exec(name)![1])
      const xml = await zip.file(name)!.async('string')
      const rel = zip.file(`ppt/slides/_rels/slide${n}.xml.rels`)
      const relXml = rel ? await rel.async('string') : undefined
      placeholders.push(...scanPptxSlide(xml, n, relXml, issues))
    }
  } else {
    const book = zip.file('xl/workbook.xml')
    const rels = zip.file('xl/_rels/workbook.xml.rels')
    const namesByFile = book && rels ? sheetNames(await book.async('string'), await rels.async('string')) : new Map<string, string>()
    const shared = zip.file('xl/sharedStrings.xml')
    const strings = shared ? sharedRuns(await shared.async('string')) : []
    const sheets = names.filter((n) => SHEET_FILE.test(n)).sort()
    const sheetXmls: { name: string; xml: string }[] = []
    const stack: StackEntry[] = []
    for (const name of sheets) {
      const xml = await zip.file(name)!.async('string')
      sheetXmls.push({ name, xml })
      const key = name.replace(/^xl\//, '')
      const sheet = namesByFile.get(key) ?? name.split('/').pop()!.replace(/\.xml$/, '')
      const found = scanSheet(xml, sheet, strings, stack)
      placeholders.push(...found.placeholders)
      issues.push(...found.issues)
    }
    issues.push(...roundtripIssues(names, sheetXmls))
  }
  if (format === 'pptx') issues.push(...roundtripIssues(names, []))
  return { engineVersion: ENGINE, format, placeholders, issues }
}

export function engineFor(format: FormFormat): { readonly format: FormFormat; scan: (template: Uint8Array) => Promise<ScanReport> } {
  return { format, scan: (template) => scanFormTemplate(template, format) }
}
