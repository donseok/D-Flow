// 응답 보안 헤더(운영 준비) — 정책 조립은 이 순수 모듈 한 곳이다. next.config.ts 의 headers() 와 src/middleware.ts 가 함께 import 하므로
// 경로 별칭(@/)·다른 모듈·Node 전용 API 를 쓰지 않는다(설정 파일·엣지 런타임 양쪽에서 돈다. tests/http/security-headers.test.ts 가 정책을 고정한다).
//
// ── CSP 는 두 갈래로 나간다 ──
//   ① 미들웨어가 도는 경로(로그인 뒤의 앱 화면 전부): 요청마다 만든 nonce 를 실은 **엄격한 정책**(script-src 'self' 'nonce-…' 'strict-dynamic').
//      미들웨어가 그 정책을 요청 헤더에도 실어 Next 가 자기 인라인 스크립트(부트스트랩·flight 조각)에 nonce 를 붙인다.
//   ② 미들웨어가 제외하는 경로(/login·/invite/**·/share/**·/api/**·정적 자산): next.config.ts 의 정적 헤더가 **nonce 없는 정책**을 낸다.
//      /login·/invite·/share 화면도 루트 레이아웃을 거쳐 Next 의 인라인 스크립트를 싣는데, 그 내용은 요청마다 달라 해시로 고정할 수 없고
//      nonce 는 요청마다 도는 코드(미들웨어)만 만들 수 있다. 그래서 이 경로의 script-src 는 'self' 'unsafe-inline' 로 남긴다.
//      미들웨어 matcher 를 넓히지 않은 이유: 그 matcher 는 세션 검증·리다이렉트와 한 몸이라, 비로그인 경로를 넣으면 인증 분기를 함께 고쳐야 한다
//      (CSP 때문에 인증 게이트를 건드리지 않는다). 이 경로들은 로그인 전 화면이라 세션 뒤의 데이터가 없고, 본문은 raw HTML 을 렌더하지 않는다.
//   정적 헤더는 전 경로에 걸려 있으므로 ①의 경로에도 먼저 붙고, 미들웨어의 같은 이름 헤더가 그 값을 덮는다(Next 의 라우팅 순서: 설정 헤더 → 미들웨어).
//   덮지 못하고 두 정책이 함께 나가더라도 화면은 같다 — nonce 가 붙은 스크립트는 두 정책을 모두 통과한다(②는 ①보다 느슨하다).
//
// ── 모드(CSP_MODE) ── enforce(기본): 정책을 Content-Security-Policy 로 낸다(정책 밖의 자원을 막는다). report: 같은 정책을
//   Content-Security-Policy-Report-Only 로 낸다(막지 않고 보고만) — 강제 때문에 화면이 깨졌을 때 되돌리는 스위치다.
//   판정은 닫힌 쪽이 기본이다(cspModeOf): 정확히 'report' 일 때만 보고 전용이고, 값이 없거나 오타면 강제한다 — 보안 설정이 오타로 풀리지 않게.
//   기본을 강제로 둔 근거: CSP_MODE=enforce 빌드에서 로컬 E2E 와 화면 순회로 위반 0 을 확인했다(2026-10-10 — docs/runbook-selfhost.md '응답 보안 헤더'의
//   확인됨/미확인 표). 정책이 화면과 어긋나면 스크립트·그림·글꼴이 조용히 막히고 그 깨짐은 빌드·린트·타입체크·단위 테스트로 잡히지 않으므로,
//   정책이나 인라인 스크립트를 바꾸면 그 표의 화면을 다시 본다. 값은 빌드 때 굳는다 — 정적 헤더는 빌드 산출물(routes-manifest)에 들어가고,
//   미들웨어 쪽도 어긋나지 않게 next.config.ts 가 같은 값을 빌드 env 로 박는다(되돌리려면 CSP_MODE=report 로 다시 빌드).
// 프레임 차단은 두 모드 모두 강제한다(X-Frame-Options + 강제 헤더의 frame-ancestors) — 보고 전용 헤더의 frame-ancestors 는 막지 않기 때문이다.
// 위반 보고는 CSP_REPORT_PATH(무인증 수집 — 차단된 주소와 지시어만 서버 로그에 남긴다)로 보낸다.

export interface HeaderRule { source: string; headers: { key: string; value: string }[] }
export interface SecurityHeaderEnv {
  /** 배포 환경 정본(APP_ENV — 설정 파일이 호스팅 플랫폼의 환경 값에서 옮겨 준 것 포함) */
  appEnv?: string
  /** STAGING=1 이면 검색엔진 노출을 막는다 */
  staging?: string
  /** NEXT_PUBLIC_SUPABASE_URL — API·Realtime(ws)·Storage 의 출처를 여기서 파생한다 */
  supabaseUrl?: string
  /** next dev 인가(NODE_ENV=development) — React Refresh 가 eval 을 쓴다 */
  dev?: boolean
  /** CSP_MODE 원문 — 'report' 일 때만 보고 전용, 그 밖(없음·오타 포함)은 강제(cspModeOf) */
  cspMode?: string
}

