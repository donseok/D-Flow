import { notFound } from 'next/navigation'
import { getActorForView } from '@/lib/authz'
import { canManagePlatformAdmins } from '@/lib/authz/accountsAccess'
import { t } from '@/lib/i18n/dict'
import { readCurrentWorkspace } from '@/lib/workspace/current'
import { wsHref } from '@/lib/workspace/paths'
import { viewTimezone } from '@/lib/calendar/viewZone'
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
/**
 * 지정 일시를 보일 tz — 현재 워크스페이스의 달력 tz(설정에서 온다. 코드에 고정 시간대 리터럴을 두지 못한다 — 런타임 상수 가드, 스펙 D45).
 * 워크스페이스가 없거나 달력을 못 읽으면 UTC 를 명시한다(표 머리가 tz 이름을 보여 주므로 조용히 틀리지 않는다) — 이 화면은 달력 때문에 막히지 않는다.
 */
async function displayTimezone(wsId: string | null): Promise<string> {
  if (!wsId) return 'UTC'
  try {
    const r = await viewTimezone(wsId)
    if (r.ok) return r.timeZone
    console.error('[platform-admins] 워크스페이스 달력을 해석하지 못해 UTC 로 보입니다:', r.key, r.error)
  } catch (e) {
    console.error('[platform-admins] 워크스페이스 설정을 읽지 못해 UTC 로 보입니다:', e instanceof Error ? e.message : String(e))
  }
  return 'UTC'
}

export default async function PlatformAdminsPage() {
  const actor = await getActorForView()
  if (!actor || !canManagePlatformAdmins(actor)) notFound()
  const [res, cur] = await Promise.all([listPlatformAdmins(), readCurrentWorkspace()])
  // 없는 계정의 안내 링크 — 계정은 워크스페이스 멤버·초대 화면에서 만든다(소속이 없거나 못 읽으면 링크 없이 문구만)
  const accountsHref = cur.ok && cur.ws ? wsHref(cur.ws.slug, 'admin/accounts') : null
  const timeZone = res.ok ? await displayTimezone(cur.ok && cur.ws ? cur.ws.id : null) : 'UTC'   // 목록이 없으면 쓸 데가 없다
  return (
    <div className="space-y-6">
      <PageHeader title={t('platformAdmins.title')} description={t('platformAdmins.desc')} />
      {res.ok ? (
        <PlatformAdminsManager rows={res.rows} currentUserId={actor.userId} accountsHref={accountsHref} timeZone={timeZone} />
      ) : (
        // 조회 실패를 '관리자 0명'으로 그리지 않는다(3원칙 ①) — 원인은 서버 로그에 남았다
        <StatusMessage kind="partial_error" blocking title={t('platformAdmins.listError')} detail={t('platformAdmins.listErrorDetail')} />
      )}
    </div>
  )
}
