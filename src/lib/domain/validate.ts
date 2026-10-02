// 공용 입력 검증 유틸 — 클라이언트/서버 양쪽에서 동일 규칙을 쓰기 위한 순수 함수.

/** 이메일 형식 검증. 공백·@·도메인 최소 형태만 확인(과도한 엄격 규칙은 지양). */
export function isValidEmail(email: string): boolean {
  const t = email.trim()
  if (!t) return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)
}

/**
 * 시작일~종료일 범위 검증. null/빈문자열은 "미입력"으로 간주해 통과.
 * 둘 다 있으면 YYYY-MM-DD 형식 확인 후 시작 <= 종료(하루짜리 프로젝트 허용).
 */
export function isValidDateRange(start: string | null, end: string | null): boolean {
  if (!start || !end) return true
  const re = /^\d{4}-\d{2}-\d{2}$/
  if (!re.test(start) || !re.test(end)) return false
  return start <= end
}

/** 날짜 하나의 형식·실재 — YYYY-MM-DD 이고 Date 왕복이 같은 문자열이어야 한다(2026-02-30·2026-13-45 거부). 빈 값 처리는 호출부 몫 */
export function isValidIsoDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const d = new Date(`${v}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
}

/** UUID 형태 검증의 단일 출처(사본 5벌 정리). 버전 니블까지 좁힌 변형이 필요하면 호출부에 사유를 남길 것. */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 식별자 인자의 안전한 모양 — 영숫자·밑줄·하이픈 1~64자. 소속 판정이 참을 돌려주는 호출자(플랫폼 관리자)의 입력이 줄바꿈·임의 길이로
 *  로그·설정 조회 오류에 실리지 않게 하는 입구 검사다(uuid 인지는 보지 않는다 — 테스트 픽스처의 'ws-1' 같은 값도 받는다). */
export const SAFE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

export function isUuidLike(v: string): boolean {
  return UUID_RE.test(v)
}
