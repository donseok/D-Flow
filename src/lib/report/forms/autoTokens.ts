/**
 * 자리표시자가 없는 주간보고 PPT 양식의 표 자동 연결(계획 docs/superpowers/plans/2026-10-28-weekly-form-auto-tokens.md).
 *
 * 회사 양식은 대개 "구분 | 전주(실적) | 금주(계획)" 또는 "구분 | 금주 실적 | 차주 계획" 표 하나에 주간 내용을 적는다.
 * 그런 표를 머리글 낱말·열 너비·가로 병합으로 찾아 첫 데이터 행의 세 칸에 `{{#rows sections}}{{.name}}` ·
 * `{{.this_content}}` · `{{.next_content}}` 를 넣는다. 구분 열이 없는 "금주 실적 | 차주 계획" 두 열 표는 내용 칸의
 * 첫 문단에 `[{{.name}}]` 을 두어 영역 이름을 내용 앞에 적는다(사람이 "[생산계획] …" 처럼 쓰던 꼴).
 * 그 뒤는 기존 토큰 엔진(정본 §4.4)이 그대로 채운다 — 등록 때 한 번 바꾸고 저장하므로 렌더·활성화·매핑 경로는 바뀌지 않는다.
 *
 * 양식에 적힌 보기 내용은 패턴일 뿐이다: 첫 데이터 행 뒤의 행은 지우고, 같은 표를 되풀이한 뒤 슬라이드(사람이 쪽을
 * 나눠 쓴 것)도 지운다 — 보고서를 만들 때 엔진이 필요한 만큼 행·슬라이드를 다시 늘린다. 표본 데이터 행 수는
 * `rowsPerSlide` 로 돌려줘 등록 화면이 한 장당 줄 수(options.max_rows_per_slide)로 쓴다.
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
  /** 0-based 열 번호 — 구분 열이 없으면 name 은 null(영역 이름은 내용 칸 첫 문단의 [이름]) */
  columns: { name: number | null; this: number; next: number }
  /** 머리글 글자(공백 정리) — 안내 문구에 쓴다. 구분 열이 없으면 name 은 '' */
  headers: { name: string; this: string; next: string }
  /** 데이터 행 뒤에서 지운 표본 행 수 */
  removedRows: number
  /** 같은 표를 되풀이해 지운 뒤 슬라이드 수 */
  removedSlides: number
  /** 양식의 표본 데이터 행 수(1 이상) — 한 장당 줄 수(options.max_rows_per_slide)로 쓴다 */
  rowsPerSlide: number
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
/** 월 단위 머리글("금월 주요 실적 | 차월 주요 계획") — 주간 내용 표가 아니다. 주 낱말이 같이 있으면 주간으로 본다. */
const MONTH_RE = /금월|차월|전월|당월|익월|이달|다음달|지난달|월간/
/** 내용 열의 최소 너비(표 전체 대비) — 요일 격자(월~금 한 칸 2% 안팎)를 배제한다 */
const MIN_WIDTH_SHARE = 0.15
/** 구분 열이 있는 표를 두 열 표보다 앞세우는 점수 가산(내용 두 열 너비 합은 1 이하) */
const NAME_BONUS = 0.5

const TBL_RE = /<a:tbl\b[^>]*>[\s\S]*?<\/a:tbl>/g
const TR_RE = /<a:tr\b[^>]*>[\s\S]*?<\/a:tr>/g
const TC_RE = /<a:tc\b[^>]*>[\s\S]*?<\/a:tc>/g
const P_RE = /<a:p\b[^>]*>[\s\S]*?<\/a:p>/g

interface Cell { xml: string; text: string; span: number; hMerge: boolean; vMerge: boolean; rowSpan: number }
interface Row { xml: string; h: number; cells: Cell[] }
interface Table { xml: string; widths: number[]; rows: Row[] }

interface Found {
  table: Table
  headerCount: number
  dataRow: number
  columns: { name: number | null; this: number; next: number }
  headers: { name: string; this: string; next: string }
  /** 열 수·머리글 행 글자 — 같은 표를 되풀이한 슬라이드를 알아보는 열쇠 */
  signature: string
  score: number
}

