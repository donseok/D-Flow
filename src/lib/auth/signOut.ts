'use client'
import { createBrowserClient } from '@/lib/supabase/client'
import { clearAllWikiDrafts } from '@/lib/drafts/wikiDrafts'

/**
 * 로그아웃(클라이언트 전용) — 공용 PC 에서 다음 사용자에게 위키 초안이 남지 않게 세션을 끊기 전에 지운다.
 * 세션 만료·/login 진입에서는 지우지 않는다(주인의 초안을 부순다). 셸 계정 메뉴와 소속 없음 화면이 같이 쓴다.
 */
export async function signOutAndLeave(router: { replace: (href: string) => void; refresh: () => void }): Promise<void> {
  try { clearAllWikiDrafts(window.localStorage) } catch { /* 저장소를 못 쓰는 환경 */ }
  await createBrowserClient().auth.signOut()
  router.replace('/login')
  router.refresh()
}
