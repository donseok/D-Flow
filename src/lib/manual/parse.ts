/* ── 사용자 매뉴얼 장 해석(순수) — 머리말·절·검색 평문. I/O 없음. 원본은 src/content/manual/NN-slug.md(스펙 2026-10-16 §4.1). ── */

export const MANUAL_AUDIENCES = ['member', 'projectAdmin', 'workspaceAdmin', 'platformAdmin'] as const
export type ManualAudience = (typeof MANUAL_AUDIENCES)[number]
export const MANUAL_PARTS = ['start', 'daily', 'projectAdmin', 'workspaceAdmin', 'platformAdmin', 'help'] as const
export type ManualPart = (typeof MANUAL_PARTS)[number]

export interface ManualSection { id: string; title: string; depth: 2 | 3 }
/** 검색 단위 — 절 하나의 평문(첫 절 앞의 들어가는 말은 sectionId null) */
export interface ManualBlock { sectionId: string | null; sectionTitle: string | null; text: string }
export interface ManualChapter {
  file: string; slug: string; order: number
  title: string; part: ManualPart; audience: ManualAudience; summary: string
  /** 머리말을 뺀 마크다운 */
  body: string
  sections: ManualSection[]
  blocks: ManualBlock[]
}

export function audienceRank(a: ManualAudience): number {
  return MANUAL_AUDIENCES.indexOf(a)
}

/** 제목 → 앵커. 한글·영숫자만 남기고 공백은 -. 화면(ManualArticle)과 같은 함수를 써야 목차 링크가 맞는다 */
export function headingSlug(text: string): string {
  const s = text.trim().toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  return s || 'section'
}

/**
 * 한 장 안에서 유일한 앵커 — 같은 제목 두 번째부터 -2, -3. 이미 쓴 id 를 기억해 빈 번호를 고른다
 * (제목 `가`·`가`·`가-2` 가 같은 id 를 만들지 않는다). 화면(ManualArticle)도 이 함수를 그대로 쓴다 — 앵커의 단일 원천.
 */
export function createSlugger(): (text: string) => string {
  const used = new Set<string>()
  const lastSuffix = new Map<string, number>()
  return (text) => {
    const base = headingSlug(text)
    let id = base
    let n = lastSuffix.get(base) ?? 1
    while (used.has(id)) { n++; id = `${base}-${n}` }
    lastSuffix.set(base, n)
    used.add(id)
    return id
  }
}

