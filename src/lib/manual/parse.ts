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

/** 한 장 안에서 유일한 앵커 — 같은 제목 두 번째부터 -2, -3 */
export function createSlugger(): (text: string) => string {
  const seen = new Map<string, number>()
  return (text) => {
    const base = headingSlug(text)
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    return n === 1 ? base : `${base}-${n}`
  }
}

const FILE_RE = /^(\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/
const HEADING_RE = /^(#{2,3})\s+(.+?)\s*#*\s*$/

function fail(file: string, msg: string): never {
  throw new Error(`[manual] ${file}: ${msg}`)
}

/** 마크다운 한 줄 → 검색용 평문(표기 기호 제거) */
function plainLine(line: string): string {
  return line
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]/g, '')
    .replace(/\|/g, ' ')
    .replace(/^\s*:?-{3,}:?\s*$/, '')
    .trim()
}

export function parseChapter(file: string, raw: string): ManualChapter {
  const m = FILE_RE.exec(file)
  if (!m) fail(file, '파일 이름은 NN-slug.md 꼴이어야 한다')
  const text = raw.replace(/\r\n?/g, '\n')
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(text)
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
  let inFence = false
  for (const line of body.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; continue }
    const h = inFence ? null : HEADING_RE.exec(line)
    if (h) {
      const title = h[2]
      const id = slugger(title)
      sections.push({ id, title, depth: h[1].length as 2 | 3 })
      if (cur.text.trim() || cur.sectionId === null) blocks.push({ ...cur, text: cur.text.trim() })
      cur = { sectionId: id, sectionTitle: title, text: '' }
      continue
    }
    if (/^#\s/.test(line) && !inFence) continue          // 장 제목(#)은 머리말 title 이 대신한다
    const p = plainLine(line)
    if (p) cur.text += (cur.text ? ' ' : '') + p
  }
  blocks.push({ ...cur, text: cur.text.trim() })

  return {
    file, slug: m[2], order: Number(m[1]),
    title: meta.title, part: meta.part as ManualPart, audience: meta.audience as ManualAudience, summary: meta.summary,
    body, sections, blocks: blocks.filter((b) => b.text || b.sectionId !== null),
  }
}
