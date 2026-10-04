/**
 * PptxFormEngine.render (정본 §4.3.2 2–8, §4.4.2–§4.4.5, §4.4.7).
 * 넘침으로 슬라이드를 나누는 §4.4.6 은 여기 없다. XlsxFormEngine 도 여기 없다.
 * render 인자에는 저장된 스캔이 없어 TEMPLATE_DRIFT 대조는 하지 않는다.
 * 바이트를 다시 scan 해 severity error 가 있으면 부분 출력 없이 멈춘다.
 */
import JSZip from 'jszip'
import { formatCatalogValue, resolveCatalogPath } from '../catalog'
import type { CatalogModel } from '../catalog/types'
import { escapeXml } from '../xml'
import { capItems } from './paginate'
import { scanFormTemplate } from './scan'
import { parseTokenBody } from './scanner'
import {
  FormRenderError,
  type FormKind,
  type PlaceholderLocation,
  type RenderMapping,
  type RenderOptions,
} from './types'

const SLIDE_CT = 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml'
const SLIDE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide'
const TX_RE = /<(p|a):txBody\b[^>]*>[\s\S]*?<\/\1:txBody>/g
const P_RE = /<a:p\b[^>]*>[\s\S]*?<\/a:p>/g

interface Run { rPr: string; text: string }
interface Ctx {
  scope: string[]
  items: unknown[]
  page: number
  pageCount: number
  continuation: string
}

function decodeXml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

