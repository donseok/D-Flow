import Link from 'next/link'
import { getActorViewState } from '@/lib/authz'
import { manualViewer } from '@/lib/authz/manualAccess'
import { visibleChapters } from '@/lib/manual/chapters'
import { MANUAL_PARTS } from '@/lib/manual/parse'
import { normalizeQuery, searchManual } from '@/lib/manual/search'
import { t } from '@/lib/i18n/dict'
import { PageFrame } from '@/components/app/PageFrame'
import { PageHeader } from '@/components/app/PageHeader'
import { StatusMessage } from '@/components/ui/StatusMessage'
import { ManualBadge } from '@/components/manual/ManualBadge'
import { ManualSearch } from '@/components/manual/ManualSearch'
import { PART_KEY, withAudience } from '@/components/manual/labels'

export const dynamic = 'force-dynamic'
export async function generateMetadata() { return { title: t('manual.title') } }   // (global) 레이아웃의 템플릿이 ' | {제품}' 을 붙인다

/** 사용자 매뉴얼 첫 화면·검색(스펙 2026-10-16 §2.2). 로그인만 요구한다 — 모듈 관문 밖(페이지 관문 불변식 제외 목록). */
export default async function ManualHomePage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const [state, sp] = await Promise.all([getActorViewState(), searchParams])
  const viewer = manualViewer(state)
  const chapters = visibleChapters(viewer.audience)
  const q = normalizeQuery(sp.q)
  const hits = q ? searchManual(chapters, q) : null
  return (
    <PageFrame header={<PageHeader title={t('manual.title')} description={t('manual.desc')} />}>
      <div className="space-y-6 pb-6">
        {viewer.uncertain
          ? <StatusMessage kind="partial_error" title={t('manual.viewerUncertain')} compact />
          : <p className="text-body text-fg-secondary">{withAudience('manual.viewer', viewer.audience)}</p>}
        <ManualSearch q={q} hits={hits} />
        {hits === null && (
          <div className="space-y-8">
            {MANUAL_PARTS.map((part) => {
              const inPart = chapters.filter((c) => c.part === part)
              if (inPart.length === 0) return null
              return (
                <section key={part} className="space-y-3">
                  <h2 className="text-section text-fg">{t(PART_KEY[part])}</h2>
                  <ul className="grid gap-3 sm:grid-cols-2">
                    {inPart.map((c) => (
                      <li key={c.slug} className="rounded-(--radius-panel) border border-border bg-surface p-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link href={`/help/${c.slug}`} className="text-section font-semibold text-action underline-offset-2 hover:underline">{c.title}</Link>
                          {c.audience !== 'member' && <ManualBadge audience={c.audience} />}
                        </div>
                        <p className="mt-1 text-body text-fg-secondary">{c.summary}</p>
                      </li>
                    ))}
                  </ul>
                </section>
              )
            })}
          </div>
        )}
      </div>
    </PageFrame>
  )
}
