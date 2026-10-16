/* ── 사용자 매뉴얼 낱말 찾기(순수) — 서버에서 보이는 장만 뒤진다. 공백으로 나눈 낱말이 모두 들어간 절을 찾는다. ── */
import type { ManualChapter } from './parse'

export const MANUAL_QUERY_MAX = 100
const EXCERPT_RADIUS = 50

export interface ManualHit { slug: string; chapterTitle: string; sectionId: string | null; sectionTitle: string | null; excerpt: string }

export function normalizeQuery(q: string | string[] | undefined): string {
  const v = Array.isArray(q) ? q[0] : q
  const spaced = (v ?? '').replace(/\s+/g, ' ').trim()
  // 글자 단위(코드 포인트)로 자른다 — 서로게이트 쌍 가운데를 자르면 주소에 실을 때 encodeURIComponent 가 던진다. 자른 끝의 공백은 다시 뗀다
  return [...spaced].slice(0, MANUAL_QUERY_MAX).join('').trim()
}

function excerptOf(text: string, term: string): string {
  const i = text.toLowerCase().indexOf(term)
  if (i < 0) return text.slice(0, EXCERPT_RADIUS * 2) + (text.length > EXCERPT_RADIUS * 2 ? '…' : '')
  const start = Math.max(0, i - EXCERPT_RADIUS)
  const end = Math.min(text.length, i + term.length + EXCERPT_RADIUS)
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '')
}

/** limit 가 0 이하(또는 숫자가 아님)이면 결과 없음 — slice 의 음수 끝 인덱스로 뒤쪽이 잘려 나가지 않게 한다 */
export function searchManual(chapters: readonly ManualChapter[], query: string, limit = 30): ManualHit[] {
  if (!(limit > 0)) return []
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return []
  const scored: { hit: ManualHit; score: number; rank: number }[] = []
  let rank = 0
  for (const c of chapters) {
    for (const b of c.blocks) {
      rank++
      const title = `${c.title} ${b.sectionTitle ?? ''}`.toLowerCase()
      const hay = `${title} ${b.text.toLowerCase()}`
      if (!terms.every((t) => hay.includes(t))) continue
      const score = terms.filter((t) => title.includes(t)).length
      const firstInText = terms.find((t) => b.text.toLowerCase().includes(t)) ?? terms[0]
      scored.push({ hit: { slug: c.slug, chapterTitle: c.title, sectionId: b.sectionId, sectionTitle: b.sectionTitle, excerpt: excerptOf(b.text, firstInText) }, score, rank })
    }
  }
  return scored.sort((a, b) => b.score - a.score || a.rank - b.rank).slice(0, limit).map((s) => s.hit)
}
