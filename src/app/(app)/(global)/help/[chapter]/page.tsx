import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getActorViewState } from '@/lib/authz'
import { manualViewer } from '@/lib/authz/manualAccess'
import { canSee, manualChapter, visibleChapters } from '@/lib/manual/chapters'
import { t } from '@/lib/i18n/dict'
import { PageHeader } from '@/components/app/PageHeader'
import { StatusMessage } from '@/components/ui/StatusMessage'
import { ManualArticle } from '@/components/manual/ManualArticle'
import { ManualBadge } from '@/components/manual/ManualBadge'
import { ManualChapterNav } from '@/components/manual/ManualChapterNav'
import { withAudience } from '@/components/manual/labels'

export const dynamic = 'force-dynamic'
export async function generateMetadata({ params }: { params: Promise<{ chapter: string }> }) {
  const c = manualChapter((await params).chapter)
  return { title: c ? c.title : t('manual.title') }
}

/** 왼쪽 목차는 넓고 키 큰 화면에서만 따라온다 — 키가 작으면 목차가 화면보다 길어 아래 장에 닿지 못한다(페이지 안에 세로 스크롤을 두지 않는다: tests/invariants/scroll-owner) */
const NAV_STICKY = '[@media(min-width:64rem)_and_(min-height:56rem)]:sticky [@media(min-width:64rem)_and_(min-height:56rem)]:top-4'
const PAGER_LINK = 'flex min-w-0 flex-col rounded-(--radius-panel) border border-border bg-surface px-4 py-3 hover:bg-surface-hover'

/** 사용자 매뉴얼 장(스펙 §2.3). 상위 등급 장도 숨기지 않고 안내를 붙인다(매뉴얼은 비밀이 아니다 — 목차 숨김은 편의). 없는 장은 404. */
export default async function ManualChapterPage({ params }: { params: Promise<{ chapter: string }> }) {
  const [state, { chapter: slug }] = await Promise.all([getActorViewState(), params])
  const chapter = manualChapter(slug)
  if (!chapter) notFound()
  const viewer = manualViewer(state)
  const visible = visibleChapters(viewer.audience)
  const i = visible.findIndex((c) => c.slug === chapter.slug)
  const prev = i > 0 ? visible[i - 1] : null
  const next = i >= 0 && i < visible.length - 1 ? visible[i + 1] : null
  // '이 장의 내용'은 큰 절(##)만 — 긴 장은 소절까지 합치면 50줄 가까이 돼 본문이 한참 밀린다(2026-10-16 눈확인). 소절은 본문에서 앵커로 그대로 간다
  const tocSections = chapter.sections.filter((s) => s.depth === 2)
  return (
    <div className="space-y-6">
      <PageHeader
        title={chapter.title}
        description={chapter.summary}
        meta={chapter.audience !== 'member' ? <ManualBadge audience={chapter.audience} /> : undefined}
      />
      <div className="grid gap-6 lg:grid-cols-[14rem_minmax(0,1fr)] lg:items-start">
        <div className={NAV_STICKY}>
          <ManualChapterNav chapters={visible} current={chapter.slug} />
        </div>
        <article className="min-w-0 space-y-6">
          {viewer.uncertain && <StatusMessage kind="partial_error" title={t('manual.viewerUncertain')} compact />}
          {!canSee(viewer.audience, chapter.audience) && (
            <p role="note" className="rounded-(--radius-panel) border border-warning/40 bg-warning-weak p-3 text-body text-fg">
              {withAudience('manual.aboveAudience', chapter.audience)}
            </p>
          )}
          {tocSections.length > 0 && (
            <nav aria-label={t('manual.toc')} className="rounded-(--radius-panel) border border-border bg-surface p-4">
              <p className="mb-2 text-control font-semibold text-fg">{t('manual.toc')}</p>
              <ol className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                {tocSections.map((s) => (
                  <li key={s.id}>
                    <a href={`#${encodeURIComponent(s.id)}`} className="text-control text-action underline-offset-2 hover:underline">{s.title}</a>
                  </li>
                ))}
              </ol>
            </nav>
          )}
          <div className="rounded-(--radius-panel) border border-border bg-surface px-4 py-4 sm:px-6 sm:py-5">
            <div className="max-w-[46rem]">
              <ManualArticle body={chapter.body} />
            </div>
          </div>
          <nav data-manual-pager="" aria-label={t('manual.pager')} className="grid gap-3 sm:grid-cols-3">
            {prev ? (
              <Link href={`/help/${prev.slug}`} className={PAGER_LINK}>
                <span className="text-meta text-fg-muted">{t('manual.prev')}</span>
                <span className="text-control font-semibold text-fg">{prev.title}</span>
              </Link>
            ) : <span aria-hidden className="hidden sm:block" />}
            <Link href="/help" className={`${PAGER_LINK} sm:items-center`}>
              <span className="text-control font-semibold text-fg">{t('manual.home')}</span>
            </Link>
            {next ? (
              <Link href={`/help/${next.slug}`} className={`${PAGER_LINK} sm:items-end sm:text-right`}>
                <span className="text-meta text-fg-muted">{t('manual.next')}</span>
                <span className="text-control font-semibold text-fg">{next.title}</span>
              </Link>
            ) : <span aria-hidden className="hidden sm:block" />}
          </nav>
        </article>
      </div>
    </div>
  )
}