function kindOf(model: CatalogModel): FormKind {
  if ('summary' in model && 'areas' in model) return 'issue_analysis_pptx'
  if ('report' in model) return 'weekly_report_pptx'
  throw new FormRenderError('MISSING_PATH', undefined, undefined, 'PPTX render got a model that is not a pptx catalog')
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

function readRel(item: unknown, path: string): unknown {
  if (path === '.') return item
  return readAbs(item, path.slice(1))
}

function rawOf(model: CatalogModel, path: string, ctx: Ctx): unknown {
  if (path === 'slide.page') return ctx.page
  if (path === 'slide.page_count') return ctx.pageCount
  if (path === 'slide.continuation') return ctx.continuation
  if (path.startsWith('.')) return readRel(ctx.items[ctx.items.length - 1], path)
  return readAbs(model, path)
}

function mappedPath(token: string, path: string, ctx: Ctx, mapping: RenderMapping): string {
  const composite = [...ctx.scope, token].join('/')
  return mapping[composite] ?? mapping[token] ?? path
}

class Renderer {
  constructor(
    private readonly model: CatalogModel,
    private readonly kind: FormKind,
    private readonly mapping: RenderMapping,
    private readonly options: RenderOptions,
  ) {}

  private resolve(token: string, path: string, ctx: Ctx) {
    const effective = mappedPath(token, path, ctx, this.mapping)
    const resolved = resolveCatalogPath(this.kind, effective, ctx.scope, undefined, this.mapping)
    if (!resolved) fail('MISSING_PATH', token, `No catalog path for '${token}'`)
    return { effective, resolved }
  }

  blockList(token: string, path: string, ctx: Ctx): unknown[] {
    const { effective, resolved } = this.resolve(token, path, ctx)
    const type = resolved.field.type
    if (type !== 'list<text>' && type !== 'list<record>') {
      fail('TYPE_MISMATCH', token, `'${token}' is not a list`)
    }
    const raw = rawOf(this.model, effective, ctx)
    if (raw === null || raw === undefined) return []
    if (!Array.isArray(raw)) fail('TYPE_MISMATCH', token, `'${token}' value is not a list`)
    return raw
  }

  private text(token: string, path: string, ctx: Ctx): string {
    const { effective, resolved } = this.resolve(token, path, ctx)
    const formatted = formatCatalogValue(rawOf(this.model, effective, ctx), resolved.field.type, 'pptx', this.options)
    return typeof formatted === 'string' ? formatted : String(formatted)
  }

  private cap(list: unknown[]): { items: unknown[]; extra: string | null } {
    const cap = this.options.item_cap
    if (cap <= 0 || list.length <= cap) return { items: list, extra: null }
    const note = `외 ${list.length - cap}건`
    if (list.every((v) => typeof v === 'string')) return { items: capItems(list as string[], cap), extra: null }
    return { items: list.slice(0, cap), extra: note }
  }

  renderFragment(xml: string, ctx: Ctx): string {
    if (/<a:tr\b/.test(xml) && /\{\{#rows[ \t]/.test(xml)) return this.expandRows(xml, ctx)
    const expanded = /\{\{#items[ \t]/.test(xml) ? this.expandItems(xml, ctx) : xml
    return this.fillValues(expanded, ctx)
  }

  private expandRows(xml: string, ctx: Ctx): string {
    const out = xml.replace(/<a:tr\b[^>]*>[\s\S]*?<\/a:tr>/g, (row) => {
      const open = /\{\{#rows[ \t]+([\s\S]*?)\}\}/.exec(row)
      if (!open) return this.renderFragment(row, ctx)
      const parsed = parseTokenBody(`#rows ${open[1]}`)
      if (!parsed.ok || parsed.kind !== 'rows') fail('MISSING_PATH', open[0], parsed.ok ? 'rows' : parsed.error)
      const list = this.blockList(parsed.token, parsed.path, ctx)
      if (list.length === 0) return ''
      return list.map((item) => {
        const stripped = row.replace(/\{\{#rows[ \t]+[\s\S]*?\}\}/, '').replace(/\{\{\/rows\}\}/, '')
        const child: Ctx = { ...ctx, scope: [...ctx.scope, parsed.token], items: [...ctx.items, item] }
        return this.renderFragment(stripped, child)
      }).join('')
    })
    return this.fillValues(/\{\{#items[ \t]/.test(out) ? this.expandItems(out, ctx) : out, ctx)
  }

  private expandItems(xml: string, ctx: Ctx): string {
    return xml.replace(TX_RE, (body) => this.expandRegion(body, ctx)).replace(/^[\s\S]*$/, (all) => (
      /<(?:p|a):txBody\b/.test(all) ? all : this.expandRegion(all, ctx)
    ))
  }

  private expandRegion(region: string, ctx: Ctx): string {
    if (!/\{\{#items[ \t]/.test(region)) return region
    return this.expandRegion(this.expandFirstItems(region, ctx), ctx)
  }

  private expandFirstItems(region: string, ctx: Ctx): string {
    const found = matchItems(region)
    if (!found) return region
    const parsed = parseTokenBody(`#items ${found.path}`)
    if (!parsed.ok || parsed.kind !== 'items') fail('MISSING_PATH', found.rawOpen, parsed.ok ? 'items' : parsed.error)
    const list = this.blockList(parsed.token, parsed.path, ctx)
    const { items, extra } = this.cap(list)
    const paras = paragraphSpans(region)
    const first = paras.findIndex((p) => p.start <= found.start && found.start < p.end)
    const last = paras.findIndex((p) => p.start < found.end && found.end <= p.end)
    if (first < 0 || last < 0) {
      throw new FormRenderError('MALFORMED_TOKEN', undefined, parsed.token, '{{#items}} is not inside a paragraph')
    }
    const sample = paras[first].xml
    let replacement: string
    if (items.length === 0) {
      replacement = emptyParagraph(sample, this.options.empty_text)
    } else {
      const unit = stripBlock(paras, first, last, found)
      replacement = items.map((item) => {
        const child: Ctx = { ...ctx, scope: [...ctx.scope, parsed.token], items: [...ctx.items, item] }
        return this.renderFragment(unit, child)
      }).join('')
      if (extra) replacement += textParagraph(sample, extra)
    }
    return region.slice(0, paras[first].start) + replacement + region.slice(paras[last].end)
  }

  private fillValues(xml: string, ctx: Ctx): string {
    const filled = xml.replace(/<a:p\b[^>]*>[\s\S]*?<\/a:p>/g, (p) => this.rewriteParagraph(p, ctx))
    return filled.replace(TX_RE, (body) => ensureParagraph(body))
  }

  private rewriteParagraph(p: string, ctx: Ctx): string {
    const parsed = parseParagraph(p)
    let groups: Run[][] = [parsed.runs.length ? parsed.runs : [{ rPr: '', text: '' }]]
    let guard = 0
    while (guard++ < 100) {
      const text = groups[0].map((r) => r.text).join('')
      const tok = findToken(text)
      if (!tok) break
      const body = parseTokenBody(text.slice(tok.start + 2, tok.end - 2))
      if (!body.ok) {
        throw new FormRenderError('MALFORMED_TOKEN', undefined, text.slice(tok.start, tok.end), body.error)
      }
      const rPr = runCovering(groups[0], tok.start).rPr
      if (body.kind === 'value') {
        const value = this.text(body.token, body.path, ctx)
        const lines = value.split('\n')
        const first = spliceRuns(groups[0], tok.start, tok.end, lines[0], rPr)
        const more = lines.slice(1).map((line) => [{ rPr, text: line }])
        groups = [first, ...more, ...groups.slice(1)]
      } else {
        const onlyBlock = blockOnly(text)
        groups[0] = spliceRuns(groups[0], tok.start, tok.end, '', rPr)
        if (onlyBlock && groups[0].every((r) => r.text.trim() === '') && groups.length === 1) return ''
      }
    }
    return groups.map((runs) => emitParagraph(parsed.pPr, parsed.end, runs)).join('')
  }
}

function blockOnly(text: string): boolean {
  let rest = ''
  let pos = 0
  while (pos < text.length) {
    const open = text.indexOf('{{', pos)
    if (open === -1) { rest += text.slice(pos); break }
    rest += text.slice(pos, open)
    const close = text.indexOf('}}', open + 2)
    if (close === -1) return false
    const parsed = parseTokenBody(text.slice(open + 2, close))
    if (!parsed.ok || parsed.kind === 'value') return false
    pos = close + 2
  }
  return rest.trim() === ''
}

function runCovering(runs: Run[], index: number): Run {
  let pos = 0
  for (const run of runs) {
    if (index < pos + run.text.length) return run
    pos += run.text.length
  }
  return runs[0] ?? { rPr: '', text: '' }
}

function spliceRuns(runs: Run[], start: number, end: number, value: string, _rPr: string): Run[] {
  let pos = 0
  let first = -1
  let last = -1
  const spans: { a: number; b: number }[] = []
  for (const run of runs) {
    const a = pos
    const b = pos + run.text.length
    spans.push({ a, b })
    if (b > start && a < end) {
      if (first < 0) first = spans.length - 1
      last = spans.length - 1
    }
    pos = b
  }
  if (first < 0) return [...runs, { rPr: _rPr, text: value }]
  if (first === last) {
    const run = runs[first]
    const a = spans[first].a
    const out = runs.slice()
    out[first] = { rPr: run.rPr, text: run.text.slice(0, start - a) + value + run.text.slice(end - a) }
    return out
  }
  const left = runs[first].text.slice(0, Math.max(0, start - spans[first].a))
  const right = runs[last].text.slice(Math.max(0, end - spans[last].a))
  return [...runs.slice(0, first), { rPr: runs[first].rPr, text: left + value + right }, ...runs.slice(last + 1)]
}

function findToken(text: string): { start: number; end: number } | null {
  const start = text.indexOf('{{')
  if (start === -1) return null
  const close = text.indexOf('}}', start + 2)
  if (close === -1) return { start, end: text.length }
  return { start, end: close + 2 }
}

function parseParagraph(p: string): { pPr: string; end: string; runs: Run[] } {
  const open = p.match(/^<a:p\b[^>]*>/)?.[0] ?? '<a:p>'
  const rest = p.slice(open.length, p.endsWith('</a:p>') ? p.length - 6 : p.length)
  const pPr = rest.match(/^\s*(<a:pPr\b[^>]*\/>|<a:pPr\b[\s\S]*?<\/a:pPr>)/)?.[1] ?? ''
  const end = rest.match(/(<a:endParaRPr\b[^>]*\/>|<a:endParaRPr\b[\s\S]*?<\/a:endParaRPr>)\s*$/)?.[1] ?? ''
  const runs: Run[] = []
  for (const m of rest.matchAll(/<a:r\b[^>]*>([\s\S]*?)<\/a:r>/g)) {
    const rPr = m[1].match(/^(<a:rPr\b[^>]*\/>|<a:rPr\b[\s\S]*?<\/a:rPr>)/)?.[1] ?? ''
    const inner = m[1].slice(rPr.length)
    let text = ''
    for (const t of inner.matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>|<a:br\b[^>]*\/>/g)) {
      text += t[1] !== undefined ? decodeXml(t[1]) : '\n'
    }
    runs.push({ rPr, text })
  }
  return { pPr, end, runs }
}

function emitRun(run: Run): string {
  const parts = run.text.split('\n')
  return `<a:r>${run.rPr}${parts.map((part) => `<a:t>${escapeXml(part)}</a:t>`).join('<a:br/>')}</a:r>`
}

function emitParagraph(pPr: string, end: string, runs: Run[]): string {
  const usable = runs.filter((r) => r.text.length > 0)
  const body = (usable.length ? usable : [{ rPr: runs[0]?.rPr ?? '', text: '' }]).map(emitRun).join('')
  return `<a:p>${pPr}${body}${end}</a:p>`
}

function emptyParagraph(sample: string, text: string): string {
  const parsed = parseParagraph(sample)
  return emitParagraph(parsed.pPr, parsed.end, [{ rPr: parsed.runs[0]?.rPr ?? '', text }])
}

function textParagraph(sample: string, text: string): string {
  return emptyParagraph(sample, text)
}

function paragraphSpans(region: string): { start: number; end: number; xml: string }[] {
  const out: { start: number; end: number; xml: string }[] = []
  for (const m of region.matchAll(P_RE)) {
    if (m.index === undefined) continue
    out.push({ start: m.index, end: m.index + m[0].length, xml: m[0] })
  }
  return out
}

interface ItemSpan { start: number; end: number; path: string; rawOpen: string; innerStart: number; innerEnd: number }

function matchItems(region: string): ItemSpan | null {
  const re = /\{\{([\s\S]*?)\}\}/g
  let depth = 0
  let open: { start: number; end: number; path: string; raw: string } | null = null
  let m: RegExpExecArray | null
  while ((m = re.exec(region))) {
    const parsed = parseTokenBody(m[1])
    if (!parsed.ok) continue
    if (parsed.kind === 'items' && depth === 0) {
      open = { start: m.index, end: m.index + m[0].length, path: parsed.path, raw: parsed.token }
      depth = 1
    } else if (parsed.kind === 'items') depth += 1
    else if (parsed.kind === 'close_items' && depth > 0) {
      depth -= 1
      if (depth === 0 && open) {
        return {
          start: open.start, innerStart: open.end, innerEnd: m.index, end: m.index + m[0].length,
          path: open.path, rawOpen: open.raw,
        }
      }
    }
  }
  if (open) {
    throw new FormRenderError('UNCLOSED_BLOCK', undefined, open.raw, `'${open.raw}' has no {{/items}}`)
  }
  return null
}

function stripBlock(
  paras: { start: number; end: number; xml: string }[],
  first: number,
  last: number,
  found: ItemSpan,
): string {
  if (first === last) {
    const p = paras[first]
    const a = found.start - p.start
    const b = found.innerStart - p.start
    const c = found.innerEnd - p.start
    const d = found.end - p.start
    return p.xml.slice(0, a) + p.xml.slice(b, c) + p.xml.slice(d)
  }
  const head = paras[first]
  const tail = paras[last]
  const headXml = head.xml.slice(0, found.start - head.start) + head.xml.slice(found.innerStart - head.start)
  const tailXml = tail.xml.slice(0, found.innerEnd - tail.start) + tail.xml.slice(found.end - tail.start)
  const mid = paras.slice(first + 1, last).map((p) => p.xml).join('')
  return headXml + mid + tailXml
}

function ensureParagraph(body: string): string {
  const open = body.match(/^<(?:p|a):txBody\b[^>]*>/)?.[0]
  const close = body.match(/<\/(?:p|a):txBody>$/)?.[0]
  if (!open || !close) return body
  const inner = body.slice(open.length, body.length - close.length)
  if (/<a:p\b/.test(inner)) return body
  return `${open}<a:p><a:r><a:t></a:t></a:r></a:p>${close}`
}

interface OutSlide { xml: string; source: string; clone: boolean; ctx: Ctx }

function slideToken(xml: string): { token: string; path: string } | null {
  const m = /\{\{#slide[ \t]+([\s\S]*?)\}\}/.exec(xml)
  if (!m) return null
  const parsed = parseTokenBody(`#slide ${m[1]}`)
  if (!parsed.ok || parsed.kind !== 'slide') return null
  return { token: parsed.token, path: parsed.path }
}

async function expandSlides(zip: JSZip, renderer: Renderer, base: Ctx): Promise<OutSlide[]> {
  const order = await deckOrder(zip)
  const out: OutSlide[] = []
  for (const source of order) {
    const file = zip.file(source)
    if (!file) continue
    const xml = await file.async('string')
    const token = slideToken(xml)
    if (!token) {
      out.push({ xml, source, clone: false, ctx: base })
      continue
    }
    const list = renderer.blockList(token.token, token.path, base)
    if (list.length === 0) continue
    list.forEach((item, index) => {
      out.push({
        xml,
        source,
        clone: index > 0,
        ctx: { ...base, scope: [token.token], items: [item] },
      })
    })
  }
  const pageCount = out.length
  return out.map((slide, index) => ({ ...slide, ctx: { ...slide.ctx, page: index + 1, pageCount } }))
}

async function deckOrder(zip: JSZip): Promise<string[]> {
  const pres = zip.file('ppt/presentation.xml')
  const rels = zip.file('ppt/_rels/presentation.xml.rels')
  if (pres && rels) {
    const relXml = await rels.async('string')
    const targets = new Map<string, string>()
    for (const m of relXml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
      const id = /Id="([^"]+)"/.exec(m[1])?.[1]
      const target = /Target="([^"]+)"/.exec(m[1])?.[1]
      if (id && target) targets.set(id, target.replace(/^\/?ppt\//, ''))
    }
    const xml = await pres.async('string')
    const order: string[] = []
    for (const m of xml.matchAll(/<p:sldId\b([^>]*)\/?>/g)) {
      const rid = /r:id="([^"]+)"/.exec(m[1])?.[1]
      const target = rid ? targets.get(rid) : undefined
      if (target) order.push(target.startsWith('slides/') ? `ppt/${target}` : `ppt/slides/${target.split('/').pop()}`)
    }
    if (order.length) return order
  }
  return Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(/\d+/.exec(a)![0]) - Number(/\d+/.exec(b)![0]))
}

function stripClone(xml: string, creationSeed: number): string {
  let n = creationSeed
  return xml
    .replace(/<p:custDataLst>[\s\S]*?<\/p:custDataLst>/g, '')
    .replace(/<p14:creationId\b([^>]*)\bval="[^"]*"([^>]*)\/>/g, (_m, a, b) => {
      n += 1
      return `<p14:creationId${a}val="${n}"${b}/>`
    })
}

function stripTagRels(xml: string): string {
  return xml.replace(/<Relationship\b[^>]*\/relationships\/tags"[^>]*\/>/g, '')
}

async function writeDeck(zip: JSZip, slides: OutSlide[]): Promise<void> {
  const existing = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
  let maxN = existing.reduce((m, n) => Math.max(m, Number(/\d+/.exec(n)![0])), 0)
  let maxId = 256
  const presFile = zip.file('ppt/presentation.xml')
  const pres0 = presFile ? await presFile.async('string') : ''
  for (const m of pres0.matchAll(/<p:sldId\b[^>]*\bid="(\d+)"/g)) maxId = Math.max(maxId, Number(m[1]))
  const relFile = zip.file('ppt/_rels/presentation.xml.rels')
  const rel0 = relFile ? await relFile.async('string') : ''
  let fm = 1
  while (rel0.includes(`Id="rIdFm${fm}"`)) fm += 1
  const kept = new Set<string>()
  const entries: { path: string; xml: string; rid: string; id: string; newRel: boolean }[] = []
  for (const slide of slides) {
    if (!slide.clone) {
      kept.add(slide.source)
      const rid = ridFor(rel0, slide.source)
      const id = idFor(pres0, rid) ?? String(++maxId)
      entries.push({ path: slide.source, xml: slide.xml, rid, id, newRel: false })
      continue
    }
    maxN += 1
    maxId += 1
    const path = `ppt/slides/slide${maxN}.xml`
    const rid = `rIdFm${fm}`
    fm += 1
    const relsPath = slide.source.replace('ppt/slides/', 'ppt/slides/_rels/').replace(/\.xml$/, '.xml.rels')
    const rels = zip.file(relsPath)
    if (rels) zip.file(relsPath.replace(/slide\d+\.xml\.rels$/, `slide${maxN}.xml.rels`), stripTagRels(await rels.async('string')))
    entries.push({ path, xml: stripClone(slide.xml, 3_000_000_000 + maxN), rid, id: String(maxId), newRel: true })
    kept.add(path)
  }
  for (const name of existing) {
    if (!kept.has(name)) {
      zip.remove(name)
      const rels = name.replace('ppt/slides/', 'ppt/slides/_rels/').replace(/\.xml$/, '.xml.rels')
      if (zip.file(rels)) zip.remove(rels)
    }
  }
  for (const entry of entries) zip.file(entry.path, entry.xml)
  if (presFile && relFile) {
    let rels = rel0
    let pres = pres0
    const keepRids = new Set(entries.filter((e) => !e.newRel).map((e) => e.rid))
    rels = rels.replace(/<Relationship\b[^>]*\/relationships\/slide"[^>]*\/>/g, (tag) => {
      const id = /Id="([^"]+)"/.exec(tag)?.[1]
      return id && keepRids.has(id) ? tag : ''
    })
    for (const entry of entries.filter((e) => e.newRel)) {
      const target = entry.path.replace(/^ppt\//, '')
      rels = rels.replace('</Relationships>', `<Relationship Id="${entry.rid}" Type="${SLIDE_REL}" Target="${target}"/></Relationships>`)
    }
    const ids = entries.map((e) => `<p:sldId id="${e.id}" r:id="${e.rid}"/>`).join('')
    if (/<p:sldIdLst\b[^>]*>[\s\S]*?<\/p:sldIdLst>/.test(pres)) {
      pres = pres.replace(/<p:sldIdLst\b[^>]*>[\s\S]*?<\/p:sldIdLst>/, `<p:sldIdLst>${ids}</p:sldIdLst>`)
    }
    zip.file('ppt/_rels/presentation.xml.rels', rels)
    zip.file('ppt/presentation.xml', pres)
  }
  const ctFile = zip.file('[Content_Types].xml')
  if (ctFile) {
    let ct = await ctFile.async('string')
    ct = ct.replace(/<Override\b[^>]*PartName="\/ppt\/slides\/slide\d+\.xml"[^>]*\/>/g, '')
    for (const entry of entries) {
      const part = `/${entry.path}`
      ct = ct.replace('</Types>', `<Override PartName="${part}" ContentType="${SLIDE_CT}"/></Types>`)
    }
    zip.file('[Content_Types].xml', ct)
  }
  const app = zip.file('docProps/app.xml')
  if (app) {
    const xml = await app.async('string')
    if (/<Slides>\d+<\/Slides>/.test(xml)) zip.file('docProps/app.xml', xml.replace(/<Slides>\d+<\/Slides>/, `<Slides>${entries.length}</Slides>`))
  }
}

function ridFor(rels: string, source: string): string {
  const target = source.replace(/^ppt\//, '')
  for (const m of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = /Id="([^"]+)"/.exec(m[1])?.[1]
    const t = /Target="([^"]+)"/.exec(m[1])?.[1]
    if (id && t && (t === target || t.endsWith(target) || source.endsWith(t))) return id
  }
  return 'rId1'
}

function idFor(pres: string, rid: string): string | undefined {
  for (const m of pres.matchAll(/<p:sldId\b([^>]*)\/?>/g)) {
    if (new RegExp(`r:id="${rid}"`).test(m[1])) return /id="(\d+)"/.exec(m[1])?.[1]
  }
  return undefined
}

export async function renderPptx(
  template: Uint8Array,
  model: CatalogModel,
  mapping: RenderMapping,
  options: RenderOptions,
): Promise<Uint8Array> {
  const scanned = await scanFormTemplate(template, 'pptx')
  const error = scanned.issues.find((i) => i.severity === 'error')
  if (error) {
    const location: PlaceholderLocation | undefined = error.location
    throw new FormRenderError(error.code, location, error.token, error.message)
  }
  const kind = kindOf(model)
  for (const placeholder of scanned.placeholders) {
    const composite = [...placeholder.scope, placeholder.token].join('/')
    const path = mapping[composite] ?? mapping[placeholder.token] ?? placeholder.path
    if (!resolveCatalogPath(kind, path, placeholder.scope, undefined, mapping)) {
      throw new FormRenderError('MISSING_PATH', placeholder.location, placeholder.token, `No catalog path for '${placeholder.token}'`)
    }
  }
  const renderer = new Renderer(model, kind, mapping, options)
  const zip = await JSZip.loadAsync(template)
  const base: Ctx = { scope: [], items: [], page: 1, pageCount: 1, continuation: '' }
  const slides = await expandSlides(zip, renderer, base)
  for (const slide of slides) slide.xml = renderer.renderFragment(slide.xml, slide.ctx)
  await writeDeck(zip, slides)
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

export const pptxEngine = {
  format: 'pptx' as const,
  scan: (template: Uint8Array) => scanFormTemplate(template, 'pptx'),
  render: renderPptx,
}
