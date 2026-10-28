/**
 * 자리표시자가 없는 주간보고 PPT 양식의 표 자동 연결(계획 docs/superpowers/plans/2026-10-28-weekly-form-auto-tokens.md).
 *
 * 회사 양식은 대개 "구분 | 전주(실적) | 금주(계획)" 또는 "구분 | 금주 실적 | 차주 계획" 표 하나에 주간 내용을 적는다.
 * 그런 표를 머리글 낱말·열 너비·가로 병합으로 찾아 첫 데이터 행의 세 칸에 `{{#rows sections}}{{.name}}` ·
 * `{{.this_content}}` · `{{.next_content}}` 를 넣는다. 그 뒤는 기존 토큰 엔진(정본 §4.4)이 그대로 채운다 —
 * 등록 때 한 번 바꾸고 저장하므로 렌더·활성화·매핑 경로는 바뀌지 않는다.
 *
 * 규칙은 결정형이다(같은 파일이면 같은 결과). 못 찾으면 `changed:false` 로 사유를 돌려주고 파일을 건드리지 않는다.
 */
import JSZip from 'jszip'
import { deckOrder } from '../engine/pptx'
import type { FormKind } from '../engine/types'
import { escapeXml } from '../xml'

export interface AutoTokenDetection {
  /** 덱 순서 1-based 슬라이드 번호 */
  slide: number
  /** 0-based 열 번호 */
  columns: { name: number; this: number; next: number }
  /** 머리글 글자(공백 정리) — 안내 문구에 쓴다 */
  headers: { name: string; this: string; next: string }
  /** 데이터 행 뒤에서 지운 표본 행 수 */
  removedRows: number
}

export type AutoTokenResult =
  | { changed: true; bytes: Uint8Array; detection: AutoTokenDetection }
  | { changed: false; reason: 'has_tokens' | 'no_table' | 'unsupported_kind' }

/** 이름 열 머리글 — 칸 글자가 이 낱말로 시작해야 한다('부산운영팀' 같은 데이터 글자가 '팀' 에 걸리지 않게) */
const NAME_RE = /^(?:구분|업무영역|영역|팀명|담당팀|팀|항목|부문|분류|과제|업무명|업무|부서)/
const THIS_RE = /실적|완료|수행|결과|진척|진행/
const NEXT_RE = /계획|예정/
const RANKS: ReadonlyArray<readonly [RegExp, number]> = [
  [/전주|지난주|전週/, -1],
  [/금주|이번주|당주|이주/, 0],
  [/차주|다음주|익주|내주/, 1],
]
/** 내용 열의 최소 너비(표 전체 대비) — 요일 격자(월~금 한 칸 2% 안팎)를 배제한다 */
const MIN_WIDTH_SHARE = 0.15

const TBL_RE = /<a:tbl\b[^>]*>[\s\S]*?<\/a:tbl>/g
const TR_RE = /<a:tr\b[^>]*>[\s\S]*?<\/a:tr>/g
const TC_RE = /<a:tc\b[^>]*>[\s\S]*?<\/a:tc>/g
const P_RE = /<a:p\b[^>]*>[\s\S]*?<\/a:p>/g

interface Cell { xml: string; text: string; span: number; hMerge: boolean; vMerge: boolean; rowSpan: number }
interface Row { xml: string; h: number; cells: Cell[] }
interface Table { xml: string; widths: number[]; rows: Row[] }

interface Candidate {
  slideIndex: number
  slidePath: string
  table: Table
  headerCount: number
  dataRow: number
  columns: { name: number; this: number; next: number }
  headers: { name: string; this: string; next: string }
  score: number
}

function decodeXml(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
}

function attr(open: string, name: string): string | undefined {
  return new RegExp(`\\b${name}="([^"]*)"`).exec(open)?.[1]
}

