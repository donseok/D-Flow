// lib 가 만든 고정 문구를 요청의 화면 언어로 푸는 서버 전용 도우미(i18n 3차).
// lib 의 문구 상수는 한국어 그대로 둔다 — 코드로 비교되고(가드·테스트), 워커·저장 경로는 화면 언어를 모른다.
// 서버 사전(serverDict.ts)의 `srv.lib.*`·`err.config.*` 키는 그 문구를 ko 값으로 그대로 실은 것이라, ko 값 → 키를 거꾸로 찾아 요청의 언어로 바꾼다
// (화면이 문구로 키를 찾는 src/lib/wbs/actionErrors.ts 와 같은 꼴 — 표를 lib 모듈마다 두지 않고 사전에서 얻는다).
// 가드·관문 결과 다섯 문구(src/lib/authz/errors.ts)도 같은 길로 푼다(`err.guard.*` — i18n 4차: 비교가 문구에서 코드(guardCodeOf)로 옮겨져 번역해도 된다).
// 표에 없는 문구(동적 문구·DB 원문)는 받은 그대로다. lib 문구를 고치면 사전의 ko 값도 같이 고친다 —
// tests/invariants/i18n-server-messages.test.ts 가 사전의 문구가 lib 원문에 그대로 있는지 본다.
import 'server-only'
import { GUARD_DICT_KEY, guardCodeOf, type GuardCode } from '@/lib/authz/errors'
import { SERVER_KO, serverTranslatorFor, type ServerDictKey, type ServerTranslate } from './serverDict'
import type { Locale } from './dict'
import { fill } from './translate'

const REVERSE: ReadonlyMap<string, ServerDictKey> = new Map(
  (Object.entries(SERVER_KO) as [ServerDictKey, string][])
    .filter(([key]) => key.startsWith('srv.lib.') || key.startsWith('err.config.') || key.startsWith('err.guard.'))
    .map(([key, text]) => [text, key]),
)

// ── 값이 끼는 lib 문구(i18n 4차) ──────────────────────────────────────────────────────────────────────────────
// 설정 값 검증(src/lib/settings/defs/** 의 parse — 레지스트리의 parse(raw) 는 번역 함수를 받을 자리가 없다)·추가 정보·크레딧 표·이슈 분석처럼
// 순수 lib 가 값을 끼워 만드는 문구는 `srv.libt.*` 에 틀로 싣는다(ko 값 = lib 의 템플릿에서 `${식}` 을 `{이름}` 으로 바꾼 것).
// 응답을 만드는 자리에서 틀 → 정규식으로 받은 문구를 맞춰 보고, 맞으면 낀 값을 그대로 옮겨 요청의 언어 틀에 채운다. 낀 값이 다시 lib 문구인 자리
// (`{key}: {error}` 의 error — NESTED_SLOTS)와 lib 의 고정 이름인 자리(LABEL_SLOTS)만 그 값도 푼다. 한국어 로캘에서는 같은 틀에 같은 값을 채우므로 글자가 그대로다. 맞는 틀이 없으면 받은 그대로.
const SLOT = /\{(\w+)\}/g
const escapeRe = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

interface Pattern { key: ServerDictKey; re: RegExp; names: string[]; weight: number; literals: string[] }

function compile(key: ServerDictKey, template: string): Pattern {
  const names: string[] = []
  const literals: string[] = []
  let source = '', last = 0, weight = 0
  for (const m of template.matchAll(SLOT)) {
    const literal = template.slice(last, m.index)
    if (literal) literals.push(literal)
    source += escapeRe(literal)
    weight += literal.length
    const seen = names.indexOf(m[1])
    if (seen >= 0) source += `\\${seen + 1}`          // 같은 이름이 두 번 나오면 같은 값이어야 한다
    else { names.push(m[1]); source += '([\\s\\S]+?)' }
    last = m.index + m[0].length
  }
  const tail = template.slice(last)
  if (tail) literals.push(tail)
  weight += tail.length
  return { key, re: new RegExp(`^${source}${escapeRe(tail)}$`), names, weight, literals }
}

/** 글자가 많은 틀부터 맞춰 본다 — `{key}: {error}` 같은 느슨한 틀이 구체적인 틀을 가로채지 않게 */
const PATTERNS: readonly Pattern[] = (Object.entries(SERVER_KO) as [ServerDictKey, string][])
  .filter(([key]) => key.startsWith('srv.libt.'))
  .map(([key, template]) => compile(key, template))
  .sort((a, b) => b.weight - a.weight)

/** 낀 값이 다시 lib 문구인 자리의 이름 — 이 이름의 값만 문구로 다시 푼다(그 밖의 값은 사용자 자료·식별자라 글자 그대로 옮긴다) */
const NESTED_SLOTS: ReadonlySet<string> = new Set(['error', 'message', 'reason', 'configInvalid'])
/** 낀 값이 lib 의 고정 이름(어휘 이름·열 이름·필드 유형)인 자리 — 표에서만 찾아 바꾼다. 사용자가 지은 이름이 우연히 같아도 다른 자리에서는 바뀌지 않는다 */
const LABEL_SLOTS: Partial<Record<ServerDictKey, readonly string[]>> = {
  'srv.libt.vocabGuard.selectedNotUsedProject': ['v'],
  'srv.libt.detect.couldNotFindColumn': ['v'],
  'srv.libt.detect.guessedColumn': ['v2'],
  'srv.libt.customColumns.notTypeFormat': ['type'],
}

