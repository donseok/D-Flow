'use client'
import { createBrowserClient } from '@/lib/supabase/client'
import { clearAllDrafts } from '@/lib/drafts/wikiDrafts'
import { WS_COOKIE } from '@/lib/workspace/constants'

/**
 * 로그아웃(클라이언트 전용) — 공용 PC 에서 다음 사용자에게 위키 초안이 남지 않게 세션을 끊기 전에 지운다.
 * 세션 만료·/login 진입에서는 지우지 않는다(주인의 초안을 부순다). 셸 계정 메뉴와 소속 없음 화면이 같이 쓴다.
 * 서버 로그아웃이 오류(네트워크·5xx)를 돌려주거나 던지면 auth-js 는 로컬 세션을 지우지 않는다 — 로컬 로그아웃(scope:'local', 네트워크 없음)으로
 * 반드시 지운 뒤 이동한다(U2b-2 권한 리뷰 Y2 — 로그인 화면인데 세션이 살아 있는 상태를 만들지 않는다). 현재 워크스페이스 쿠키(dflow-ws)도 지운다.
 */
export async function signOutAndClear(router: { replace: (href: string) => void; refresh: () => void }): Promise<void> {
  try { clearAllDrafts(window.localStorage) } catch { /* 저장소를 못 쓰는 환경 */ }
  await endSession()
  try { document.cookie = `${WS_COOKIE}=; path=/; max-age=0; samesite=lax` } catch { /* 쿠키를 못 쓰는 환경 */ }
  router.replace('/login')
  router.refresh()
}

/**
 * 세션만 끊는다(이동·초안·쿠키 정리 없음) — 서버 로그아웃이 오류·던짐이면 로컬 로그아웃(scope:'local')으로 반드시 지운다(Y2).
 * signOutAndClear 와 초대 화면의 불일치 계정 되돌림이 같이 쓴다(로그아웃 경로는 하나 — W16, U2b-3 보안 리뷰 AA8).
 */
export async function endSession(): Promise<void> {
  const auth = createBrowserClient().auth
  let failed: unknown = null
  try { const { error } = await auth.signOut(); if (error) failed = error } catch (e) { failed = e }
  if (failed) {
    console.error('[signOut] 서버 로그아웃 실패 — 로컬 세션을 지운다:', failed instanceof Error ? failed.message : (failed as { message?: string }).message ?? failed)
    try { await auth.signOut({ scope: 'local' }) } catch (e) { console.error('[signOut] 로컬 로그아웃 실패:', e instanceof Error ? e.message : e) }
  }
}
