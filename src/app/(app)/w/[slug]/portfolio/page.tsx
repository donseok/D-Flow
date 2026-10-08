import { after } from 'next/server'
import { redirect } from 'next/navigation'
import { loadWorkspaceScope } from '@/lib/authz/workspaceScope'
import { canViewPortfolio } from '@/lib/authz/portfolioAccess'
import { createServerClient } from '@/lib/supabase/server'
import { recordProgressSnapshot } from '@/lib/data/snapshots'
import { getPortfolioInputs } from '@/lib/data/portfolio'
import { buildPortfolio } from '@/lib/domain/portfolio'
import { PageHeader } from '@/components/app/PageHeader'
import { PortfolioKpis } from '@/components/portfolio/PortfolioKpis'
import { PortfolioTable } from '@/components/portfolio/PortfolioTable'
import { PortfolioMilestoneBoard } from '@/components/portfolio/PortfolioMilestoneBoard'
import { getServerLocale } from '@/lib/i18n/server'
import { t } from '@/lib/i18n/dict'
import { todayIn } from '@/lib/domain/calendar'
import { viewTimezone } from '@/lib/calendar/viewZone'
import { ConfigLoadError } from '@/components/settings/ConfigLoadError'
import { requireModulePage } from '@/lib/modules/pageGate'
import { wsHref } from '@/lib/workspace/paths'

export const dynamic = 'force-dynamic' // 워크스페이스 비교 화면은 항상 최신이어야 한다
export const metadata = { title: '포트폴리오' }   // 레이아웃 템플릿이 ' · {워크스페이스} | {제품}' 을 붙인다(V6)

export default async function PortfolioPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const scope = await loadWorkspaceScope(slug)                                  // 첫 await — 비소속 404
  // 화면 권한 현행(플랫폼 관리자 — canViewPortfolio 한 곳). 거부는 그 워크스페이스 홈(D7)
  if (!canViewPortfolio(scope.actor)) redirect(wsHref(scope.ws.slug))
  await requireModulePage({ workspaceId: scope.ws.id }, 'portfolio')

  // 실제 오늘의 tz = 이 워크스페이스의 달력(계획 D-22b·D-22d). 달력 손상이면 그 사유를 그린다
  const [vz, locale] = await Promise.all([viewTimezone(scope.ws.id), getServerLocale()])
  if (!vz.ok) return <ConfigLoadError error={vz.error} keyName={vz.key} kind="invalid" locale={locale} />
  const realToday = todayIn(vz.timeZone, new Date())
  // 입력은 슬러그 워크스페이스의 프로젝트만(D21)
  const { inputs, leadersDegraded, listDegraded } = await getPortfolioInputs(scope.ws.id, realToday)
  const model = buildPortfolio(inputs)

  // 포트폴리오 조회를 스냅샷 기회로 — 아무도 열지 않는 프로젝트의 이력 공백을 메운다.
  // after() 안에서는 cookies() 불가라 client 를 밖에서 만들어 넘긴다(recordProgressSnapshot 관례).
  const sb = await createServerClient()
  // 5개씩 순차 청크 — 전 프로젝트 동시 팬아웃은 커넥션 풀을 고갈시킬 수 있다
  // (작은 DB 사양에서 PostgREST 풀이 고갈된 이력).
  after(async () => {
    for (let i = 0; i < inputs.length; i += 5) {
      await Promise.all(inputs.slice(i, i + 5).map(x => recordProgressSnapshot(x.projectId, sb)))
    }
  })

  return (
    <div className="space-y-6 pb-10">
      <PageHeader title={t(locale, 'pf.title')} />
      {listDegraded && (
        <div className="rounded-xl border border-danger/40 bg-danger-weak px-4 py-3 text-xs font-medium text-danger">
          {t(locale, 'pf.listDegraded')}
        </div>
      )}
      <PortfolioKpis totals={model.totals} locale={locale} />
      <PortfolioTable rows={model.rows} leadersDegraded={leadersDegraded} locale={locale} />
      {/* 통합 축의 오늘 마커는 실제 오늘 — 행별 마일스톤 상태(dday)는 각 프로젝트 today 로 이미 판정됨 */}
      <PortfolioMilestoneBoard rows={model.rows} milestones={model.milestones} today={realToday} locale={locale} />
    </div>
  )
}
