'use client'

// 회의록 → WBS 등록 창(설계 docs/superpowers/specs/2026-10-21-minutes-to-wbs-design.md §3.1·§3.2). 한 건(single)과 한꺼번에(bulk)는
// 한 컴포넌트의 두 모양이다(계획 "설계와의 차이"). 줄 입력은 MinuteWbsRowFields, 저장은 onSubmit 한 번(RPC 하나 — 전부 또는 전무).
// 등록 줄: 빈 종료일·담당자는 null(빈 글자를 보내지 않는다), 맨 위(WBS_ROOT_PARENT)는 parentId null, 계획 시작일은 늘 null(설계 §4.3),
// 말단 확인(confirmParentLeaf)은 줄마다 자기 값(RPC 가 줄마다 본다). 보내는 줄은 모두 이름이 있고 위치가 실제로 있어야 한다 — 맨 위이거나
// drafts.parents 의 id(다른 프로젝트에서 고른 마지막 위치·그새 사라진 위치는 위치가 아니다), 그 위치가 하위 없는 작업이면 확인까지.
// 등록 단추와 submit 이 같은 판정(canSubmit)을 쓴다 — 고르지 않은 위치(null)가 맨 위로 가지 않고, 일부 줄만 보내지도 않는다.
// 한꺼번에: 줄마다 체크(처음엔 아직 등록되지 않았고 추천 위치가 있는 줄, 위치를 고르면 체크), 등록된 줄은 회색·체크 불가·작업 계획 링크,
// 「위치 한꺼번에 바꾸기」는 체크된 줄 전부. 보내는 줄은 체크된 줄뿐이고, 거부의 줄 번호(보낸 배열의 자리)는 화면 줄로 되돌려 그 줄에 사유를 쓴다.
// 뷰어는 열 때마다 새로 마운트한다(wbsModal 이 null → 값) — 줄 상태는 마운트 때 초안에서 채운다.

import { useEffect, useId, useRef, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ChevronDown, ExternalLink, FolderInput, Info, LoaderCircle } from 'lucide-react'
import type { MinuteWbsCreateResult } from '@/app/actions/minuteWbs'
import { useLocale } from '@/components/providers/LocaleProvider'
import { Modal } from '@/components/ui/Modal'
import type { MinuteIssueSourceInput } from '@/lib/domain/issueMinuteSource'
import {
  WBS_ROOT_PARENT, type MinuteWbsCreateRow, type MinuteWbsDraftRow, type MinuteWbsDrafts, type MinuteWbsParentOption,
} from '@/lib/domain/minuteWbs'
import { fill } from '@/lib/i18n/translate'
import { useModalDirty } from '@/lib/ui/useModalDirty'
import { MinuteWbsRowFields, rowStateFromDraft, type MinuteWbsRowState } from './MinuteWbsRowFields'
import { WbsParentPicker } from './WbsParentPicker'

type CreatedItem = { row: number; itemId: string; code: string }
/** 거부 — row 는 화면 줄 번호(drafts.rows 의 자리). 줄과 무관한 거부·요청 실패는 null */
type Failure = { message: string; row: number | null }

/** 「위치 한꺼번에 바꾸기」의 선택기에는 추천을 주지 않는다 — 추천이 있으면 선택기가 첫 추천을 스스로 골라(onChange) 체크된 줄 전부를 바꾼다 */
const NO_RECOMMENDATIONS: string[] = []

/** 등록할 수 있는 줄인가 — 이름(앞뒤 공백 뺀), 실제로 있는 위치, 하위 없는 위치면 확인 */
function rowReady(state: MinuteWbsRowState, parents: readonly MinuteWbsParentOption[]): boolean {
  if (!state.name.trim()) return false
  if (state.parentValue === WBS_ROOT_PARENT) return true
  const parent = parents.find(option => option.id === state.parentValue)
  return parent !== undefined && (!parent.leaf || state.confirmParentLeaf)
}

/** 화면 줄 indexes 를 보낼 수 있는가 — 하나 이상이고, 줄마다 원문 앵커가 있고 rowReady. 등록 단추와 submit 이 같은 판정을 쓴다 */
function canSubmit(
  indexes: readonly number[], rows: readonly MinuteWbsRowState[], sources: readonly MinuteIssueSourceInput[],
  parents: readonly MinuteWbsParentOption[],
): boolean {
  return indexes.length > 0 && indexes.every(index => {
    const state = rows[index]
    return state !== undefined && sources[index] !== undefined && rowReady(state, parents)
  })
}

