/**
 * 로그인 뒤 돌아갈 자리(?next=) — 로그인하지 않은 채 보호 화면을 열면 미들웨어가 그 주소를 실어 /login 으로 보내고,
 * 로그인 화면이 성공 뒤 그 자리로 돌려보낸다(2026-10-12 UAT PERM-13 — 늘 홈으로 떨어졌다).
 *
 * 받는 값은 주소창에서 오므로 믿지 않는다: 이 사이트 안의 경로(`/` 로 시작)만 통과시킨다.
 * `//host`·`/\host`(브라우저가 다른 출처로 읽는다)·제어문자·로그인 화면 자신은 버리고 홈으로 간다.
 */
const NEXT_MAX_CHARS = 2000

export function safeNextPath(raw: string | null | undefined): string {
  if (!raw || raw.length > NEXT_MAX_CHARS) return '/'
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/'
  if (/[\u0000-\u001f\\]/.test(raw)) return '/'
  if (raw === '/login' || raw.startsWith('/login/') || raw.startsWith('/login?')) return '/'
  return raw
}

/** 미들웨어가 /login 에 붙일 next 값 — 홈은 싣지 않는다(기본이 홈이다) */
export function nextParamFor(pathname: string, search: string): string | null {
  const path = `${pathname}${search}`
  return safeNextPath(path) === '/' ? null : path
}
