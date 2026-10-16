'use client'
import { newUuid } from '@/lib/domain/uuid'
import { useLocale } from '@/components/providers/LocaleProvider'
import { useState } from 'react'
import { DEFAULT_WEEKLY_COLUMNS, parseWeeklyColumns, WEEKLY_COLUMNS_MAX, type WeeklyColumn } from '@/lib/domain/weeklyColumns'
import { useSettingsCommand } from './useSettingsCommand'

export function WeeklyColumnsEditor({ projectId, value, revision, canEdit }: {
  projectId: string; value: WeeklyColumn[] | null; revision: number; canEdit: boolean
}) {
  const { t } = useLocale()
  const [draft, setDraft] = useState(() => (value ?? DEFAULT_WEEKLY_COLUMNS).map(c => ({ ...c })))
  const [baseline, setBaseline] = useState(JSON.stringify(value))
  const cmd = useSettingsCommand(projectId, revision, set => setBaseline(JSON.stringify(set['weekly.columns'])))
  const parsed = parseWeeklyColumns(draft)
  const locked = !canEdit || cmd.pending || cmd.uncertain
  function change(next: WeeklyColumn[]) { setDraft(next); cmd.clear() }
  function move(i: number, step: number) {
    const next = [...draft]; [next[i], next[i + step]] = [next[i + step], next[i]]; change(next)
  }
  return <div className="space-y-3">
    <p className="text-sm text-fg-secondary">{t('settings.weeklyColumns.hint')}</p>
    {value === null && <p role="alert" className="text-sm text-danger">{t('settings.weeklyColumns.invalid')}</p>}
    <ol className="space-y-2">
      {draft.map((c, i) => <li key={c.id} className="flex flex-wrap items-center gap-2 rounded border border-border p-2">
        <span className="text-sm text-fg-muted">{i + 1}.</span>
        <input aria-label={t('settings.weeklyColumns.itemName').replace('{n}', String(i + 1))} className="app-input min-w-0 flex-1" maxLength={40} value={c.label} disabled={locked}
          onChange={e => change(draft.map(v => v.id === c.id ? { ...v, label: e.target.value } : v))} />
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={c.carryOver} disabled={locked}
          onChange={e => change(draft.map(v => v.id === c.id ? { ...v, carryOver: e.target.checked } : v))} />{t('settings.weeklyColumns.carry')}</label>
        <button type="button" className="btn btn-ghost px-2" aria-label={t('settings.weeklyColumns.up').replace('{name}', c.label)} disabled={locked || i === 0} onClick={() => move(i, -1)}>↑</button>
        <button type="button" className="btn btn-ghost px-2" aria-label={t('settings.weeklyColumns.down').replace('{name}', c.label)} disabled={locked || i === draft.length - 1} onClick={() => move(i, 1)}>↓</button>
        <button type="button" className="btn btn-ghost px-2" aria-label={t('settings.weeklyColumns.removeLabel').replace('{name}', c.label)} disabled={locked || draft.length === 1} onClick={() => change(draft.filter(v => v.id !== c.id))}>{t('settings.weeklyColumns.remove')}</button>
      </li>)}
    </ol>
    <div className="flex gap-2">
      <button type="button" className="btn btn-secondary" disabled={locked || draft.length >= WEEKLY_COLUMNS_MAX}
        onClick={() => change([...draft, { id: `item_${newUuid().replaceAll('-', '').slice(0, 24)}`, label: '', carryOver: true }])}>{t('settings.weeklyColumns.add')}</button>
      {canEdit && <button type="button" className="btn btn-primary" disabled={cmd.pending || (!cmd.uncertain && (!parsed.ok || JSON.stringify(draft) === baseline))}
        onClick={() => cmd.save({ 'weekly.columns': parsed.ok ? parsed.value : draft })}>{cmd.uncertain ? t('settings.weeklyColumns.retry') : t('settings.weeklyColumns.save')}</button>}
    </div>
    <p className="text-xs text-fg-muted">{t('settings.weeklyColumns.footnote').replace('{max}', String(WEEKLY_COLUMNS_MAX))}</p>
    {!parsed.ok && <p role="alert" className="text-sm text-danger">{parsed.error}</p>}
    {(cmd.fieldErrors['weekly.columns'] ?? cmd.error) && <p role="alert" className="text-sm text-danger">{cmd.fieldErrors['weekly.columns'] ?? cmd.error}</p>}
    {cmd.saved && <p role="status" className="text-sm text-success">{t('settings.weeklyColumns.saved')}</p>}
  </div>
}