export type CspMode = 'report' | 'enforce'
/** 정확히 'report'(앞뒤 공백 허용)일 때만 보고 전용 — 없음·오타·대문자는 강제다(fail-closed: 모르는 값이 보호를 풀지 않는다) */
export function cspModeOf(raw: string | undefined): CspMode {
  return raw?.trim() === 'report' ? 'report' : 'enforce'
}

/** 위반 보고 수집 주소(src/app/api/csp-report/route.ts) — report-uri(옛 방식)와 report-to(Reporting-Endpoints) 둘 다 여기를 가리킨다 */
export const CSP_REPORT_PATH = '/api/csp-report'
const REPORT_GROUP = 'csp-endpoint'
export const REPORTING_ENDPOINTS_VALUE = `${REPORT_GROUP}="${CSP_REPORT_PATH}"`

/** nonce 로 쓸 수 있는 글자만(base64·base64url) — 정책 문자열에 다른 지시어를 끼워 넣지 못하게 형식 밖이면 nonce 없는 정책으로 내려간다 */
const NONCE_RE = /^[A-Za-z0-9+/_-]{16,}={0,2}$/

const ALL = '/:path*'

/** Supabase URL → [https 출처, ws 출처]. 형식이 아니거나 http(s) 가 아니면 [] — 정책에 엉뚱한 값을 싣지 않는다 */
export function supabaseOrigins(url: string | undefined): string[] {
  if (!url) return []
  let u: URL
  try { u = new URL(url.trim()) } catch { return [] }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return []
  return [u.origin, `${u.protocol === 'https:' ? 'wss:' : 'ws:'}//${u.host}`]
}

/**
 * CSP 지시어 — 앱이 실제로 쓰는 출처만(자체, Supabase, 글꼴 CDN, data:·blob:, 본문 그림의 https:).
 * nonce 가 있으면 엄격한 script-src(머리 주석 ①), 없으면 정적 경로의 script-src(②)다. 나머지 지시어는 두 갈래가 같다.
 */
export function cspDirectives(env: SecurityHeaderEnv & { nonce?: string }): Record<string, string[]> {
  const [sbHttp, sbWs] = supabaseOrigins(env.supabaseUrl)
  const sb = sbHttp ? [sbHttp] : []
  const FONT_CDN = 'https://cdn.jsdelivr.net' // Pretendard(src/app/layout.tsx 의 stylesheet link 와 그 CSS 가 부르는 글꼴 파일)
  const nonce = env.nonce && NONCE_RE.test(env.nonce) ? env.nonce : null
  const evalInDev = env.dev ? ["'unsafe-eval'"] : []
  return {
    'default-src': ["'self'"],
    'script-src': nonce
      // 'strict-dynamic': nonce 가 붙은 스크립트가 불러오는 청크(웹팩 런타임의 동적 삽입)를 믿는다 — 지원 브라우저에서는 'self' 가 무시되고,
      // 지원하지 않는 옛 브라우저에서는 'self' + nonce 로 동작한다. 앱이 직접 넣는 인라인 스크립트는 없다(해시 허용 없음) — 인라인은 Next 의 것뿐이고
      // Next 가 요청 헤더의 nonce 를 붙인다.
      ? ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...evalInDev]
      // 정적 경로 — nonce 를 만들 코드가 돌지 않는다(머리 주석 ②). 해시를 같이 적으면 'unsafe-inline' 이 무시되어 Next 의 인라인이 막힌다 — 적지 않는다
      : ["'self'", "'unsafe-inline'", ...evalInDev],
    // 스타일은 nonce 화하지 않는다(범위 밖): React 의 인라인 style 속성(진행 막대·간트·표 폭 등 값이 실행 중에 정해진다)과 mermaid 가 그리는 SVG 의
    // style 속성은 nonce·해시로 열 수 없다(속성에는 nonce 가 없다 — 'unsafe-hashes' 로도 값이 고정이어야 한다). 그래서 'unsafe-inline' 을 둔다.
    'style-src': ["'self'", "'unsafe-inline'", FONT_CDN],
    'font-src': ["'self'", 'data:', FONT_CDN],
    // 로고 미리보기(blob:)·아이콘(data:)·Storage 서명 URL, 그리고 **https: 전체** — 회의록·위키·작업 명세의 마크다운 본문(MarkdownView — 그림 노드를
    // 거르지 않는다)은 외부 주소의 그림을 담을 수 있다. 사용자가 쓴 문서의 그림이 강제 모드에서 조용히 깨지지 않게 연다. 잃는 것: 그림 요청으로
    // 외부에 신호를 보내는 길(추적 픽셀)을 CSP 로는 막지 못한다 — 본문은 로그인한 구성원(또는 연동 토큰)이 쓰고 raw HTML 은 렌더하지 않는다.
    // http: 그림은 열지 않는다(https 화면에서는 브라우저가 어차피 막는다).
    'img-src': ["'self'", 'data:', 'blob:', 'https:', ...sb],
    'media-src': ["'self'", 'blob:', ...sb],
    // REST·Auth·Storage(https) 와 Realtime(wss)
    'connect-src': ["'self'", ...sb, ...(sbWs ? [sbWs] : [])],
    // 첨부 미리보기 iframe(Storage 서명 URL)·내려받기용 blob:
    'frame-src': ["'self'", 'blob:', ...sb],
    'worker-src': ["'self'", 'blob:'],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
    // 위반 보고 — report-uri(지금 브라우저 대부분이 듣는다)와 report-to(Reporting-Endpoints 헤더의 이름) 둘 다
    'report-uri': [CSP_REPORT_PATH],
    'report-to': [REPORT_GROUP],
  }
}