function cellText(xml: string): string {
  const paras = [...xml.matchAll(P_RE)].map((m) => [...m[0].matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((t) => decodeXml(t[1])).join(''))
  return paras.join('\n').replace(/\s+/g, ' ').trim()
}

function parseCell(xml: string): Cell {
  const open = /^<a:tc\b([^>]*)>/.exec(xml)?.[1] ?? ''
  const span = Number(attr(open, 'gridSpan') ?? '1')
  const rowSpan = Number(attr(open, 'rowSpan') ?? '1')
  return {
    xml, text: cellText(xml),
    span: Number.isFinite(span) && span > 1 ? span : 1,
    rowSpan: Number.isFinite(rowSpan) && rowSpan > 1 ? rowSpan : 1,
    hMerge: attr(open, 'hMerge') !== undefined && attr(open, 'hMerge') !== '0',
    vMerge: attr(open, 'vMerge') !== undefined && attr(open, 'vMerge') !== '0',
  }
}

function parseTable(xml: string): Table {
  const widths = [...xml.matchAll(/<a:gridCol\b[^>]*\bw="(\d+)"/g)].map((m) => Number(m[1]))
  const rows = [...xml.matchAll(TR_RE)].map((m) => ({
    xml: m[0],
    h: Number(attr(/^<a:tr\b([^>]*)>/.exec(m[0])?.[1] ?? '', 'h') ?? '0'),
    cells: [...m[0].matchAll(TC_RE)].map((c) => parseCell(c[0])),
  }))
  return { xml, widths, rows }
}

function compact(text: string): string { return text.replace(/\s+/g, '') }

function isHeaderCue(compactText: string): boolean {
  return NAME_RE.test(compactText) || THIS_RE.test(compactText) || NEXT_RE.test(compactText) || RANKS.some(([re]) => re.test(compactText))
}

/**
 * 머리글 행 수 — 첫 행은 머리글이고, 그 아래로 세로 병합이 이어지는 행(From/To 같은 보조 머리글)과
 * 짧은 머리글 낱말만 있는 행이 머리글이다. 데이터 글자('[생산계획] …')로는 판정하지 않는다 — 길고 낱말이 섞인다.
 */
function headerRowCount(rows: Row[]): number {
  if (!rows.length) return 0
  let count = 1
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i]
    const continues = row.cells.some((c) => c.vMerge)
    const own = row.cells.filter((c) => !c.hMerge && !c.vMerge && c.text)
    const shortCues = own.length > 0 && own.every((c) => compact(c.text).length <= 10 && isHeaderCue(compact(c.text)))
    if (continues || shortCues) count = i + 1
    else break
  }
  return count
}

function rankOf(text: string): number | null {
  for (const [re, rank] of RANKS) if (re.test(text)) return rank
  return null
}

