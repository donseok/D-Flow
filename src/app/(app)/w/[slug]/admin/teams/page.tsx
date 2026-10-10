import { redirect } from 'next/navigation'
import { loadWorkspaceScope } from '@/lib/authz/workspaceScope'
import { canManageTeams } from '@/lib/authz/teamsAccess'
import { listTeamsAdmin } from '@/app/actions/teams'
import { PageHeader } from '@/components/app/PageHeader'
import { TeamsManager } from '@/components/admin/TeamsManager'
import { wsHref } from '@/lib/workspace/paths'
import { t} from '@/lib/i18n/dict'

export const dynamic = 'force-dynamic' // 기준정보는 항상 최신 조회(관리 직후 반영)
/** 탭 제목 — 사전에서 꺼낸다('공용 팀') */
export async function generateMetadata() { return { title: t('nav.wsTeams') } }   // 레이아웃 템플릿이 ' · {워크스페이스} | {제품}' 을 붙인다(V6)

export default async function TeamsAdminPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const scope = await loadWorkspaceScope(slug)                                  // 첫 await — 비소속 404
  // 슬러그 워크스페이스 관리자(D22 — 플랫폼 관리자 포함). 판정은 canManageTeams 한 곳. 열화·권한 없음은 그 워크스페이스 홈(D7)
  if (!canManageTeams(scope.actor, scope.ws.id)) redirect(wsHref(scope.ws.slug))
  const list = await listTeamsAdmin(scope.ws.id)
  // 조회 실패는 'TEAMS 0' 이 아니다 — 같은 오류 카드로 보여 준다(액션이 로그를 남겼다). 액션 문구가 머리글을 겸하므로
  // 제목 한 줄만 — 같은 문장을 제목과 본문에 두 번 찍지 않는다. 가드 거부도 그 사유가 제목이 된다.
  if (!list.ok) return <TeamsLoadError title={list.error} />
  const teams = list.rows

  return (
    <div className="space-y-6">
      <PageHeader title={t('pages.teams.title')} description={t('pages.teams.desc')} />
      <TeamsManager teams={teams} workspaceId={scope.ws.id} />
    </div>
  )
}

/** 목록을 못 읽었을 때 — 빈 목록 대신 원인을 보여 준다. detail 은 있을 때만 둘째 줄. */
function TeamsLoadError({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="space-y-6">
      <PageHeader title={t('pages.teams.title')} description={t('pages.teams.desc')} />
      <div className="card p-6" role="alert">
        <p className="text-sm font-semibold text-danger">{title}</p>
        {detail && <p className="mt-1 text-xs leading-5 text-fg-secondary">{detail}</p>}
      </div>
    </div>
  )
}
