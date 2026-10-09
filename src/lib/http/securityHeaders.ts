// 응답 보안 헤더(운영 준비) — next.config.ts 의 headers() 가 이 순수 함수의 결과를 그대로 싣는다. 설정 파일이 import 하므로 이 파일은
// 경로 별칭(@/)·다른 모듈을 쓰지 않는다(부작용 없음 — tests/http/security-headers.test.ts 가 정책을 고정한다).
//
// CSP 는 **보고 전용(Content-Security-Policy-Report-Only)** 으로 시작한다. 강제 헤더로 바꾸지 않는 이유: 정책이 실제 화면과 어긋나면
// 스크립트·스타일·글꼴이 조용히 막혀 화면이 깨지는데, 그 깨짐은 빌드·린트·타입체크·단위 테스트 어느 것으로도 잡히지 않는다(2026-07-27 사고와 같은 종류).
// 강제 전환은 배포된 화면에서 브라우저 콘솔의 위반 보고가 0 인 것을 눈으로 확인한 뒤에 한다. 그때 손볼 것:
//   · script-src 의 'unsafe-inline' — Next 의 인라인 부트스트랩과 테마 no-flash 스크립트(src/lib/theme/policy.ts) 때문에 둔다.
//     걷으려면 미들웨어에서 요청마다 nonce 를 만들어야 한다(지금 미들웨어는 인증·토큰 갱신만 한다).
//   · img-src — 회의록·위키 마크다운이 외부 그림 주소를 담으면 여기 걸린다(지금 정책은 자체·data:·blob:·Supabase Storage 만).
//   · 보고 수집 주소(report-to)가 없다 — 위반은 브라우저 콘솔에만 남는다.
// 프레임 차단만은 지금 강제한다(X-Frame-Options + 강제 CSP 의 frame-ancestors 한 지시어) — 이 앱은 자기 화면을 iframe 에 싣지 않고
// (첨부 미리보기 iframe 의 출처는 Supabase Storage 다), frame-ancestors 는 보고 전용 헤더에서는 막지 않기 때문이다.

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
}

const ALL = '/:path*'

/** Supabase URL → [https 출처, ws 출처]. 형식이 아니거나 http(s) 가 아니면 [] — 정책에 엉뚱한 값을 싣지 않는다 */
export function supabaseOrigins(url: string | undefined): string[] {
  if (!url) return []
  let u: URL
  try { u = new URL(url.trim()) } catch { return [] }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return []
  return [u.origin, `${u.protocol === 'https:' ? 'wss:' : 'ws:'}//${u.host}`]
}

/** 보고 전용 CSP 의 지시어 — 앱이 실제로 쓰는 출처만(자체, Supabase, 글꼴 CDN, data:·blob:) */
export function cspDirectives(env: SecurityHeaderEnv): Record<string, string[]> {
  const [sbHttp, sbWs] = supabaseOrigins(env.supabaseUrl)
  const sb = sbHttp ? [sbHttp] : []
  const FONT_CDN = 'https://cdn.jsdelivr.net' // Pretendard(src/app/layout.tsx 의 stylesheet link 와 그 CSS 가 부르는 글꼴 파일)
  return {
    'default-src': ["'self'"],
    'script-src': ["'self'", "'unsafe-inline'", ...(env.dev ? ["'unsafe-eval'"] : [])],
    // 인라인 style 속성(React style·mermaid 가 그리는 SVG)이 있다
    'style-src': ["'self'", "'unsafe-inline'", FONT_CDN],
    'font-src': ["'self'", 'data:', FONT_CDN],
    // 로고 미리보기(blob:)·아이콘(data:)·Storage 서명 URL
    'img-src': ["'self'", 'data:', 'blob:', ...sb],
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
  }
}

export function serializeCsp(directives: Record<string, string[]>): string {
  return Object.entries(directives).map(([name, values]) => `${name} ${values.join(' ')}`).join('; ')
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
      // 강제하는 CSP 는 프레임 차단 한 지시어뿐이다 — 자원 로딩에는 영향이 없다(머리 주석)
      { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
      { key: 'Content-Security-Policy-Report-Only', value: serializeCsp(cspDirectives(env)) },
      // HSTS 는 프로덕션에서만 — 로컬·미리보기·평문 HTTP 리허설 호스트를 https 로 묶지 않는다
      ...(env.appEnv === 'production' ? [{ key: 'Strict-Transport-Security', value: HSTS_VALUE }] : []),
    ],
  })
  return rules
}
