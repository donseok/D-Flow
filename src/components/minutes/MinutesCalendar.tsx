'use client'
import { useMemo } from 'react'
import type { Minute } from '@/lib/domain/types'
import { calendarDayInfo, monthMatrix, weekdayColumns, type CalendarView } from '@/lib/domain/attendance'
import { currentRuleDay } from '@/lib/domain/calendar'
import { useLocale } from '@/components/providers/LocaleProvider'
import type { DictKey } from '@/lib/i18n/dict'
import { useTeamSlot } from '@/components/app/TeamsProvider'
import { RestDayMark } from '@/components/calendar/RestDayMark'

export function MinutesCalendar({
  year, month0, todayIso, minutes, onSelectDate, selectedDate, calendar,
}: {
  year: number
  month0: number
  todayIso: string
  minutes: Minute[]
  onSelectDate: (dateIso: string) => void
  selectedDate: string | null
  /** 첫 열·쉬는 날의 원천 — 회의록은 워크스페이스 화면이라 요일만(날짜 예외 없음, D36) */
  calendar: CalendarView
}) {
  const { t } = useLocale()
  const slotOf = useTeamSlot()
  // 첫 열 = 오늘 적용되는 규칙의 시작 요일(SP5 §4.4)
  const firstDay = currentRuleDay(calendar.weekStart, todayIso)
  const columns = useMemo(() => weekdayColumns(firstDay), [firstDay])
  const matrix = useMemo(() => monthMatrix(year, month0, firstDay), [year, month0, firstDay])
  const byDate = useMemo(() => {
    const map = new Map<string, Minute[]>()
    for (const mi of minutes) {
      const arr = map.get(mi.minuteDate) ?? []
      arr.push(mi); map.set(mi.minuteDate, arr)
    }
    return map
  }, [minutes])
  const ym = `${year}-${String(month0 + 1).padStart(2, '0')}`

  return (
    <div className="card overflow-hidden p-0">
      <div className="grid grid-cols-7 gap-px bg-line">
        {columns.map(c => (
          <div key={c.key} data-cal-head data-working={calendar.workingDays.has(c.iso)} className={`bg-surface-2 py-2 text-center text-[11px] ${calendar.workingDays.has(c.iso) ? 'font-semibold text-ink' : 'font-normal text-ink-subtle'}`}>
            {t(`att.weekday.${c.key}` as DictKey)}
          </div>
        ))}
        {matrix.flat().map(cell => {
          const inMonth = cell.startsWith(ym)
          const isToday = cell === todayIso
          const dayNum = Number(cell.slice(8, 10))
          const rows = byDate.get(cell) ?? []
          const { working } = calendarDayInfo(cell, calendar)
          const isSelected = cell === selectedDate
          return (
            <button key={cell} data-date={cell} type="button" onClick={() => rows.length && onSelectDate(cell)}
              className={`min-h-[92px] p-1.5 text-left ${working ? 'bg-surface' : 'bg-weekend'} ${inMonth ? '' : 'opacity-40'} ${isSelected ? 'ring-2 ring-inset ring-brand-ring' : ''} ${rows.length ? 'cursor-pointer hover:bg-surface-2' : 'cursor-default'}`}>
              <span className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-semibold tabular-nums ${isToday ? 'bg-brand text-action-fg' : working ? 'text-ink' : 'text-ink-muted'}`}>
                {dayNum}
              </span>
              {!working && <RestDayMark named={false} mark={t('att.restMark')} label={t('att.restDay')} />}
              <div className="mt-1 flex flex-wrap gap-1">
                {rows.slice(0, 4).map(mi => (
                  <span key={mi.id}
                    className={`inline-flex items-center rounded px-1 py-px text-[10px] font-bold text-category-fg ${slotOf(mi.teamCode).bar}`}>
                    {mi.teamCode}
                  </span>
                ))}
                {rows.length > 4 && (
                  <span className="text-[10px] font-medium text-ink-subtle">+{rows.length - 4}</span>
                )}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
