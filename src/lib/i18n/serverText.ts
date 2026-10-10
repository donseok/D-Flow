// 서버가 lib·가드의 문구를 응답에 싣는 자리의 도우미.
// 영어 화면이 있던 때에는 lib 의 한국어 문구를 요청의 화면 언어로 바꾸는 번역 계층이었다. 제품이 한국어 전용이 되어(2026-10-10 결정)
// 지금은 받은 문구를 그대로 돌려준다 — 이름과 인자(t)는 호출부(액션·내부 API 수백 곳)를 건드리지 않으려고 남겼다.
// 새 코드는 이 도우미로 감쌀 필요가 없다(문구를 그대로 실으면 된다). 가드 사유의 비교는 문구가 아니라 코드(guardCodeOf)로 한다.
import 'server-only'
import type { GuardCode } from '@/lib/authz/errors'
import type { ServerTranslate } from './serverDict'
import type { Locale } from './dict'

/** lib 문구를 그대로 돌려준다(없는 값도 그대로) */
export function libText<M extends string | null | undefined>(_t: ServerTranslate, message: M): M | string {
  return message
}

/** `fieldErrors`·행 오류 목록을 그대로(사본) 돌려준다 */
export function libMessages<T extends { message: string }>(_t: ServerTranslate, items: readonly T[]): T[] {
  return [...items]
}

/** 가드·관문의 실패(결과 객체 또는 그 문구)의 문구 */
export function guardText(_t: ServerTranslate, g: string | { error: string; code?: GuardCode }): string {
  return typeof g === 'string' ? g : g.error
}

/**
 * 실패한 가드·관문·lib 결과를 액션의 실패 결과로 — `if (!g.ok) return denied(g, t)`. `{ ok: false, error }` 만 돌려준다
 * (가드의 `code`·그 밖의 필드는 싣지 않는다 — 액션 계약은 그대로다).
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- 호출부(`denied(g, t)`)를 그대로 두려고 남긴 자리다
export function denied(g: { ok: false; error: string; code?: GuardCode }, _t: ServerTranslate): { ok: false; error: string } {
  return { ok: false, error: g.error }
}

/** lib 함수의 결과를 액션이 통째로 돌려줄 때(`return failureText(t, r)`) — 받은 그대로 */
export function failureText<R>(_t: ServerTranslate, result: R): R {
  return result
}

/** 서버 화면용 — 로더(lib)의 결과를 받은 그대로 */
export function failureTextIn<R>(_locale: Locale, result: R): R {
  return result
}
