import { Users, UserCog, Unlink, Shield } from 'lucide-react'
import { t } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'
import { getProjectMembers } from '@/lib/data/members'
import { getActorForView } from '@/lib/authz'
import { isProjectAdmin, toProjectActorView } from '@/lib/domain/authz'
import { teamsForProjectSync } from '@/lib/teams/master'
import { listProjects } from '@/app/actions/project'
import { listRoster } from '@/app/actions/roster'
import { listProjectInvites } from '@/app/actions/projectInvites'
import { PageHero, HeroBadge } from '@/components/ui/PageHero'
import { KpiCard } from '@/components/ui/KpiCard'
import { SectionCard } from '@/components/ui/SectionCard'
import { RosterManager } from '@/components/roster/RosterManager'
import { ProjectInviteManager } from '@/components/settings/ProjectInviteManager'
import { ProjectPageShell } from '@/components/app/ProjectPageShell'

export default async function MembersPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const [m, projects, locale] = await Promise.all([getActorForView(), listProjects(), getServerLocale()])

  const project = projects.find((p) => p.id === projectId)
  const projectName = project?.name ?? t(locale, 'members.projectFallback')
  const canEdit = isProjectAdmin(m, projectId)

  // 관리자는 명단 편집 화면(listRoster — 조회 실패를 '0명' 으로 위장하지 않는다), 그 외는 같은 표를 읽기 전용으로.
  // 초대 조회 실패가 명단 본체를 막으면 안 된다(섹션 안 에러 문구로 흡수).
  const [roster, invites] = await Promise.all([
    canEdit ? listRoster(projectId) : getProjectMembers(projectId).then(rows => ({ ok: true as const, rows })),
    canEdit ? listProjectInvites(projectId) : null,
  ])
  const rows = roster.ok ? roster.rows : []
  // 팀 후보 = 이 프로젝트에서 고를 수 있는 활성 팀(프로젝트 팀이 있으면 그것만, 없으면 공용).
  const teamOptions = teamsForProjectSync(projectId).filter(x => x.active).map(x => ({ id: x.id, code: x.code }))

  const active = rows.filter(x => x.active)
  const admins = active.filter(x => x.accessRole === 'admin').length
  const unlinked = active.filter(x => x.kind === 'external').length

  return (
    <ProjectPageShell
      hero={<PageHero
        eyebrow="TEAM"
        badge={<HeroBadge>Members</HeroBadge>}
        title={`${projectName} ${t(locale, 'members.heroTitleSuffix')}`}
        description={t(locale, 'members.heroDesc')}
        heroKpis={
          <>
            <KpiCard variant="hero" label="TEAM SIZE" value={active.length} sub={t(locale, 'members.kpiTeamSizeSub')} icon={Users} tone="brand" />
            <KpiCard variant="hero" label="ADMINS" value={admins} sub={t(locale, 'members.kpiAdminsSub')} icon={UserCog} tone="success" />
            <KpiCard variant="hero" label="NO ACCOUNT" value={unlinked} sub={t(locale, 'members.kpiUnlinkedSub')} icon={Unlink} tone="default" />
          </>
        }
      />}
    >
      <div className="space-y-4">
        <SectionCard
          eyebrow={canEdit ? 'TEAM & AUTHORIZATION' : 'TEAM'}
          title={t(locale, canEdit ? 'members.sectionManage' : 'members.sectionRoster')}
          icon={canEdit ? Shield : Users}
        >
          {canEdit && <p className="-mt-2 mb-4 text-xs leading-5 text-ink-muted">{t(locale, 'members.manageHint')}</p>}
          {roster.ok ? (
            <RosterManager
              projectId={projectId}
              rows={rows}
              teamOptions={teamOptions}
              actorView={toProjectActorView(m, projectId)}
              canEdit={canEdit}
            />
          ) : (
            <p role="alert" className="text-sm text-delayed">{roster.error}</p>
          )}
          {canEdit && (
            <div className="mt-6 border-t border-line pt-5">
              <ProjectInviteManager
                projectId={projectId}
                rows={invites?.ok ? invites.rows : []}
                loadError={invites && !invites.ok ? invites.error : null}
              />
            </div>
          )}
        </SectionCard>
      </div>
    </ProjectPageShell>
  )
}
