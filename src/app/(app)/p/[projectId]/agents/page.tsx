import { redirect } from 'next/navigation'
import { toCalendarInput } from '@/lib/calendar/load'
import { getActorForView } from '@/lib/authz'
import { isProjectAdmin, isProjectMember, toProjectActorView } from '@/lib/domain/authz'
import { getAgentHub } from '@/lib/data/agentHub'
import { getComputedWbs } from '@/lib/data/wbs'
import { loadProjectConfigForPage } from '@/lib/settings/pageConfig'
import { pick } from '@/lib/settings/pick'
import { levelDepthOf } from '@/lib/settings/projectConfig'
import { getServerLocale } from '@/lib/i18n/server'
import { getProjectRoster } from '@/lib/data/members'
import { AgentHubView } from '@/components/agent-hub/AgentHubView'
import { ConfigLoadError } from '@/components/settings/ConfigLoadError'
import { requireModulePage } from '@/lib/modules/pageGate'

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
  await requireModulePage({ projectId }, 'agents')   // 스펙 §4.2 1행 — 꺼지면 notFound(), 로더보다 앞(R14)
  // 조회 실패는 throw → Next 의 error 경계가 받는다. 빈 허브로 위장하지 않는다.
  const [hub, wbsData, pc, roster, locale] = await Promise.all([
    getAgentHub(projectId, { userId: actor.userId, isAdmin: isProjectAdmin(actor, projectId) }),
    getComputedWbs(projectId),
    loadProjectConfigForPage(projectId),
    getProjectRoster(projectId),
    getServerLocale(),
  ])
  // 상세 패널의 트리 깊이·라벨을 기본값으로 채우지 않는다(스펙 §3.5). 설정 전체 조회 실패면 허브 대신 사유를 그린다.
  if (!pc.ok) return <div className="p-6"><ConfigLoadError error={pc.error} locale={locale} /></div>
  // 단계 이름은 상세 패널만 쓴다 — 손상이면 허브(킬스위치·승인 큐·위임)는 그대로 그리고 패널 자리에만 사유를 띄운다
  // (개정 §2.5 "그 키를 쓰는 기능만 멈춘다"). 허브 전체를 막으면 잘못 도는 에이전트를 UI 로 멈출 길이 없다(최종 리뷰 FN-8).
  const labels = pick(pc.cfg, 'core.level_labels')
  // 명단은 상세 패널의 담당자 선택용 곁가지 — 실패해도 허브는 그리고, 사유는 허브가 표 위에 띄운다.
  if (!roster.ok) console.error(`[agents] 명단 조회 실패(project=${projectId}) — 담당자 목록 없이 그리고 경고를 띄운다`)
  const wbs = {
    items: wbsData.items,
    dependencies: wbsData.dependencies,
    unresolvedDepends: wbsData.unresolvedDepends,
    calendar: toCalendarInput(wbsData.calendar),
    today: wbsData.today,
    levelLabels: labels.ok ? labels.value : null,
    levelsError: labels.ok ? null : { error: labels.error, key: labels.key },
    maxDepth: labels.ok ? levelDepthOf(pc.cfg) : null,
    members: roster.ok ? roster.rows : [],
    membersError: roster.ok ? null : roster.error,
    actorView: toProjectActorView(actor, projectId),
  }
  // 공통 헤더(탭·요약·타일)는 뷰가 그린다 — 타일이 뷰의 최신 허브 상태를 따라가야 한다(AgentFrame).
  // 시각의 tz — getComputedWbs 가 이미 판독한 프로젝트 달력(손상이면 그 로더가 던졌다). 따로 pickCalendar 로 실패 갈래를 두지 않는다 —
  // 허브 전체를 ConfigLoadError 로 덮으면 잘못 도는 에이전트를 멈출 길이 없다(FN-8)
  return <AgentHubView initial={hub} wbs={wbs} timeZone={wbsData.calendar.timezone} />
}
