// 이슈 ID 정책 골든 표(개정 §4.4.3) — TS(src/lib/issues/idPolicy.ts)와 SQL(public.issue_id_policy_of·render_issue_code·issue_code_year)이
// 같은 표로 판정한다(tests/issues/id-policy.test.ts·tests/rls/issue-code-policy.test.ts). 표를 고치면 두 쪽이 같이 돈다.
import type { IdPolicy } from '@/lib/issues/idPolicy'

const P = (prefix: string, pattern: string, counter_scope: IdPolicy['counter_scope'] = 'project', reset: IdPolicy['reset'] = 'never'): IdPolicy =>
  ({ prefix, pattern, counter_scope, reset })

export const ID_POLICY_PARSE_CASES: readonly { name: string; raw: unknown; ok: boolean }[] = [
  { name: '제품 기본값', raw: P('ISS', '{prefix}-{seq:3}'), ok: true },
  { name: '연도별', raw: P('RND', '{prefix}-{yyyy}-{seq:4}', 'project', 'yearly'), ok: true },
  { name: '영역별(현 동작 재현)', raw: P('PI', '{prefix}-I-{area}-{seq:2}', 'area'), ok: true },
  { name: '두 자리 연도·리터럴 기호', raw: P('', 'Q.{yy}#{seq:5}/x', 'project', 'yearly'), ok: true },
  { name: '빈 접두', raw: P('', '{seq:2}'), ok: true },
  // 규칙은 area ⇒ {area} 한 방향뿐이다 — 프로젝트 범위 번호에 {area} 가 들어가는 것은 허용(SQL 이 이 조합을 잘못 거부하지 않게 고정)
  { name: '프로젝트 범위인데 {area} 포함', raw: P('RS', '{prefix}-{area}-{seq:3}', 'project'), ok: true },
  { name: '{prefix} 두 번', raw: P('ISS', '{prefix}-{prefix}-{seq:3}'), ok: true },
  { name: '밑줄 리터럴', raw: P('ISS', '{prefix}_{seq:3}'), ok: true },
  { name: 'seq 없음', raw: P('ISS', '{prefix}-1'), ok: false },
  { name: 'seq 둘', raw: P('ISS', '{seq:2}-{seq:3}'), ok: false },
  { name: 'seq:1', raw: P('ISS', '{prefix}-{seq:1}'), ok: false },
  { name: 'seq:7', raw: P('ISS', '{prefix}-{seq:7}'), ok: false },
  { name: '모르는 토큰', raw: P('ISS', '{prefix}-{dd}-{seq:3}'), ok: false },
  { name: '허용 밖 리터럴(공백)', raw: P('ISS', '{prefix} {seq:3}'), ok: false },
  { name: '허용 밖 리터럴(한글)', raw: P('ISS', '이슈-{seq:3}'), ok: false },
  { name: '접두 소문자', raw: P('iss', '{prefix}-{seq:3}'), ok: false },
  { name: '접두 9자', raw: P('ABCDEFGHI', '{prefix}-{seq:3}'), ok: false },
  { name: 'area 범위인데 {area} 없음', raw: P('ISS', '{prefix}-{seq:3}', 'area'), ok: false },
  { name: 'yearly 인데 연도 없음', raw: P('ISS', '{prefix}-{seq:3}', 'project', 'yearly'), ok: false },
  // 8+1+8+1+4+1+8+1+6 = 38 + 리터럴
  { name: '최대 렌더 41자', raw: P('ABCDEFGH', '{prefix}-{area}-{yyyy}-{prefix}-{seq:6}xyz', 'area'), ok: false },
  { name: '최대 렌더 40자', raw: P('ABCDEFGH', '{prefix}-{area}-{yyyy}-{prefix}-{seq:6}xy', 'area'), ok: true },
  { name: '모르는 키', raw: { ...P('ISS', '{prefix}-{seq:3}'), extra: 1 }, ok: false },
  { name: '키 빠짐', raw: { prefix: 'ISS', pattern: '{prefix}-{seq:3}', counter_scope: 'project' }, ok: false },
  { name: '배열', raw: [], ok: false },
  { name: 'null', raw: null, ok: false },
  { name: 'counter_scope 모름', raw: { ...P('ISS', '{prefix}-{seq:3}'), counter_scope: 'workspace' }, ok: false },
  { name: 'reset 모름(monthly)', raw: { ...P('ISS', '{prefix}-{seq:3}'), reset: 'monthly' }, ok: false },
  { name: '접두 허용 밖 문자(밑줄)', raw: P('A_B', '{prefix}-{seq:3}'), ok: false },
  { name: '접두 허용 밖 문자(공백)', raw: P('A B', '{prefix}-{seq:3}'), ok: false },
  { name: '접두가 문자열이 아님', raw: { ...P('ISS', '{prefix}-{seq:3}'), prefix: 123 }, ok: false },
  { name: '미완결 토큰 {prefix', raw: P('ISS', '{prefix-{seq:3}'), ok: false },
  { name: '{seq:03}(앞자리 0)', raw: P('ISS', '{prefix}-{seq:03}'), ok: false },
  { name: '{SEQ:3}(대문자)', raw: P('ISS', '{prefix}-{SEQ:3}'), ok: false },
  // 토큰은 한 번에(단일 패스) 지운다 — 순차 치환은 앞 토큰을 지운 자리에서 뒤 토큰이 새로 생겨 리터럴 규칙을 우회한다(리뷰 P1-1)
  { name: '중첩 토큰 {{prefix}yy}', raw: P('ISS', '{{prefix}yy}-{seq:3}'), ok: false },
  { name: '중첩 토큰 {seq:3}{se{prefix}q:3}', raw: P('ISS', '{seq:3}{se{prefix}q:3}'), ok: false },
  { name: '중첩 토큰 {ar{prefix}ea}', raw: P('ISS', '{ar{prefix}ea}-{seq:3}'), ok: false },
  { name: '중첩 토큰 {y{prefix}y}(yearly)', raw: P('ISS', '{y{prefix}y}-{seq:3}', 'project', 'yearly'), ok: false },
]

