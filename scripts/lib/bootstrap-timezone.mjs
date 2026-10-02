// scripts/lib/bootstrap-timezone.mjs — dev-bootstrap 의 BOOTSTRAP_TIMEZONE(스펙 D13 ②·D54). 순수. I/O 없음.
// .mjs 는 src/lib/domain/calendar.ts 의 parseTimezone 을 import 하지 못한다 — 같은 규칙(① 오프셋 꼴 사전 거부 ② '/' 없는 이름은 닫힌 허용 목록만
// — L1 ③ Intl 생성 성공 ④ 풀린 이름이 오프셋 꼴이면 거부 ⑤ 저장 값 = 런타임 목록의 표기(대소문자만 정규화 — J2 별칭 보존) 또는 입력)을
// 여기 한 번 더 적는다. tests/scripts/bootstrap-timezone.test.ts 가 골든·L1 표본 전부로 두 판정이 같음을 단언한다(bootstrap-modules.mjs 선례).
export const DEFAULT_BOOTSTRAP_TIMEZONE = 'UTC'
const NO_SLASH_TIMEZONES = ['UTC', 'GMT', 'EST5EDT', 'CST6CDT', 'MST7MDT', 'PST8PDT']
const OFFSET_FORM = /^(?:[+\-−]\d|(?:GMT|UTC|UT)\s*[+\-−]\s*\d)/i

function spellingOf(lower) {
  try {
    return Intl.supportedValuesOf('timeZone').find((n) => n.toLowerCase() === lower)
  } catch {
    return undefined
  }
}

/** undefined → 기본값. 빈 문자열은 거부(조용히 기본값으로 바꾸지 않는다). 오프셋 꼴(+09:00·GMT+1)은 PG 가 부호를 반대로 읽으므로 거부 */
export function parseBootstrapTimezone(raw) {
  if (raw === undefined) return { ok: true, value: DEFAULT_BOOTSTRAP_TIMEZONE }
  const v = String(raw).trim()
  if (!v) return { ok: false, error: '비어 있다 — IANA 이름(예: Asia/Tokyo, Europe/Berlin, UTC)을 준다' }
  if (OFFSET_FORM.test(v)) return { ok: false, error: `오프셋 꼴은 받지 않는다 — IANA 이름을 준다: ${v}` }
  const noSlash = v.includes('/') ? null : NO_SLASH_TIMEZONES.find((n) => n.toLowerCase() === v.toLowerCase())
  if (noSlash === undefined) return { ok: false, error: `'/' 없는 이름은 ${NO_SLASH_TIMEZONES.join('·')} 만 받는다: ${v}` }
  let resolved
  try {
    resolved = new Intl.DateTimeFormat('en', { timeZone: v }).resolvedOptions().timeZone
  } catch {
    return { ok: false, error: `시간대 이름이 아니다: ${v}` }
  }
  if (OFFSET_FORM.test(resolved)) return { ok: false, error: `오프셋 꼴은 받지 않는다 — IANA 이름을 준다: ${v}` }
  return { ok: true, value: noSlash ?? spellingOf(v.toLowerCase()) ?? v }
}

/**
 * 쓰기 판단 — BOOTSTRAP_TIMEZONE 을 env 로 명시했을 때만 쓴다(기존 값도 덮는다). 명시하지 않으면 값이 없어도 쓰지 않는다(A-5 리뷰 O8):
 * 레지스트리 기본값이 같은 UTC 라 결과는 같고, 키 상태가 default 로 남아야 설정 화면이 브라우저 시간대를 제안한다(스펙 D13 ② — 과제 26).
 * 기존 값(설정 화면에서 바꾼 값)도 그대로 둔다. existingValues 는 판단에 쓰지 않지만 호출부의 안내 문구가 읽는다.
 * @param {{ envValue: string | undefined, existingValues: Record<string, unknown> | null | undefined }} input
 */
export function bootstrapTimezonePlan({ envValue }) {
  const parsed = parseBootstrapTimezone(envValue)
  if (!parsed.ok) return parsed
  return { ok: true, write: envValue !== undefined, value: parsed.value }
}
