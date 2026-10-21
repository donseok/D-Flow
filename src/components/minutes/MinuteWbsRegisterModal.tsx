'use client'

// 회의록 → WBS 등록 창(설계 docs/superpowers/specs/2026-10-21-minutes-to-wbs-design.md §3.1·§3.2). 한 건(single)과 한꺼번에(bulk)는
// 한 컴포넌트의 두 모양이다(계획 "설계와의 차이"). 줄 입력은 MinuteWbsRowFields, 저장은 onSubmit 한 번(RPC 하나 — 전부 또는 전무).
// 등록 줄: 빈 종료일·담당자는 null(빈 글자를 보내지 않는다), 맨 위(WBS_ROOT_PARENT)는 parentId null, 계획 시작일은 늘 null(설계 §4.3),
// 말단 확인(confirmParentLeaf)은 줄마다 자기 값(RPC 가 줄마다 본다). 등록 단추는 이름이 있고 위치가 실제로 있을 때만 — 맨 위이거나
// drafts.parents 의 id(다른 프로젝트에서 고른 마지막 위치·그새 사라진 위치는 위치가 아니다), 그 위치가 하위 없는 작업이면 확인까지.
// 뷰어는 열 때마다 새로 마운트한다(wbsModal 이 null → 값) — 줄 상태는 마운트 때 초안에서 채운다.

import { useRef, useState } from 'react'
import { AlertTriangle, Info, LoaderCircle } from 'lucide-react'
import type { MinuteWbsCreateResult } from '@/app/actions/minuteWbs'
import { useLocale } from '@/components/providers/LocaleProvider'
import { Modal } from '@/components/ui/Modal'
import type { MinuteIssueSourceInput } from '@/lib/domain/issueMinuteSource'
import {
  WBS_ROOT_PARENT, type MinuteWbsCreateRow, type MinuteWbsDrafts, type MinuteWbsParentOption,
} from '@/lib/domain/minuteWbs'
import { useModalDirty } from '@/lib/ui/useModalDirty'
import { MinuteWbsRowFields, rowStateFromDraft, type MinuteWbsRowState } from './MinuteWbsRowFields'

type CreatedItem = { row: number; itemId: string; code: string }
/** 거부 — row 는 화면 줄 번호(drafts.rows 의 자리). 줄과 무관한 거부·요청 실패는 null */
type Failure = { message: string; row: number | null }

/** 등록할 수 있는 줄인가 — 이름(앞뒤 공백 뺀), 실제로 있는 위치, 하위 없는 위치면 확인 */
function rowReady(state: MinuteWbsRowState, parents: readonly MinuteWbsParentOption[]): boolean {
  if (!state.name.trim()) return false
  if (state.parentValue === WBS_ROOT_PARENT) return true
  const parent = parents.find(option => option.id === state.parentValue)
  return parent !== undefined && (!parent.leaf || state.confirmParentLeaf)
}

/** 줄 상태 → 등록 줄. rowReady 를 통과한 줄만 온다(위치는 맨 위 또는 id) */
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

/** 등록한 줄들의 공통 위치 — 다르면 null. 뷰어가 「마지막으로 고른 위치」로 기억한다(설계 §4.2) */
function sharedParentId(rows: readonly MinuteWbsCreateRow[]): string | null {
  const first = rows[0]?.parentId ?? null
  return rows.every(row => row.parentId === first) ? first : null
}

export function MinuteWbsRegisterModal({ open, mode, drafts, sources, lastParentId, onClose, onSubmit, onCreated }: {
  open: boolean
  mode: 'single' | 'bulk'
  /** 등록할 프로젝트 — 한꺼번에 창의 「등록됨」 줄 링크(/p/<id>/wbs?focus=)가 쓴다 */
  projectId: string
  drafts: MinuteWbsDrafts
  /** drafts.rows[i] 를 준비한 원문 앵커 — prepareMinuteWbsDrafts 에 보낸 배열 그대로(같은 순서). 등록 줄의 source 다 */
  sources: MinuteIssueSourceInput[]
  /** 이 화면에서 마지막으로 고른 위치 — 추천이 없는 줄의 처음 위치(rowStateFromDraft) */
  lastParentId: string | null
  onClose: () => void
  onSubmit: (rows: MinuteWbsCreateRow[]) => Promise<MinuteWbsCreateResult>
  /** 등록 성공 — 창을 닫는 것은 부르는 쪽이다. parentId 는 등록한 줄들의 공통 위치(맨 위·서로 다름은 null) */
  onCreated: (items: CreatedItem[], parentId: string | null) => void
}) {
  const { t } = useLocale()
  const [rows, setRows] = useState<MinuteWbsRowState[]>(() => drafts.rows.map(draft => rowStateFromDraft(draft, lastParentId)))
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<Failure | null>(null)
  // 상태(pending)는 커밋 뒤에야 단추를 막는다 — 같은 틱의 두 번째 누름은 동기 ref 로 막는다(이중 등록 방지)
  const submittingRef = useRef(false)
  const dirty = useModalDirty(open, rows)

  function updateRow(index: number, next: MinuteWbsRowState) {
    setRows(prev => prev.map((row, i) => (i === index ? next : row)))
  }

  function closeIfIdle() {
    if (submittingRef.current) return
    onClose()
  }

  /** 화면 줄 indexes 를 한 번에 등록한다 — 거부의 row(보낸 배열의 자리)는 화면 줄로 되돌린다 */
  async function submit(indexes: readonly number[]) {
    if (submittingRef.current) return
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
        onCreated(result.items, sharedParentId(payload))
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

  if (mode === 'bulk') {
    // 한꺼번에 등록(설계 §3.2) — 다음 단계가 이 갈래를 채운다: 줄마다 체크(추천 있는 줄만 처음 체크)·「위치 한꺼번에 바꾸기」·
    // 등록된 줄(registered)은 회색 + 작업 계획 링크, 제출은 체크된 줄만 submit(indexes) — 거부 row 는 화면 줄로 되돌아온다.
    return null
  }

  const draft = drafts.rows[0]
  const state = rows[0]
  if (!draft || !state) return null
  const ready = rowReady(state, drafts.parents)
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
        {drafts.mode === 'fallback' && (
          <p className="flex items-start gap-2 rounded-lg border border-action/30 bg-action-soft px-3 py-2.5 text-meta text-fg">
            <Info aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-action" />
            <span>{t('min.wbs.fallbackMode')}</span>
          </p>
        )}
        <div data-wbs-row={0} data-row-failed={rowFailed || undefined}
          className={rowFailed ? 'rounded-lg border border-danger/40 bg-danger-weak/30 p-3' : undefined}>
          <MinuteWbsRowFields state={state} draft={draft} parents={drafts.parents} members={drafts.members}
            onChange={next => updateRow(0, next)} disabled={pending} />
        </div>
        <div>
          <p className="mb-1 text-sm font-medium text-fg">{t('min.wbs.excerpt')}</p>
          <p className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-surface-subtle px-3 py-2 text-sm text-fg-secondary">
            {draft.excerpt}
          </p>
        </div>
      </div>
    </Modal>
  )
}
