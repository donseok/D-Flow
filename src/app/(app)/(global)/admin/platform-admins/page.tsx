import { notFound } from 'next/navigation'
import { getActorForView } from '@/lib/authz'
import { canManagePlatformAdmins } from '@/lib/authz/accountsAccess'
import { t } from '@/lib/i18n/dict'
import { readCurrentWorkspace } from '@/lib/workspace/current'
import { wsHref } from '@/lib/workspace/paths'
import { listPlatformAdmins } from '@/app/actions/platformAdmins'
import { PageHeader } from '@/components/app/PageHeader'
import { StatusMessage } from '@/components/ui/StatusMessage'
import { PlatformAdminsManager } from '@/components/admin/PlatformAdminsManager'

export const dynamic = 'force-dynamic' // 목록은 항상 최신 DB 값을 읽는다

/**
 * 플랫폼 관리자 목록·지정·해제 — (global) 라우트 그룹, 플랫폼 관리자만(나머지·열화 = 404, /admin/workspaces 관례).
 * 판정은 canManagePlatformAdmins 이고 목록·찾기 액션은 requireSuperuser, 지정·해제는 setPlatformAdmin 이 다시 가드한다.
 * 플랫폼 관리라 모듈 관문 밖이다(페이지 관문 불변식 제외 목록).
 */
export async function generateMetadata() { return { title: t('nav.platformAdmins') } }   // (global) 레이아웃의 템플릿이 ' | {제품}' 을 붙인다
export default async function PlatformAdminsPage() {
  const actor = await getActorForView()
  if (!actor || !canManagePlatformAdmins(actor)) notFound()
  const [res, cur] = await Promise.all([listPlatformAdmins(), readCurrentWorkspace()])
  // 없는 계정의 안내 링크 — 계정은 워크스페이스 멤버·초대 화면에서 만든다(소속이 없거나 못 읽으면 링크 없이 문구만)
  const accountsHref = cur.ok && cur.ws ? wsHref(cur.ws.slug, 'admin/accounts') : null
  return (
    <div className="space-y-6">
      <PageHeader title={t('platformAdmins.title')} description={t('platformAdmins.desc')} />
      {res.ok ? (
        <PlatformAdminsManager rows={res.rows} currentUserId={actor.userId} accountsHref={accountsHref} />
      ) : (
        // 조회 실패를 '관리자 0명'으로 그리지 않는다(3원칙 ①) — 원인은 서버 로그에 남았다
        <StatusMessage kind="partial_error" blocking title={t('platformAdmins.listError')} detail={t('platformAdmins.listErrorDetail')} />
      )}
    </div>
  )
}
