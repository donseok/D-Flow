import { redirect } from 'next/navigation'
import { Landmark, ListChecks, Users } from 'lucide-react'
import { getActorForView } from '@/lib/authz'
import { canManageTeams } from '@/lib/authz/teamsAccess'
import { resolveSoleWorkspaceId } from '@/lib/authz/workspace'
import { listTeamsAdmin } from '@/app/actions/teams'
import { PageHero, HeroBadge } from '@/components/ui/PageHero'
import { KpiCard } from '@/components/ui/KpiCard'
import { TeamsManager } from '@/components/admin/TeamsManager'

export const dynamic = 'force-dynamic' // 기준정보는 항상 최신 조회(관리 직후 반영)

export default async function TeamsAdminPage() {
  // 슈퍼유저 전용 — 판정은 canManageTeams 한 곳에서. 어포던스(헤더 메뉴)도 같은 판정을 쓴다.
  const actor = await getActorForView()
  if (!canManageTeams(actor)) redirect('/projects')

  // 공용 팀은 워크스페이스별이다(SP2). 워크스페이스 선택 UI 는 SP3 몫이라 유일 소속일 때만 그 워크스페이스를 연다.
  const ws = resolveSoleWorkspaceId(actor!)
  if (!ws.ok) {
    // 조용한 빈 목록 금지 — 원인을 그대로 보여준다(표시 = 로깅).
    console.error('[TeamsAdminPage] 대상 워크스페이스를 정할 수 없음:', ws.error)
    return (
      <div className="space-y-6">
        <PageHero eyebrow="ADMIN" badge={<HeroBadge>Teams</HeroBadge>} title="팀 관리"
          description="담당 팀 기준정보를 관리합니다 — 탭·필터·검증·엑셀·회의록 편철이 모두 이 목록을 따릅니다." />
        <div className="card p-6">
          <p className="text-sm font-semibold text-delayed">팀 목록을 열 워크스페이스를 정할 수 없습니다.</p>
          <p className="mt-1 text-xs leading-5 text-ink-muted">{ws.error}</p>
        </div>
      </div>
    )
  }
  const teams = await listTeamsAdmin(ws.workspaceId)
  const active = teams.filter(t => t.active).length

  return (
    <div className="space-y-6">
      <PageHero
        eyebrow="ADMIN"
        badge={<HeroBadge>Teams</HeroBadge>}
        title="팀 관리"
        description="담당 팀 기준정보를 관리합니다 — 탭·필터·검증·엑셀·회의록 편철이 모두 이 목록을 따릅니다."
        heroKpis={
          <>
            <KpiCard variant="hero" label="TEAMS" value={teams.length} sub="전체 팀" icon={Users} tone="brand" />
            <KpiCard variant="hero" label="ACTIVE" value={active} sub="활성(화면 노출)" icon={ListChecks} tone="success" />
            <KpiCard variant="hero" label="HIDDEN" value={teams.length - active} sub="비활성(데이터 보존)" icon={Landmark} tone="default" />
          </>
        }
      />
      <TeamsManager teams={teams} workspaceId={ws.workspaceId} />
    </div>
  )
}