interface Candidate extends Found {
  slideIndex: number
  slidePath: string
  tableCount: number
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

function detectTable(table: Table): Found | null {
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
    if (rank === null && MONTH_RE.test(c)) continue
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
  const data = table.rows[dataRow]
  if (data.cells.length <= Math.max(nameCol ?? 0, thisCol, nextCol)) return null

  const share = (col: number) => table.widths[col] / total
  return {
    table, headerCount, dataRow,
    columns: { name: nameCol, this: thisCol, next: nextCol },
    headers: { name: nameCol === null ? '' : headerText[nameCol], this: headerText[thisCol], next: headerText[nextCol] },
    signature: `${colCount}|${headerRows.map((r) => r.cells.map((c) => compact(c.text)).join(',')).join(';')}`,
    score: share(thisCol) + share(nextCol) + (nameCol === null ? 0 : NAME_BONUS),
  }
}

/** 셀 글자를 문단 하나씩의 토큰으로 — 첫 문단의 pPr 과 첫 런의 rPr(없으면 endParaRPr)을 모든 문단에 입히고 런은 하나씩 둔다 */
function setCellParagraphs(cellXml: string, texts: string[]): string {
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
  const paragraphs = texts.map((text) => `<a:p>${pPr}<a:r>${rPr}<a:t>${escapeXml(text)}</a:t></a:r></a:p>`).join('')
  return cellXml.replace(tx[0], `${open}${bodyPr}${lstStyle}${paragraphs}</a:txBody>`)
}

function stripVertical(cellXml: string): string {
  return cellXml.replace(/^<a:tc\b([^>]*)>/, (_m, attrs: string) => `<a:tc${attrs.replace(/\s(?:rowSpan|vMerge)="[^"]*"/g, '')}>`)
}

function rewriteTable(c: Found): { xml: string; removedRows: number } {
  const { table, headerCount, dataRow, columns } = c
  const headerRows = table.rows.slice(0, headerCount)
  const data = table.rows[dataRow]
  // 구분 열이 없으면 영역 이름은 내용 칸의 첫 문단에 [이름] 으로 — 사람이 "[생산계획] …" 처럼 쓰던 꼴. 차주 칸도 같은 이름을 앞세운다.
  const tokens: Record<number, string[]> = columns.name === null
    ? { [columns.this]: ['{{#rows sections}}[{{.name}}]', '{{.this_content}}'], [columns.next]: ['[{{.name}}]', '{{.next_content}}'] }
    : { [columns.name]: ['{{#rows sections}}{{.name}}'], [columns.this]: ['{{.this_content}}'], [columns.next]: ['{{.next_content}}'] }
  const cells = data.cells.map((cell, col) => stripVertical(col in tokens ? setCellParagraphs(cell.xml, tokens[col]) : cell.xml))
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

function escapeRe(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

/** `ppt/slides/slide3.xml` 기준의 `../notesSlides/notesSlide2.xml` → `ppt/notesSlides/notesSlide2.xml` */
function resolvePart(from: string, target: string): string {
  const dir = from.split('/').slice(0, -1)
  for (const seg of target.split('/')) {
    if (seg === '..') dir.pop()
    else if (seg !== '.' && seg) dir.push(seg)
  }
  return dir.join('/')
}

/**
 * 슬라이드 파트를 덱에서 뺀다 — sldIdLst·presentation.xml.rels·[Content_Types].xml 의 항목과 파트 자체, 그 슬라이드만
 * 가리키던 노트 슬라이드까지. 엔진의 writeDeck 이 렌더 때 안 쓰는 슬라이드를 지우는 것과 같은 범위에 노트를 더한 것이다
 * (노트가 지워진 슬라이드를 가리키면 PowerPoint 가 복구를 묻는다).
 */
async function removeSlides(zip: JSZip, paths: string[]): Promise<void> {
  if (!paths.length) return
  const presFile = zip.file('ppt/presentation.xml')
  const relFile = zip.file('ppt/_rels/presentation.xml.rels')
  const ctFile = zip.file('[Content_Types].xml')
  let pres = presFile ? await presFile.async('string') : ''
  let rels = relFile ? await relFile.async('string') : ''
  let types = ctFile ? await ctFile.async('string') : ''
  const parts: string[] = []
  for (const path of paths) {
    const target = path.replace(/^ppt\//, '')
    for (const m of rels.matchAll(/<Relationship\b[^>]*\/>/g)) {
      const t = /\bTarget="([^"]+)"/.exec(m[0])?.[1]
      const id = /\bId="([^"]+)"/.exec(m[0])?.[1]
      if (!t || !id || t.replace(/^\/?ppt\//, '') !== target) continue
      rels = rels.replace(m[0], '')
      pres = pres.replace(new RegExp(`<p:sldId\\b[^>]*\\br:id="${escapeRe(id)}"[^>]*/>`), '')
    }
    const slideRelsPath = path.replace('ppt/slides/', 'ppt/slides/_rels/') + '.rels'
    const slideRels = zip.file(slideRelsPath)
    if (slideRels) {
      const xml = await slideRels.async('string')
      for (const m of xml.matchAll(/<Relationship\b[^>]*\/relationships\/notesSlide"[^>]*\/>/g)) {
        const t = /\bTarget="([^"]+)"/.exec(m[0])?.[1]
        if (!t) continue
        const notes = resolvePart(path, t)
        parts.push(notes, notes.replace('ppt/notesSlides/', 'ppt/notesSlides/_rels/') + '.rels')
      }
      parts.push(slideRelsPath)
    }
    parts.push(path)
  }
  for (const part of parts) {
    if (zip.file(part)) zip.remove(part)
    types = types.replace(new RegExp(`<Override\\b[^>]*\\bPartName="/${escapeRe(part)}"[^>]*/>`), '')
  }
  if (presFile) zip.file('ppt/presentation.xml', pres)
  if (relFile) zip.file('ppt/_rels/presentation.xml.rels', rels)
  if (ctFile) zip.file('[Content_Types].xml', types)
  const app = zip.file('docProps/app.xml')
  if (app) {
    const xml = await app.async('string')
    const count = [...pres.matchAll(/<p:sldId\b/g)].length
    if (/<Slides>\d+<\/Slides>/.test(xml)) zip.file('docProps/app.xml', xml.replace(/<Slides>\d+<\/Slides>/, `<Slides>${count}</Slides>`))
  }
}

/**
 * 자리표시자가 없는 `weekly_report_pptx` 양식의 주간 내용 표를 찾아 토큰을 넣은 바이트를 돌려준다.
 * 토큰이 하나라도 있는 양식·다른 종류·맞는 표 없음은 바꾸지 않는다.
 */
export async function autoTokenizeTemplate(bytes: Uint8Array, kind: FormKind): Promise<AutoTokenResult> {
  if (kind !== 'weekly_report_pptx') return { changed: false, reason: 'unsupported_kind' }
  const zip = await JSZip.loadAsync(bytes)
  const order = await deckOrder(zip)
  const slides: { path: string; xml: string; tables: Table[] }[] = []
  for (const path of order) {
    const file = zip.file(path)
    if (!file) continue
    const xml = await file.async('string')
    slides.push({ path, xml, tables: [...xml.matchAll(TBL_RE)].map((m) => parseTable(m[0])) })
  }
  if (slides.some((s) => s.xml.includes('{{'))) return { changed: false, reason: 'has_tokens' }

  let best: Candidate | null = null
  slides.forEach((s, slideIndex) => {
    for (const table of s.tables) {
      const found = detectTable(table)
      if (!found) continue
      if (!best || found.score > best.score) best = { ...found, slideIndex, slidePath: s.path, tableCount: s.tables.length }
    }
  })
  if (!best) return { changed: false, reason: 'no_table' }
  const chosen: Candidate = best

  // 같은 머리글의 같은 표를 바로 뒤 슬라이드에 되풀이했으면 사람이 쪽을 나눠 쓴 것 — 첫 장만 남긴다(엔진이 필요한 만큼 복제한다)
  const duplicates: string[] = []
  for (let i = chosen.slideIndex + 1; i < slides.length; i += 1) {
    const s = slides[i]
    const same = s.tables.length === chosen.tableCount
      && s.tables.some((table) => detectTable(table)?.signature === chosen.signature)
    if (!same) break
    duplicates.push(s.path)
  }

  const { xml: tableXml, removedRows } = rewriteTable(chosen)
  const slide = slides[chosen.slideIndex]
  zip.file(chosen.slidePath, slide.xml.replace(chosen.table.xml, tableXml))
  await removeSlides(zip, duplicates)
  const out = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
  return {
    changed: true,
    bytes: out,
    detection: {
      slide: chosen.slideIndex + 1,
      columns: chosen.columns,
      headers: chosen.headers,
      removedRows,
      removedSlides: duplicates.length,
      rowsPerSlide: Math.max(1, chosen.table.rows.length - chosen.headerCount),
    },
  }
}