const FILE_RE = /^(\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/
const HEADING_RE = /^(#{2,3})\s+(.+?)(?:\s+#+)?\s*$/   // 닫는 # 은 앞에 공백이 있을 때만(`C#` 은 제목 그대로)

function fail(file: string, msg: string): never {
  throw new Error(`[manual] ${file}: ${msg}`)
}

/** 표 구분 줄(`|---|:---:|`)과 가로줄(`---`) — 검색 평문에 넣지 않는다 */
const TABLE_SEP_RE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/

/** 마크다운 한 줄 → 검색용 평문(표기 기호 제거) */
function plainLine(line: string): string {
  if (TABLE_SEP_RE.test(line)) return ''
  return line
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]/g, '')
    .replace(/\|/g, ' ')
    .replace(/^\s*:?-{3,}:?\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const FENCE_RE = /^\s*(`{3,}|~{3,})(.*)$/

/**
 * 본문을 줄로 나누며 코드 펜스 안(여는·닫는 줄 포함)인지 표시한다.
 * 펜스는 여는 표지와 같은 글자(` 또는 ~)이고 길이가 같거나 긴 표지만 닫는다(닫는 줄에 다른 글자가 붙으면 닫지 않는다).
 */
function scanLines(body: string): { line: string; code: boolean }[] {
  const out: { line: string; code: boolean }[] = []
  let open: { ch: string; len: number } | null = null
  for (const line of body.split('\n')) {
    const f = FENCE_RE.exec(line)
    if (open) {
      if (f && f[1][0] === open.ch && f[1].length >= open.len && f[2].trim() === '') open = null
      out.push({ line, code: true })
    } else if (f && !(f[1][0] === '`' && f[2].includes('`'))) {   // 백틱 펜스의 안내 글에는 백틱이 없다(한 줄 코드와 구분)
      open = { ch: f[1][0], len: f[1].length }
      out.push({ line, code: true })
    } else {
      out.push({ line, code: false })
    }
  }
  return out
}

/** 바로 아래 줄이 `===`·`---` 면 제목이 되어 버리는 평범한 문단 줄인가 */
function isParagraphLine(line: string): boolean {
  if (!line.trim() || /^ {4,}|^\t/.test(line)) return false
  return !/^\s*(?:#|>|\||<|[-*+]\s|\d+[.)]\s|[-=]+\s*$)/.test(line)
}

/**
 * 마크다운은 제목으로 그리지만 해석기가 절로 세지 않는 모양 — 밑줄 제목(`제목` 아래 `===`·`---`)과 들여쓴 `#`~`###`.
 * 화면은 ##·### 만 앵커를 달므로 이런 줄은 목차·검색과 어긋난다. 내용 검사(tests/manual/content.test.ts)가 쓴다.
 */
export function findIgnoredHeadings(body: string): string[] {
  const out: string[] = []
  let prev: string | null = null
  for (const { line, code } of scanLines(body)) {
    if (code) { prev = null; continue }
    if (/^ {1,3}#{1,3}\s+\S/.test(line)) out.push(`들여쓴 제목: ${line.trim()}`)
    if (prev !== null && /^ {0,3}(?:=+|-+)\s*$/.test(line)) out.push(`밑줄 제목: ${prev.trim()}`)
    prev = isParagraphLine(line) ? line : null
  }
  return out
}

export function parseChapter(file: string, raw: string): ManualChapter {
  const m = FILE_RE.exec(file)
  if (!m) fail(file, '파일 이름은 NN-slug.md 꼴이어야 한다')
  const text = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const fm = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text)
  if (!fm) fail(file, '머리말(--- … ---)이 없다')
  const meta: Record<string, string> = {}
  for (const line of fm[1].split('\n')) {
    const kv = /^([a-z]+):\s*(.*?)\s*$/.exec(line)
    if (kv) meta[kv[1]] = kv[2]
  }
  for (const key of ['title', 'part', 'audience', 'summary']) if (!meta[key]) fail(file, `머리말에 ${key} 가 없다`)
  if (!(MANUAL_PARTS as readonly string[]).includes(meta.part)) fail(file, `part 값이 틀렸다: ${meta.part}`)
  if (!(MANUAL_AUDIENCES as readonly string[]).includes(meta.audience)) fail(file, `audience 값이 틀렸다: ${meta.audience}`)

  const body = text.slice(fm[0].length).replace(/^\n+/, '')
  const slugger = createSlugger()
  const sections: ManualSection[] = []
  const blocks: ManualBlock[] = []
  let cur: ManualBlock = { sectionId: null, sectionTitle: null, text: '' }
  for (const { line, code } of scanLines(body)) {
    if (code) continue
    const h = HEADING_RE.exec(line)
    if (h) {
      const title = h[2]
      const id = slugger(title)
      sections.push({ id, title, depth: h[1].length as 2 | 3 })
      blocks.push({ ...cur, text: cur.text.trim() })   // 본문 없는 절(바로 아래가 소절)도 블록으로 남겨 제목 검색에 잡힌다
      cur = { sectionId: id, sectionTitle: title, text: '' }
      continue
    }
    if (/^#\s/.test(line)) continue          // 장 제목(#)은 머리말 title 이 대신한다
    const p = plainLine(line)
    if (p) cur.text += (cur.text ? ' ' : '') + p
  }
  blocks.push({ ...cur, text: cur.text.trim() })

  return {
    file, slug: m[2], order: Number(m[1]),
    title: meta.title, part: meta.part as ManualPart, audience: meta.audience as ManualAudience, summary: meta.summary,
    body, sections, blocks: blocks.filter((b) => b.sectionId !== null || b.text),   // 비어 있는 들어가는 말 블록만 버린다
  }
}
