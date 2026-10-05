'use client'

import { useMemo, useState, useTransition } from 'react'
import { Modal } from '@/components/ui/Modal'
import { bulkPasteWbsItems, createWbsBulkSnapshot, type WbsBulkResult, type WbsBulkSnapshotRow } from '@/app/actions/wbsBulk'
import { previewWbsPaste, type WbsPasteField, type WbsPasteOperation } from '@/lib/domain/wbsPaste'

const LABELS: Record<WbsPasteField, string> = { deliverable: '산출물', plannedStart: '시작일', plannedEnd: '종료일', biz: '업무 분류' }

export function WbsPasteDialog({ projectId, rows, columns, initialText = '', onClose, onSuccess }: {
  projectId: string; rows: WbsBulkSnapshotRow[]; columns: WbsPasteField[]; initialText?: string
  onClose: () => void; onSuccess: () => void
}) {
  const [text, setText] = useState(initialText)
  const [startField, setStartField] = useState(columns[0] ?? 'deliverable')
  const [result, setResult] = useState<WbsBulkResult | null>(null)
  const [retryOperations, setRetryOperations] = useState<WbsPasteOperation[] | null>(null)
  const [reviewRows, setReviewRows] = useState(rows)
  const [error, setError] = useState<string | null>(null)
  const [pending, transition] = useTransition()
  const preview = useMemo(() => {
    try { return { rows: retryOperations ?? previewWbsPaste(text, reviewRows, columns.slice(columns.indexOf(startField))), error: null } }
    catch (error) { return { rows: [], error: error instanceof Error ? error.message : '내용을 확인해 주세요.' } }
  }, [text, reviewRows, columns, startField, retryOperations])
  const apply = () => transition(async () => {
    try {
      setError(null)
      const result = await bulkPasteWbsItems(projectId, preview.rows)
      setResult(result)
      if (result.succeeded.length) onSuccess()
    } catch { setError('저장하지 못했습니다. 변경 내용을 유지했습니다. 다시 시도해 주세요.') }
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
    setError('실패한 항목의 최신 내용을 다시 불러왔습니다. 변경 내용을 검토한 뒤 적용해 주세요.')
    } catch { setError('최신 내용을 불러오지 못했습니다. 다시 시도해 주세요.') }
  })
  return <Modal open size="lg" title="WBS 붙여넣기 검토" onClose={() => { if (!pending) onClose() }}
    dirty={!!text.trim() && !result && !pending}
    footer={<>
      {result && <button type="button" className="btn btn-ghost" disabled={pending} onClick={onClose}>닫기</button>}
      {result?.failed.length ? <button type="button" className="btn btn-primary" disabled={pending} onClick={retry}>실패한 {result.failed.length}건만 다시 검토</button> : null}
      {!result && <button type="button" className="btn btn-primary" disabled={pending || !!preview.error || !preview.rows.length} onClick={apply}>{pending ? '저장 중…' : `${preview.rows.length}개 항목에 적용`}</button>}
    </>}>
    <div className="space-y-4" data-testid="wbs-paste-dialog">
      <p className="text-sm text-fg-secondary">선택된 {rows.length}개 표시 행에 적용합니다. 숨긴 열·필터 제외 행은 대상에 포함하지 않습니다. 빈 셀은 값을 지웁니다.</p>
      {!retryOperations && !result && <>
        <label className="block text-sm">시작 열<select className="app-input mt-1" value={startField} onChange={e => setStartField(e.target.value as WbsPasteField)}>{columns.map(field => <option key={field} value={field}>{LABELS[field]}</option>)}</select></label>
        <label className="block text-sm">표 내용<textarea className="app-textarea mt-1 min-h-32" value={text} onChange={e => setText(e.target.value)} placeholder="엑셀에서 복사한 셀을 붙여넣으세요." /></label>
      </>}
      {(preview.error || error) && <p role="alert" className="rounded-lg border border-danger bg-danger-weak p-3 text-sm text-danger">{preview.error ?? error}</p>}
      {preview.rows.length > 0 && <div className="max-h-64 overflow-auto rounded-lg border border-border">
        <table className="w-full text-left text-xs"><thead className="bg-surface-subtle"><tr><th className="p-2">작업</th><th className="p-2">변경 내용 (현재 → 변경)</th></tr></thead>
          <tbody>{preview.rows.map(row => <tr key={row.target.id} className="border-t border-border"><td className="p-2">{row.name}</td><td className="p-2">{Object.entries(row.changes).map(([field, value]) => <div key={field}>
            {LABELS[field as WbsPasteField]}: {reviewRows.find(item => item.id === row.target.id)?.[field as WbsPasteField] ?? '비어 있음'} → {value.mode === 'set' ? value.value : '값 비우기'}
          </div>)}</td></tr>)}</tbody>
        </table>
      </div>}
      {result && <div role="status" className="space-y-2" data-testid="wbs-paste-result">
        <p className="text-sm font-semibold">{result.succeeded.length}개 성공 · {result.failed.length}개 실패</p>
        {result.failed.map(row => <p key={row.itemId} className="text-sm text-danger">{preview.rows.find(item => item.target.id === row.itemId)?.name ?? row.itemId}: {row.message}</p>)}
      </div>}
    </div>
  </Modal>
}
