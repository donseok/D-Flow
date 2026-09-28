import { redirect } from 'next/navigation'
import { getActorForView } from '@/lib/authz'
import { isProjectAdmin, isProjectMember, toProjectActorView } from '@/lib/domain/authz'
import { getAgentHub } from '@/lib/data/agentHub'
import { getComputedWbs } from '@/lib/data/wbs'
import { loadProjectConfigForPage, pick } from '@/lib/settings/pageConfig'
import { levelDepthOf } from '@/lib/settings/projectConfig'
import { getServerLocale } from '@/lib/i18n/server'
import { getProjectRoster } from '@/lib/data/members'
import { AgentHubView } from '@/components/agent-hub/AgentHubView'
import { ConfigLoadError } from '@/components/settings/ConfigLoadError'

export const dynamic = 'force-dynamic' // 위임·주문 상태는 항상 최신이어야 한다

/**
 * 프로젝트 에이전트 허브 — 켜기/중지·위임(단건·일괄)·프롬프트·승인을 한 화면에(좌석 층은 /agents/office, 2026-09-14 허브 스펙).
 * 멤버 이상만 — 조회 전용은 대시보드로. 판정은 isProjectMember 한 곳(사이드바는 프로젝트 목록 자체가 멤버 기준).
 * 이름 클릭 시 여는 WBS 상세 패널을 위해 계산된 WBS(getComputedWbs)·설정·로스터를 허브와 함께 병렬 로드해 넘긴다(2026-09-15).
 */
export default async function ProjectAgentsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const actor = await getActorForView()
  if (!actor || !isProjectMember(actor, projectId)) redirect(`/p/${projectId}/dashboard`)
  // 조회 실패는 throw → Next 의 error 경계가 받는다. 빈 허브로 위장하지 않는다.
  const [hub, wbsData, pc, roster, locale] = await Promise.all([
    getAgentHub(projectId, { userId: actor.userId, isAdmin: isProjectAdmin(actor, projectId) }),
    getComputedWbs(projectId),
    loadProjectConfigForPage(projectId),
    getProjectRoster(projectId),
    getServerLocale(),
  ])
  // 상세 패널의 트리 깊이·라벨을 기본값으로 채우지 않는다(스펙 §3.5) — 설정 실패·단계 이름 손상이면 허브 대신 사유를 그린다.
  if (!pc.ok) return <div className="p-6"><ConfigLoadError error={pc.error} locale={locale} /></div>
  const labels = pick(pc.cfg, 'core.level_labels')
  if (!labels.ok) return <div className="p-6"><ConfigLoadError error={labels.error} keyName={labels.key} locale={locale} /></div>
  // 명단은 상세 패널의 담당자 선택용 곁가지 — 실패해도 허브는 그리고, 사유는 허브가 표 위에 띄운다.
  if (!roster.ok) console.error(`[agents] 명단 조회 실패(project=${projectId}) — 담당자 목록 없이 그리고 경고를 띄운다`)
  const wbs = {
    items: wbsData.items,
    dependencies: wbsData.dependencies,
    unresolvedDepends: wbsData.unresolvedDepends,
    holidays: wbsData.holidays,
    today: wbsData.today,
    levelLabels: labels.value,
    maxDepth: levelDepthOf(pc.cfg),
    members: roster.ok ? roster.rows : [],
    membersError: roster.ok ? null : roster.error,
    actorView: toProjectActorView(actor, projectId),
  }
  // 공통 헤더(탭·요약·타일)는 뷰가 그린다 — 타일이 뷰의 최신 허브 상태를 따라가야 한다(AgentFrame).
  return <AgentHubView initial={hub} wbs={wbs} />
}
