/* ── 사용자 매뉴얼 장 목록 — 생성 모듈을 한 번 해석해 순서대로 둔다. 해석 오류는 throw(빈 매뉴얼로 위장하지 않는다 — 테스트가 먼저 잡는다). ── */
import { MANUAL_SOURCES } from '@/content/manual/chapters.generated'
import { audienceRank, parseChapter, type ManualAudience, type ManualChapter } from './parse'

let cache: readonly ManualChapter[] | null = null

export function manualChapters(): readonly ManualChapter[] {
  if (!cache) cache = MANUAL_SOURCES.map((s) => parseChapter(s.file, s.raw)).sort((a, b) => a.order - b.order)
  return cache
}

export function manualChapter(slug: string): ManualChapter | undefined {
  return manualChapters().find((c) => c.slug === slug)
}

export function canSee(viewer: ManualAudience, chapter: ManualAudience): boolean {
  return audienceRank(chapter) <= audienceRank(viewer)
}

export function visibleChapters(viewer: ManualAudience): ManualChapter[] {
  return manualChapters().filter((c) => canSee(viewer, c.audience))
}
