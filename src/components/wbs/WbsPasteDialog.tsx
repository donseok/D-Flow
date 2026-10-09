'use client'

import { useMemo, useState, useTransition } from 'react'
import { Modal } from '@/components/ui/Modal'
import { bulkPasteWbsItems, createWbsBulkSnapshot, type WbsBulkResult, type WbsBulkSnapshotRow } from '@/app/actions/wbsBulk'
import { previewWbsPaste, type WbsPasteField, type WbsPasteOperation } from '@/lib/domain/wbsPaste'
import { useLocale } from '@/components/providers/LocaleProvider'
import type { DictKey } from '@/lib/i18n/dict'

const LABELS: Record<WbsPasteField, DictKey> = { deliverable: 'wbs.colDeliverable', plannedStart: 'wbs.field.start', plannedEnd: 'wbs.field.end', biz: 'wbs.field.biz' }

export function WbsPasteDialog({ projectId, rows, columns, initialText = '', extraAxisLabel = null, onClose, onSuccess }: {
  projectId: string; rows: WbsBulkSnapshotRow[]; columns: WbsPasteField[]; initialText?: string
  /** 프로젝트의 추가 축 이름(core.extra_axis_label) — null 은 기본 문구 */
  extraAxisLabel?: string | null
  onClose: () => void; onSuccess: () => void
}) {
  const { t } = useLocale()
  const labelOf = (field: WbsPasteField) => field === 'biz' && extraAxisLabel ? extraAxisLabel : t(LABELS[field])
  const [text, setText] = useState(initialText)
  const [startField, setStartField] = useState(columns[0] ?? 'deliverable')
  const [result, setResult] = useState<WbsBulkResult | null>(null)
  const [retryOperations, setRetryOperations] = useState<WbsPasteOperation[] | null>(null)
  const [reviewRows, setReviewRows] = useState(rows)
  const [error, setError] = useState<string | null>(null)
  const [pending, transition] = useTransition()
  const preview = useMemo(() => {
    try { return { rows: retryOperations ?? previewWbsPaste(text, reviewRows, columns.slice(columns.indexOf(startField))), error: null } }
    catch (error) { return { rows: [], error: error instanceof Error ? error.message : t('wbs.paste.checkInput') } }
  }, [text, reviewRows, columns, startField, retryOperations, t])
  const apply = () => transition(async () => {
    try {
      setError(null)
      const result = await bulkPasteWbsItems(projectId, preview.rows)
      setResult(result)
      if (result.succeeded.length) onSuccess()
    } catch { setError(t('wbs.paste.saveFail')) }
  })
  const retry = () => transition(async () => {
    if (!result) return
    try {
    const ids = result.failed.map(row => row.itemId)
    const snapshot = await createWbsBulkSnapshot(projectId, ids)
    if (!snapshot.ok) { setError(snapshot.error); return }
    const latest = new Map(snapshot.rows.map(row => [row.id, row]))
    setRetryOperations(preview.rows.filter(row => ids.includes(row.target.id)).map(row => ({ ...row, target: { id: row.target.id, updatedAt: latest.get(row.target.id)!.updatedAt } })))
    setReviewRows(snapshot.rows)
    setResult(null)
    setError(t('wbs.paste.reloaded'))
    } catch { setError(t('wbs.bulk.reloadFail')) }
  })
  return <Modal open size="lg" title={t('wbs.paste.title')} onClose={() => { if (!pending) onClose() }}
    dirty={!!text.trim() && !result && !pending}
    footer={<>
      {result && <button type="button" className="btn btn-ghost" disabled={pending} onClick={onClose}>{t('common.close')}</button>}
      {result?.failed.length ? <button type="button" className="btn btn-primary" disabled={pending} onClick={retry}>{t('wbs.paste.retryFailed').replace('{n}', String(result.failed.length))}</button> : null}
      {!result && <button type="button" className="btn btn-primary" disabled={pending || !!preview.error || !preview.rows.length} onClick={apply}>{pending ? t('wbs.saving') : t('wbs.paste.apply').replace('{n}', String(preview.rows.length))}</button>}
    </>}>
    <div className="space-y-4" data-testid="wbs-paste-dialog">
      <p className="text-sm text-fg-secondary">{t('wbs.paste.intro').replace('{n}', String(rows.length))}</p>
      {!retryOperations && !result && <>
        <label className="block text-sm">{t('wbs.paste.startColumn')}<select className="app-input mt-1" value={startField} onChange={e => setStartField(e.target.value as WbsPasteField)}>{columns.map(field => <option key={field} value={field}>{labelOf(field)}</option>)}</select></label>
        <label className="block text-sm">{t('wbs.paste.tableText')}<textarea className="app-textarea mt-1 min-h-32" value={text} onChange={e => setText(e.target.value)} placeholder={t('wbs.paste.placeholder')} /></label>
      </>}
      {(preview.error || error) && <p role="alert" className="rounded-lg border border-danger bg-danger-weak p-3 text-sm text-danger">{preview.error ?? error}</p>}
      {preview.rows.length > 0 && <div className="max-h-64 overflow-auto rounded-lg border border-border">
        <table className="w-full text-left text-xs"><thead className="bg-surface-subtle"><tr><th className="p-2">{t('wbs.paste.colTask')}</th><th className="p-2">{t('wbs.paste.colChange')}</th></tr></thead>
          <tbody>{preview.rows.map(row => <tr key={row.target.id} className="border-t border-border"><td className="p-2">{row.name}</td><td className="p-2">{Object.entries(row.changes).map(([field, value]) => <div key={field}>
            {labelOf(field as WbsPasteField)}: {reviewRows.find(item => item.id === row.target.id)?.[field as WbsPasteField] ?? t('wbs.paste.emptyValue')} → {value.mode === 'set' ? value.value : t('wbs.bulk.modeClear')}
          </div>)}</td></tr>)}</tbody>
        </table>
      </div>}
      {result && <div role="status" className="space-y-2" data-testid="wbs-paste-result">
        <p className="text-sm font-semibold">{t('wbs.paste.result').replace('{ok}', String(result.succeeded.length)).replace('{fail}', String(result.failed.length))}</p>
        {result.failed.map(row => <p key={row.itemId} className="text-sm text-danger">{preview.rows.find(item => item.target.id === row.itemId)?.name ?? row.itemId}: {row.message}</p>)}
      </div>}
    </div>
  </Modal>
}
