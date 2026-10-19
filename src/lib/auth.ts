import { requestCache as cache } from '@/lib/server/requestCache'
import { createServerClient } from './supabase/server'
import { displayNameFrom } from './domain/display-name'

// 같은 요청 안의 세션 조회는 한 번만 한다. RSC 는 React cache, /api/shell 같은
// 명시적 읽기 요청은 요청 캐시를 사용한다. 다른 요청에서는 사용자 상태를 새로 검증한다.
export const getSession = cache(async () => {
  const sb = await createServerClient()
  const { data } = await sb.auth.getUser()
  return data.user
})

/** 헤더 표시용 로그인 사용자 이름 — 계정 생성 시 저장한 full_name, 없으면 이메일 아이디. */
export const getDisplayName = cache(async (): Promise<string | null> => {
  const u = await getSession()
  if (!u) return null
  return displayNameFrom(u.user_metadata, u.email)
})
