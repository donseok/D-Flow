import { requestCache as cache } from '@/lib/server/requestCache'
import { createServerClient } from './supabase/server'
import { getRequestClaims } from './supabase/claims'
import { displayNameFrom } from './domain/display-name'

/**
 * 로그인 사용자 — 액세스 토큰(JWT)의 서명 검증 결과에서 만든다. 호출부가 읽는 칸(id·email·user_metadata)만 싣는다.
 * auth.users 행 전체(identities·factors 등)가 아니다.
 */
export interface SessionUser {
  id: string
  email: string | undefined
  user_metadata: Record<string, unknown>
  app_metadata: Record<string, unknown>
}

// 같은 요청 안의 세션 조회는 한 번만 한다. RSC 는 React cache, /api/shell 같은
// 명시적 읽기 요청은 요청 캐시를 사용한다. 다른 요청에서는 사용자 상태를 새로 검증한다.
//
// getUser() 가 아니라 getClaims() 를 쓴다 — getUser() 는 매 호출 GoTrue /auth/v1/user 로 네트워크 왕복을 하고
// (GoTrue 가 안에서 users·mfa_factors·identities·sessions·mfa_amr_claims 를 차례로 읽는다), (app) 레이아웃·범위 레이아웃·거의 모든 페이지와 서버 액션이
// 이 함수를 부르므로 화면 이동마다 그 왕복이 직렬 폭포(레이아웃은 부모가 끝나야 자식이 실행된다)에 끼었다.
// 이 프로젝트의 JWT 는 비대칭 서명(ES256)이라 getClaims() 는 JWKS 캐시로 로컬 검증만 한다(src/middleware.ts 의 같은 주석 참고).
// 이미 인증 게이트(미들웨어)와 권한 판정(getActor)이 getClaims 기준이라 이 호출만 getUser 일 때 얻는 것은 없었다 —
// 갈리는 건 토큰 수명(1h) 안에서 서버가 세션을 지운 직후뿐인데, 그 창은 미들웨어·getActor 에도 똑같이 열려 있다.
// 검증 실패·만료·세션 없음은 null(비로그인)이다 — 폴백으로 넓히지 않는다(fail-closed).
// 표시 이름의 근거 user_metadata.full_name 은 계정 생성·초대 수락 때만 쓰이고 그 뒤로 바뀌지 않는다(JWT 에 실려 있다).
export const getSession = cache(async (): Promise<SessionUser | null> => {
  const { data } = await getRequestClaims(await createServerClient())
  const claims = data?.claims
  if (!claims?.sub) return null
  return {
    id: claims.sub,
    email: claims.email,
    user_metadata: (claims.user_metadata ?? {}) as Record<string, unknown>,
    app_metadata: (claims.app_metadata ?? {}) as Record<string, unknown>,
  }
})

/** 헤더 표시용 로그인 사용자 이름 — 계정 생성 시 저장한 full_name, 없으면 이메일 아이디. */
export const getDisplayName = cache(async (): Promise<string | null> => {
  const u = await getSession()
  if (!u) return null
  return displayNameFrom(u.user_metadata, u.email)
})
