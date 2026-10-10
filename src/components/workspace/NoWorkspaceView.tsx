import Link from 'next/link'
import { SignOutButton } from '@/components/workspace/SignOutButton'
import { t} from '@/lib/i18n/dict'

/**
 * 소속 0 화면(§5.3) — 초대를 받아 합류하라는 안내와 로그아웃. 플랫폼 관리자에게는 워크스페이스를 직접 만드는 길(/admin/workspaces, 개정 §5.3.2)과
 * LLM 설정 링크를 준다. 그 밖의 사용자는 워크스페이스를 만들 수 없으므로 "관리자에게 초대를 요청" 안내만 본다.
 */
export function NoWorkspaceView({ isPlatformAdmin }: { isPlatformAdmin: boolean }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-[560px] flex-col justify-center gap-4 px-4">
      <h1 className="text-title text-fg">{t('platform.noWs.title')}</h1>
      <p className="text-body text-fg-secondary">{t('platform.noWs.inviteHint')}</p>
      {isPlatformAdmin && (
        <p className="text-body text-fg-secondary">
          {t('platform.noWs.adminHint')}{' '}
          <Link href="/admin/workspaces#create" className="font-semibold text-action hover:underline">{t('platform.noWs.create')}</Link>
          {' · '}
          <Link href="/admin/llm-config" className="font-semibold text-action hover:underline">{t('nav.llm')}</Link>
        </p>
      )}
      <div><SignOutButton /></div>
    </main>
  )
}