/** 줄 상태 → 등록 줄. canSubmit 을 통과한 줄만 온다(위치는 맨 위 또는 id) */
function createRow(state: MinuteWbsRowState, source: MinuteIssueSourceInput): MinuteWbsCreateRow {
  return {
    source,
    name: state.name.trim(),
    parentId: state.parentValue === WBS_ROOT_PARENT ? null : state.parentValue,
    plannedStart: null,
    plannedEnd: state.plannedEnd || null,
    assigneeMemberId: state.assigneeMemberId || null,
    confirmParentLeaf: state.confirmParentLeaf,
  }
}

/**
 * 등록한 줄들의 공통 위치 값 — 맨 위는 WBS_ROOT_PARENT(맨 위도 고른 위치다), 서로 다르면 null. 뷰어가 「마지막으로 고른 위치」로 기억해
 * 추천이 없는 다음 줄의 처음 위치로 쓴다(설계 §4.2)
 */
function sharedParentValue(states: readonly MinuteWbsRowState[]): string | null {
  const first = states[0]?.parentValue ?? null
  return states.every(state => state.parentValue === first) ? first : null
}

export function MinuteWbsRegisterModal({ open, mode, projectId, drafts, sources, lastParentId, onClose, onSubmit, onCreated }: {
  open: boolean
  mode: 'single' | 'bulk'
  /** 등록할 프로젝트 — 한꺼번에 창의 「등록됨」 줄 링크(/p/<id>/wbs?focus=)가 쓴다 */
  projectId: string
  drafts: MinuteWbsDrafts
  /** drafts.rows[i] 를 준비한 원문 앵커 — prepareMinuteWbsDrafts 에 보낸 배열 그대로(같은 순서). 등록 줄의 source 다 */
  sources: MinuteIssueSourceInput[]
  /** 이 화면에서 마지막으로 고른 위치(WBS_ROOT_PARENT = 맨 위) — 추천이 없는 줄의 처음 위치(rowStateFromDraft) */
  lastParentId: string | null
  onClose: () => void
  onSubmit: (rows: MinuteWbsCreateRow[]) => Promise<MinuteWbsCreateResult>
  /** 등록 성공 — 창을 닫는 것은 부르는 쪽이다. parentId 는 등록한 줄들의 공통 위치 값(맨 위 = WBS_ROOT_PARENT, 서로 다르면 null) */
  onCreated: (items: CreatedItem[], parentId: string | null) => void
}) {
  const { t } = useLocale()
  const [rows, setRows] = useState<MinuteWbsRowState[]>(() => drafts.rows.map(draft => rowStateFromDraft(draft, lastParentId)))
  // 한꺼번에 — 처음 체크는 아직 등록되지 않았고 추천 위치가 있는 줄(설계 §3.2). 등록된 줄은 체크할 수 없다
  const [checked, setChecked] = useState<boolean[]>(() => drafts.rows.map(draft => !draft.registered && draft.parentIds.length > 0))
  const [bulkParentOpen, setBulkParentOpen] = useState(false)
  // 「위치 한꺼번에 바꾸기」에서 마지막으로 고른 값 — 선택기가 무엇을 골랐는지 보이기만 한다(줄은 고르는 순간 바뀐다)
  const [bulkParentValue, setBulkParentValue] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<Failure | null>(null)
  // 상태(pending)는 커밋 뒤에야 단추를 막는다 — 같은 틱의 두 번째 누름은 동기 ref 로 막는다(이중 등록 방지)
  const submittingRef = useRef(false)
  const listRef = useRef<HTMLOListElement>(null)
  const bulkPanelId = useId()
  // 체크도 입력이다 — 바꾼 체크를 버리고 닫을지도 묻는다
  const dirty = useModalDirty(open, { rows, checked })

  // 거부된 줄을 화면 안으로 — 한꺼번에 창은 줄이 많아 그 줄이 스크롤 밖일 수 있다
  useEffect(() => {
    if (failure?.row == null) return
    const target = listRef.current?.querySelector<HTMLElement>(`[data-wbs-row="${failure.row}"]`)
    if (target && typeof target.scrollIntoView === 'function') target.scrollIntoView({ block: 'nearest' })
  }, [failure])

  function updateRow(index: number, next: MinuteWbsRowState) {
    setRows(prev => prev.map((row, i) => (i === index ? next : row)))
  }

  /** 한꺼번에 창의 줄 고침 — 위치를 고르면 그 줄을 체크한다(추천이 없어 빠져 있던 줄, 설계 §3.2) */
  function changeBulkRow(index: number, next: MinuteWbsRowState) {
    const pickedParent = next.parentValue !== null && next.parentValue !== rows[index]?.parentValue
    updateRow(index, next)
    if (pickedParent) setChecked(prev => prev.map((on, i) => (i === index ? true : on)))
  }

  function setRowChecked(index: number, on: boolean) {
    if (drafts.rows[index]?.registered) return
    setChecked(prev => prev.map((value, i) => (i === index ? on : value)))
  }

  /** 「위치 한꺼번에 바꾸기」 — 체크된 줄 전부에 같은 위치. 위치가 바뀐 줄은 말단 확인을 다시 받는다(같은 값이면 그대로 — 줄 칸과 같은 규칙) */
  function applyBulkParent(value: string) {
    setBulkParentValue(value)
    setRows(prev => prev.map((row, i) => (checked[i] && !drafts.rows[i]?.registered
      ? { ...row, parentValue: value, confirmParentLeaf: value === row.parentValue && row.confirmParentLeaf }
      : row)))
  }

  function closeIfIdle() {
    if (submittingRef.current) return
    onClose()
  }

  /** 화면 줄 indexes 를 한 번에 등록한다 — 거부의 row(보낸 배열의 자리)는 화면 줄로 되돌린다 */
  async function submit(indexes: readonly number[]) {
    if (submittingRef.current) return
    // 단추가 막지만 한 번 더 본다 — 고르지 않은 위치(null)가 맨 위(parentId null)로, 이름 없는 줄이 서버로 가지 않게. 일부만 보내지도 않는다
    if (!canSubmit(indexes, rows, sources, drafts.parents)) {
      console.error('[MinuteWbsRegisterModal] 등록할 수 없는 줄이 있어 보내지 않았다:', indexes)
      return
    }
    submittingRef.current = true
    setPending(true)
    setFailure(null)
    const payload = indexes.map(index => createRow(rows[index], sources[index]))
    let result: MinuteWbsCreateResult
    try {
      result = await onSubmit(payload)
    } catch (cause) {
      console.error('[MinuteWbsRegisterModal] 등록 요청 실패:', cause)
      result = { ok: false, error: t('common.err.tryAgain') }
    }
    if (result.ok) {
      // 등록은 끝났다 — 창은 잠긴 채로 두고(다시 누르면 같은 작업이 또 생긴다) 닫기는 부르는 쪽에 맡긴다.
      // 알림 쪽 오류가 재등록으로 이어지지 않게 그때는 창을 닫는다
      try {
        onCreated(result.items, sharedParentValue(indexes.map(index => rows[index])))
      } catch (cause) {
        console.error('[MinuteWbsRegisterModal] onCreated 실패:', cause)
        onClose()
      }
      return
    }
    submittingRef.current = false
    setPending(false)
    setFailure({ message: result.error, row: result.row === undefined ? null : indexes[result.row] ?? null })
  }

  const fallbackNotice = drafts.mode === 'fallback' && (
    <p className="flex items-start gap-2 rounded-lg border border-action/30 bg-action-soft px-3 py-2.5 text-meta text-fg">
      <Info aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-action" />
      <span>{t('min.wbs.fallbackMode')}</span>
    </p>
  )

  if (mode === 'bulk') {
    // 보낼 줄 = 체크된 줄(등록된 줄은 체크될 수 없지만 한 번 더 뺀다). 화면 순서 = 회의록 문단 순서 = 같은 위치에 붙는 순서(설계 §3.2)
    const checkedIndexes = drafts.rows.flatMap((draft, index) => (checked[index] && !draft.registered ? [index] : []))
    const ready = canSubmit(checkedIndexes, rows, sources, drafts.parents)
    const bulkOpen = bulkParentOpen && checkedIndexes.length > 0
    return (
      <Modal
        open={open}
        onClose={closeIfIdle}
        dirty={dirty && !pending}
        title={t('min.wbs.bulkTitle')}
        size="lg"
        notice={failure ? (
          <p role="alert" className="flex items-start gap-1.5 text-sm text-danger">
            <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="min-w-0 break-words">
              {failure.row !== null && (
                <span className="block font-semibold">{fill(t('min.wbs.rowFailed'), { n: failure.row + 1 })}</span>
              )}
              <span className="block">{failure.message}</span>
            </span>
          </p>
        ) : checkedIndexes.length === 0 ? (
          <p className="text-sm text-fg-secondary">{t('min.wbs.nothingSelected')}</p>
        ) : undefined}
        footer={
          <>
            <button type="button" onClick={closeIfIdle} disabled={pending} className="btn btn-ghost">{t('common.cancel')}</button>
            <button type="button" onClick={() => void submit(checkedIndexes)} disabled={pending || !ready} className="btn btn-primary">
              {pending && <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" />}
              {fill(t('min.wbs.submitN'), { n: checkedIndexes.length })}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          {fallbackNotice}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" aria-expanded={bulkOpen} aria-controls={bulkOpen ? bulkPanelId : undefined}
                disabled={pending || checkedIndexes.length === 0} onClick={() => setBulkParentOpen(value => !value)}
                className="btn btn-ghost">
                <FolderInput aria-hidden className="h-4 w-4" />
                {t('min.wbs.changeParentAll')}
                <ChevronDown aria-hidden className={`h-4 w-4 ${bulkOpen ? 'rotate-180' : ''}`} />
              </button>
              <span className="ml-auto text-sm font-semibold tabular-nums text-fg">
                {fill(t('min.wbs.selectedCount'), { n: checkedIndexes.length })}
              </span>
            </div>
            {bulkOpen && (
              <div id={bulkPanelId} data-wbs-bulk-parent className="rounded-lg border border-border bg-surface-subtle p-3">
                <WbsParentPicker options={drafts.parents} value={bulkParentValue} recommendedIds={NO_RECOMMENDATIONS}
                  onChange={applyBulkParent} disabled={pending} />
              </div>
            )}
          </div>
          <ol ref={listRef} className="space-y-3">
            {drafts.rows.map((draft, index) => {
              const state = rows[index]
              if (!state) return null
              return (
                <BulkRow key={index} index={index} draft={draft} state={state} checked={checkedIndexes.includes(index)}
                  failedMessage={failure !== null && failure.row === index ? failure.message : null} pending={pending}
                  projectId={projectId} parents={drafts.parents} members={drafts.members}
                  onCheckedChange={on => setRowChecked(index, on)} onChange={next => changeBulkRow(index, next)} />
              )
            })}
          </ol>
        </div>
      </Modal>
    )
  }

  const draft = drafts.rows[0]
  const state = rows[0]
  if (!draft || !state) return null
  const ready = canSubmit([0], rows, sources, drafts.parents)
  const rowFailed = failure !== null && failure.row === 0

  return (
    <Modal
      open={open}
      onClose={closeIfIdle}
      dirty={dirty && !pending}
      title={t('min.wbs.title')}
      size="md"
      notice={failure ? (
        <p role="alert" className="flex items-start gap-1.5 text-sm text-danger">
          <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="min-w-0 break-words">{failure.message}</span>
        </p>
      ) : undefined}
      footer={
        <>
          <button type="button" onClick={closeIfIdle} disabled={pending} className="btn btn-ghost">{t('common.cancel')}</button>
          <button type="button" onClick={() => void submit([0])} disabled={pending || !ready} className="btn btn-primary">
            {pending && <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" />}
            {t('min.wbs.submit')}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {fallbackNotice}
        <div data-wbs-row={0} data-row-failed={rowFailed || undefined}
          className={rowFailed ? 'rounded-lg border border-danger/40 bg-danger-weak/30 p-3' : undefined}>
          <MinuteWbsRowFields state={state} draft={draft} parents={drafts.parents} members={drafts.members}
            onChange={next => updateRow(0, next)} disabled={pending} />
        </div>
        <div>
          <p className="mb-1 text-sm font-medium text-fg">{t('min.wbs.excerpt')}</p>
          {/* 길면 스크롤되는 상자 — 키보드로도 닿게(tabIndex) 이름 있는 영역으로 둔다(axe scrollable-region-focusable) */}
          <div role="region" aria-label={t('min.wbs.excerpt')} tabIndex={0}
            className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-surface-subtle px-3 py-2 text-sm text-fg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus">
            {draft.excerpt}
          </div>
        </div>
      </div>
    </Modal>
  )
}

/**
 * 한꺼번에 창의 줄 하나 — 머리(체크·줄 번호·「원문」 펼침), 칸 전부(MinuteWbsRowFields), 펼친 원문, 거부 사유.
 * 등록된 줄은 회색 머리(체크 불가·이미 만든 작업)와 작업 계획 링크만 — 칸이 없다(다시 올리지 않는다, 설계 §3.2).
 * 390px 에서도 칸이 줄 폭을 다 쓰도록 체크는 왼쪽 단이 아니라 머리 줄에 둔다.
 */
function BulkRow({
  index, draft, state, checked, failedMessage, pending, projectId, parents, members, onCheckedChange, onChange,
}: {
  index: number
  draft: MinuteWbsDraftRow
  state: MinuteWbsRowState
  checked: boolean
  /** 이 줄에서 멈춘 거부의 사유 — 없으면 null */
  failedMessage: string | null
  pending: boolean
  projectId: string
  parents: MinuteWbsParentOption[]
  members: { id: string; name: string }[]
  onCheckedChange: (on: boolean) => void
  onChange: (next: MinuteWbsRowState) => void
}) {
  const { t } = useLocale()
  const [excerptOpen, setExcerptOpen] = useState(false)
  const excerptId = useId()
  const registered = draft.registered
  const failed = failedMessage !== null
  // 체크 상자의 이름 — 만들 작업명(비었으면 초안 이름, 그것도 없으면 칸 이름)
  const checkLabel = registered ? registered.name : state.name.trim() || draft.name || t('min.wbs.name')
  const frame = failed
    ? 'border-danger/40 bg-danger-weak/30'
    : registered ? 'border-border bg-surface-subtle' : 'border-border'

  return (
    <li data-wbs-row={index} data-row-failed={failed || undefined} data-registered={registered ? '' : undefined}
      className={`rounded-lg border p-3 ${frame}`}>
      <div className="flex items-start gap-2">
        <div className={`flex min-w-0 flex-1 items-start gap-2${registered ? ' opacity-60' : ''}`}>
          {/* 누르는 영역을 넓힌다 — 줄 번호까지 체크를 바꾼다 */}
          <label className={`-m-1.5 inline-flex shrink-0 items-center gap-2 rounded-(--radius-control) p-1.5 ${registered || pending ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
            <input type="checkbox" data-wbs-row-check checked={checked} disabled={pending || !!registered} aria-label={checkLabel}
              onChange={event => onCheckedChange(event.target.checked)} className="h-4 w-4" />
            <span aria-hidden className="text-meta font-medium tabular-nums text-fg-muted">{index + 1}</span>
          </label>
          {registered && (
            <span className="min-w-0 flex-1 break-words text-sm text-fg">
              <span className="mr-1.5 font-semibold">{registered.code}</span>
              {registered.name}
            </span>
          )}
        </div>
        <button type="button" aria-expanded={excerptOpen} aria-controls={excerptOpen ? excerptId : undefined}
          onClick={() => setExcerptOpen(value => !value)}
          className="inline-flex shrink-0 items-center gap-1 rounded-(--radius-control) px-1.5 py-1 text-meta font-medium text-fg-secondary hover:bg-surface-hover hover:text-fg">
          {t('min.wbs.excerpt')}
          <ChevronDown aria-hidden className={`h-3.5 w-3.5 ${excerptOpen ? 'rotate-180' : ''}`} />
        </button>
      </div>
      {registered ? (
        // 이미 만든 작업 — 새 탭으로 연다(이 창에서 고친 다른 줄을 잃지 않게)
        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-meta">
          <span className="font-semibold text-fg-muted">{t('min.wbs.registered')}</span>
          <Link href={`/p/${projectId}/wbs?focus=${encodeURIComponent(registered.itemId)}`} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-medium text-action hover:text-action-hover">
            {t('min.wbs.viewInPlan')}
            <ExternalLink aria-hidden className="h-3 w-3" />
          </Link>
        </p>
      ) : (
        <div className="mt-3">
          <MinuteWbsRowFields state={state} draft={draft} parents={parents} members={members} onChange={onChange} disabled={pending} />
        </div>
      )}
      {excerptOpen && (
        <p id={excerptId} className="mt-3 whitespace-pre-wrap break-words rounded-lg border border-border bg-surface-subtle px-3 py-2 text-sm text-fg-secondary">
          {draft.excerpt}
        </p>
      )}
      {failed && (
        <p className="mt-2 flex items-start gap-1.5 text-sm text-danger">
          <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="min-w-0 break-words">{failedMessage}</span>
        </p>
      )}
    </li>
  )
}