function detectTable(table: Table): Omit<Candidate, 'slideIndex' | 'slidePath'> | null {
  const headerCount = headerRowCount(table.rows)
  if (headerCount < 1 || headerCount >= table.rows.length) return null
  const total = table.widths.reduce((a, b) => a + b, 0)
  if (!table.widths.length || total <= 0) return null
  const headerRows = table.rows.slice(0, headerCount)
  const dataRow = headerCount
  const colCount = table.widths.length

  const headerText: string[] = Array.from({ length: colCount }, () => '')
  const grouped: boolean[] = Array.from({ length: colCount }, () => false)
  for (const row of headerRows) {
    row.cells.forEach((cell, col) => {
      if (col >= colCount) return
      if (cell.span > 1) for (let k = col; k < Math.min(colCount, col + cell.span); k += 1) grouped[k] = true
      if (cell.hMerge) grouped[col] = true
      if (!cell.hMerge && !cell.vMerge && cell.text) headerText[col] = headerText[col] ? `${headerText[col]} ${cell.text}` : cell.text
    })
  }

  type Cue = { col: number; share: number; isThis: boolean; isNext: boolean; rank: number | null }
  const cues: Cue[] = []
  for (let col = 0; col < colCount; col += 1) {
    const c = compact(headerText[col])
    if (!c) continue
    const isThis = THIS_RE.test(c)
    const isNext = NEXT_RE.test(c)
    const rank = rankOf(c)
    if (!isThis && !isNext && rank === null) continue
    const share = table.widths[col] / total
    if (grouped[col] || share < MIN_WIDTH_SHARE) continue
    cues.push({ col, share, isThis, isNext, rank })
  }

  let thisCol: number | null = null
  let nextCol: number | null = null
  const explicitThis = cues.filter((c) => c.isThis && !c.isNext)
  const explicitNext = cues.filter((c) => c.isNext && !c.isThis)
  if (explicitThis.length === 1 && explicitNext.length === 1) {
    thisCol = explicitThis[0].col
    nextCol = explicitNext[0].col
  } else {
    const ranked = cues.filter((c) => c.rank !== null && !(c.isThis && c.isNext))
    if (ranked.length === 2 && ranked[0].rank !== ranked[1].rank) {
      const [a, b] = ranked
      thisCol = (a.rank as number) < (b.rank as number) ? a.col : b.col
      nextCol = thisCol === a.col ? b.col : a.col
    }
  }
  if (thisCol === null || nextCol === null) return null

  let nameCol: number | null = null
  for (let col = 0; col < colCount; col += 1) {
    if (col === thisCol || col === nextCol) continue
    if (NAME_RE.test(compact(headerText[col]))) { nameCol = col; break }
  }
  if (nameCol === null) return null
  const data = table.rows[dataRow]
  if (data.cells.length <= Math.max(nameCol, thisCol, nextCol)) return null

  const share = (col: number) => table.widths[col] / total
  return {
    table, headerCount, dataRow,
    columns: { name: nameCol, this: thisCol, next: nextCol },
    headers: { name: headerText[nameCol], this: headerText[thisCol], next: headerText[nextCol] },
    score: share(thisCol) + share(nextCol),
  }
}

/** 셀 글자를 토큰 하나로 — 첫 문단의 pPr 과 첫 런의 rPr(없으면 endParaRPr)을 입혀 문단 하나·런 하나로 둔다 */
function setCellText(cellXml: string, text: string): string {
  const tx = /<a:txBody\b[^>]*>([\s\S]*?)<\/a:txBody>/.exec(cellXml)
  if (!tx) return cellXml
  const body = tx[1]
  const open = /^<a:txBody\b[^>]*>/.exec(tx[0])?.[0] ?? '<a:txBody>'
  const bodyPr = /<a:bodyPr\b[^>]*\/>|<a:bodyPr\b[^>]*>[\s\S]*?<\/a:bodyPr>/.exec(body)?.[0] ?? ''
  const lstStyle = /<a:lstStyle\b[^>]*\/>|<a:lstStyle\b[^>]*>[\s\S]*?<\/a:lstStyle>/.exec(body)?.[0] ?? ''
  const firstP = /<a:p\b[^>]*>[\s\S]*?<\/a:p>/.exec(body)?.[0] ?? ''
  const pPr = /<a:pPr\b[^>]*\/>|<a:pPr\b[^>]*>[\s\S]*?<\/a:pPr>/.exec(firstP)?.[0] ?? ''
  const firstRun = /<a:r\b[^>]*>[\s\S]*?<\/a:r>/.exec(firstP)?.[0]
  let rPr = firstRun ? (/<a:rPr\b[^>]*\/>|<a:rPr\b[^>]*>[\s\S]*?<\/a:rPr>/.exec(firstRun)?.[0] ?? '') : ''
  if (!rPr) {
    const end = /<a:endParaRPr\b([^>]*)\/>|<a:endParaRPr\b([^>]*)>([\s\S]*?)<\/a:endParaRPr>/.exec(firstP)
    if (end) rPr = end[3] !== undefined ? `<a:rPr${end[2]}>${end[3]}</a:rPr>` : `<a:rPr${end[1]}/>`
  }
  const paragraph = `<a:p>${pPr}<a:r>${rPr}<a:t>${escapeXml(text)}</a:t></a:r></a:p>`
  return cellXml.replace(tx[0], `${open}${bodyPr}${lstStyle}${paragraph}</a:txBody>`)
}

