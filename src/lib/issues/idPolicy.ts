// 이슈 ID 정책(개정 §4.4.3, SP5 스펙 D15) — 검증·미리보기 전용. 실제 발번은 DB 트리거 public.assign_issue_code(*_issue_areas)이고
// 같은 규칙을 public.issue_id_policy_of·render_issue_code·issue_code_year 가 SQL 로 한 번 더 갖는다 — 골든 표
// tests/fixtures/issue-id-policy-cases.ts 를 두 쪽이 돈다(tests/issues/id-policy·tests/rls/issue-code-policy). 한쪽만 고치지 않는다.
import { parseTimezone, ymdIn } from '@/lib/domain/calendar'

export type IdPolicy = { prefix: string; pattern: string; counter_scope: 'project' | 'area'; reset: 'never' | 'yearly' }
export const DEFAULT_ID_POLICY: IdPolicy = Object.freeze({ prefix: 'ISS', pattern: '{prefix}-{seq:3}', counter_scope: 'project', reset: 'never' })
// seq 가 n 자리 이내일 때의 최대 — 절단 금지 때문에 이후 자리 올림에서 더 길어질 수 있어 DB 는 code 길이 CHECK 를 걸지 않는다
export const ID_POLICY_MAX_LENGTH = 40

const KEYS = ['counter_scope', 'pattern', 'prefix', 'reset'] as const
const PREFIX_RE = /^[A-Z0-9-]{0,8}$/
const SEQ_TOKEN = /\{seq:([2-6])\}/
const LITERALS = /^[A-Za-z0-9._#/-]*$/
const fail = (error: string) => ({ ok: false as const, error })

/** 토큰을 한 번에(단일 정규식) 지운다 — 순차 치환은 앞 토큰을 지운 자리에서 중첩 토큰이 새로 만들어져 리터럴 규칙이 우회된다. SQL issue_id_policy_of 도 같은 단일 패스여야 한다 */
function stripTokens(pattern: string): string {
  return pattern.replace(/\{(?:prefix|area|yyyy|yy|seq:[2-6])\}/g, '')
}
export const policyNeedsArea = (p: IdPolicy): boolean => p.pattern.includes('{area}')
export const policyNeedsYear = (p: IdPolicy): boolean => p.pattern.includes('{yyyy}') || p.pattern.includes('{yy}')

export function parseIdPolicy(raw: unknown): { ok: true; value: IdPolicy } | { ok: false; error: string } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return fail('코드 규칙은 객체여야 합니다.')
  const o = raw as Record<string, unknown>
  if (Object.keys(o).sort().join(',') !== KEYS.join(',')) return fail('코드 규칙은 prefix·pattern·counter_scope·reset 네 칸이어야 합니다.')
  const { prefix, pattern, counter_scope, reset } = o
  if (typeof prefix !== 'string' || !PREFIX_RE.test(prefix)) return fail('접두는 영문 대문자·숫자·하이픈 8자 이하입니다.')
  if (typeof pattern !== 'string' || pattern === '') return fail('패턴을 입력하세요.')
  if (counter_scope !== 'project' && counter_scope !== 'area') return fail('번호 범위는 프로젝트·영역 가운데 하나입니다.')
  if (reset !== 'never' && reset !== 'yearly') return fail('번호 초기화는 없음·매년 가운데 하나입니다.')
  if ((pattern.match(new RegExp(SEQ_TOKEN.source, 'g')) ?? []).length !== 1) return fail('패턴에 {seq:n}(n 2~6)이 정확히 하나 있어야 합니다.')
  if (!LITERALS.test(stripTokens(pattern))) return fail('패턴에는 토큰과 영문·숫자·. _ # / - 만 쓸 수 있습니다.')
  const p: IdPolicy = { prefix, pattern, counter_scope, reset }
  if (counter_scope === 'area' && !policyNeedsArea(p)) return fail('영역별 번호는 패턴에 {area} 가 있어야 합니다.')
  if (reset === 'yearly' && !policyNeedsYear(p)) return fail('매년 초기화는 패턴에 {yyyy} 또는 {yy} 가 있어야 합니다.')
  const n = Number(SEQ_TOKEN.exec(pattern)![1])
  const longest = renderIssueCode(p, { areaCode: 'ZZZZZZZZ', year: 9999, seq: 10 ** n - 1 })
  if (longest.length > ID_POLICY_MAX_LENGTH) return fail(`코드가 ${ID_POLICY_MAX_LENGTH}자를 넘을 수 있습니다(최대 ${longest.length}자).`)
  return { ok: true, value: p }
}

/** SQL render_issue_code 와 같은 치환 순서·자리 규칙(lpad(seq, greatest(n, length(seq)))) */
export function renderIssueCode(p: IdPolicy, v: { areaCode: string | null; year: number | null; seq: number }): string {
  if (policyNeedsArea(p) && !v.areaCode) throw new Error('ISSUE_AREA_REQUIRED')
  if (policyNeedsYear(p) && v.year === null) throw new Error('ISSUE_YEAR_REQUIRED')
  const n = Number(SEQ_TOKEN.exec(p.pattern)![1])
  const s = String(v.seq)
  const y = v.year ?? 0
  // 치환 값은 함수로 준다 — 문자열 인자는 $&·$1 을 특수 패턴으로 해석한다
  return p.pattern.replaceAll('{prefix}', () => p.prefix).replaceAll('{area}', () => v.areaCode ?? '')
    .replaceAll('{yyyy}', () => String(y).padStart(4, '0')).replaceAll('{yy}', () => String(y % 100).padStart(2, '0'))
    .replace(SEQ_TOKEN, () => s.padStart(Math.max(n, s.length), '0'))
}

export function scopeKeyOf(p: IdPolicy, v: { areaId: string | null; year: number | null }): string {
  const parts: string[] = []
  if (p.counter_scope === 'area') {
    if (!v.areaId) throw new Error('ISSUE_AREA_REQUIRED')
    parts.push(`a:${v.areaId}`)
  }
  if (p.reset === 'yearly') {
    if (v.year === null) throw new Error('ISSUE_YEAR_REQUIRED')
    parts.push(`y:${String(v.year).padStart(4, '0')}`)
  }
  return parts.join('|')
}

/** 그 tz 의 달력 연도. tz 규칙은 parseTimezone(§9.1 D54 — '/' 없는 이름 닫힌 목록·오프셋 꼴 거부)과 같다 */
export function issueCodeYear(tz: string, at: Date): number {
  const t = parseTimezone(tz)
  if (!t.ok) throw new Error('CONFIG_INVALID:calendar.timezone')
  return Number(ymdIn(t.value, at).slice(0, 4))
}

/** 설정 화면의 코드 예시(P19) — 첫 활성 영역 code(없으면 RND), seq 1 */
export function codeExample(p: IdPolicy, v: { areaCode: string | null; year: number }): string {
  return renderIssueCode(p, { areaCode: policyNeedsArea(p) ? (v.areaCode ?? 'RND') : v.areaCode, year: v.year, seq: 1 })
}
