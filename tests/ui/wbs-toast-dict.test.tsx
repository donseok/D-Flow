// WBS·칸반 토스트의 사전 매핑(SP4 D21·D52, 계획 P12 — H2 removeErrorKey 꼴): 액션이 돌려준 한국어 고정 문구를 사전 키로 바꿔 그린다.
// 사전 문구는 액션 문구와 같은 글자다. 표 밖 문구(동적 문구·원문·프로토타입 이름)는 화면의 일반 키 — 받은 문구를 그리지 않는다.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { t, type DictKey } from '@/lib/i18n/dict'
import { WBS_ACTION_ERRORS, wbsErrorKey, wbsToastText } from '@/lib/wbs/actionErrors'
import { ERR_ANON, ERR_DENIED, ERR_LOOKUP, ERR_MISSING, ERR_MODULE_DISABLED } from '@/lib/authz/errors'

const tKo = (k: DictKey) => t('ko', k)
const MESSAGES = [...Object.values(WBS_ACTION_ERRORS), ERR_ANON, ERR_DENIED, ERR_LOOKUP, ERR_MISSING, ERR_MODULE_DISABLED]

const TABLE_KEYS = new Set(Object.keys(WBS_ACTION_ERRORS))

/** 문자열 리터럴('…'·"…"·`…`)을 건너뛴 다음 위치 — 문구 안의 괄호·쉼표가 식의 경계를 흐리지 않게 */
function skipString(s: string, i: number): number {
  const q = s[i]
  for (let j = i + 1; j < s.length; j++) {
    if (s[j] === '\\') { j++; continue }
    if (s[j] === q) return j + 1
  }
  return s.length
}

/** s[from] 부터 깊이 0 에서 stop 문자 중 하나를 만나기 전까지의 식(괄호·중괄호·대괄호 균형, 문자열 건너뜀) */
function exprUntil(s: string, from: number, stop: string): { text: string; end: number } {
  let depth = 0
  let i = from
  while (i < s.length) {
    const c = s[i]
    if (c === "'" || c === '"' || c === '`') { i = skipString(s, i); continue }
    if (depth === 0 && stop.includes(c)) break
    if ('({['.includes(c)) depth++
    else if (')}]'.includes(c)) depth--
    i++
  }
  return { text: s.slice(from, i).trim(), end: i }
}

/** 마지막 인자(깊이 0 의 마지막 쉼표 뒤) — failWith(tag, err, MESSAGE) 의 MESSAGE */
function lastArg(call: string): string {
  const inner = call.slice(call.indexOf('(') + 1, call.lastIndexOf(')'))
  let rest = inner
  for (;;) {
    const { end } = exprUntil(rest, 0, ',')
    if (end >= rest.length) return rest.trim()
    rest = rest.slice(end + 1)
  }
}

/** 객체가 아닌 값을 돌려주는 return 의 닫힌 목록 — 화면이 code 로 사전 문구를 고르는 결과(사유 필수) */
const NAMED_RETURNS = new Set(['ACTUAL_LOCKED']) // code 'actual_locked' → wbs.actualLocked(문구가 아니라 code 로 가른다)

/**
 * 본문의 return 이 돌려줄 수 있는 error 식 가운데 표 밖인 것(B-3 리뷰 P3 — 작은따옴표 리터럴만 보던 가드의 보강).
 * 허용: 표의 상수 `E.<표 키>`, 그 별칭(`const ERR_X = E.<키>`), 가드·범위 결과 `g.error`·`found.error`(ERR_LOOKUP·ERR_ANON·ERR_DENIED·
 * ERR_MISSING — 표에 있다), 마지막 인자가 그 둘 중 하나인 `failWith(…)`(그 인자를 그대로 돌려준다). 그 밖(표 밖 상수·리터럴·템플릿·
 * 다른 결과 변수)은 모두 잡는다 — 객체가 아닌 return 은 `<return 식>` 으로, NAMED_RETURNS 만 통과.
 */
function disallowedErrors(body: string, aliases: ReadonlySet<string>): string[] {
  const allowedMsg = (e: string) =>
    (/^E\.\w+$/.test(e) && TABLE_KEYS.has(e.slice(2))) || aliases.has(e)
  const allowed = (e: string) =>
    allowedMsg(e) || e === 'g.error' || e === 'found.error' || (/^failWith\(/.test(e) && allowedMsg(lastArg(e)))
  const bad: string[] = []
  for (const m of body.matchAll(/\breturn\b[ \t]*/g)) {
    const at = m.index! + m[0].length
    if (body[at] !== '{') {
      const name = body.slice(at).match(/^[^\n;}]*/)![0].trim()
      if (!NAMED_RETURNS.has(name)) bad.push(`<return ${name}>`)
      continue
    }
    const obj = exprUntil(body, at + 1, '}').text
    // 깊이 0 의 키만 — 값 안의 `error:`(구조 분해 등)는 보지 않는다
    let i = 0
    while (i < obj.length) {
      const key = obj.slice(i).match(/^\s*(\w+)\s*:\s*/)
      if (!key) break
      const v = exprUntil(obj, i + key[0].length, ',')
      if (key[1] === 'error' && !allowed(v.text)) bad.push(v.text)
      i = v.end + 1
    }
  }
  return bad
}

