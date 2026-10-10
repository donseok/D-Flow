import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { CSP_HEADER, CSP_REPORT_ONLY_HEADER, buildCsp, cspModeOf } from '@/lib/http/securityHeaders'

/** 요청마다 새 nonce(128비트 난수의 base64) — 엣지 런타임이라 Web Crypto 만 쓴다 */
function newNonce(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))))
}

export async function middleware(req: NextRequest) {
  // ── CSP nonce(src/lib/http/securityHeaders.ts 머리 주석 ①) — 세션 검증과 독립이다: 아래 인증 흐름은 그대로 두고 헤더만 싣는다 ──
  // 요청 헤더에 싣는 이유: Next 는 **요청**의 CSP 헤더에서 nonce 를 읽어 자기 인라인 스크립트에 붙인다(앱이 직접 넣는 인라인 스크립트는 없다 —
  // 그래서 nonce 를 따로 내려 주는 헤더도 없다. 화면이 요청 때 그려져야 nonce 가 붙는다: 루트 레이아웃의 connection()).
  // 아래 NextResponse.next({ request: req }) 두 곳이 이 req 를 그대로 물려주므로 여기서 한 번만 적으면 된다.
  // 클라이언트가 보낸 같은 이름의 헤더는 먼저 지운다 — Next 는 강제 헤더를 먼저 보고 없으면 보고 전용을 보므로, 남겨 두면 우리 nonce 대신 그 값을 읽는다.
  const nonce = newNonce()
  const csp = buildCsp({
    nonce,
    mode: cspModeOf(process.env.CSP_MODE),
    dev: process.env.NODE_ENV === 'development',
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  })
  req.headers.delete(CSP_HEADER)
  req.headers.delete(CSP_REPORT_ONLY_HEADER)
  req.headers.set(csp.key, csp.value)

  // { request: req } 전파가 핵심이다(2026-08-18 수정, supabase 공식 패턴): 토큰 갱신 시
  // 갱신 쿠키를 req.cookies 에도 써서 **같은 요청의 RSC 가 새 토큰을 보게** 한다.
  // 종전엔 res 에만 실어 브라우저는 받지만 당장의 렌더는 만료 토큰으로 조회했고,
  // RLS(to authenticated) 미매칭이 에러가 아니라 200+빈배열로 와 조용한 빈 화면이 됐다.
  let res = NextResponse.next({ request: req })
  const sb = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (toSet) => {
          toSet.forEach(({ name, value }) => req.cookies.set(name, value))
          // 갱신된 req 를 다시 물려 만들어야 RSC 로 가는 요청 헤더에 새 쿠키가 실린다.
          res = NextResponse.next({ request: req })
          toSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options))
        },
      },
    },
  )
  // getUser() 가 아니라 getClaims() 를 쓴다 — getUser() 는 매 요청 GoTrue /auth/v1/user 로
  // 네트워크 왕복을 강제하지만(클릭당 100~180ms), 이 프로젝트의 JWT 는 비대칭 서명(ES256/EC,
  // JWKS 키 1개·대칭 oct 키 없음)이라 getClaims() 가 JWKS 캐시로 로컬 서명 검증만 하고 끝난다.
  // (대칭 HS* 키였다면 getClaims 가 내부적으로 getUser() 로 폴백해 이득이 0이 된다.)
  //
  // 쿠키를 직접 디코드하는 방식으로 바꾸지 말 것: 이 호출은 인증 게이트인 동시에 토큰 자동
  // 갱신 지점이다. getClaims() → getSession() → 만료 시 _callRefreshToken 경로가 갱신 토큰을
  // 발급하고, 위 setAll 이 그 쿠키를 res 에 싣는다. RSC 클라이언트는 Next 15 에서 쿠키 쓰기가
  // 막혀 있어 갱신을 영속할 수 없으므로, 여기서 갱신이 빠지면 액세스 토큰 수명(기본 1h) 뒤
  // 사용자가 조용히 로그아웃된다.
  const { data } = await sb.auth.getClaims()
  const isLogin = req.nextUrl.pathname.startsWith('/login')
  if (!data?.claims && !isLogin) {
    // 리다이렉트에도 갱신 쿠키를 실어 보낸다 — 안 실으면 방금 갱신된 세션이 유실된다.
    const redirect = NextResponse.redirect(new URL('/login', req.url))
    res.cookies.getAll().forEach(c => redirect.cookies.set(c))
    return redirect
  }
  // 응답에는 정책 헤더 하나만 싣는다(기본은 강제 헤더, CSP_MODE=report 면 보고 전용) — next.config.ts 의 정적 헤더가 낸 같은 이름의 값을 덮는다.
  // report 모드의 강제 헤더(frame-ancestors 'none')는 정적 헤더의 것을 그대로 둔다: 여기서 그 헤더를 응답에 실으면 Next 가 그것을 요청 헤더로도
  // 옮겨 nonce 없는 값이 먼저 읽힌다(인라인 스크립트에 nonce 가 붙지 않는다). 리다이렉트 응답은 문서가 아니라 정적 헤더로 충분하다.
  res.headers.set(csp.key, csp.value)
  return res
}

// 정적 자산(로고 등 public 이미지·아이콘)·API·로그인 경로는 인증 리다이렉트에서 제외 —
// 미제외 시 로그인 페이지의 public 이미지 요청이 /login 으로 307 되어 이미지가 깨진다.
// API 엔드포인트는 라우트 핸들러에서 인증을 처리하므로 middleware 제외.
// /share/** 는 비로그인 외부 열람 경로 — 토큰 검증은 페이지가 수행.
// /invite/** 는 비로그인 초대 수령 경로 — 링크만으로 가입·합류하므로 세션이 없다.
// `share/`·`invite/` 로 앵커: 접두사만 쓰면 /share-xxx 같은 미래 경로까지 인증이 풀린다.
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|login|api|share/|invite/|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico)).*)'],
}
