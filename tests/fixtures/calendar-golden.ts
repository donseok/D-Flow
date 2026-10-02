// 달력 골든 행렬(SP5 스펙 K5·D37·D53, 개정 §4.2.4·§4.2.9) — TS(tests/domain/calendar.test.ts)와 SQL(tests/rls/calendar-parity.test.ts)이
// 같은 배열을 읽는다. 한쪽만 고치지 않는다. 날짜는 손으로 셌다 — 2026-09-27 이 일요일(개정 §4.2.4 예시의 기준).
import type { IsoDow, WeekStartRule } from '@/lib/domain/calendar'

const MON0: WeekStartRule[] = [{ day: 'monday', from: null }]
const SUN0: WeekStartRule[] = [{ day: 'sunday', from: null }]
/** 개정 §4.2.4 예시 1 — 월→일, 변경일 09-23(수), E = 09-27(일), 과도기 [09-21, 09-27) 6일 */
export const RULES_MON_TO_SUN: WeekStartRule[] = [{ day: 'monday', from: null }, { day: 'sunday', from: '2026-09-27' }]
/** 예시 2 — 일→월, 변경일 09-23(수), E = 09-28(월), 과도기 [09-20, 09-28) 8일 */
export const RULES_SUN_TO_MON: WeekStartRule[] = [{ day: 'sunday', from: null }, { day: 'monday', from: '2026-09-28' }]
/** 예시 3 — 월→일, 변경일 09-27(일) → E ≤ T 라 10-04, 과도기 [09-28, 10-04) 6일 */
export const RULES_MON_TO_SUN_LATE: WeekStartRule[] = [{ day: 'monday', from: null }, { day: 'sunday', from: '2026-10-04' }]
/** 전환 둘 — 월→일(09-27) 뒤 일→월(10-12). 둘째 과도기 [10-04, 10-12) 8일 */
export const RULES_TWO_SWITCHES: WeekStartRule[] = [
  { day: 'monday', from: null }, { day: 'sunday', from: '2026-09-27' }, { day: 'monday', from: '2026-10-12' },
]
/** D53 — 미적용 전환 [mon, sun@10-04] 를 더 늦은 [mon, sun@10-11] 로 바꾼 새 규칙(사이의 일요일 키 문서 10-04 는 새 규칙에서 키가 아니다) */
export const RULES_LATER_SWITCH: WeekStartRule[] = [{ day: 'monday', from: null }, { day: 'sunday', from: '2026-10-11' }]

