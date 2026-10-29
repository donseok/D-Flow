/**
 * 표 칸 줄 서식 — 회사 양식의 보기 칸에서 사람이 줄 종류마다 쓴 문단 서식(글머리 기호·들여쓰기·내어쓰기)을 배워 두고,
 * 보고서를 만들 때 웹에서 온 줄에 같은 서식을 입힌다(계획 docs/superpowers/plans/2026-10-28-weekly-form-auto-tokens.md 4차).
 *
 * 줄 종류(사람이 주간보고 칸을 쓰는 꼴):
 * - title  "[생산계획] 칼라 작업지시 …"            — 건 제목
 * - label  "▪ 목적 : …", "일정 : …", "수행실적:"   — 짧은 이름 + 쌍점(또는 "수행실적" 같은 이름만)
 * - item   "– 프로그램 개발 및 테스트"              — 대시로 시작하거나, 값이 빈 label("수행실적:") 아래의 줄
 * - sub    "ㄴ 구매 라미나 …", "┕ …"               — 하위 줄(과 그 줄이 접혀 이어진 들여쓴 줄)
 * - body   그 밖
 *
 * 저장: 자동 연결이 토큰 칸의 `a:tcPr/a:extLst/a:ext`(uri = LINE_STYLE_URI)에 종류별 `a:pPr`·`a:rPr` 표본을 둔다.
 * DrawingML 확장 목록이라 PowerPoint 는 모르는 uri 를 무시한다. 엔진은 행을 그린 뒤 그 칸의 문단에 서식을 입히고 확장을 지운다.
 */

export const LINE_STYLE_URI = '{5B0F7C3E-2D4A-4E61-9C8B-7A1D3F6E2B90}'
const NS = 'urn:d-flow:line-styles:1'

export type LineKind = 'title' | 'label' | 'item' | 'sub' | 'body'
const KINDS: readonly LineKind[] = ['title', 'label', 'item', 'sub', 'body']

export interface LineStyle {
  /** 문단 서식 원문(<a:pPr …/> 또는 <a:pPr …>…</a:pPr>) — 비면 서식을 바꾸지 않는다 */
  pPr: string
  /** 런 서식 원문 — 비면 런 서식을 바꾸지 않는다 */
  rPr: string
  /** 표본 글자 앞 공백 수(가장 흔한 값) */
  lead: number
  /** 글머리 기호가 서식(buChar·buAutoNum)이면 true — 글자로 적은 글머리를 지운다 */
  auto: boolean
}
export type LinePalette = Partial<Record<LineKind, LineStyle>>

const BULLET_GLYPHS = '▪●•■◆◇◦○§·※'
const LABEL_RE = new RegExp(`^[${BULLET_GLYPHS}]?\\s*[가-힣A-Za-z][가-힣A-Za-z0-9 /()]{0,11}\\s*[:：]`)
const BARE_LABEL_RE = new RegExp(`^[${BULLET_GLYPHS}]?\\s*(?:수행실적|수행계획|진행실적|진행사항|추진실적|추진계획|조치사항|조치계획|세부내용|주요내용)\\s*[:：]?\\s*$`)
const DASH_RE = /^[–—\-−](?:\.|\s|$)/
const SUB_RE = /^[ㄴ┕└↳]/

function leadOf(text: string): number { return text.length - text.trimStart().length }

/**
 * 한 칸의 줄들을 종류로 — 앞 줄의 문맥을 본다(값이 빈 label 아래는 item, sub 아래 들여쓴 이어짐 줄은 sub).
 */
export function classifyLines(lines: readonly string[]): LineKind[] {
  const out: LineKind[] = []
  let open = false
  let prev: LineKind | null = null
  for (const raw of lines) {
    const t = raw.trimStart()
    let kind: LineKind
    if (!t) kind = 'body'
    else if (t.startsWith('[')) { kind = 'title'; open = false }
    else if (SUB_RE.test(t)) kind = 'sub'
    else if (DASH_RE.test(t)) kind = 'item'
    else if (BARE_LABEL_RE.test(t)) { kind = 'label'; open = true }
    else if (LABEL_RE.test(t)) { kind = 'label'; open = /[:：]\s*$/.test(t) }
    else if (prev === 'sub' && leadOf(raw) >= 2) kind = 'sub'
    else if (open) kind = 'item'
    else kind = 'body'
    out.push(kind)
    prev = t ? kind : prev
  }
  return out
}

