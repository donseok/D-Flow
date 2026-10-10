import { notFound, redirect } from 'next/navigation'
import { getActorForView } from '@/lib/authz'
import { isProjectMember } from '@/lib/domain/authz'
import { getProjectOffice } from '@/lib/data/agentSeatmap'
import { UUID_RE } from '@/lib/domain/validate'
import { SeatmapView } from '@/components/agents/SeatmapView'
import { ConfigLoadError } from '@/components/settings/ConfigLoadError'
import { requireModulePage } from '@/lib/modules/pageGate'
import { loadProjectConfigForPage } from '@/lib/settings/pageConfig'
import { pickCalendar } from '@/lib/settings/pick'
import { koTranslate } from '@/lib/i18n/translate'

export const dynamic = 'force-dynamic' // 좌석은 항상 최신이어야 한다

/**
 * 프로젝트 스튜디오 — 이 프로젝트 층 하나를 전역 좌석표와 같은 규칙·폴링으로 그린다(2026-09-14 스튜디오 분리 스펙 §6-3).
 * 멤버 이상만 — 허브와 같은 게이트. 로더가 접근 범위와 다시 교집합을 낸다.
 */
export default async function ProjectOfficePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const actor = await getActorForView()
  if (!actor || !isProjectMember(actor, projectId)) redirect(`/p/${projectId}/dashboard`)
  await requireModulePage({ projectId }, 'agents')   // 스펙 §4.2 1행 — 꺼지면 notFound(), 로더보다 앞(R14)
  // 형식이 아닌 값은 DB 까지 가면 uuid 비교에서 throw 해 500 이 된다 — 슈퍼유저는 멤버 판정을 통과하므로 여기서 404 로 끊는다.
  if (!UUID_RE.test(projectId)) notFound()
  // 조회 실패는 throw → Next 의 error 경계가 받는다. 빈 스튜디오로 위장하지 않는다.
  const [office, pc] = await Promise.all([
    getProjectOffice(actor, projectId, Date.now(), 'all', koTranslate), // 기본은 전체(2026-09-19)
    loadProjectConfigForPage(projectId),
  ])
  if (office.projectName === null) notFound()
  // 시각·사무실 대사의 tz = 프로젝트 달력(계획 D-21a·D-21e) — 못 읽거나 손상이면 그 사유를 그린다(서울·UTC 로 대체하지 않는다)
  if (!pc.ok) return <div className="p-6"><ConfigLoadError error={pc.error} /></div>
  const cal = pickCalendar(pc.cfg)
  if (!cal.ok) return <div className="p-6"><ConfigLoadError error={cal.error} keyName={cal.key} kind={cal.kind} /></div>
  // 공통 헤더(탭·요약·타일)는 뷰가 그린다 — 타일이 30초 폴링을 따라가야 한다(AgentFrame).
  return <SeatmapView initial={office.seatmap} projectId={projectId} projectName={office.projectName} timeZone={cal.calendar.timezone} />
}