describe('WBS·칸반 토스트 사전', () => {
  it('드리프트 가드 표본 — 표 밖 상수·템플릿·큰따옴표·표 밖 failWith·객체가 아닌 return 을 잡고, 표의 상수·가드 결과는 통과시킨다', () => {
    const aliases = new Set(['ERR_ITEM_LOOKUP', 'ERR_SAVE'])
    const sample = [
      'export async function updateActual(id: string) {',
      "  if (a) return { ok: false, error: ERR_TEAM_LOOKUP }",
      '  if (b) return { ok: false, error: `없음 ${id}` }',
      '  if (c) return { ok: false, conflict: true, error: "큰따옴표" }',
      "  if (d) return { ok: false, error: failWith('wbs.x', e, ERR_DEP_LOOKUP) }",
      '  if (f) return OTHER_RESULT',
      '  if (h) return { ok: false, error: E.notInTable }',
      '  if (i) return { ok: false, error: E.range }',
      '  if (j) return { ok: false, error: g.error }',
      '  if (k) return { ok: false, error: found.error }',
      "  if (l) return { ok: false, error: failWith('wbs.x', itemErr ?? '조회 결과(없음)', ERR_ITEM_LOOKUP) }",
      '  if (m) return { ok: false, error: ERR_SAVE }',
      '  if (n) return ACTUAL_LOCKED',
      '  const { data: item, error: itemErr } = await q',
      '  return { ok: true }',
      '}',
    ].join('\n')
    expect(disallowedErrors(sample, aliases)).toEqual([
      'ERR_TEAM_LOOKUP', '`없음 ${id}`', '"큰따옴표"', "failWith('wbs.x', e, ERR_DEP_LOOKUP)", '<return OTHER_RESULT>', 'E.notInTable',
    ])
  })
  it.each(MESSAGES)('%s — 사전 키가 있고 사전 문구가 같은 글자다', (msg) => {
    const k = wbsErrorKey(msg)
    expect(k).not.toBeNull()
    expect(tKo(k!)).toBe(msg)
  })
  it('표 밖 문구는 화면의 일반 키 — 받은 문구를 싣지 않는다', () => {
    expect(wbsToastText(tKo, "'QA' 팀과 같은 낱말입니다 — 그 팀을 고르세요.", 'wbs.toastSaveFail')).toBe(tKo('wbs.toastSaveFail'))
    expect(wbsToastText(tKo, undefined, 'kanban.errChange')).toBe(tKo('kanban.errChange'))
    expect(wbsToastText(tKo, 'constructor', 'wbs.toastAddFail')).toBe(tKo('wbs.toastAddFail'))
    expect(wbsToastText(tKo, WBS_ACTION_ERRORS.hasChildren, 'wbs.toastSaveFail')).toBe(WBS_ACTION_ERRORS.hasChildren)
  })
  it('세 액션(updateActual·updateWeight·addWbsItem)은 표 밖 문구를 돌려주지 않는다 — 리터럴·템플릿·표 밖 상수 모두(새 문구가 사전 없이 늘지 않게)', () => {
    const src = readFileSync('src/app/actions/wbs.ts', 'utf8')
    // 표의 별칭 — `const ERR_X = E.<표 키>` 만(값이 리터럴인 ERR_* 는 표 밖이다)
    const aliases = new Set([...src.matchAll(/^const (ERR_\w+) = E\.(\w+)$/gm)].filter((m) => TABLE_KEYS.has(m[2])).map((m) => m[1]))
    expect(aliases.size).toBeGreaterThan(0)
    for (const fn of ['updateActual', 'updateWeight', 'addWbsItem']) {
      const start = src.indexOf(`export async function ${fn}(`)
      // 함수 끝 = 열 0 의 닫는 중괄호(다음 export 까지 자르면 사이의 내부 도우미까지 섞인다)
      const end = src.indexOf('\n}\n', start)
      const body = src.slice(start, end)
      expect(start, fn).toBeGreaterThan(-1)
      expect(end, fn).toBeGreaterThan(start)
      expect(body, fn).toMatch(/\breturn\b/)
      expect(disallowedErrors(body, aliases), fn).toEqual([])
    }
  })
  it('화면 셋(WBS 시트·칸반)은 받은 문구를 그대로 그리지 않는다', () => {
    for (const f of ['src/components/wbs/WbsGanttSheet.tsx', 'src/components/kanban/KanbanBoard.tsx']) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/res\.error\s*\?\?/)
    }
  })
})