export function serializeCsp(directives: Record<string, string[]>): string {
  return Object.entries(directives).map(([name, values]) => `${name} ${values.join(' ')}`).join('; ')
}

export const CSP_HEADER = 'Content-Security-Policy'
export const CSP_REPORT_ONLY_HEADER = 'Content-Security-Policy-Report-Only'

/**
 * 정책을 실을 헤더 한 개 — enforce 면 Content-Security-Policy, report 면 -Report-Only 로 **같은 정책**을 낸다.
 * nonce 를 주면 미들웨어 경로의 엄격한 정책, 안 주면 정적 경로의 정책이다. 순수 함수(요청·환경을 읽지 않는다).
 */
export function buildCsp(input: { nonce?: string; mode: CspMode; dev?: boolean; supabaseUrl?: string }): { key: string; value: string } {
  const value = serializeCsp(cspDirectives({ nonce: input.nonce, dev: input.dev, supabaseUrl: input.supabaseUrl }))
  return { key: input.mode === 'enforce' ? CSP_HEADER : CSP_REPORT_ONLY_HEADER, value }
}

/**
 * 쓰지 않는 브라우저 기능을 닫는다. 이 앱은 카메라·마이크·위치·결제·USB·센서를 쓰지 않는다(src 에 getUserMedia·geolocation 호출 0건 —
 * 회의록 녹음은 외부 도구가 올린다). 클립보드(복사 버튼)·전체 화면은 기본값(자기 출처 허용)에 맡겨 적지 않는다.
 */
export const PERMISSIONS_POLICY = [
  'camera=()', 'microphone=()', 'geolocation=()', 'payment=()', 'usb=()', 'bluetooth=()', 'serial=()', 'hid=()', 'midi=()',
  'accelerometer=()', 'gyroscope=()', 'magnetometer=()', 'display-capture=()', 'browsing-topics=()',
].join(', ')

/** HSTS 2년 — preload 는 넣지 않는다(목록 등재는 되돌리기 어렵고 하위 도메인 전체의 약속이라 운영자가 따로 정한다) */
export const HSTS_VALUE = 'max-age=63072000; includeSubDomains'

/**
 * next.config.ts 의 headers() 결과. 규칙은 전 경로에 걸고, 뒤 규칙이 앞 규칙의 같은 헤더를 덮지 않게 한 규칙에 한 번씩만 적는다.
 * 기존 두 규칙(스테이징의 X-Robots-Tag, 프로덕션의 x-vercel-skip-toolbar)은 조건·값 그대로 둔다.
 */
export function buildSecurityHeaders(env: SecurityHeaderEnv): HeaderRule[] {
  const rules: HeaderRule[] = []
  const mode = cspModeOf(env.cspMode)
  // 스테이징은 검색엔진에 노출하지 않는다 (스펙 §5 — STAGING=1 은 스테이징 배포에만 설정).
  if (env.staging === '1') rules.push({ source: ALL, headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] })
  // 프로덕션 배포에서만 Vercel Toolbar 숨김(공식 x-vercel-skip-toolbar 헤더). Preview 배포의 코멘트/피드백 기능은 유지한다. (BUG-07)
  if (env.appEnv === 'production') rules.push({ source: ALL, headers: [{ key: 'x-vercel-skip-toolbar', value: '1' }] })
  rules.push({
    source: ALL,
    headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Permissions-Policy', value: PERMISSIONS_POLICY },
      // enforce 모드(기본): 정책 전체가 강제 헤더 하나로 나간다(frame-ancestors 포함) — 보고 전용 헤더는 없다.
      // report 모드: 강제하는 것은 프레임 차단 한 지시어뿐이고(자원 로딩에 영향 없음) 정책 전체는 보고 전용으로 나간다.
      // 미들웨어 경로에서는 미들웨어가 정책 헤더(둘 중 그 모드의 것)를 nonce 정책으로 덮는다. report 모드의 프레임 차단 헤더는 미들웨어가 건드리지 않는다.
      ...(mode === 'enforce' ? [] : [{ key: CSP_HEADER, value: "frame-ancestors 'none'" }]),
      buildCsp({ mode, dev: env.dev, supabaseUrl: env.supabaseUrl }),
      { key: 'Reporting-Endpoints', value: REPORTING_ENDPOINTS_VALUE },
      // HSTS 는 프로덕션에서만 — 로컬·미리보기·평문 HTTP 리허설 호스트를 https 로 묶지 않는다
      ...(env.appEnv === 'production' ? [{ key: 'Strict-Transport-Security', value: HSTS_VALUE }] : []),
    ],
  })
  return rules
}
