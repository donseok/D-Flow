import Link from 'next/link'
import { loadWorkspaceScope } from '@/lib/authz/workspaceScope'
import { getMyWork, getPortalSummary } from '@/lib/data/portal'
import { MY_WORK_KINDS, type MyWorkKind } from '@/lib/portal/myWork'
import { wsHref } from '@/lib/workspace/paths'
import { PageFrame } from '@/components/app/PageFrame'
import { PageHeader } from '@/components/app/PageHeader'
import { KIND_LABEL_KEY, MyWorkList } from '@/components/portal/MyWorkList'
import { MyWorkTabNav, MyWorkInboxView, type MyWorkTabId } from '@/components/portal/MyWorkTabs'
import { StatusMessage } from '@/components/ui/StatusMessage'
import { buttonClass } from '@/components/ui/buttonStyles'
import { t } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'
import { translatorFor } from '@/lib/i18n/translate'
import { failureTextIn } from '@/lib/i18n/serverText'

/** 탭 제목 — 화면 언어를 따른다(ko 는 종전의 '내 업무') */
export async function generateMetadata() { return { title: t(await getServerLocale(), 'nav.myWork') } } // 레이아웃 템플릿이 ' · {워크스페이스} | {제품}' 을 붙인다(V6)
const isKind = (k: string): k is MyWorkKind => (MY_WORK_KINDS as readonly string[]).includes(k)

/**
 * 내 업무 완성 (개정 §5.9.1, D5-§3, SPU2)
 * - 3단 탭: 내 작업(?tab=work) · 검토 대기(?tab=review) · 알림함(?tab=inbox)
 * - 종류는 쉼표 목록(?kind=wbs,issue — '내 담당'), ?due=today 는 작업·이슈 가운데 기한이 그 프로젝트의 오늘인 것
 * - 50행 쪽 나눔, 알림함 패널 임베드 연동
 */
export default async function MyWorkPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ kind?: string; cursor?: string; due?: string; tab?: string }>
}) {
  const { slug } = await params
  const scope = await loadWorkspaceScope(slug) // 첫 await — 비소속 404
  const [q, locale] = await Promise.all([searchParams, getServerLocale()])

  const tab: MyWorkTabId = q.tab === 'review' || q.tab === 'inbox' ? q.tab : 'work'
  const kinds =
    tab === 'review'
      ? ['approval' as MyWorkKind]
      : [...new Set((typeof q.kind === 'string' ? q.kind.split(',') : []).map((k) => k.trim()).filter(isKind))]
  const kindKey = kinds.length && tab !== 'review' ? kinds.join(',') : null // 정규화한 거르기
  const dueToday = q.due === 'today'
  const cursor = typeof q.cursor === 'string' ? q.cursor : null

  const res =
    scope.actor && tab !== 'inbox'
      ? failureTextIn(locale, await getMyWork(scope.ws.id, scope.actor, {
          kinds: kinds.length ? kinds : undefined,
          cursor,
          limit: 50,
          dueToday,
        }))   // 로더의 실패 문구(lib 고정 문구)는 화면 언어로
      : null

  let reviewCount: number | undefined
  if (scope.actor && typeof getPortalSummary === 'function') {
    try {
      const summary = await getPortalSummary(scope.ws.id, scope.actor, { t: translatorFor(locale) })
      if (summary?.review?.ok) reviewCount = summary.review.count
    } catch {}
  }

  /** 칩 — 그 쿼리와 정확히 같을 때만 현재(aria-current) */
  const chip = (k: string | null, due: boolean, label: string) => (
    <Link
      key={label}
      href={wsHref(scope.ws.slug, 'my-work', { kind: k, due: due ? 'today' : null })}
      aria-current={kindKey === k && dueToday === due ? 'page' : undefined}
      className={`chip ${
        kindKey === k && dueToday === due ? 'bg-surface-selected text-fg' : 'text-fg-secondary'
      }`}
    >
      {label}
    </Link>
  )

  return (
    <PageFrame
      width="portal"
      header={<PageHeader title={t(locale, 'nav.myWork')} />}
      toolbar={
        <div className="space-y-3">
          <MyWorkTabNav slug={scope.ws.slug} currentTab={tab} reviewCount={reviewCount} />
          {tab === 'work' && (
            <nav aria-label={t(locale, 'pages.myWork.kindNav')} className="flex flex-wrap gap-2">
              {chip(null, false, t(locale, 'pages.myWork.chipAll'))}
              {chip('wbs,issue', false, t(locale, 'pages.myWork.chipMine'))}
              {chip(null, true, t(locale, 'pages.myWork.chipDueToday'))}
              {MY_WORK_KINDS.map((k) => chip(k, false, t(locale, KIND_LABEL_KEY[k])))}
            </nav>
          )}
        </div>
      }
    >
      {tab === 'inbox' ? (
        <MyWorkInboxView />
      ) : res?.ok ? (
        <div className="space-y-4 pb-8">
          <MyWorkList
            locale={locale}
            rows={res.rows}
            failedKinds={res.failedKinds}
            empty={
              tab === 'review'
                ? t(locale, 'pages.myWork.emptyReview')
                : dueToday
                ? t(locale, 'pages.myWork.emptyDueToday')
                : t(locale, 'pages.myWork.empty')
            }
          />
          {res.nextCursor && (
            <Link
              href={wsHref(scope.ws.slug, 'my-work', {
                tab: tab === 'review' ? 'review' : null,
                kind: kindKey,
                due: dueToday ? 'today' : null,
                cursor: res.nextCursor,
              })}
              className={buttonClass('ghost')}
            >
              {t(locale, 'pages.common.more')}
            </Link>
          )}
        </div>
      ) : (
        <StatusMessage
          kind="partial_error"
          blocking
          title={t(locale, 'pages.myWork.loadFailed')}
          detail={t(locale, res ? 'pages.common.refreshLater' : 'pages.myWork.noActorDetail')}
        />
      )}
    </PageFrame>
  )
}
