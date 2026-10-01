import { redirect } from 'next/navigation'
import { getActorForView } from '@/lib/authz'
import { canViewAgents } from '@/lib/authz/agentsAccess'
import { resolveSoleWorkspaceId } from '@/lib/authz/workspace'
import { getSeatmap } from '@/lib/data/agentSeatmap'
import { SeatmapView } from '@/components/agents/SeatmapView'
import { requireModulePage } from '@/lib/modules/pageGate'

export const dynamic = 'force-dynamic' // 좌석표는 항상 최신이어야 한다

export default async function AgentsPage() {
  // 그 워크스페이스에 역할이 있는가 — 판정은 canViewAgents 한 곳. 입구는 프로젝트 스튜디오 탭의 "전체 스튜디오" 링크(사이드바 항목 없음).
  // 워크스페이스는 세션 유일 워크스페이스(관문과 같은 축) — 과제 13 이 /w/[slug]/agents 로 옮기며 슬러그 워크스페이스로 바꾼다.
  const actor = await getActorForView()
  const sole = actor ? resolveSoleWorkspaceId(actor) : null
  if (!actor || !sole?.ok || !canViewAgents(actor, sole.workspaceId)) redirect('/projects')
  await requireModulePage(null, 'agents')   // 전역 경로 — 세션 유일 워크스페이스(스펙 §4.2 2행, P13)
  // 조회 실패는 throw → Next 의 error 경계가 받는다. 빈 좌석표로 위장하지 않는다.
  const seatmap = await getSeatmap(actor, Date.now(), 'all', { workspaceId: sole.workspaceId }) // 기본은 전체(2026-09-19); 화면에서 내 작업으로 좁힐 수 있다
  // 헤더·층 칩(돌아갈 길)은 SeatmapView 가 공통 헤더(AgentFrame)로 그린다. 프로젝트 레이아웃과 같은 h-full 틀을 줘야
  // ProjectPageShell 이 콘텐츠만 스크롤한다 — 바깥 main 이 스크롤하면 보기마다 스크롤바가 생겼다 사라지며 조작 줄이 밀린다.
  return (
    <div className="h-full min-h-0 min-w-0">
      <SeatmapView initial={seatmap} />
    </div>
  )
}