function slotValue(t: ServerTranslate, key: ServerDictKey, name: string, value: string, depth: number): string {
  if (NESTED_SLOTS.has(name)) return depth < 3 ? translate(t, value, depth + 1) : value
  if (LABEL_SLOTS[key]?.includes(name)) { const label = REVERSE.get(value); return label ? t(label) : value }
  return value
}

/** 틀에 맞춰 볼 문구의 길이 상한 — lib 의 검증 문구는 짧다. 긴 글(DB 원문·본문)은 틀과 맞춰 보지 않는다(정규식 비용) */
const PATTERN_MAX_LENGTH = 600
/** 틀의 글자 조각이 순서대로 다 들어 있는가 — 정규식을 돌리기 전의 싼 거르기 */
function hasLiterals(message: string, literals: readonly string[]): boolean {
  let from = 0
  for (const literal of literals) {
    const at = message.indexOf(literal, from)
    if (at < 0) return false
    from = at + literal.length
  }
  return true
}

function byPattern(t: ServerTranslate, message: string, depth: number): string | null {
  if (message.length > PATTERN_MAX_LENGTH) return null
  for (const p of PATTERNS) {
    if (!hasLiterals(message, p.literals)) continue
    const m = p.re.exec(message)
    if (!m) continue
    const vars: Record<string, string> = {}
    p.names.forEach((name, i) => { vars[name] = slotValue(t, p.key, name, m[i + 1], depth) })
    return fill(t(p.key), vars)
  }
  return null
}

function translate(t: ServerTranslate, message: string, depth: number): string {
  const key = REVERSE.get(message)
  if (key) return t(key)
  return byPattern(t, message, depth) ?? message
}

/** lib 문구 → 요청의 화면 언어. 고정 문구는 표에서, 값이 낀 문구는 틀에서 찾는다. 어디에도 없으면 받은 값 그대로(없는 값도 그대로 돌려준다) */
export function libText<M extends string | null | undefined>(t: ServerTranslate, message: M): M | string {
  return typeof message === 'string' ? translate(t, message, 0) : message
}

/** `fieldErrors`·행 오류 목록처럼 `message` 를 가진 항목들의 문구를 한 번에 — 다른 칸은 그대로 */
export function libMessages<T extends { message: string }>(t: ServerTranslate, items: readonly T[]): T[] {
  return items.map((item) => ({ ...item, message: translate(t, item.message, 0) }))
}

/**
 * 가드·관문의 실패(결과 객체 또는 그 문구)를 요청의 화면 언어로. 코드(`code` → 없으면 문구)로 고르고, 다섯 가지가 아니면 libText 와 같다
 * (lib 고정 문구는 번역, 그 밖은 받은 그대로). 판정에는 쓰지 않는다 — 번역은 응답을 만드는 마지막 자리에서만 한다(비교는 guardCodeOf).
 */
export function guardText(t: ServerTranslate, g: string | { error: string; code?: GuardCode }): string {
  const code = guardCodeOf(g)
  if (code) return t(GUARD_DICT_KEY[code])
  return libText(t, typeof g === 'string' ? g : g.error)
}

/**
 * 실패한 가드·관문·lib 결과를 액션의 실패 결과로 — `if (!g.ok) return denied(g, t)`. 문구만 화면 언어로 바꾸고 `{ ok: false, error }` 만 돌려준다
 * (가드의 `code`·그 밖의 필드는 싣지 않는다 — 액션 계약은 그대로다).
 */
export function denied(g: { ok: false; error: string; code?: GuardCode }, t: ServerTranslate): { ok: false; error: string } {
  return { ok: false, error: guardText(t, g) }
}

/**
 * lib 함수의 결과를 액션이 통째로 돌려줄 때(`return r`·`return libFn(…)`) — 실패 결과면 문구만 요청의 화면 언어로 바꾼 사본을, 아니면 받은 그대로.
 * 바꾸는 칸은 `error`(가드·lib 문구)와 `fieldErrors[].message` 뿐이다 — code·reason 같은 구분 값과 그 밖의 자료는 건드리지 않는다.
 */
export function failureText<R>(t: ServerTranslate, result: R): R {
  if (typeof result !== 'object' || result === null || (result as { ok?: unknown }).ok !== false) return result
  const r = result as { error?: unknown; fieldErrors?: unknown }
  const out: Record<string, unknown> = { ...(result as Record<string, unknown>) }
  if (typeof r.error === 'string') out.error = guardText(t, r.error)
  if (Array.isArray(r.fieldErrors)) {
    out.fieldErrors = r.fieldErrors.map((f: unknown) =>
      typeof f === 'object' && f !== null && typeof (f as { message?: unknown }).message === 'string' ? { ...f, message: translate(t, (f as { message: string }).message, 0) } : f)
  }
  return out as R
}

/** 서버 화면용 — 로캘을 이미 읽은 페이지가 로더(lib)의 실패 결과를 그 언어로 바꾼다(`failureText` 에 로캘을 묶은 것) */
export function failureTextIn<R>(locale: Locale, result: R): R {
  return failureText(serverTranslatorFor(locale), result)
}