export const ID_POLICY_RENDER_CASES: readonly { name: string; policy: IdPolicy; areaCode: string | null; year: number | null; seq: number; code: string }[] = [
  { name: '기본 1', policy: P('ISS', '{prefix}-{seq:3}'), areaCode: null, year: null, seq: 1, code: 'ISS-001' },
  { name: '기본 1000 무절단', policy: P('ISS', '{prefix}-{seq:3}'), areaCode: null, year: null, seq: 1000, code: 'ISS-1000' },
  { name: '연도', policy: P('RND', '{prefix}-{yyyy}-{seq:4}', 'project', 'yearly'), areaCode: null, year: 2026, seq: 1, code: 'RND-2026-0001' },
  { name: '두 자리 연도', policy: P('', 'Q.{yy}#{seq:5}/x', 'project', 'yearly'), areaCode: null, year: 2007, seq: 42, code: 'Q.07#00042/x' },
  { name: '영역 01', policy: P('PI', '{prefix}-I-{area}-{seq:2}', 'area'), areaCode: '00', year: null, seq: 1, code: 'PI-I-00-01' },
  { name: '영역 100 무절단', policy: P('PI', '{prefix}-I-{area}-{seq:2}', 'area'), areaCode: '07', year: null, seq: 100, code: 'PI-I-07-100' },
  { name: '영문 영역', policy: P('RS', '{prefix}-{area}-{seq:3}', 'area'), areaCode: 'RND', year: null, seq: 7, code: 'RS-RND-007' },
  { name: '레거시 형식', policy: P('PI', '{prefix}-U-{seq:3}'), areaCode: null, year: null, seq: 12, code: 'PI-U-012' },
]

/** at = ISO instant. LA 12/31 23:30(현지) = UTC 다음 해 07:30 — 그해 연도(개정 §4.4.4) */
export const ISSUE_YEAR_CASES: readonly { tz: string; at: string; year: number }[] = [
  { tz: 'America/Los_Angeles', at: '2027-01-01T07:30:00Z', year: 2026 },
  { tz: 'UTC', at: '2027-01-01T07:30:00Z', year: 2027 },
  { tz: 'Pacific/Kiritimati', at: '2026-12-31T10:30:00Z', year: 2027 },
  { tz: 'Pacific/Pago_Pago', at: '2027-01-01T10:30:00Z', year: 2026 },
  { tz: 'EST5EDT', at: '2027-01-01T04:30:00Z', year: 2026 },
  // 연말 경계 — 현지 자정 직전·직후(밀리초 단위)
  { tz: 'America/Los_Angeles', at: '2027-01-01T07:59:59.999Z', year: 2026 },
  { tz: 'America/Los_Angeles', at: '2027-01-01T08:00:00Z', year: 2027 },
  // 남반구 서머타임(AEDT +11)
  { tz: 'Australia/Sydney', at: '2026-12-31T12:59:59Z', year: 2026 },
  { tz: 'Australia/Sydney', at: '2026-12-31T13:00:00Z', year: 2027 },
  // '/' 없는 닫힌 목록(§9.1 D54) 연말 경계 — 표준시 오프셋 GMT 0·CST -6·MST -7·PST -8
  { tz: 'GMT', at: '2026-12-31T23:59:59.999Z', year: 2026 },
  { tz: 'GMT', at: '2027-01-01T00:00:00Z', year: 2027 },
  { tz: 'CST6CDT', at: '2027-01-01T05:59:59.999Z', year: 2026 },
  { tz: 'CST6CDT', at: '2027-01-01T06:00:00Z', year: 2027 },
  { tz: 'MST7MDT', at: '2027-01-01T06:59:59.999Z', year: 2026 },
  { tz: 'MST7MDT', at: '2027-01-01T07:00:00Z', year: 2027 },
  { tz: 'PST8PDT', at: '2027-01-01T07:59:59.999Z', year: 2026 },
  { tz: 'PST8PDT', at: '2027-01-01T08:00:00Z', year: 2027 },
]
/** 연도 판정이 거부해야 하는 tz(§9.1 D54 정본 — '/' 없는 이름은 닫힌 목록만, 오프셋 꼴 거부) */
export const ISSUE_YEAR_BAD_TZ: readonly string[] = ['EST', 'IST', 'GMT0', '+09:00', 'Mars/Phobos', '']
