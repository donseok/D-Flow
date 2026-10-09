'use client'

import { useState, useTransition } from 'react'
import { listSettingsHistory, type SettingsHistoryResult, type SettingsHistoryScope } from '@/app/actions/settings'
import { stampIn } from '@/lib/domain/calendar'
import type { DictKey } from '@/lib/i18n/dict'
import { useLocale } from '@/components/providers/LocaleProvider'

type T = (k: DictKey) => string

const SOURCE: Record<string, DictKey> = { edit: 'settings.history.source.edit', create: 'settings.history.source.create', copy: 'settings.history.source.copy', migration: 'settings.history.source.migration', internal: 'settings.history.source.internal' }
const formatValue = (value: unknown, t: T) => value === null ? t('common.none') : JSON.stringify(value, null, 2) ?? t('common.none')
const formatDate = (iso: string, timeZone: string, t: T) => Number.isNaN(new Date(iso).getTime()) ? t('settings.log.badTime') : stampIn(timeZone, iso)

/** 이력은 읽기 전용이다. 커서(id)로 이전 20건씩 읽고, 원문 값은 접어서 보여준다. */
export function SettingsHistoryList({ scope, initial, timeZone }: {
  scope: SettingsHistoryScope; initial: SettingsHistoryResult
  /** 변경 시각을 찍을 시간대(그 범위의 calendar.timezone) — 서버가 내려준다 */
  timeZone: string
}) {
  const { t } = useLocale()
  const [rows, setRows] = useState(initial.ok ? initial.rows : [])
  const [nextBefore, setNextBefore] = useState(initial.ok ? initial.nextBefore : null)
  const [error, setError] = useState(initial.ok ? null : initial.error)
  const [pending, startTransition] = useTransition()

  function load(before?: number) {
    startTransition(async () => {
      try {
        const result = await listSettingsHistory(scope, before === undefined ? undefined : { before })
        if (!result.ok) { setError(result.error); return }
        setRows(current => before === undefined ? result.rows : [...current, ...result.rows])
        setNextBefore(result.nextBefore); setError(null)
      } catch {
        setError(t('settings.history.loadFailed'))
      }
    })
  }

  return <div className="space-y-4">
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {!error && rows.length === 0 && <p className="text-sm text-fg-secondary">{t('settings.history.empty')}</p>}
    {rows.length > 0 && <ol className="divide-y divide-border">
      {rows.map(row => <li key={row.id} className="space-y-2 py-4 first:pt-0">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <strong className="text-sm text-fg">{row.key}</strong>
          <span className="text-xs text-fg-secondary">{t('settings.history.revisionAt').replace('{revision}', String(row.revision)).replace('{changedAt}', String(formatDate(row.changedAt, timeZone, t)))}</span>
        </div>
        <p className="text-xs text-fg-secondary">{row.changedByName} · {SOURCE[row.source] ? t(SOURCE[row.source]) : row.source}{row.copiedFrom ? t('settings.history.copiedFrom').replace('{copiedFrom}', String(row.copiedFrom)) : ''}</p>
        <details className="rounded-lg bg-surface-subtle p-3 text-xs">
          <summary className="cursor-pointer font-medium text-fg">{t('settings.history.beforeAfter')}</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div><span className="text-fg-muted">{t('settings.history.before')}</span><pre className="mt-1 max-h-36 overflow-auto whitespace-pre-wrap break-all text-fg">{formatValue(row.oldValue, t)}</pre></div>
            <div><span className="text-fg-muted">{t('settings.history.after')}</span><pre className="mt-1 max-h-36 overflow-auto whitespace-pre-wrap break-all text-fg">{formatValue(row.newValue, t)}</pre></div>
          </div>
        </details>
      </li>)}
    </ol>}
    <div className="flex flex-wrap gap-2">
      {nextBefore !== null && <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => load(nextBefore)}>{t('settings.log.more')}</button>}
      <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => load()}>{t('settings.log.refresh')}</button>
    </div>
  </div>
}
