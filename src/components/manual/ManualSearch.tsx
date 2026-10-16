import Link from 'next/link'
import { t } from '@/lib/i18n/dict'
import type { ManualHit } from '@/lib/manual/search'
import { MANUAL_QUERY_MAX } from '@/lib/manual/search'

const INPUT_ID = 'manual-search-q'

/** 찾은 절로 가는 주소 — 절 id 는 한글이라 조각(#)에 실을 때 인코딩한다(브라우저는 인코딩된 조각을 풀린 id 와 맞춘다) */
function hitHref(h: ManualHit): string {
  return `/help/${h.slug}${h.sectionId ? `#${encodeURIComponent(h.sectionId)}` : ''}`
}

/**
 * 매뉴얼 낱말 찾기 — 서버 컴포넌트. 양식은 GET /help?q= 라 자바스크립트 없이 돈다.
 * hits 가 null 이면 검색 중이 아니므로 결과 영역을 그리지 않는다. 0건이면 없다는 안내와 팁.
 */
export function ManualSearch({ q, hits }: { q: string; hits: ManualHit[] | null }) {
  return (
    <div className="space-y-4">
      <form action="/help" method="get" role="search" className="flex flex-wrap items-end gap-2">
        <div className="min-w-48 flex-1">
          <label htmlFor={INPUT_ID} className="mb-1.5 block text-xs font-semibold text-fg-secondary">{t('manual.search.label')}</label>
          <input id={INPUT_ID} name="q" type="search" className="app-input" defaultValue={q} maxLength={MANUAL_QUERY_MAX} placeholder={t('manual.search.placeholder')} />
        </div>
        <button type="submit" className="btn btn-primary">{t('manual.search.submit')}</button>
      </form>

      {hits !== null && (
        <section className="space-y-3">
          {hits.length > 0 ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-section text-fg">{t('manual.search.results').replace('{q}', () => q).replace('{n}', String(hits.length))}</h2>
                <Link href="/help" className="text-control font-semibold text-action underline underline-offset-2 hover:text-action-hover">{t('manual.search.clear')}</Link>
              </div>
              <ol className="divide-y divide-border rounded-(--radius-panel) border border-border bg-surface">
                {hits.map((h, i) => (
                  <li key={`${h.slug}#${h.sectionId ?? ''}#${i}`} className="px-4 py-3">
                    <Link href={hitHref(h)} className="text-control font-semibold text-action underline underline-offset-2 hover:text-action-hover">
                      {h.sectionTitle ? `${h.chapterTitle} › ${h.sectionTitle}` : h.chapterTitle}
                    </Link>
                    {h.excerpt && <p className="mt-1 text-body text-fg-secondary">{h.excerpt}</p>}
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <div className="space-y-1 rounded-(--radius-panel) border border-border bg-surface p-4">
              <p className="text-body font-semibold text-fg">{t('manual.search.empty').replace('{q}', () => q)}</p>
              <p className="text-body text-fg-secondary">{t('manual.search.tip')}</p>
              <Link href="/help" className="inline-block pt-1 text-control font-semibold text-action underline underline-offset-2 hover:text-action-hover">{t('manual.search.clear')}</Link>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
