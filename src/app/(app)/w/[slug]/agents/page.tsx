import { redirect } from 'next/navigation'
import { loadWorkspaceScope } from '@/lib/authz/workspaceScope'
import { canViewAgents } from '@/lib/authz/agentsAccess'
import { getSeatmap } from '@/lib/data/agentSeatmap'
import { SeatmapView } from '@/components/agents/SeatmapView'
import { ConfigLoadError } from '@/components/settings/ConfigLoadError'
import { requireModulePage } from '@/lib/modules/pageGate'
import { viewTimezone } from '@/lib/calendar/viewZone'
import { getServerLocale } from '@/lib/i18n/server'
import { wsHref } from '@/lib/workspace/paths'

export const dynamic = 'force-dynamic' // 좌석표는 항상 최신이어야 한다
export const metadata = { title: '에이전트 현황' }   // 레이아웃 템플릿이 ' · {워크스페이스} | {제품}' 을 붙인다(V6)

export default async function AgentsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const scope = await loadWorkspaceScope(slug)                                  // 첫 await — 비소속 404
  // 그 워크스페이스에 역할(D21) — 판정은 canViewAgents 한 곳. 열화(actor null)는 service_role 로더 전에 돌려보낸다(fail-closed)
  if (!scope.actor || !canViewAgents(scope.actor, scope.ws.id)) redirect(wsHref(scope.ws.slug))
  await requireModulePage({ workspaceId: scope.ws.id }, 'agents')
  // 조회 실패는 throw → 오류 경계. 층은 그 워크스페이스의 접근 가능 프로젝트만(seatmapFloorIds). 기본은 전체(2026-09-19) — 화면에서 내 작업으로 좁힌다
  const [seatmap, vz] = await Promise.all([
    getSeatmap(scope.actor, Date.now(), 'all', { workspaceId: scope.ws.id }),
    // 화면의 tz — 세션 유일 워크스페이스, 없거나 여럿이면 UTC(화면이 이름을 적는다, 계획 D-21c)
    viewTimezone(scope.actor),
  ])
  if (!vz.ok) return <div className="p-6"><ConfigLoadError error={vz.error} kind="invalid" keyName={vz.key} locale={await getServerLocale()} /></div>
  // 문서형(D19) — 손으로 준 h-full 틀을 두지 않는다. 헤더·층 칩은 SeatmapView 가 공통 헤더(AgentFrame)로 그린다
  return <SeatmapView initial={seatmap} workspaceId={scope.ws.id} timeZone={vz.timeZone} />
}
