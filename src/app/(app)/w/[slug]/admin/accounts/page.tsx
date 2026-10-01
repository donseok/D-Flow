import { notFound, redirect } from 'next/navigation'
import { ShieldCheck, Users, UserCog, Eye } from 'lucide-react'
import { BRAND } from '@/lib/branding'
import { loadWorkspaceScope } from '@/lib/authz/workspaceScope'
import { canManageWorkspaceAccounts } from '@/lib/authz/accountsAccess'
import { ACCESS_ROLE, isProjectAdmin } from '@/lib/domain/authz'
import { listAccounts } from '@/app/actions/accounts'
import { listProjectsWithState } from '@/app/actions/project'
import { PageHero, HeroBadge } from '@/components/ui/PageHero'
import { KpiCard } from '@/components/ui/KpiCard'
import { StatusMessage } from '@/components/ui/StatusMessage'
import { AccountsManager } from '@/components/admin/AccountsManager'
import { wsHref } from '@/lib/workspace/paths'

export const dynamic = 'force-dynamic' // 목록은 항상 최신(admin API) 조회
export const metadata = { title: `멤버·초대 | ${BRAND.productName}` }

export default async function AccountsAdminPage({ params, searchParams }: {
  params: Promise<{ slug: string }>; searchParams: Promise<{ project?: string }>
}) {
  const { slug } = await params
  const scope = await loadWorkspaceScope(slug)                                  // 첫 await — 비소속 404
  const actor = scope.actor
  // 슬러그 워크스페이스의 관리자(D22 — 플랫폼 관리자 포함). 열화(actor null)·권한 없음은 그 워크스페이스 홈(D7)
  if (!actor || !canManageWorkspaceAccounts(actor, scope.ws.id)) redirect(wsHref(scope.ws.slug))

  const [{ project }, list] = await Promise.all([searchParams, listProjectsWithState()])
  const canPlatformOps = actor.isSuperuser
  // 플랫폼 조작(비밀번호 리셋·플랫폼 관리자 지정)은 플랫폼 관리자에게만 — 안내 문구도 그 사람에게만(D22)
  const description = canPlatformOps
    ? '로그인 계정을 만들고 워크스페이스·프로젝트 권한을 지정하거나 비밀번호를 리셋합니다.'
    : '로그인 계정을 만들고 워크스페이스·프로젝트 권한을 지정합니다.'
  if (list.degraded) {
    // 목록을 못 읽은 것을 '관리할 프로젝트가 없습니다'로 그리지 않는다(에러 3원칙 ① — 원인은 [listProjects] 로그)
    return (
      <div className="space-y-6">
        <PageHero eyebrow="ADMIN" badge={<HeroBadge>Accounts</HeroBadge>} title="계정 관리" description={description} />
        <StatusMessage kind="partial_error" blocking title="프로젝트 목록을 불러오지 못했습니다" detail="잠시 뒤 새로고침하세요. 계속되면 관리자에게 알려 주세요." />
      </div>
    )
  }
  const projects = list.projects
  // 후보 = 그 워크스페이스의, 내가 관리자인 프로젝트. 목록의 첫 항목으로 정하면 B 프로젝트 관리자가 들어왔을 때 A 가 기본값이 되어
  // 게이트에 거부당하고 화면은 그 거부를 '계정 0개'로 보여준다. 다른 워크스페이스 pid 는 ?project= 로도 고를 수 없다(W11)
  const managed = (projects as { id: string; name: string; workspace_id?: string }[])
    .filter((p) => p.workspace_id === scope.ws.id && isProjectAdmin(actor, p.id))
  const projectId = managed.some((p) => p.id === project) ? project! : managed[0]?.id
  if (!projectId) {
    // 역할을 부여할 대상이 없다 — 다른 화면으로 튕기지 않고 그 사실을 보여 준다
    return (
      <div className="space-y-6">
        <PageHero eyebrow="ADMIN" badge={<HeroBadge>Accounts</HeroBadge>} title="계정 관리" />
        <StatusMessage kind="empty" title="관리할 프로젝트가 없습니다" detail="이 워크스페이스에 프로젝트를 만든 뒤 계정과 권한을 지정할 수 있습니다." />
      </div>
    )
  }

  const res = await listAccounts(projectId)
  if (res.ok && res.workspaceId !== scope.ws.id) notFound()               // 슬러그와 다른 워크스페이스의 명단을 이 주소로 보이지 않는다
  if (!res.ok) {
    // 조용한 빈 화면 금지 — 원인을 그대로 보여준다(표시 = 로깅).
    return (
      <div className="space-y-6">
        <PageHero eyebrow="ADMIN" badge={<HeroBadge>Accounts</HeroBadge>} title="계정 관리" description={description} />
        <div className="card p-6">
          <p className="text-sm font-semibold text-delayed">계정 목록을 불러오지 못했습니다.</p>
          <p className="mt-1 text-xs leading-5 text-ink-muted">{res.error}</p>
        </div>
      </div>
    )
  }
  // 플랫폼 관리자 여부는 플랫폼 관리자에게만 싣는다 — 워크스페이스 관리자 화면의 RSC 페이로드에 남기지 않는다
  const accounts = canPlatformOps ? res.rows : res.rows.map((a) => ({ ...a, isPlatformAdmin: false }))
  const total = accounts.length
  const superusers = accounts.filter((a) => a.isPlatformAdmin).length
  const admins = accounts.filter((a) => a.accessRole === ACCESS_ROLE.admin).length
  const members = accounts.filter((a) => a.accessRole === ACCESS_ROLE.member).length

  return (
    <div className="space-y-6">
      <PageHero
        eyebrow="ADMIN"
        badge={<HeroBadge>Accounts</HeroBadge>}
        title="계정 관리"
        description={description}
        heroKpis={
          <>
            <KpiCard variant="hero" label="ACCOUNTS" value={total} sub="전체 로그인 계정" icon={Users} tone="brand" />
            {canPlatformOps && <KpiCard variant="hero" label="SUPERUSER" value={superusers} sub="슈퍼유저" icon={ShieldCheck} tone="success" />}
            <KpiCard variant="hero" label="ADMIN / MEMBER" value={`${admins} / ${members}`} sub="관리자 / 멤버" icon={UserCog} tone="default" />
            <KpiCard variant="hero" label="VIEWER" value={total - admins - members} sub="조회 전용" icon={Eye} tone="default" />
          </>
        }
      />
      <AccountsManager
        accounts={accounts}
        projectId={projectId}
        workspaceId={res.workspaceId}
        projects={managed.map(p => ({ id: p.id, name: p.name }))}
        canPlatformOps={canPlatformOps}
        currentUserId={actor.userId}
      />
    </div>
  )
}
