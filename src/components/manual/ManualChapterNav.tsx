import Link from 'next/link'
import { t } from '@/lib/i18n/dict'
import { MANUAL_PARTS, type ManualChapter } from '@/lib/manual/parse'
import { PART_KEY } from './labels'

function ChapterList({ chapters, current }: { chapters: readonly ManualChapter[]; current?: string }) {
  return (
    <div className="space-y-4">
      {MANUAL_PARTS.map((part) => {
        const inPart = chapters.filter((c) => c.part === part)
        if (inPart.length === 0) return null
        return (
          <section key={part}>
            <p className="mb-1 px-2 text-meta font-semibold text-fg-muted">{t(PART_KEY[part])}</p>
            <ul className="space-y-0.5">
              {inPart.map((c) => {
                const active = c.slug === current
                return (
                  <li key={c.slug}>
                    <Link
                      href={`/help/${c.slug}`}
                      aria-current={active ? 'page' : undefined}
                      className={`block rounded-(--radius-control) px-2 py-1.5 text-control ${active ? 'bg-action-soft font-semibold text-action' : 'text-fg-secondary hover:bg-surface-hover hover:text-fg'}`}
                    >
                      {c.title}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

/**
 * 매뉴얼 장 목차 — 부(MANUAL_PARTS 순서)별 묶음. 넓은 화면은 항상 펼친 목록, 좁은 화면은 접이식(details).
 * 두 목록은 같은 장을 싣고, 어느 쪽이 보일지는 반응형 display 하나(hidden lg:block / lg:hidden)로만 가른다 — 숨은 쪽은 접근성 트리에서도 빠진다.
 */
export function ManualChapterNav({ chapters, current }: { chapters: readonly ManualChapter[]; current?: string }) {
  return (
    <>
      <nav aria-label={t('manual.chapters')} className="hidden lg:block">
        <ChapterList chapters={chapters} current={current} />
      </nav>
      <nav aria-label={t('manual.chapters')} className="lg:hidden">
        <details className="rounded-(--radius-panel) border border-border bg-surface">
          <summary className="cursor-pointer px-3 py-2 text-control font-semibold text-fg">{t('manual.chapters')}</summary>
          <div className="border-t border-border p-3">
            <ChapterList chapters={chapters} current={current} />
          </div>
        </details>
      </nav>
    </>
  )
}
