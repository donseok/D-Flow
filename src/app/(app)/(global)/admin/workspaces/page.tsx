import { notFound } from 'next/navigation'
import { getActorForView } from '@/lib/authz'
import { canManageWorkspaces } from '@/lib/authz/platformWorkspacesAccess'
import { getServerLocale } from '@/lib/i18n/server'
import { t } from '@/lib/i18n/dict'
import { readCurrentWorkspace } from '@/lib/workspace/current'
import { wsHref } from '@/lib/workspace/paths'
import { listPlatformWorkspaces } from '@/app/actions/platformWorkspaces'
import { PageHeader } from '@/components/app/PageHeader'
import { StatusMessage } from '@/components/ui/StatusMessage'
import { WorkspacesManager } from '@/components/admin/WorkspacesManager'

export const dynamic = 'force-dynamic' // 목록·수는 항상 최신 DB 값을 읽는다

/**
 * 워크스페이스 목록·생성(개정 §5.3.1 플랫폼 범위 `/admin/*`, §5.3.2 "플랫폼 관리자는 /admin 목록") — (global) 라우트 그룹.
 * 플랫폼 관리자만(나머지·권한 조회 열화 = 404, ui-states 관례). 판정은 canManageWorkspaces 한 곳이고 목록·생성 액션이 requireSuperuser 로 다시 가드한다.
 * 플랫폼 관리라 모듈 관문 밖이다(페이지 관문 불변식 제외 목록).
 */
export default async function WorkspacesAdminPage() {
  const actor = await getActorForView()
  if (!canManageWorkspaces(actor)) notFound()
  const [locale, res, cur] = await Promise.all([getServerLocale(), listPlatformWorkspaces(), readCurrentWorkspace()])
  // 계정 관리 화면은 워크스페이스마다 있다 — 첫 관리자 계정이 없을 때 안내할 곳은 지금 워크스페이스의 것(소속이 없거나 못 읽으면 링크 없이 문구만)
  const accountsHref = cur.ok && cur.ws ? wsHref(cur.ws.slug, 'admin/accounts') : null
  return (
    <div className="space-y-6">
      <PageHeader title={t(locale, 'platform.ws.title')} description={t(locale, 'platform.ws.desc')} />
      {res.ok ? (
        <WorkspacesManager rows={res.rows} accountsHref={accountsHref} />
      ) : (
        // 조회 실패를 '워크스페이스 0개'로 그리지 않는다(3원칙 ①) — 원인은 서버 로그에 남았다
        <StatusMessage kind="partial_error" blocking title={t(locale, 'platform.ws.listError')} detail={t(locale, 'platform.ws.listErrorDetail')} />
      )}
    </div>
  )
}