export const GOLDEN_WEEK_CASES: readonly { name: string; rules: WeekStartRule[]; date: string; key: string }[] = [
  { name: '월요일 — 수요일', rules: MON0, date: '2026-09-23', key: '2026-09-21' },
  { name: '월요일 — 일요일은 앞 주', rules: MON0, date: '2026-09-27', key: '2026-09-21' },
  { name: '월요일 — 월요일 자신', rules: MON0, date: '2026-09-28', key: '2026-09-28' },
  { name: '월요일 — 연 경계', rules: MON0, date: '2027-01-01', key: '2026-12-28' },
  { name: '일요일 — 수요일', rules: SUN0, date: '2026-09-23', key: '2026-09-20' },
  { name: '일요일 — 토요일', rules: SUN0, date: '2026-09-26', key: '2026-09-20' },
  { name: '일요일 — 일요일 자신', rules: SUN0, date: '2026-09-27', key: '2026-09-27' },
  { name: '일요일 — 연 경계', rules: SUN0, date: '2027-01-01', key: '2026-12-27' },
  { name: '월→일 — 전환 전 주', rules: RULES_MON_TO_SUN, date: '2026-09-20', key: '2026-09-14' },
  { name: '월→일 — 과도기 첫날', rules: RULES_MON_TO_SUN, date: '2026-09-21', key: '2026-09-21' },
  { name: '월→일 — 과도기 끝날(토)', rules: RULES_MON_TO_SUN, date: '2026-09-26', key: '2026-09-21' },
  { name: '월→일 — E', rules: RULES_MON_TO_SUN, date: '2026-09-27', key: '2026-09-27' },
  { name: '월→일 — E 뒤 토요일', rules: RULES_MON_TO_SUN, date: '2026-10-03', key: '2026-09-27' },
  { name: '월→일 — 다음 일요일', rules: RULES_MON_TO_SUN, date: '2026-10-04', key: '2026-10-04' },
  { name: '일→월 — 전환 전 토요일', rules: RULES_SUN_TO_MON, date: '2026-09-19', key: '2026-09-13' },
  { name: '일→월 — 과도기 첫날(일)', rules: RULES_SUN_TO_MON, date: '2026-09-20', key: '2026-09-20' },
  { name: '일→월 — 과도기 끝날(일)', rules: RULES_SUN_TO_MON, date: '2026-09-27', key: '2026-09-20' },
  { name: '일→월 — E', rules: RULES_SUN_TO_MON, date: '2026-09-28', key: '2026-09-28' },
  { name: '일→월 — E 뒤 일요일', rules: RULES_SUN_TO_MON, date: '2026-10-04', key: '2026-09-28' },
  { name: '월→일 늦은 E — 앞 주는 정상 7일', rules: RULES_MON_TO_SUN_LATE, date: '2026-09-27', key: '2026-09-21' },
  { name: '월→일 늦은 E — 과도기 첫날', rules: RULES_MON_TO_SUN_LATE, date: '2026-09-28', key: '2026-09-28' },
  { name: '월→일 늦은 E — 과도기 끝날', rules: RULES_MON_TO_SUN_LATE, date: '2026-10-03', key: '2026-09-28' },
  { name: '월→일 늦은 E — E', rules: RULES_MON_TO_SUN_LATE, date: '2026-10-04', key: '2026-10-04' },
  { name: '전환 둘 — 첫 전환 뒤', rules: RULES_TWO_SWITCHES, date: '2026-09-30', key: '2026-09-27' },
  { name: '전환 둘 — 둘째 과도기 첫날', rules: RULES_TWO_SWITCHES, date: '2026-10-04', key: '2026-10-04' },
  { name: '전환 둘 — 둘째 과도기 끝날(일)', rules: RULES_TWO_SWITCHES, date: '2026-10-11', key: '2026-10-04' },
  { name: '전환 둘 — 둘째 E', rules: RULES_TWO_SWITCHES, date: '2026-10-12', key: '2026-10-12' },
  { name: 'D53 늦춤 교체 — 옛 일요일 키 10-04 는 새 규칙에서 09-28 주', rules: RULES_LATER_SWITCH, date: '2026-10-04', key: '2026-09-28' },
  { name: 'D53 늦춤 교체 — 새 과도기 키', rules: RULES_LATER_SWITCH, date: '2026-10-05', key: '2026-10-05' },
  { name: 'D53 unset — 월요일 문서 09-21 은 기본 일요일에서 09-20 주', rules: SUN0, date: '2026-09-21', key: '2026-09-20' },
]

export const GOLDEN_WORKDAY_CASES: readonly { name: string; workingDays: IsoDow[]; off: string[]; work: string[]; date: string; working: boolean }[] = [
  { name: '월~금 토요일', workingDays: [1, 2, 3, 4, 5], off: [], work: [], date: '2026-10-03', working: false },
  { name: '월~금 월요일', workingDays: [1, 2, 3, 4, 5], off: [], work: [], date: '2026-10-05', working: true },
  { name: '일~목 일요일', workingDays: [1, 2, 3, 4, 7], off: [], work: [], date: '2026-10-04', working: true },
  { name: '일~목 금요일', workingDays: [1, 2, 3, 4, 7], off: [], work: [], date: '2026-10-02', working: false },
  { name: '일~목 토요일', workingDays: [1, 2, 3, 4, 7], off: [], work: [], date: '2026-10-03', working: false },
  { name: '월~토 토요일', workingDays: [1, 2, 3, 4, 5, 6], off: [], work: [], date: '2026-10-03', working: true },
  { name: '월~토 일요일', workingDays: [1, 2, 3, 4, 5, 6], off: [], work: [], date: '2026-10-04', working: false },
  { name: '특정 토요일 근무', workingDays: [1, 2, 3, 4, 5], off: [], work: ['2026-10-03'], date: '2026-10-03', working: true },
  { name: '평일 휴무', workingDays: [1, 2, 3, 4, 5], off: ['2026-10-05'], work: [], date: '2026-10-05', working: false },
  { name: '휴무 다음 날은 근무', workingDays: [1, 2, 3, 4, 5], off: ['2026-10-05'], work: [], date: '2026-10-06', working: true },
]

/** TS 가 받는 이름 — PG `at time zone` 도 모두 받아야 한다(TS ⊂ PG, D54) */
export const GOLDEN_TZ_NAMES: readonly string[] = ['UTC', 'Asia/Seoul', 'America/Los_Angeles', 'Europe/Berlin', 'Asia/Kolkata', 'Europe/Kyiv', 'America/New_York']
/** TS 가 거부하는 값 — 손상 이름·오프셋 꼴·빈 값 */
export const GOLDEN_TZ_REJECT: readonly string[] = ['Asia/Seol', '+09:00', 'GMT+1', '']
