/**
 * 가드 실패 사유(코드·문자열)와 그 HTTP 매핑 — 순수 모듈.
 *
 * index.ts(가드)가 아니라 여기 사는 이유: index.ts 는 테스트에서 통째로 vi.mock 되는 모듈이고
 * (가드 몇 개만 스텁하는 테스트가 37개) 라우트가 거기서 denyStatus 를 가져오면 모킹된 문맥에서
 * export 누락으로 터진다 — 실제로 이 배치로 라우트 테스트가 깨졌다.
 * 문자열과 매핑은 I/O 가 없으니 분리해 둔다.
 */

export const ERR_LOOKUP = '권한을 확인할 수 없어 중단했습니다.'
export const ERR_DENIED = '권한 없음'
export const ERR_ANON = '로그인 필요'
export const ERR_MISSING = '대상을 찾을 수 없습니다.'
/** 모듈 관문(src/lib/modules/gate.ts)의 거부 사유 — 사용자에게 보인다. 설정 조회 실패·손상·꺼짐을 구별하지 않는다(존재 은닉, 원인은 로그) */
export const ERR_MODULE_DISABLED = '이 기능은 지금 사용할 수 없습니다.'

/** 가드·관문 실패의 구분 코드 — 비교는 문구가 아니라 이 값으로 한다(문구를 고쳐도 판정이 흔들리지 않는다) */
export type GuardCode = 'lookup' | 'denied' | 'anon' | 'missing' | 'module_disabled'

/** 코드 → 문구(위 상수 그대로) */
export const GUARD_TEXT: Readonly<Record<GuardCode, string>> = {
  lookup: ERR_LOOKUP,
  denied: ERR_DENIED,
  anon: ERR_ANON,
  missing: ERR_MISSING,
  module_disabled: ERR_MODULE_DISABLED,
}

const CODE_BY_TEXT: ReadonlyMap<string, GuardCode> = new Map(
  (Object.entries(GUARD_TEXT) as [GuardCode, string][]).map(([code, text]) => [text, code]),
)

/** 가드·관문의 실패 결과 — `code` 는 선택이다(가드를 통째로 대역하는 테스트·옛 호출부는 문구만 싣는다. 그때는 문구로 코드를 읽는다) */
export interface GuardFailure { ok: false; error: string; code?: GuardCode }

/** 실패 결과를 만든다 — 문구는 코드 겸용 상수 그대로다 */
export const guardFail = (code: GuardCode): GuardFailure => ({ ok: false, error: GUARD_TEXT[code], code })

/**
 * 가드·관문 실패의 코드. 결과 객체면 `code` 를 먼저 보고, 없으면(대역·문구만 넘겨받은 자리) 문구로 읽는다.
 * 다섯 가지가 아니면 null(그 밖의 사유 — 호출부가 fallback 을 고른다. 모르는 값을 '거부'로 단정하지 않는다).
 */
export function guardCodeOf(x: string | { error?: unknown; code?: unknown } | null | undefined): GuardCode | null {
  if (x === null || x === undefined) return null
  if (typeof x === 'string') return CODE_BY_TEXT.get(x) ?? null
  if (typeof x.code === 'string' && Object.hasOwn(GUARD_TEXT, x.code)) return x.code as GuardCode
  return typeof x.error === 'string' ? CODE_BY_TEXT.get(x.error) ?? null : null
}

const STATUS: Readonly<Partial<Record<GuardCode, number>>> = { anon: 401, denied: 403, missing: 404, module_disabled: 404 }

/**
 * 가드 실패 → HTTP status. 코드로 판정한다(결과 객체를 넘기면 `code`, 문구를 넘기면 문구 → 코드).
 * 비로그인 401 · 권한 없음 403 · 대상 없음 404 · 모듈 꺼짐 404 · 그 외(권한 조회 실패 등)는 호출부가 고른 fallback.
 * 404 는 타 워크스페이스·미존재 프로젝트의 존재 은닉이다 — 403 으로 답하면 '있다'는 사실이 샌다.
 * 꺼진 모듈은 존재를 알리지 않는다(정본 §3.2.4) — fallback 무시.
 * wiki/reindex 는 503(판정 불가)을, 나머지 라우트는 500(서버 문제)을 택했다.
 */
export function denyStatus(error: string | { error?: unknown; code?: unknown }, fallback: number = 500): number {
  const code = guardCodeOf(error)
  return (code && STATUS[code]) ?? fallback
}
