import { createServerClient as create } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

export async function createServerClient() {
  const cookieStore = await cookies()
  return create(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          // RSC 렌더 중에는 Next 15 가 쿠키 쓰기를 throw 로 막는다. 토큰 갱신 영속은
          // 미들웨어가 책임지므로(src/middleware.ts — { request } 전파) 여기서는 무해화한다.
          // 안 감싸면 렌더 중 우연히 갱신이 겹칠 때 페이지 전체가 500 이 된다.
          try {
            toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
          } catch {}
        },
      },
    },
  )
}

/**
 * 인증 메일(비밀번호 재설정)을 요청하는 익명 클라이언트 — 세션·쿠키를 만지지 않는다(로그인 전 화면의 서버 액션이 쓴다).
 * flowType 을 implicit 로 둔다: 쿠키 클라이언트의 기본(PKCE)은 요청한 브라우저에 검증값을 심어, 메일을 다른 기기·다른 브라우저에서 열면
 * 링크가 죽는다. 재설정 메일은 흔히 그렇게 열린다. implicit 은 결과를 주소의 조각(#…)으로 돌려주고 새 비밀번호 화면이 그것을 읽는다.
 * anon 키 클라이언트다(service_role 이 아니다) — 할 수 있는 일은 누구나 부를 수 있는 인증 API 뿐이다.
 */
export function createAuthMailClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { flowType: 'implicit', persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  )
}
