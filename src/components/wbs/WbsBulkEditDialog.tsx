'use client'

import { useId, useMemo, useRef, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { X, AlertCircle, CheckCircle2, RefreshCw, AlertTriangle, Layers } from 'lucide-react'
import { useEscHandler, ESC_PRIORITY } from '@/lib/ui/escStack'
import {
  bulkUpdateWbsItems,
  createWbsBulkSnapshot,
  type WbsBulkSnapshotRow,
  type WbsBulkChanges,
  type WbsBulkResult,
} from '@/app/actions/wbsBulk'
import type { StageCode } from '@/lib/domain/stageLabels'
import { useTeams } from '@/components/app/TeamsProvider'
import type { ProjectMember } from '@/lib/domain/types'
import { useDialogFocus } from '@/lib/ui/useDialogFocus'
import { DirtyConfirmDialog } from '@/components/ui/DirtyConfirmDialog'
import { useStageLabel } from './StageLabelsProvider'
import { useLocale } from '@/components/providers/LocaleProvider'

export interface WbsItemSummary {
  id: string
  name: string
  plannedStart?: string | null
  plannedEnd?: string | null
  deliverable?: string | null
  biz?: string | null
  stage?: string | null
  assigneeMemberId?: string | null
  teamCode?: string | null
}

export interface WbsBulkEditDialogProps {
  open: boolean
  onClose: () => void
  projectId: string
  selectedItems: WbsItemSummary[]
  totalCount: number
  allItemIdsSnapshot?: string[]
  snapshotRows?: WbsBulkSnapshotRow[]
  members?: ProjectMember[]
  /** 프로젝트의 추가 축 이름(core.extra_axis_label) — null 은 기본 문구 */
  extraAxisLabel?: string | null
  onSuccess?: () => void
}

type FieldMode = 'unchanged' | 'set' | 'clear'

export function WbsBulkEditDialog({
  open,
  onClose,
  projectId,
  selectedItems,
  allItemIdsSnapshot,
  onSuccess,
  snapshotRows = [],
  members = [],
  extraAxisLabel = null,
}: WbsBulkEditDialogProps) {
  const stageLabel = useStageLabel()
  const { t } = useLocale()
  const dialogId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  useDialogFocus(panelRef, open)
  const teams = useTeams()
  const [retryRows, setRetryRows] = useState<WbsBulkSnapshotRow[] | null>(null)
  const [discardOpen, setDiscardOpen] = useState(false)

  const [scope, setScope] = useState<'selected' | 'all'>('selected')
  const [retryItemIds, setRetryItemIds] = useState<string[] | null>(null)

  // 각 필드별 모드 및 설정값 상태
  const [startMode, setStartMode] = useState<FieldMode>('unchanged')
  const [startVal, setStartVal] = useState('')

  const [endMode, setEndMode] = useState<FieldMode>('unchanged')
  const [endVal, setEndVal] = useState('')

  const [delivMode, setDelivMode] = useState<FieldMode>('unchanged')
  const [delivVal, setDelivVal] = useState('')

  const [bizMode, setBizMode] = useState<FieldMode>('unchanged')
  const [bizVal, setBizVal] = useState('')

  const [assigneeMode, setAssigneeMode] = useState<FieldMode>('unchanged')
  const [assigneeVal, setAssigneeVal] = useState('')
  const [teamMode, setTeamMode] = useState<FieldMode>('unchanged')
  const [teamVal, setTeamVal] = useState('')
  const [stageMode, setStageMode] = useState<FieldMode>('unchanged')
  const [stageVal, setStageVal] = useState<StageCode | 'none'>('none')

  const [isPending, startTransition] = useTransition()
  const [result, setResult] = useState<WbsBulkResult | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // 선택된 항목들의 혼합(Mixed) 상태 계산
  const isMixedStart = useMemo(() => {
    if (selectedItems.length <= 1) return false
    return new Set(selectedItems.map(it => it.plannedStart || '')).size > 1
  }, [selectedItems])

  const isMixedEnd = useMemo(() => {
    if (selectedItems.length <= 1) return false
    return new Set(selectedItems.map(it => it.plannedEnd || '')).size > 1
  }, [selectedItems])

  const isMixedDeliv = useMemo(() => {
    if (selectedItems.length <= 1) return false
    return new Set(selectedItems.map(it => it.deliverable || '')).size > 1
  }, [selectedItems])

  const isMixedBiz = useMemo(() => {
    if (selectedItems.length <= 1) return false
    return new Set(selectedItems.map(it => it.biz || '')).size > 1
  }, [selectedItems])

  const isMixedStage = useMemo(() => {
    if (selectedItems.length <= 1) return false
    return new Set(selectedItems.map(it => it.stage || '')).size > 1
  }, [selectedItems])

  // 실제 적용 대상 ID 목록
  const targetIds = useMemo(() => {
    if (retryItemIds) return retryItemIds
    if (scope === 'all' && allItemIdsSnapshot && allItemIdsSnapshot.length > 0) {
      return allItemIdsSnapshot
    }
    return selectedItems.map(it => it.id)
  }, [scope, selectedItems, allItemIdsSnapshot, retryItemIds])

  const hasChanges =
    startMode !== 'unchanged' ||
    endMode !== 'unchanged' ||
    delivMode !== 'unchanged' ||
    bizMode !== 'unchanged' ||
    stageMode !== 'unchanged' || assigneeMode !== 'unchanged' || teamMode !== 'unchanged'

  const requestClose = () => {
    if (isPending) return
    if (hasChanges && !result) setDiscardOpen(true)
    else onClose()
  }
  useEscHandler(requestClose, { priority: ESC_PRIORITY.MODAL, enabled: open && !discardOpen })
  const reviewRows = retryRows ?? snapshotRows
  const activeRows = reviewRows.filter(row => targetIds.includes(row.id))
  const mixed = (field: keyof WbsItemSummary) => new Set(activeRows.map(row => row[field] ?? '')).size > 1

  const handleSubmit = () => {
    if (!hasChanges || targetIds.length === 0) return
    setErrorMessage(null)
    if ((stageMode !== 'unchanged' || assigneeMode !== 'unchanged') && [startMode, endMode, delivMode, bizMode, teamMode, stageMode, assigneeMode].filter(mode => mode !== 'unchanged').length > 1) {
      setErrorMessage(t('wbs.bulk.errSeparate'))
      return
    }

    // 시작일 > 종료일 사전 검증
    if (startMode === 'set' && endMode === 'set' && startVal && endVal && startVal > endVal) {
      setErrorMessage(t('wbs.bulk.errDateOrder'))
      return
    }

    const changes: WbsBulkChanges = {}

    if (startMode === 'set') {
      changes.plannedStart = { mode: 'set', value: startVal }
    } else if (startMode === 'clear') {
      changes.plannedStart = { mode: 'clear' }
    } else {
      changes.plannedStart = { mode: 'unchanged' }
    }

    if (endMode === 'set') {
      changes.plannedEnd = { mode: 'set', value: endVal }
    } else if (endMode === 'clear') {
      changes.plannedEnd = { mode: 'clear' }
    } else {
      changes.plannedEnd = { mode: 'unchanged' }
    }

    if (delivMode === 'set') {
      changes.deliverable = { mode: 'set', value: delivVal }
    } else if (delivMode === 'clear') {
      changes.deliverable = { mode: 'clear' }
    } else {
      changes.deliverable = { mode: 'unchanged' }
    }

    if (bizMode === 'set') {
      changes.biz = { mode: 'set', value: bizVal }
    } else if (bizMode === 'clear') {
      changes.biz = { mode: 'clear' }
    } else {
      changes.biz = { mode: 'unchanged' }
    }

    if (stageMode === 'set') {
      changes.stage = { mode: 'set', value: stageVal }
    } else if (stageMode === 'clear') {
      changes.stage = { mode: 'clear' }
    } else {
      changes.stage = { mode: 'unchanged' }
    }

    if (assigneeMode !== 'unchanged') changes.assigneeMemberId = assigneeMode === 'clear' ? { mode: 'clear' } : { mode: 'set', value: assigneeVal }
    if (teamMode !== 'unchanged') changes.teamCode = teamMode === 'clear' ? { mode: 'clear' } : { mode: 'set', value: teamVal }
    startTransition(async () => {
      try {
        const res = await bulkUpdateWbsItems(projectId, targetIds, changes, reviewRows.filter(row => targetIds.includes(row.id)).map(({ id, updatedAt }) => ({ id, updatedAt })))
        setResult(res)
        if (res.succeeded.length > 0 && onSuccess) {
          onSuccess()
        }
      } catch {
        setErrorMessage(t('wbs.bulk.errApply'))
      }
    })
  }

  const handleRetryFailedOnly = () => {
    if (!result || !result.failed.length) return
    const ids = result.failed.map(item => item.itemId)
    startTransition(async () => {
      try {
      const snapshot = await createWbsBulkSnapshot(projectId, ids)
      if (!snapshot.ok) { setErrorMessage(snapshot.error); return }
      setRetryItemIds(ids)
      setRetryRows(snapshot.rows)
      setResult(null)
      setErrorMessage(t('wbs.bulk.reloaded'))
      } catch { setErrorMessage(t('wbs.bulk.reloadFail')) }
    })
  }

  if (!open) return null

  const modalContent = (
    <div
      ref={panelRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${dialogId}-title`}
      data-testid="wbs-bulk-edit-dialog"
      className="fixed inset-0 z-(--z-modal) flex items-start justify-center overflow-y-auto p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-150"
    >
      <div className="my-auto flex shrink-0 flex-col w-full max-w-xl max-h-[max(300px,calc(100dvh-2rem))] rounded-2xl border border-border bg-surface-raised shadow-2xl overflow-hidden">
        {/* 헤더 */}
        <div className="flex shrink-0 items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-action/10 text-action">
              <Layers className="h-5 w-5" />
            </div>
            <div>
              <h2 id={`${dialogId}-title`} className="text-base font-semibold text-fg">
                {t('wbs.bulk.title')}
              </h2>
              <p className="text-xs text-fg-muted">
                {retryItemIds
                  ? t('wbs.bulk.subtitleRetry').replace('{n}', String(retryItemIds.length))
                  : t('wbs.bulk.subtitleSelected').replace('{n}', String(selectedItems.length))}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={requestClose} disabled={isPending}
            className="rounded-lg p-1.5 text-fg-muted hover:bg-surface-hover hover:text-fg transition-colors"
            aria-label={t('common.close')}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 본문 */}
        <div className="min-h-0 flex-1 overflow-y-auto p-6 space-y-5">
          {/* 결과 패널이 표시되는 경우 */}
          {result ? (
            <div className="space-y-4" data-testid="wbs-bulk-result-panel">
              {result.ok ? (
                <div className="rounded-xl border border-success bg-success-weak p-4 flex items-start gap-3">
                  <CheckCircle2 className="h-5 w-5 text-success shrink-0 mt-0.5" />
                  <div>
                    <h3 className="text-sm font-semibold text-success">
                      {t('wbs.bulk.doneTitle')}
                    </h3>
                    <p className="text-xs text-success mt-0.5">
                      {t('wbs.bulk.doneDesc').replace('{n}', String(result.total))}
                    </p>
                  </div>
                </div>
              ) : (
              <div className="space-y-3">
                  <div className="rounded-xl border border-warning bg-warning-weak p-4 flex items-start gap-3">
                    <AlertTriangle className="h-5 w-5 text-warning shrink-0 mt-0.5" />
                    <div>
                      <h3 className="text-sm font-semibold text-warning">
                        {t('wbs.bulk.partialTitle')}
                      </h3>
                      <p className="text-xs text-warning mt-0.5">
                        {t('wbs.bulk.partialDesc').replace('{total}', String(result.total)).replace('{ok}', String(result.succeeded.length)).replace('{fail}', String(result.failed.length))}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold text-fg-muted">
                      {t('wbs.bulk.failedList')}
                    </h4>
                    <div className="max-h-48 overflow-y-auto space-y-1.5 rounded-lg border border-border bg-surface-subtle p-2">
                      {result.failed.map(f => (
                        <div
                          key={f.itemId}
                          data-testid="wbs-bulk-failed-item"
                          className="flex items-center justify-between text-xs p-2 rounded bg-surface border border-border/60"
                        >
                          <div className="truncate pr-2">
                            <span className="font-medium text-fg">{f.name || f.itemId}</span>
                            <span className="text-fg-muted ml-2">{f.message}</span>
                          </div>
                          <span className="shrink-0 rounded bg-danger-weak px-1.5 py-0.5 text-xs font-medium text-danger">
                            {f.reason === 'permission'
                              ? t('wbs.err.denied')
                              : f.reason === 'conflict'
                                ? t('wbs.bulk.reasonConflict')
                                : t('wbs.bulk.reasonInvalid')}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <>
              {/* 범위 선택기 (전체 스냅샷이 있는 경우만) */}
              {!retryItemIds && allItemIdsSnapshot && allItemIdsSnapshot.length > selectedItems.length && (
                <div className="rounded-xl border border-border bg-surface-subtle p-3.5 space-y-2">
                  <span className="text-xs font-semibold text-fg-muted block">{t('wbs.bulk.scope')}</span>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <label
                      className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                        scope === 'selected'
                          ? 'border-action bg-action/5 text-fg font-semibold'
                          : 'border-border bg-surface text-fg-secondary hover:bg-surface-hover'
                      }`}
                    >
                      <input
                        type="radio"
                        name="bulk-scope"
                        checked={scope === 'selected'}
                        onChange={() => setScope('selected')}
                        className="sr-only"
                      />
                      <span>{t('wbs.bulk.scopeSelected').replace('{n}', String(selectedItems.length))}</span>
                    </label>
                    <label
                      className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                        scope === 'all'
                          ? 'border-action bg-action/5 text-fg font-semibold'
                          : 'border-border bg-surface text-fg-secondary hover:bg-surface-hover'
                      }`}
                    >
                      <input
                        type="radio"
                        name="bulk-scope"
                        checked={scope === 'all'}
                        onChange={() => setScope('all')}
                        className="sr-only"
                      />
                      <span>{t('wbs.bulk.scopeAll').replace('{n}', String(allItemIdsSnapshot.length))}</span>
                    </label>
                  </div>
                </div>
              )}

              {errorMessage && (
                <div
                  role="alert"
                  className="rounded-xl border border-danger bg-danger-weak p-3 text-xs text-danger flex items-center gap-2"
                >
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}

              {/* 필드별 설정 영역 */}
              <div className="space-y-4">
                {/* 1. 시작일 */}
                <FieldRow
                  label={t('wbs.field.start')}
                  isMixed={activeRows.length ? mixed("plannedStart") : isMixedStart}
                  mode={startMode}
                  onModeChange={setStartMode}
                  inputControl={
                    <input
                      type="date"
                      value={startVal}
                      onChange={e => setStartVal(e.target.value)}
                      data-testid="bulk-input-planned-start"
                      className="w-full text-xs rounded-lg border border-border bg-surface px-2.5 py-1.5 text-fg focus:outline-hidden focus:ring-1 focus:ring-action"
                    />
                  }
                />

                {/* 2. 종료일 */}
                <FieldRow
                  label={t('wbs.field.end')}
                  isMixed={activeRows.length ? mixed("plannedEnd") : isMixedEnd}
                  mode={endMode}
                  onModeChange={setEndMode}
                  inputControl={
                    <input
                      type="date"
                      value={endVal}
                      onChange={e => setEndVal(e.target.value)}
                      data-testid="bulk-input-planned-end"
                      className="w-full text-xs rounded-lg border border-border bg-surface px-2.5 py-1.5 text-fg focus:outline-hidden focus:ring-1 focus:ring-action"
                    />
                  }
                />

                {/* 3. 산출물 */}
                <FieldRow
                  label={t('wbs.colDeliverable')}
                  isMixed={activeRows.length ? mixed("deliverable") : isMixedDeliv}
                  mode={delivMode}
                  onModeChange={setDelivMode}
                  inputControl={
                    <input
                      type="text"
                      placeholder={t('wbs.bulk.deliverablePlaceholder')}
                      value={delivVal}
                      onChange={e => setDelivVal(e.target.value)}
                      data-testid="bulk-input-deliverable"
                      className="w-full text-xs rounded-lg border border-border bg-surface px-2.5 py-1.5 text-fg placeholder:text-fg-muted focus:outline-hidden focus:ring-1 focus:ring-action"
                    />
                  }
                />

                {/* 4. 업무 분류 — 이름은 프로젝트의 추가 축 이름을 따른다 */}
                <FieldRow
                  label={extraAxisLabel ?? t('wbs.field.biz')}
                  isMixed={activeRows.length ? mixed("biz") : isMixedBiz}
                  mode={bizMode}
                  onModeChange={setBizMode}
                  inputControl={
                    <input
                      type="text"
                      placeholder={t('wbs.bulk.bizPlaceholder')}
                      value={bizVal}
                      onChange={e => setBizVal(e.target.value)}
                      data-testid="bulk-input-biz"
                      className="w-full text-xs rounded-lg border border-border bg-surface px-2.5 py-1.5 text-fg placeholder:text-fg-muted focus:outline-hidden focus:ring-1 focus:ring-action"
                    />
                  }
                />

                {/* 5. WBS 단계 */}
                <p className="text-xs text-fg-secondary">{t('wbs.bulk.separateHint')}</p>
                <FieldRow label={t('wbs.colAssignee')} isMixed={mixed('assigneeMemberId')} mode={assigneeMode} onModeChange={setAssigneeMode}
                  inputControl={<select aria-label={t('wbs.bulk.assigneeNewAria')} value={assigneeVal} onChange={e => setAssigneeVal(e.target.value)} className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs">
                    <option value="">{t('wbs.bulk.assigneePick')}</option>{members.filter(member => member.active).map(member => <option key={member.id} value={member.id}>{member.name}</option>)}
                  </select>} />
                <FieldRow label={t('wbs.bulk.primaryTeam')} isMixed={mixed('teamCode')} mode={teamMode} onModeChange={setTeamMode}
                  inputControl={<select aria-label={t('wbs.bulk.teamNewAria')} value={teamVal} onChange={e => setTeamVal(e.target.value)} className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs">
                    <option value="">{t('wbs.bulk.teamPick')}</option>{teams.map(team => <option key={team.id} value={team.code}>{team.name}</option>)}
                  </select>} />
                <FieldRow
                  label={t('wbs.bulk.stage')}
                  isMixed={activeRows.length ? mixed("stage") : isMixedStage}
                  mode={stageMode}
                  onModeChange={setStageMode}
                  inputControl={
                    <select
                      value={stageVal}
                      onChange={e => setStageVal(e.target.value as StageCode | 'none')}
                      data-testid="bulk-input-stage"
                      className="w-full text-xs rounded-lg border border-border bg-surface px-2.5 py-1.5 text-fg focus:outline-hidden focus:ring-1 focus:ring-action"
                    >
                      <option value="none">{stageLabel(null, t('wbs.stageNoneOption'))}</option>
                      <option value="as">{stageLabel('as', t('wbs.stageAs'))}</option>
                      <option value="ip">{stageLabel('ip', t('wbs.stageIp'))}</option>
                      <option value="im">{stageLabel('im', t('wbs.stageIm'))}</option>
                      <option value="xx">{stageLabel('xx', t('wbs.stageXx'))}</option>
                    </select>
                  }
                />
              </div>
            </>
          )}
        </div>

        {/* 푸터 */}
        <div className="flex shrink-0 flex-wrap items-center justify-between px-6 py-4 border-t border-border bg-surface-subtle/50">
          {result ? (
            <div className="flex items-center justify-end w-full gap-2">
              {result.failed.length > 0 && (
                <button
                  type="button"
                  onClick={handleRetryFailedOnly}
                  data-testid="wbs-bulk-retry-failed-btn"
                  className="flex min-h-11 items-center gap-1.5 rounded-xl bg-warning px-4 text-xs font-semibold text-warning-fg transition-colors hover:bg-warning/90"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  {t('wbs.bulk.retryFailed').replace('{n}', String(result.failed.length))}
                </button>
              )}
              <button
                type="button"
                onClick={requestClose} disabled={isPending}
                className="min-h-11 rounded-xl border border-border bg-surface px-4 text-xs font-semibold text-fg transition-colors hover:bg-surface-hover"
              >
                {t('common.close')}
              </button>
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={requestClose} disabled={isPending}
                className="min-h-11 rounded-xl border border-border bg-surface px-4 text-xs font-medium text-fg transition-colors hover:bg-surface-hover"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!hasChanges || isPending}
                data-testid="wbs-bulk-apply-btn"
                className="flex min-h-11 items-center gap-1.5 rounded-xl bg-action px-4 text-xs font-semibold text-action-fg transition-colors hover:bg-action-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isPending && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                {isPending ? t('wbs.bulk.applying') : t('wbs.bulk.apply').replace('{n}', String(targetIds.length))}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )

  if (typeof document === 'undefined') return null
  return <>{createPortal(modalContent, document.body)}<DirtyConfirmDialog open={discardOpen}
    onContinue={() => setDiscardOpen(false)} onDiscard={() => { setDiscardOpen(false); onClose() }} /></>
}

function FieldRow({
  label,
  isMixed,
  mode,
  onModeChange,
  inputControl,
}: {
  label: string
  isMixed: boolean
  mode: FieldMode
  onModeChange: (m: FieldMode) => void
  inputControl: React.ReactNode
}) {
  const { t } = useLocale()
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-border/60 bg-surface p-3 text-xs">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-fg">{label}</span>
          {isMixed && (
            <span
              data-testid={`bulk-mixed-indicator-${label}`}
              className="rounded bg-warning-weak px-1.5 py-0.5 text-xs font-medium text-warning"
            >
              {t('wbs.bulk.mixed')}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onModeChange('unchanged')}
            className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
              mode === 'unchanged'
                ? 'bg-surface-selected text-fg font-semibold'
                : 'text-fg-muted hover:text-fg hover:bg-surface-hover'
            }`}
          >
            {t('wbs.bulk.modeUnchanged')}
          </button>
          <button
            type="button"
            onClick={() => onModeChange('set')}
            className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
              mode === 'set'
                ? 'bg-action text-action-fg font-semibold'
                : 'text-fg-muted hover:text-fg hover:bg-surface-hover'
            }`}
          >
            {t('wbs.bulk.modeSet')}
          </button>
          <button
            type="button"
            onClick={() => onModeChange('clear')}
            className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
              mode === 'clear'
                ? 'bg-danger text-danger-fg font-semibold'
                : 'text-fg-muted hover:text-fg hover:bg-surface-hover'
            }`}
          >
            {t('wbs.bulk.modeClear')}
          </button>
        </div>
      </div>

      <div className="mt-1">
        {mode === 'unchanged' && (
          <div className="text-fg-muted text-xs py-1">
            {isMixed ? t('wbs.bulk.keepMixed') : t('wbs.bulk.keepSame')}
          </div>
        )}
        {mode === 'clear' && (
          <div className="text-danger text-xs py-1 font-medium">
            {t('wbs.bulk.clearHint')}
          </div>
        )}
        {mode === 'set' && inputControl}
      </div>
    </div>
  )
}
