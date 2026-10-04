/**
 * 주간 기준일 (정본 §4.5.4).
 * week 가 있으면 그 주 키로 맞추고, 지난 주는 표시 요일 끝, 이번 주는 기준일 그대로, 미래 주는 표시 요일 첫날.
 * 근무일이 0이면 표시 요일은 기간 전체다(weekDisplayDays).
 */
import { weekDisplayDays, weekKeyOf, type WorkCalendar } from '@/lib/domain/calendar'

export function weeklyReference(calendar: WorkCalendar, baseToday: string, week: string | null): { today: string; weekStart: string } {
  const currentKey = weekKeyOf(calendar.weekStart, baseToday)
  if (!week) return { today: baseToday, weekStart: currentKey }
  const weekStart = weekKeyOf(calendar.weekStart, week)
  if (weekStart === currentKey) return { today: baseToday, weekStart }
  const days = weekDisplayDays(calendar, weekStart)
  const edge = weekStart < currentKey ? days[days.length - 1] : days[0]
  return { today: edge, weekStart }
}
