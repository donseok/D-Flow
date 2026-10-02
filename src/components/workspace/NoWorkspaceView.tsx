import Link from 'next/link'
import { SignOutButton } from '@/components/workspace/SignOutButton'

/** 소속 0 화면(§5.3) — 초대 링크로 합류하라는 안내와 로그아웃. 플랫폼 관리자에게는 목록 화면이 SP9 라는 안내와 LLM 설정 링크 */
export function NoWorkspaceView({ isPlatformAdmin }: { isPlatformAdmin: boolean }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-[560px] flex-col justify-center gap-4 px-4">
      <h1 className="text-title text-fg">소속된 워크스페이스가 없습니다</h1>
      <p className="text-body text-fg-secondary">관리자에게 받은 초대 링크를 열면 워크스페이스에 합류합니다.</p>
      {isPlatformAdmin && (
        <p className="text-body text-fg-secondary">
          모든 워크스페이스 목록은 준비 중입니다(SP9). <Link href="/admin/llm-config" className="font-semibold text-action hover:underline">LLM 설정</Link>
        </p>
      )}
      <div><SignOutButton /></div>
    </main>
  )
}
