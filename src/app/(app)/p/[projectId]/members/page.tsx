import { notFound } from 'next/navigation'
import { Users, UserCog, Unlink, Shield } from 'lucide-react'
import { t } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'
import { getProjectRoster } from '@/lib/data/members'
import { getActorViewState } from '@/lib/authz'
import { getHiddenProjectIds } from '@/lib/authz/visibility'
import { isAdminAccessRole, isHiddenProject, isProjectAdmin, toProjectActorView } from '@/lib/domain/authz'
import { projectTeams } from '@/lib/teams/source'
import { listProjects } from '@/app/actions/project'
import { listRoster } from '@/app/actions/roster'
import { listProjectInvites } from '@/app/actions/projectInvites'
import { PageHero, HeroBadge } from '@/components/ui/PageHero'
import { KpiCard } from '@/components/ui/KpiCard'
import { SectionCard } from '@/components/ui/SectionCard'
import { RosterManager } from '@/components/roster/RosterManager'
import { ProjectInviteManager } from '@/components/settings/ProjectInviteManager'
import { ProjectPageShell } from '@/components/app/ProjectPageShell'
import { requireModulePage } from '@/lib/modules/pageGate'

export default async function MembersPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  await requireModulePage({ projectId }, 'members')   // 스펙 §4.2 1행 — 꺼지면 notFound(), 로더보다 앞(R14)
  const [{ actor: m, degraded }, projects, locale, hidden] = await Promise.all([getActorViewState(), listProjects(), getServerLocale(), getHiddenProjectIds()])
  // 존재 은닉을 페이지가 다시 판정한다 — 레이아웃과 페이지는 병렬로 렌더돼 레이아웃의 notFound 가 이 페이지의 조회를 멈추지
  // 않고, 여기서 만든 RSC 페이로드는 404 digest 옆에 그대로 실린다. 아래 팀 후보도 게이트 뒤에서만 읽는다. 권한 조회 실패(degraded)는
  // 레이아웃처럼 404 로 위장하지 않는다(actor 가 null 이라 canEdit 도 거짓 — 팀을 읽지 않는다).
  // GG1 — 명단 밖 비공개도 레이아웃과 같은 판정자로 숨긴다. 열화에 비공개면 명단을 모르므로 던진다(404 위장 금지). 판정 실패도 던진다(위 Promise.all)
  if (degraded && hidden.has(projectId)) throw new Error('권한 조회가 실패해 비공개 프로젝트의 명단을 판정하지 못했습니다')
  if (!degraded && isHiddenProject(m, projectId, hidden)) notFound()

  const project = projects.find((p) => p.id === projectId)
  const projectName = project?.name ?? t(locale, 'members.projectFallback')
  const canEdit = isProjectAdmin(m, projectId)

  // 관리자는 명단 편집 화면(listRoster), 그 외는 같은 표를 읽기 전용으로(getProjectRoster) — 둘 다 조회 실패를 '0명' 으로 위장하지 않는다.
  // 초대 조회 실패가 명단 본체를 막으면 안 된다(섹션 안 에러 문구로 흡수).
  const [roster, invites] = await Promise.all([
    canEdit ? listRoster(projectId) : getProjectRoster(projectId),
    canEdit ? listProjectInvites(projectId) : null,
  ])
  const rows = roster.ok ? roster.rows : []
  // 팀 후보 = 이 프로젝트에서 고를 수 있는 활성 팀(프로젝트 팀이 있으면 그것만, 없으면 공용). 편집(명단 행·초대)에만 쓰므로
  // 관리자에게만 싣는다 — 읽기 전용 표는 행이 가진 팀 코드로 그린다.
  // 팀 후보 — 요청 범위 원천(세션 RLS, 레이아웃과 같은 요청 캐시). 읽기 실패는 던진다(오류 경계) — 빈 후보로 명단 편집을 열면 저장이 팀을 지운다
  const teamOptions = canEdit ? (await projectTeams(projectId)).filter(x => x.active).map(x => ({ id: x.id, code: x.code })) : []

  const active = rows.filter(x => x.active)
  const admins = active.filter(x => isAdminAccessRole(x.accessRole)).length
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
                teamOptions={teamOptions}
                actorView={toProjectActorView(m, projectId)}
              />
            </div>
          )}
        </SectionCard>
      </div>
    </ProjectPageShell>
  )
}