const P_RE = /<a:p\b[^>]*>[\s\S]*?<\/a:p>/g
const PPR_RE = /<a:pPr\b[^>]*\/>|<a:pPr\b[^>]*>[\s\S]*?<\/a:pPr>/
const RPR_RE = /<a:rPr\b[^>]*\/>|<a:rPr\b[^>]*>[\s\S]*?<\/a:rPr>/

function decodeXml(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
}
function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
function paragraphText(p: string): string {
  return [...p.matchAll(/<a:t>([^<]*)<\/a:t>|<a:t\b[^>]*>([^<]*)<\/a:t>/g)].map((m) => decodeXml(m[1] ?? m[2] ?? '')).join('')
}

/** 표본 칸들(XML)의 문단을 종류별로 모아 가장 흔한 서식(pPr 원문 기준)을 고른다. 표본이 없는 종류는 빠진다. */
export function learnPalette(cells: readonly string[]): LinePalette {
  const tally = new Map<LineKind, Map<string, { n: number; rPr: string; leads: Map<number, number> }>>()
  for (const cell of cells) {
    const paras = [...cell.matchAll(P_RE)].map((m) => m[0])
    const texts = paras.map(paragraphText)
    const kinds = classifyLines(texts)
    paras.forEach((p, i) => {
      if (!texts[i].trim()) return
      const pPr = PPR_RE.exec(p)?.[0] ?? ''
      const run = /<a:r\b[^>]*>[\s\S]*?<\/a:r>/.exec(p)?.[0] ?? ''
      const rPr = RPR_RE.exec(run)?.[0] ?? ''
      const byKind = tally.get(kinds[i]) ?? new Map()
      tally.set(kinds[i], byKind)
      const entry = byKind.get(pPr) ?? { n: 0, rPr, leads: new Map<number, number>() }
      entry.n += 1
      const lead = leadOf(texts[i])
      entry.leads.set(lead, (entry.leads.get(lead) ?? 0) + 1)
      byKind.set(pPr, entry)
    })
  }
  const palette: LinePalette = {}
  for (const kind of KINDS) {
    const byKind = tally.get(kind)
    if (!byKind?.size) continue
    const [pPr, best] = [...byKind.entries()].sort((a, b) => b[1].n - a[1].n)[0]
    const lead = [...best.leads.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0]
    palette[kind] = { pPr, rPr: best.rPr, lead, auto: /<a:bu(?:Char|AutoNum)\b/.test(pPr) }
  }
  return palette
}

/**
 * 줄 배치 — 한 장에서 이 행들이 쓰는 데이터 영역(EMU, 보기 행 높이의 합)과 글자 크기(1/100pt).
 * 있으면 엔진이 행을 내용 줄 수로 담고 높이를 나눈다(pptx packRowBlock).
 */
export interface RowLayoutHint { area: number; fontSize: number }

/** 팔레트 → a:ext 원문(a:extLst 안에 넣는다) */
export function encodePalette(palette: LinePalette, layout?: RowLayoutHint): string {
  const styles = KINDS.filter((k) => palette[k]).map((k) => {
    const s = palette[k]!
    return `<dfl:style kind="${k}" lead="${s.lead}" auto="${s.auto ? 1 : 0}">${s.pPr}${s.rPr}</dfl:style>`
  }).join('')
  const attrs = layout ? ` area="${Math.round(layout.area)}" sz="${Math.round(layout.fontSize)}"` : ''
  return `<a:ext uri="${LINE_STYLE_URI}"><dfl:lineStyles xmlns:dfl="${NS}"${attrs}>${styles}</dfl:lineStyles></a:ext>`
}

function decodePalette(ext: string): LinePalette {
  const palette: LinePalette = {}
  for (const m of ext.matchAll(/<dfl:style kind="(\w+)" lead="(\d+)" auto="([01])">([\s\S]*?)<\/dfl:style>/g)) {
    const kind = m[1] as LineKind
    if (!KINDS.includes(kind)) continue
    palette[kind] = { pPr: PPR_RE.exec(m[4])?.[0] ?? '', rPr: RPR_RE.exec(m[4])?.[0] ?? '', lead: Number(m[2]), auto: m[3] === '1' }
  }
  return palette
}

const EXT_RE = new RegExp(`<a:ext uri="${LINE_STYLE_URI.replace(/[{}-]/g, (c) => `\\${c}`)}">[\\s\\S]*?</a:ext>`)

