'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarClock, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useToast } from '@/components/ui/Toast'
import { setBaseDate, addHoliday, removeHoliday } from '@/app/actions/project'
import { useLocale } from '@/components/providers/LocaleProvider'
import type { HolidayRow } from '@/lib/calendar/load'

/** 공정율 기준일 + 날짜 예외(휴무·근무 — 스펙 D7). 예외는 근무 요일 규칙과 다른 날만 적는다 */
export function ScheduleManager({
  projectId, baseDate, holidays, canEdit,
}: {
  projectId: string
  baseDate: string | null
  holidays: readonly HolidayRow[]
  canEdit: boolean
}) {
  const router = useRouter()
  const { toast } = useToast()
  const { t } = useLocale()
  const [pending, start] = useTransition()
  const [dateInput, setDateInput] = useState(baseDate ?? '')
  const [holDate, setHolDate] = useState('')
  const [holName, setHolName] = useState('')
  const [holKind, setHolKind] = useState<'off' | 'work'>('off')
  const sorted = [...holidays].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))

  // onOk 는 성공했을 때만 — 실패(결과형 ok:false·throw)면 입력을 지우지 않는다(A-5 리뷰 O9)
  const run = (fn: () => Promise<unknown>, msg: string, onOk?: () => void) => start(async () => {
    try {
      const res = await fn()
      if (res && typeof res === 'object' && 'ok' in res && (res as { ok: boolean }).ok === false) {
        toast({ title: (res as { error?: string }).error ?? t('settings.actionFailed'), variant: 'error' })
        return
      }
      onOk?.()
      router.refresh()
      toast({ title: msg, variant: 'success' })
    } catch {
      toast({ title: t('settings.actionError'), variant: 'error' })
    }
  })

  return (
    <div className="space-y-6">
      {/* 공정율 기준일 */}
      <div>
        <div className="flex items-center gap-2 text-sm font-semibold text-fg">
          <CalendarClock className="h-4 w-4 text-action" />{t('settings.baseDateHeading')}
        </div>
        <p className="mt-1 text-xs leading-5 text-fg-secondary">
          {t('settings.baseDateDesc1')}<strong className="text-fg">{t('settings.baseDateDescStrong')}</strong>{t('settings.baseDateDesc2')}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className={`chip ${baseDate ? 'bg-pending-weak text-warning' : 'bg-action-soft text-action'}`}>
            {baseDate ? `${t('settings.manualFixed')} · ${baseDate}` : t('settings.autoTodayChip')}
          </span>
          {canEdit && (
            <>
              <input type="date" value={dateInput} onChange={e => setDateInput(e.target.value)} className="app-input h-9 w-40 px-2 text-xs" />
              <button disabled={pending || !dateInput} onClick={() => run(() => setBaseDate(projectId, dateInput), t('settings.baseDateApplied'))} className="btn btn-primary h-9 px-3 text-[13px]">{t('settings.apply')}</button>
              {baseDate && (
                <button disabled={pending} onClick={() => { setDateInput(''); run(() => setBaseDate(projectId, null), t('settings.baseDateReset')) }} className="btn btn-ghost h-9 px-3 text-[13px]"><RotateCcw className="h-3.5 w-3.5" />{t('settings.toAuto')}</button>
              )}
            </>
          )}
        </div>
      </div>

      {/* 날짜 예외 — 휴무·근무 */}
      <div className="border-t border-border pt-5">
        <div className="text-sm font-semibold text-fg">{t('settings.holidaysHeading')}</div>
        <p className="mt-1 text-xs leading-5 text-fg-secondary">{t('settings.holidaysDesc')} {t('settings.holidaysTotalPrefix')}{sorted.length}{t('settings.holidaysTotalSuffix')}</p>
        <p className="mt-1 text-xs leading-5 text-fg-secondary">{t('settings.holidaysNoOverlay')}</p>
        <p className="mt-1 text-xs leading-5 text-fg-secondary">{t('settings.holidaysExportNote')}</p>

        {sorted.length > 0 ? (
          <ul className="mt-3 flex flex-wrap gap-2" aria-label={t('settings.holidaysHeading')}>
            {sorted.map(h => (
              <li key={h.date} data-holiday={h.date} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-subtle py-1 pl-2.5 pr-1.5 text-xs tabular-nums text-fg">
                <span className={`chip ${h.kind === 'work' ? 'bg-action-soft text-action' : 'bg-weekend text-fg-secondary'}`}>
                  {h.kind === 'work' ? t('settings.holidayKindWork') : t('settings.holidayKindOff')}
                </span>
                {h.date}{h.name ? ` · ${h.name}` : ''}
                {canEdit && (
                  <button disabled={pending} onClick={() => run(() => removeHoliday(projectId, h.date), t('settings.holidayRemoved'))} className="flex h-5 w-5 items-center justify-center rounded text-fg-muted transition hover:bg-danger-weak hover:text-danger" aria-label={`${t('settings.holidayRemoveAria')}: ${h.date}`}><Trash2 className="h-3 w-3" /></button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-xs text-fg-muted">{t('settings.noHolidays')}</p>
        )}

        {canEdit && (
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="block"><span className="mb-1 block text-[11px] font-semibold text-fg-secondary">{t('settings.date')}</span><input type="date" value={holDate} onChange={e => setHolDate(e.target.value)} className="app-input h-9 w-40 px-2 text-xs" /></label>
            <label className="block"><span className="mb-1 block text-[11px] font-semibold text-fg-secondary">{t('settings.holidayKind')}</span>
              <select value={holKind} onChange={e => setHolKind(e.target.value === 'work' ? 'work' : 'off')} className="app-input h-9 w-28 text-xs" aria-label={t('settings.holidayKind')}>
                <option value="off">{t('settings.holidayKindOff')}</option>
                <option value="work">{t('settings.holidayKindWork')}</option>
              </select>
            </label>
            <label className="block"><span className="mb-1 block text-[11px] font-semibold text-fg-secondary">{t('settings.nameOptional')}</span><input value={holName} onChange={e => setHolName(e.target.value)} placeholder={t('settings.holidayNamePlaceholder')} className="app-input h-9 w-44 text-xs" /></label>
            <button disabled={pending || !holDate} onClick={() => run(() => addHoliday(projectId, holDate, holName, holKind), t('settings.holidayAdded'), () => { setHolDate(''); setHolName('') })} className="btn btn-primary h-9 px-3 text-[13px]"><Plus className="h-3.5 w-3.5" />{t('common.add')}</button>
          </div>
        )}
      </div>
    </div>
  )
}
