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

/** 가드·관문 실패의 구분 코드 — 비교는 문구가 아니라 이 값으로 한다(문구는 화면 언어에 따라 달라진다 — i18n 4차) */
export type GuardCode = 'lookup' | 'denied' | 'anon' | 'missing' | 'module_disabled'

/**
 * 코드 → 문구. ko 는 위 상수 그대로(저장·로그·요청 범위 밖의 기본값), en 은 영어 화면에 나가는 글자다(서버 사전 `err.guard.*` 와 같은 글자 —
 * tests/authz/guard-codes.test.ts 가 대조한다). en 을 여기(순수 모듈)에도 두는 이유: 화면이 액션 결과의 문구로 사유를 알아볼 때
 * (`wbsErrorKey`·ClearExcelProfileButton) 영어로 번역된 문구도 같은 코드로 읽어야 한다 — 서버 사전은 클라이언트가 가져올 수 없다.
 */
export const GUARD_TEXT: Readonly<Record<GuardCode, { ko: string; en: string }>> = {
  lookup: { ko: ERR_LOOKUP, en: "Couldn't check permissions, so this was stopped." },
  denied: { ko: ERR_DENIED, en: 'No permission' },
  anon: { ko: ERR_ANON, en: 'Please sign in' },
  missing: { ko: ERR_MISSING, en: 'Target not found.' },
  module_disabled: { ko: ERR_MODULE_DISABLED, en: "This feature isn't available right now." },
}

const CODE_BY_TEXT: ReadonlyMap<string, GuardCode> = new Map(
  (Object.entries(GUARD_TEXT) as [GuardCode, { ko: string; en: string }][]).flatMap(([code, v]) => [[v.ko, code], [v.en, code]] as [string, GuardCode][]),
)

/** 가드·관문의 실패 결과 — `code` 는 선택이다(가드를 통째로 대역하는 테스트·옛 호출부는 문구만 싣는다. 그때는 문구로 코드를 읽는다) */
export interface GuardFailure { ok: false; error: string; code?: GuardCode }

/** 실패 결과를 만든다 — 문구는 한국어(코드 겸용 상수), 화면에 내보낼 때 액션이 `denied(g, t)`·`guardText(t, g)`(i18n/serverText)로 번역한다 */
export const guardFail = (code: GuardCode): GuardFailure => ({ ok: false, error: GUARD_TEXT[code].ko, code })

/**
 * 가드·관문 실패의 코드. 결과 객체면 `code` 를 먼저 보고, 없으면(대역·문구만 넘겨받은 자리) 문구로 읽는다 — 한국어·영어 문구 둘 다 알아본다.
 * 다섯 가지가 아니면 null(그 밖의 사유 — 호출부가 fallback 을 고른다. 모르는 값을 '거부'로 단정하지 않는다).
 */
export function guardCodeOf(x: string | { error?: unknown; code?: unknown } | null | undefined): GuardCode | null {
  if (x === null || x === undefined) return null
  if (typeof x === 'string') return CODE_BY_TEXT.get(x) ?? null
  if (typeof x.code === 'string' && Object.hasOwn(GUARD_TEXT, x.code)) return x.code as GuardCode
  return typeof x.error === 'string' ? CODE_BY_TEXT.get(x.error) ?? null : null
}

/** 코드 → 서버 사전 키(`err.guard.*` — src/lib/i18n/dict/serverUi.ts). 이 모듈은 사전을 값으로 가져오지 않는다(클라이언트도 쓰는 순수 모듈) */
export const GUARD_DICT_KEY = {
  lookup: 'err.guard.lookup', denied: 'err.guard.denied', anon: 'err.guard.anon', missing: 'err.guard.missing', module_disabled: 'err.guard.moduleOff',
} as const satisfies Record<GuardCode, string>
export type GuardDictKey = (typeof GUARD_DICT_KEY)[GuardCode]

/** 가드 문구(또는 결과)면 번역 함수로 풀고, 아니면 받은 문구 그대로 — 서버 번역 함수를 인자로 받는 순수 도우미(표의 `message: ERR_DENIED` 를 푸는 자리) */
export function guardTextBy(t: (key: GuardDictKey) => string, message: string): string {
  const code = guardCodeOf(message)
  return code ? t(GUARD_DICT_KEY[code]) : message
}

const STATUS: Readonly<Partial<Record<GuardCode, number>>> = { anon: 401, denied: 403, missing: 404, module_disabled: 404 }

/**
 * 가드 실패 → HTTP status. 코드로 판정한다(결과 객체를 넘기면 `code`, 문구를 넘기면 문구 → 코드 — 문구가 번역돼도 매핑이 fallback 으로 떨어지지 않는다).
 * 비로그인 401 · 권한 없음 403 · 대상 없음 404 · 모듈 꺼짐 404 · 그 외(권한 조회 실패 등)는 호출부가 고른 fallback.
 * 404 는 타 워크스페이스·미존재 프로젝트의 존재 은닉이다 — 403 으로 답하면 '있다'는 사실이 샌다.
 * 꺼진 모듈은 존재를 알리지 않는다(정본 §3.2.4) — fallback 무시.
 * wiki/reindex 는 503(판정 불가)을, 나머지 라우트는 500(서버 문제)을 택했다.
 */
export function denyStatus(error: string | { error?: unknown; code?: unknown }, fallback: number = 500): number {
  const code = guardCodeOf(error)
  return (code && STATUS[code]) ?? fallback
}