function stripVertical(cellXml: string): string {
  return cellXml.replace(/^<a:tc\b([^>]*)>/, (_m, attrs: string) => `<a:tc${attrs.replace(/\s(?:rowSpan|vMerge)="[^"]*"/g, '')}>`)
}

function rewriteTable(c: Omit<Candidate, 'slideIndex' | 'slidePath'>): { xml: string; removedRows: number } {
  const { table, headerCount, dataRow, columns } = c
  const headerRows = table.rows.slice(0, headerCount)
  const data = table.rows[dataRow]
  const tokens: Record<number, string> = {
    [columns.name]: '{{#rows sections}}{{.name}}',
    [columns.this]: '{{.this_content}}',
    [columns.next]: '{{.next_content}}',
  }
  const cells = data.cells.map((cell, col) => stripVertical(col in tokens ? setCellText(cell.xml, tokens[col]) : cell.xml))
  const headerHeights = headerRows.map((r) => r.h).filter((h) => h > 0)
  const h = headerHeights.length ? Math.min(...headerHeights) : data.h
  const openTag = /^<a:tr\b[^>]*>/.exec(data.xml)?.[0] ?? '<a:tr>'
  const newOpen = /\bh="\d+"/.test(openTag) ? openTag.replace(/\bh="\d+"/, `h="${h}"`) : openTag
  const newData = `${newOpen}${cells.join('')}</a:tr>`
  const first = table.xml.indexOf(table.rows[0].xml)
  const lastRow = table.rows[table.rows.length - 1]
  const last = table.xml.lastIndexOf(lastRow.xml) + lastRow.xml.length
  const xml = table.xml.slice(0, first) + headerRows.map((r) => r.xml).join('') + newData + table.xml.slice(last)
  return { xml, removedRows: table.rows.length - dataRow - 1 }
}

/**
 * 자리표시자가 없는 `weekly_report_pptx` 양식의 주간 내용 표를 찾아 토큰을 넣은 바이트를 돌려준다.
 * 토큰이 하나라도 있는 양식·다른 종류·맞는 표 없음은 바꾸지 않는다.
 */
export async function autoTokenizeTemplate(bytes: Uint8Array, kind: FormKind): Promise<AutoTokenResult> {
  if (kind !== 'weekly_report_pptx') return { changed: false, reason: 'unsupported_kind' }
  const zip = await JSZip.loadAsync(bytes)
  const order = await deckOrder(zip)
  const slides: { path: string; xml: string }[] = []
  for (const path of order) {
    const file = zip.file(path)
    if (!file) continue
    slides.push({ path, xml: await file.async('string') })
  }
  if (slides.some((s) => s.xml.includes('{{'))) return { changed: false, reason: 'has_tokens' }

  let best: Candidate | null = null
  slides.forEach((s, slideIndex) => {
    for (const m of s.xml.matchAll(TBL_RE)) {
      const found = detectTable(parseTable(m[0]))
      if (!found) continue
      if (!best || found.score > best.score) best = { ...found, slideIndex, slidePath: s.path }
    }
  })
  if (!best) return { changed: false, reason: 'no_table' }
  const chosen: Candidate = best
  const { xml: tableXml, removedRows } = rewriteTable(chosen)
  const slide = slides[chosen.slideIndex]
  zip.file(chosen.slidePath, slide.xml.replace(chosen.table.xml, tableXml))
  const out = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
  return {
    changed: true,
    bytes: out,
    detection: { slide: chosen.slideIndex + 1, columns: chosen.columns, headers: chosen.headers, removedRows },
  }
}
