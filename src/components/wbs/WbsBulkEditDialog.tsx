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
import { stageLabelKo, type StageCode } from '@/lib/domain/stageLabels'
import { useTeams } from '@/components/app/TeamsProvider'
import type { ProjectMember } from '@/lib/domain/types'
import { useDialogFocus } from '@/lib/ui/useDialogFocus'
import { DirtyConfirmDialog } from '@/components/ui/DirtyConfirmDialog'
import { useStageLabel } from './StageLabelsProvider'

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
}: WbsBulkEditDialogProps) {
  const stageLabel = useStageLabel()
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
      setErrorMessage('단계·담당자 변경은 각각 다른 필드와 분리해서 적용해 주세요.')
      return
    }

    // 시작일 > 종료일 사전 검증
    if (startMode === 'set' && endMode === 'set' && startVal && endVal && startVal > endVal) {
      setErrorMessage('시작일이 종료일보다 늦을 수 없습니다.')
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
        setErrorMessage('대량 변경 중 오류가 발생했습니다. 변경 내용을 유지했습니다. 다시 시도해 주세요.')
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
      setErrorMessage('실패한 항목의 최신 내용을 다시 불러왔습니다. 검토한 뒤 적용해 주세요.')
      } catch { setErrorMessage('최신 내용을 불러오지 못했습니다. 다시 시도해 주세요.') }
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
                WBS 작업 대량 수정
              </h2>
              <p className="text-xs text-fg-muted">
                {retryItemIds
                  ? `실패한 ${retryItemIds.length}개 항목 재시도`
                  : `선택된 ${selectedItems.length}개 작업 항목`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={requestClose} disabled={isPending}
            className="rounded-lg p-1.5 text-fg-muted hover:bg-surface-hover hover:text-fg transition-colors"
            aria-label="닫기"
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
                <div className="rounded-xl border border-success bg-success-weak dark:bg-success-weak p-4 flex items-start gap-3">
                  <CheckCircle2 className="h-5 w-5 text-success dark:text-success shrink-0 mt-0.5" />
                  <div>
                    <h3 className="text-sm font-semibold text-success dark:text-success">
                      대량 수정 완료
                    </h3>
                    <p className="text-xs text-success dark:text-success mt-0.5">
                      총 {result.total}개 항목이 성공적으로 반영되었습니다.
                    </p>
                  </div>
                </div>
              ) : (
              <div className="space-y-3">
                  <div className="rounded-xl border border-warning bg-warning-weak dark:bg-warning-weak p-4 flex items-start gap-3">
                    <AlertTriangle className="h-5 w-5 text-warning dark:text-warning shrink-0 mt-0.5" />
                    <div>
                      <h3 className="text-sm font-semibold text-warning dark:text-warning">
                        부분 실패 발생
                      </h3>
                      <p className="text-xs text-warning dark:text-warning mt-0.5">
                        총 {result.total}개 중 {result.succeeded.length}개 성공,{' '}
                        {result.failed.length}개 실패
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold text-fg-muted">
                      실패 항목 목록
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
                              ? '권한 없음'
                              : f.reason === 'conflict'
                                ? '충돌/잠금'
                                : '유효성 오류'}
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
                  <span className="text-xs font-semibold text-fg-muted block">적용 대상 범위</span>
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
                      <span>현재 선택한 {selectedItems.length}개 항목</span>
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
                      <span>결과 전체 {allItemIdsSnapshot.length}개 항목</span>
                    </label>
                  </div>
                </div>
              )}

              {errorMessage && (
                <div
                  role="alert"
                  className="rounded-xl border border-danger bg-danger-weak dark:bg-danger-weak p-3 text-xs text-danger dark:text-danger flex items-center gap-2"
                >
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}

              {/* 필드별 설정 영역 */}
              <div className="space-y-4">
                {/* 1. 시작일 */}
                <FieldRow
                  label="시작일"
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
                  label="종료일"
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
                  label="산출물"
                  isMixed={activeRows.length ? mixed("deliverable") : isMixedDeliv}
                  mode={delivMode}
                  onModeChange={setDelivMode}
                  inputControl={
                    <input
                      type="text"
                      placeholder="산출물 명칭"
                      value={delivVal}
                      onChange={e => setDelivVal(e.target.value)}
                      data-testid="bulk-input-deliverable"
                      className="w-full text-xs rounded-lg border border-border bg-surface px-2.5 py-1.5 text-fg placeholder:text-fg-muted focus:outline-hidden focus:ring-1 focus:ring-action"
                    />
                  }
                />

                {/* 4. 업무 분류 */}
                <FieldRow
                  label="업무 분류"
                  isMixed={activeRows.length ? mixed("biz") : isMixedBiz}
                  mode={bizMode}
                  onModeChange={setBizMode}
                  inputControl={
                    <input
                      type="text"
                      placeholder="업무 구분 코드 또는 이름"
                      value={bizVal}
                      onChange={e => setBizVal(e.target.value)}
                      data-testid="bulk-input-biz"
                      className="w-full text-xs rounded-lg border border-border bg-surface px-2.5 py-1.5 text-fg placeholder:text-fg-muted focus:outline-hidden focus:ring-1 focus:ring-action"
                    />
                  }
                />

                {/* 5. WBS 단계 */}
                <p className="text-xs text-fg-secondary">단계·담당자는 각각 따로 적용합니다. 주관 팀 변경은 지원 팀을 유지합니다.</p>
                <FieldRow label="담당자" isMixed={mixed('assigneeMemberId')} mode={assigneeMode} onModeChange={setAssigneeMode}
                  inputControl={<select aria-label="담당자 새 값" value={assigneeVal} onChange={e => setAssigneeVal(e.target.value)} className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs">
                    <option value="">담당자 선택</option>{members.filter(member => member.active).map(member => <option key={member.id} value={member.id}>{member.name}</option>)}
                  </select>} />
                <FieldRow label="주관 팀" isMixed={mixed('teamCode')} mode={teamMode} onModeChange={setTeamMode}
                  inputControl={<select aria-label="주관 팀 새 값" value={teamVal} onChange={e => setTeamVal(e.target.value)} className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs">
                    <option value="">팀 선택</option>{teams.map(team => <option key={team.id} value={team.code}>{team.name}</option>)}
                  </select>} />
                <FieldRow
                  label="작업 단계"
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
                      <option value="none">{stageLabel(null, stageLabelKo(null))}</option>
                      <option value="as">{stageLabel('as', stageLabelKo('as'))}</option>
                      <option value="ip">{stageLabel('ip', stageLabelKo('ip'))}</option>
                      <option value="im">{stageLabel('im', stageLabelKo('im'))}</option>
                      <option value="xx">{stageLabel('xx', stageLabelKo('xx'))}</option>
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
                  실패한 {result.failed.length}건만 다시 시도
                </button>
              )}
              <button
                type="button"
                onClick={requestClose} disabled={isPending}
                className="min-h-11 rounded-xl border border-border bg-surface px-4 text-xs font-semibold text-fg transition-colors hover:bg-surface-hover"
              >
                닫기
              </button>
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={requestClose} disabled={isPending}
                className="min-h-11 rounded-xl border border-border bg-surface px-4 text-xs font-medium text-fg transition-colors hover:bg-surface-hover"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!hasChanges || isPending}
                data-testid="wbs-bulk-apply-btn"
                className="flex min-h-11 items-center gap-1.5 rounded-xl bg-action px-4 text-xs font-semibold text-action-fg transition-colors hover:bg-action-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isPending && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                {isPending ? '적용 중...' : `총 ${targetIds.length}개 항목에 적용`}
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
              (혼합)
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
            변경 안 함
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
            새 값 지정
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
            값 비우기
          </button>
        </div>
      </div>

      <div className="mt-1">
        {mode === 'unchanged' && (
          <div className="text-fg-muted text-xs py-1">
            {isMixed ? '기존 서로 다른 값을 유지합니다.' : '기존 값을 변경하지 않고 유지합니다.'}
          </div>
        )}
        {mode === 'clear' && (
          <div className="text-danger dark:text-danger text-xs py-1 font-medium">
            이 필드의 값을 비웁니다.
          </div>
        )}
        {mode === 'set' && inputControl}
      </div>
    </div>
  )
}
