/**
 * 봇의 날짜 앵커(SP5 A — 스펙 D13 ③) — 요청 범위 달력 한 벌(tz·주 시작·근무 요일)로 '오늘'과 '이번/지난/다음 주'를 정한다.
 * 라우터·플래너가 같은 함수를 쓰므로 한 요청 안의 도구들은 같은 '이번 주'를 받는다. 주간 도구는 그 범위의 시작 날짜를 다시
 * 그 프로젝트 규칙의 키로 바꾼다(프로젝트마다 주 시작이 다를 수 있다). 순수 — now 를 주입받는다.
 */
import { addDaysIso } from '@/lib/domain/dates'
import { nextWeekKey, prevWeekKey, todayIn, weekKeyOf, weekPeriodOf, type RequestCalendar } from '@/lib/domain/calendar'

export interface Period { start: string; endExclusive: string }

export function dateAnchors(calendar: RequestCalendar, now: Date): { today: string; thisWeek: Period; lastWeek: Period; nextWeek: Period } {
  const today = todayIn(calendar.timezone, now)
  const rules = calendar.weekStart
  const key = weekKeyOf(rules, today)
  const period = (k: string): Period => ({ start: k, endExclusive: weekPeriodOf(rules, k).endExclusive })
  return { today, thisWeek: period(key), lastWeek: period(prevWeekKey(rules, key)), nextWeek: period(nextWeekKey(rules, key)) }
}

/** 도구 인자 꼴(양끝 포함) */
export function inclusiveRange(p: Period): { from: string; to: string } {
  return { from: p.start, to: addDaysIso(p.endExclusive, -1) }
}
