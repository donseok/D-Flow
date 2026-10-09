'use client'
import { useLocale } from '@/components/providers/LocaleProvider'

export interface ConflictRow { key: string; label: string; mine: string; latest: string }

/** 충돌 때 초안을 유지한 채 기준 revision을 다시 고르는 비교 화면. */
export function ConflictCompare({ rows, onMine, onLatest, latestAvailable = true }: {
  rows: ConflictRow[]; onMine: () => void; onLatest: () => void; latestAvailable?: boolean
}) {
  const { t } = useLocale()
  return <div role="alert" className="space-y-3 rounded-xl border border-pending/30 bg-pending-weak p-4 text-sm">
    <strong className="text-fg">{t('settings.conflict.changed')}</strong>
    <div className="space-y-2">
      {rows.map(row => <div key={row.key} className="rounded-lg border border-border bg-surface p-3">
        <p className="mb-2 font-semibold text-fg">{row.label}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <div><span className="text-xs text-fg-secondary">{t('common.conflictMine')}</span><p className="break-words text-fg">{row.mine || t('common.none')}</p></div>
          <div><span className="text-xs text-fg-secondary">{t('settings.conflict.latest')}</span><p className="break-words text-fg">{row.latest || t('common.none')}</p></div>
        </div>
      </div>)}
    </div>
    <div className="flex flex-wrap gap-2">
      <button type="button" className="btn btn-ghost" onClick={onMine}>{t('settings.conflict.reapplyMine')}</button>
      {latestAvailable && <button type="button" className="btn btn-ghost" onClick={onLatest}>{t('settings.conflict.useLatest')}</button>}
    </div>
  </div>
}
