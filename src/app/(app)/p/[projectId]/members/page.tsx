import { notFound } from 'next/navigation'
import { Users, Shield } from 'lucide-react'
import { t } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'
import { getWorkspaceRoleMap } from '@/lib/data/workspaceRoles'
import { getProjectRoster } from '@/lib/data/members'
import { getActorViewState } from '@/lib/authz'
import { getHiddenProjectIds } from '@/lib/authz/visibility'
import { effectiveRoleOfRow, isHiddenProject, isProjectAdmin, toProjectActorView } from '@/lib/domain/authz'
import { projectTeams } from '@/lib/teams/source'
import { listProjects } from '@/app/actions/project'
import { listRoster } from '@/app/actions/roster'
import { listProjectInvites } from '@/app/actions/projectInvites'
import { PageHeader } from '@/components/app/PageHeader'
import { SectionCard } from '@/components/ui/SectionCard'
import { RosterManager } from '@/components/roster/RosterManager'
import { ProjectInviteManager } from '@/components/settings/ProjectInviteManager'
import { loadProjectConfigForPage } from '@/lib/settings/pageConfig'
import { pickCalendar } from '@/lib/settings/pick'
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
  // 초대 만료·합류 시각의 tz = 프로젝트 달력(초대 칸은 관리자만 보므로 그때만 읽는다). 실패는 초대 칸에만 사유를 그린다.
  const wid = m?.projectWorkspace.get(projectId) ?? null
  const [roster, invites, pc, wsRoles] = await Promise.all([
    canEdit ? listRoster(projectId) : getProjectRoster(projectId),
    canEdit ? listProjectInvites(projectId) : null,
    canEdit ? loadProjectConfigForPage(projectId) : null,
    wid ? getWorkspaceRoleMap(wid) : Promise.resolve({ ok: false as const, error: '워크스페이스 권한을 확인하지 못했습니다' }),
  ])
  // 초대 발급·취소는 달력과 무관하다 — 달력 손상·설정 조회 실패는 시각 칸만 사유로 둔다(A-4 리뷰 N6)
  const inviteCal = pc?.ok ? pickCalendar(pc.cfg) : null
  const inviteTz = inviteCal?.ok ? inviteCal.calendar.timezone : null
  const inviteTzError = inviteCal ? (inviteCal.ok ? null : inviteCal.error) : pc && !pc.ok ? pc.error : null
  const rows = roster.ok ? roster.rows : []
  if (!wsRoles.ok) console.error('[members] 워크스페이스 역할 조회 실패 — 실효 역할 확인 불가', projectId, wsRoles.error)
  const effectiveRoles = Object.fromEntries(rows.map(row => [row.id, effectiveRoleOfRow(row, wsRoles.ok ? wsRoles.map : null)]))
  // 팀 후보 = 이 프로젝트에서 고를 수 있는 활성 팀(프로젝트 팀이 있으면 그것만, 없으면 공용) — 요청 범위 원천(세션 RLS, 레이아웃과 같은
  // 요청 캐시). 편집(명단 행·초대)에만 쓰므로 관리자에게만 싣는다 — 읽기 전용 표는 행이 가진 팀 코드로 그린다.
  // 읽기 실패는 던진다(오류 경계) — 빈 후보로 명단 편집을 열면 저장이 팀을 지운다
  const teamOptions = canEdit ? (await projectTeams(projectId)).filter(x => x.active).map(x => ({ id: x.id, code: x.code })) : []

  return (
    <ProjectPageShell
      hero={<PageHeader title={`${projectName} ${t(locale, 'members.heroTitleSuffix')}`} description={t(locale, 'members.heroDesc')} />}
    >
      <div className="space-y-4">
        <SectionCard
          title={t(locale, canEdit ? 'members.sectionManage' : 'members.sectionRoster')}
          icon={canEdit ? Shield : Users}
        >
          {canEdit && <p className="-mt-2 mb-4 text-xs leading-5 text-fg-secondary">{t(locale, 'members.manageHint')}</p>}
          {roster.ok ? (
            <RosterManager
              projectId={projectId}
              rows={rows}
              effectiveRoles={effectiveRoles}
              teamOptions={teamOptions}
              actorView={toProjectActorView(m, projectId)}
              canEdit={canEdit}
            />
          ) : (
            <p role="alert" className="text-sm text-danger">{roster.error}</p>
          )}
          {canEdit && (
            <div className="mt-6 border-t border-border pt-5">
              <ProjectInviteManager
                projectId={projectId}
                rows={invites?.ok ? invites.rows : []}
                loadError={invites && !invites.ok ? invites.error : null}
                teamOptions={teamOptions}
                actorView={toProjectActorView(m, projectId)}
                timeZone={inviteTz}
                timeZoneError={inviteTzError}
              />
            </div>
          )}
        </SectionCard>
      </div>
    </ProjectPageShell>
  )
}
