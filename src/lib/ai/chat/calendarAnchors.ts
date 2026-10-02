/**
 * 봇의 날짜 앵커(SP5 A — 스펙 D13 ③) — 요청 범위 달력 한 벌(tz·주 시작·근무 요일)로 '오늘'과 '이번/지난/다음 주'를 정한다.
 * 라우터·플래너가 같은 함수를 쓰므로 한 요청 안의 도구들은 같은 '이번 주'를 받는다. 주간 도구에는 그 주의 **기준일**(시작 + 3일 —
 * weekReferenceDay)을 넘기고, 도구가 그 날이 든 그 프로젝트 규칙의 주로 바꾼다(프로젝트마다 주 시작이 다를 수 있다 — 첫날을 넘기면
 * 주 시작이 어긋날 때 겹침이 하루뿐인 앞 주를 고른다, A-3 리뷰 P1). 순수 — now 를 주입받는다.
 */
import { addDaysIso } from '@/lib/domain/dates'
import { nextWeekKey, prevWeekKey, todayIn, weekKeyOf, weekPeriodOf, weekReferenceDay, type RequestCalendar } from '@/lib/domain/calendar'

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

/** 주간 도구에 넘기는 그 주의 기준일(시작 + 3일) — 도구가 그 날이 든 프로젝트의 주로 바꾼다 */
export function weekRefOf(p: Period): string {
  return weekReferenceDay(p.start)
}