/** 칸(<a:tc>)의 tcPr 확장 목록에 팔레트를 넣는다(extLst 는 tcPr 의 마지막 자식). 이미 있으면 바꾼다. */
export function attachPalette(cellXml: string, palette: LinePalette, layout?: RowLayoutHint): string {
  if (!Object.keys(palette).length && !layout) return cellXml
  const ext = encodePalette(palette, layout)
  const cleaned = cellXml.replace(EXT_RE, '')
  const selfClosing = /<a:tcPr\b([^>]*)\/>/.exec(cleaned)
  if (selfClosing) return cleaned.replace(selfClosing[0], `<a:tcPr${selfClosing[1]}><a:extLst>${ext}</a:extLst></a:tcPr>`)
  if (/<a:tcPr\b[^>]*>/.test(cleaned)) {
    if (/<a:extLst>[\s\S]*?<\/a:extLst>\s*<\/a:tcPr>/.test(cleaned)) return cleaned.replace(/<\/a:extLst>(\s*<\/a:tcPr>)/, `${ext}</a:extLst>$1`)
    return cleaned.replace(/<\/a:tcPr>/, `<a:extLst>${ext}</a:extLst></a:tcPr>`)
  }
  return cleaned.replace(/<\/a:tc>$/, `<a:tcPr><a:extLst>${ext}</a:extLst></a:tcPr></a:tc>`)
}

function normalizeText(text: string, kind: LineKind, style: LineStyle): string {
  let t = text.trimStart()
  if (style.auto && kind === 'label') t = t.replace(new RegExp(`^[${BULLET_GLYPHS}]\\s*`), '')
  if (style.auto && kind === 'item') t = t.replace(/^[–—\-−]\.?\s*/, '')
  return ' '.repeat(style.lead) + t
}

function restyleParagraph(p: string, kind: LineKind, style: LineStyle): string {
  const text = paragraphText(p)
  if (!text.trim()) return p
  const open = /^<a:p\b[^>]*>/.exec(p)?.[0] ?? '<a:p>'
  const oldPPr = PPR_RE.exec(p)?.[0] ?? ''
  const run = /<a:r\b[^>]*>[\s\S]*?<\/a:r>/.exec(p)?.[0] ?? ''
  const rPr = style.rPr || (RPR_RE.exec(run)?.[0] ?? '')
  const end = /<a:endParaRPr\b[^>]*\/>|<a:endParaRPr\b[^>]*>[\s\S]*?<\/a:endParaRPr>/.exec(p)?.[0] ?? ''
  return `${open}${style.pPr || oldPPr}<a:r>${rPr}<a:t>${escapeText(normalizeText(text, kind, style))}</a:t></a:r>${end}</a:p>`
}

/** 줄 높이 — 글자 크기 × 1.3(줄 간격·문단 앞 간격 여유). 행 위아래 여백 0.1in */
const LINE_FACTOR = 1.3
const ROW_PAD = 91440

/** 행(<a:tr>) 칸의 줄 배치 힌트 → 엔진이 쓰는 EMU 값. 없으면 null */
export function rowLayoutOf(rowXml: string): { area: number; line: number; pad: number } | null {
  if (!rowXml.includes(LINE_STYLE_URI)) return null
  const m = /<dfl:lineStyles\b[^>]*\barea="(\d+)"[^>]*\bsz="(\d+)"/.exec(rowXml)
  if (!m) return null
  const area = Number(m[1])
  const line = (Number(m[2]) / 100) * 12700 * LINE_FACTOR
  if (!(area > 0) || !(line > 0)) return null
  return { area, line, pad: ROW_PAD }
}

/**
 * 그려진 XML 의 칸 가운데 팔레트가 붙은 칸의 문단에 줄 종류별 서식을 입히고 팔레트를 지운다.
 * 팔레트가 없는 칸·종류는 그대로 둔다.
 */
export function applyLineStyles(xml: string): string {
  if (!xml.includes(LINE_STYLE_URI)) return xml
  return xml.replace(/<a:tc\b[^>]*>[\s\S]*?<\/a:tc>/g, (cell) => {
    const ext = EXT_RE.exec(cell)?.[0]
    if (!ext) return cell
    const palette = decodePalette(ext)
    const withoutExt = cell.replace(EXT_RE, '').replace(/<a:extLst>\s*<\/a:extLst>/, '')
    const body = /<a:txBody\b[^>]*>[\s\S]*?<\/a:txBody>/.exec(withoutExt)?.[0]
    if (!body) return withoutExt
    const paras = [...body.matchAll(P_RE)].map((m) => m[0])
    const kinds = classifyLines(paras.map(paragraphText))
    let i = 0
    const styled = body.replace(P_RE, (p) => {
      const kind = kinds[i++]
      const style = palette[kind]
      return style ? restyleParagraph(p, kind, style) : p
    })
    return withoutExt.replace(body, styled)
  })
}
