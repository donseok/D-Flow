import { redirect } from 'next/navigation'
import { getActorForView } from '@/lib/authz'
import { canViewAgents } from '@/lib/authz/agentsAccess'
import { getSeatmap } from '@/lib/data/agentSeatmap'
import { SeatmapView } from '@/components/agents/SeatmapView'
import { ConfigLoadError } from '@/components/settings/ConfigLoadError'
import { requireModulePage } from '@/lib/modules/pageGate'
import { viewTimezone } from '@/lib/calendar/viewZone'
import { getServerLocale } from '@/lib/i18n/server'

export const dynamic = 'force-dynamic' // 좌석표는 항상 최신이어야 한다

export default async function AgentsPage() {
  // 슈퍼유저 또는 역할이 있는 프로젝트 1개 이상 — 판정은 canViewAgents 한 곳. 입구는 프로젝트 스튜디오 탭의 "전체 스튜디오" 링크(사이드바 항목 없음).
  const actor = await getActorForView()
  if (!actor || !canViewAgents(actor)) redirect('/projects')
  await requireModulePage(null, 'agents')   // 전역 경로 — 세션 유일 워크스페이스(스펙 §4.2 2행, P13)
  // 조회 실패는 throw → Next 의 error 경계가 받는다. 빈 좌석표로 위장하지 않는다.
  const [seatmap, vz] = await Promise.all([
    getSeatmap(actor, Date.now(), 'all'), // 기본은 전체(2026-09-19); 화면에서 내 작업으로 좁힐 수 있다
    // 전역 화면의 tz — 세션 유일 워크스페이스, 없거나 여럿이면 UTC(화면이 이름을 적는다, 계획 D-21c)
    viewTimezone(actor),
  ])
  if (!vz.ok) return <div className="p-6"><ConfigLoadError error={vz.error} kind="invalid" keyName={vz.key} locale={await getServerLocale()} /></div>
  // 헤더·층 칩(돌아갈 길)은 SeatmapView 가 공통 헤더(AgentFrame)로 그린다. 프로젝트 레이아웃과 같은 h-full 틀을 줘야
  // ProjectPageShell 이 콘텐츠만 스크롤한다 — 바깥 main 이 스크롤하면 보기마다 스크롤바가 생겼다 사라지며 조작 줄이 밀린다.
  return (
    <div className="h-full min-h-0 min-w-0">
      <SeatmapView initial={seatmap} timeZone={vz.timeZone} />
    </div>
  )
}
