'use client'

import { useMemo, useState } from 'react'
import type { MeetingOccurrence } from '@/lib/domain/types'
import type { DictKey } from '@/lib/i18n/dict'
import { useLocale } from '@/components/providers/LocaleProvider'
import { calendarDayInfo, monthMatrix, weekdayColumns, type CalendarView } from '@/lib/domain/attendance'
import { currentRuleDay } from '@/lib/domain/calendar'
import { occurrencesByDate, sortOccurrences } from '@/lib/domain/meetings'
import { vocabColor, vocabOf, type VocabByProject } from '@/lib/settings/vocab'
import { DayPopover, type DayPopoverAnchor } from '@/components/ui/DayPopover'
import { RestDayMark } from '@/components/calendar/RestDayMark'

function OccurrenceChip({ o, onSelect, t, projectDotClass, categories }: {
  o: MeetingOccurrence
  categories: VocabByProject<'meetings.categories'>
  onSelect: (o: MeetingOccurrence) => void
  t: (k: DictKey) => string
  projectDotClass?: (projectId: string) => string | null
}) {
  const meta = vocabColor(vocabOf(categories, o.projectId), o.category)
  const timeLabel = o.startTime ?? t('meet.allDay')
  const dotClass = projectDotClass?.(o.projectId)
  return (
    <button
      onClick={() => onSelect(o)}
      className={`flex w-full items-center gap-1 rounded-md px-1.5 py-0.5 text-left text-meta font-medium ${meta.chip} cursor-pointer transition hover:ring-1 hover:ring-border-focus focus:outline-none focus-visible:ring-2 focus-visible:ring-border-focus`}
      title={`${timeLabel} · ${o.title}`}
    >
      {dotClass && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`} />}
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${meta.dot}`} />
      <span className="shrink-0 tabular-nums opacity-80">{timeLabel}</span>
      <span className="truncate">{o.title}</span>
    </button>
  )
}

export function MeetingCalendar({
  year, month0, todayIso, occurrences, onSelectOccurrence, projectDotClass, calendar, holidayNames, categories,
}: {
  year: number
  month0: number
  todayIso: string
  occurrences: MeetingOccurrence[]
  onSelectOccurrence: (o: MeetingOccurrence) => void
  /** 내 회의 뷰(여러 프로젝트 혼재)에서만 전달 — 프로젝트별 색점. 프로젝트별 달력(/p/[id]/meetings)은 미전달로 무변경. */
  projectDotClass?: (projectId: string) => string | null
  /** 첫 열·쉬는 날의 원천 — 프로젝트 달력이면 그 프로젝트, 내 회의는 워크스페이스 달력(날짜 예외 없음, D36) */
  calendar: CalendarView
  /** 휴무 이름(프로젝트 holidays.name) — 워크스페이스 달력은 없다 */
  holidayNames?: Readonly<Record<string, string>>
  /** 회의 범주(설정 meetings.categories) — 프로젝트별 */
  categories: VocabByProject<'meetings.categories'>
}) {
  const { t } = useLocale()
  const [more, setMore] = useState<DayPopoverAnchor | null>(null)
  // 첫 열 = 오늘 적용되는 규칙의 시작 요일(SP5 §4.4) — 보는 달과 무관하다. 페이지의 조회 범위도 같은 규칙이다
  const firstDay = currentRuleDay(calendar.weekStart, todayIso)
  const columns = useMemo(() => weekdayColumns(firstDay), [firstDay])
  const matrix = useMemo(() => monthMatrix(year, month0, firstDay), [year, month0, firstDay])
  const byDate = useMemo(() => occurrencesByDate(occurrences), [occurrences])
  const ym = `${year}-${String(month0 + 1).padStart(2, '0')}`
  const moreOcc = more ? sortOccurrences(byDate[more.date] ?? []) : []

  return (
    <div className="card overflow-hidden p-0">
      <div className="grid grid-cols-7 gap-px bg-border">
        {columns.map(c => (
          <div key={c.key} data-cal-head data-working={calendar.workingDays.has(c.iso)} className={`bg-surface-subtle py-2 text-center text-meta ${calendar.workingDays.has(c.iso) ? 'font-semibold text-fg' : 'font-normal text-fg-muted'}`}>
            {t(`att.weekday.${c.key}` as DictKey)}
          </div>
        ))}
        {matrix.flat().map(cell => {
          const inMonth = cell.startsWith(ym)
          const isToday = cell === todayIso
          const dayNum = Number(cell.slice(8, 10))
          const dayOcc = sortOccurrences(byDate[cell] ?? [])
          const info = calendarDayInfo(cell, calendar, holidayNames)
          return (
            <div key={cell} data-date={cell} className={`min-h-[104px] p-1.5 ${info.working ? 'bg-surface' : 'bg-weekend'} ${inMonth ? '' : 'opacity-40'}`}>
              {/* 좁은 화면(sm 미만)은 이름이 날짜 아래 한 줄을 통째로 쓰고 줄바꿈, sm 이상은 날짜 옆 한 줄 말줄임(title 로 전체) */}
              <div className="flex flex-wrap items-center justify-between gap-x-1 px-0.5 sm:flex-nowrap">
                <span className={`inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full px-1 text-xs font-semibold tabular-nums ${isToday ? 'bg-action text-action-fg' : info.working ? 'text-fg' : 'text-fg-secondary'}`}>
                  {dayNum}
                </span>
                {info.name && (
                  <span className="basis-full break-all text-meta font-medium leading-tight text-fg-muted sm:min-w-0 sm:basis-auto sm:truncate" title={info.name}>
                    {info.name}
                  </span>
                )}
                {!info.working && <RestDayMark named={!!info.name} mark={t('att.restMark')} label={t('att.restDay')} />}
              </div>
              <div className="mt-1 space-y-1">
                {dayOcc.slice(0, 3).map(o => (
                  <OccurrenceChip key={o.occurrenceId} o={o} t={t} onSelect={onSelectOccurrence} projectDotClass={projectDotClass} categories={categories} />
                ))}
                {dayOcc.length > 3 && (
                  <button
                    onClick={e => {
                      const r = e.currentTarget.getBoundingClientRect()
                      setMore({ date: cell, rect: { top: r.top, bottom: r.bottom, left: r.left } })
                    }}
                    className="w-full rounded-md px-1 py-0.5 text-left text-meta font-medium text-fg-muted transition hover:bg-surface-subtle hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
                  >
                    +{dayOcc.length - 3}{t('meet.moreSuffix')}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
      {more && (
        <DayPopover anchor={more} count={moreOcc.length} onClose={() => setMore(null)}>
          {moreOcc.map(o => (
            <OccurrenceChip key={o.occurrenceId} o={o} t={t} onSelect={occ => { setMore(null); onSelectOccurrence(occ) }} projectDotClass={projectDotClass} categories={categories} />
          ))}
        </DayPopover>
      )}
    </div>
  )
}
