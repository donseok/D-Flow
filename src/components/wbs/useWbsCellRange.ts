'use client'
// WBS 표의 셀 범위 — DOM 쪽 절반(계산은 src/lib/domain/wbsCellRange.ts). 개정 §5.9.2: 셀 범위는 행 체크 선택과 다른 상태다.
// 범위(기준 칸·끝 칸)는 ref 에만 둔다: Shift+방향키마다 React 상태를 바꾸면 가상화·행 메모가 없는 시트 전체가 다시 그려진다
// (useWbsGridNav 가 포커스 좌표를 ref 에 둔 이유와 같다). 그래서 범위 표시도 DOM 에 직접 쓴다 — 범위 안 칸에 `data-wbs-range` 와
// `aria-selected="true"`. React 는 칸의 이 두 속성을 그리지 않으므로 다시 그려도 지워지지 않고, 행·열이 바뀌면(모델이 바뀌면) 여기서 다시 칠한다.
// 복사·붙여넣기는 네이티브 copy/paste 이벤트로 받는다(주간 시트와 같다 — 클립보드 권한 프롬프트가 없다). 포커스가 표의 칸에 있을 때만 가로챈다.
// 붙여넣기·지우기의 저장은 기존 액션이다(wbsRangeWrite). 되돌리기(undo)는 넣지 않았다 — 주간 시트는 로컬 배치를 되돌리지만 WBS 는 칸마다
// 서버에 바로 저장되고 그 사이 남의 변경이 끼어들 수 있어, 한꺼번에 되돌리려면 충돌 모델을 새로 정해야 한다. 대신 결과(바꿈·건너뜀·충돌·실패)를 빠짐없이 알린다.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import type { GridCoord, GridModel } from '@/lib/domain/wbsGridNav'
import {
  clickCellRange, extendCellRange, isDataCol, planCellClear, planCellWrites, rangeMatrix, rangeRect, rectChanges, rectSize, singleRect,
  type CellRange, type RangeItem, type RangePerms, type RangePlan, type RangeRect,
} from '@/lib/domain/wbsCellRange'
import { parseTsv, serializeTsv } from '@/lib/domain/sheetClipboard'
import { fill } from '@/lib/i18n/translate'
import type { DictKey } from '@/lib/i18n/dict'
import { runRangeWrites, type RangeWriteDeps, type RangeWriteOutcome } from './wbsRangeWrite'
import { WBS_CELL_ATTR } from './useWbsGridNav'

/** 범위 안 칸의 표지 — 스타일(시트의 cellBase)과 테스트가 이 속성을 본다 */
export const WBS_RANGE_ATTR = 'data-wbs-range'
/** 이 칸 수를 넘는 붙여넣기는 적용 전에 확인한다 */
export const RANGE_CONFIRM_PASTE = 200
/** 지우기는 더 일찍 묻는다 — 되돌리기가 없다 */
export const RANGE_CONFIRM_CLEAR = 20
/** 한 번에 쓰는 칸 수의 상한 — 칸마다 서버 왕복이라 그 이상은 나누게 한다 */
export const RANGE_MAX_WRITES = 2000
/** 붙여넣는 글자 수의 상한(기존 붙여넣기 대화상자와 같은 값) */
const RANGE_MAX_TEXT = 200_000
/** 편집기 — 그 안의 키·복사·붙여넣기는 편집기의 것이다(체크박스는 편집기가 아니다) */
const EDITOR = 'input:not([type="checkbox"]),select,textarea,[contenteditable="true"]'
const MOVE_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'])

export interface RangeJob {
  kind: 'paste' | 'clear'
  /** confirm = 적용 전 확인(큰 범위), running = 저장 중, done = 결과 */
  phase: 'confirm' | 'running' | 'done'
  plan: RangePlan
  outcome: RangeWriteOutcome | null
}
const NO_OUTCOME: RangeWriteOutcome = { written: [], already: [], conflicts: [], failed: [] }

export function useWbsCellRange(opts: {
  grid: {
    gridRef: RefObject<HTMLDivElement | null>
    activeRef: RefObject<GridCoord | null>
    focusCell: (coord: GridCoord) => boolean
    coordOf: (target: HTMLElement) => GridCoord | null
  }
  /** 지금 보이는 행·열 — 렌더마다 최신 값 */
  model: GridModel
  /** 조회 전용 — 이동·범위·복사는 되고 붙여넣기·지우기는 가로채지도 않는다 */
  readOnly: boolean
  /** 표의 aria-multiselectable 을 React 가 그리지 않는 화면(행 선택이 없는 화면)인가 — 그때만 범위가 있는 동안 여기서 붙인다 */
  ownsMultiselectable: boolean
  itemOf: (rowId: string) => RangeItem | undefined
  /** 한 칸의 복사 글자 */
  textOf: (rowId: string, col: string) => string
  perms: RangePerms
  write: Omit<RangeWriteDeps, 't'>
  t: (key: DictKey) => string
  notify: (kind: 'ok' | 'err', message: string) => void
  /** 화면을 서버 값으로 다시 읽는다(router.refresh) */
  refresh: () => void
}) {
  const optsRef = useRef(opts)
  optsRef.current = opts
  const { gridRef } = opts.grid
  const rangeRef = useRef<CellRange | null>(null)
  /** 지금 DOM 에 칠해 둔 것 — 어느 모델의 어느 직사각형인지와 그 칸들 */
  const paintedRef = useRef<{ model: GridModel; rect: RangeRect; cells: Set<HTMLElement> } | null>(null)
  const liveRef = useRef<HTMLParagraphElement | null>(null)
  const busyRef = useRef(false)
  /** Shift+클릭이 범위를 잡았다 — 뒤따르는 click 이 그 칸의 편집을 열지 않게 한 번 먹는다 */
  const swallowClickRef = useRef(false)
  const [job, setJob] = useState<RangeJob | null>(null)

  const say = useCallback((text: string) => { if (liveRef.current) liveRef.current.textContent = text }, [])

  /** ref 의 범위를 DOM 에 맞춘다 — 같은 모델이면 달라진 칸만, 모델이 바뀌었으면 전부 걷고 다시 */
  const paint = useCallback(() => {
    const grid = gridRef.current
    if (!grid) return
    const m = optsRef.current.model
    const rect = rangeRect(m, rangeRef.current)
    if (!rect) rangeRef.current = null   // 끝 칸이 더는 보이지 않는다 — 범위는 풀린다
    let painted = paintedRef.current
    if (painted && painted.model !== m) {
      for (const el of painted.cells) { el.removeAttribute(WBS_RANGE_ATTR); el.removeAttribute('aria-selected') }
      painted = null
    }
    const changes = rectChanges(painted?.rect ?? null, rect)
    const cells = painted?.cells ?? new Set<HTMLElement>()
    if (changes.length) {
      const rows = new Map<string, HTMLElement>()
      for (const el of grid.children) if (el instanceof HTMLElement && el.dataset.rowId) rows.set(el.dataset.rowId, el)
      for (const ch of changes) {
        const row = rows.get(m.rows[ch.row].id)
        const col = m.cols[ch.col]
        let cell: HTMLElement | null = null
        for (const el of row?.children ?? []) if (el instanceof HTMLElement && el.hasAttribute(WBS_CELL_ATTR) && el.dataset.wbsCol === col) { cell = el; break }
        if (!cell) continue
        if (ch.on) { cell.setAttribute(WBS_RANGE_ATTR, ''); cell.setAttribute('aria-selected', 'true'); cells.add(cell) }
        else { cell.removeAttribute(WBS_RANGE_ATTR); cell.removeAttribute('aria-selected'); cells.delete(cell) }
      }
    }
    paintedRef.current = rect ? { model: m, rect, cells } : null
    if (optsRef.current.ownsMultiselectable) {
      if (rect) grid.setAttribute('aria-multiselectable', 'true')
      else grid.removeAttribute('aria-multiselectable')
    }
  }, [gridRef])

  // 렌더마다(의존성 없음) — 행·열이 바뀌었을 때만 다시 칠한다(접힘·필터·열 숨김·실시간 갱신). 범위가 없으면 할 일이 없다
  useLayoutEffect(() => {
    if (rangeRef.current && paintedRef.current?.model !== optsRef.current.model) paint()
  })

  const setRange = useCallback((next: CellRange | null, announce: boolean) => {
    const had = rangeRef.current !== null
    rangeRef.current = next
    paint()
    if (!announce) return
    const rect = rangeRect(optsRef.current.model, rangeRef.current)
    if (rect) say(fill(optsRef.current.t('wbs.range.selected'), rectSize(rect)))
    else if (had) say(optsRef.current.t('wbs.range.released'))
  }, [paint, say])

  const currentRect = useCallback(() => rangeRect(optsRef.current.model, rangeRef.current), [])

  /* ── 저장(붙여넣기·지우기) ── */
  const run = useCallback(async (kind: RangeJob['kind'], plan: RangePlan, viaDialog: boolean) => {
    const o = optsRef.current
    if (busyRef.current) return
    busyRef.current = true
    // 붙여넣은 직사각형의 두 모서리 — 저장 중에 행이 바뀌어도(실시간) 같은 칸을 가리키게 번호가 아니라 좌표로 잡아 둔다
    const corners: CellRange | null = kind === 'paste' && plan.rect
      ? { anchor: { rowId: o.model.rows[plan.rect.bottom].id, col: o.model.cols[plan.rect.right] }, head: { rowId: o.model.rows[plan.rect.top].id, col: o.model.cols[plan.rect.left] } }
      : null
    if (viaDialog) setJob({ kind, phase: 'running', plan, outcome: null })
    say(fill(o.t('wbs.range.saving'), { n: plan.writes.length }))
    let outcome: RangeWriteOutcome
    try {
      outcome = await runRangeWrites(plan.writes, { ...o.write, t: o.t })
    } catch {
      // 실행기는 칸마다 실패를 모아 돌려준다 — 여기 닿으면 어디까지 반영됐는지 모른다. 다시 읽어 화면을 맞춘다
      busyRef.current = false
      setJob(null)
      optsRef.current.notify('err', optsRef.current.t('wbs.range.unknown'))
      optsRef.current.refresh()
      return
    }
    busyRef.current = false
    const now = optsRef.current
    // 무엇이든 서버와 어긋났을 수 있으면 다시 읽는다 — 충돌·실패한 칸도 최신 값으로 보이게
    if (outcome.written.length || outcome.conflicts.length || outcome.failed.length) now.refresh()
    // 붙여넣은 범위를 보인다 — 끝 칸은 기준 칸(왼쪽 위, 포커스가 있는 칸)이다. 범위가 식별 열에 걸치면 범위 없이 둔다
    // (한 칸만 붙였으면 범위로 남길 것이 없다 — 앞서 잡아 둔 범위도 걷는다: 붙여넣지 않은 칸이 범위로 남아 다음 Delete 의 대상이 되지 않게)
    if (corners) {
      const many = plan.rect!.bottom > plan.rect!.top || plan.rect!.right > plan.rect!.left
      setRange(many && isDataCol(corners.head.col) ? corners : null, false)
    }
    const n = outcome.written.length
    say(fill(now.t(kind === 'paste' ? 'wbs.range.pasted' : 'wbs.range.erased'), { n }))
    const clean = plan.invalid.length + plan.clippedRows + plan.clippedCols + outcome.conflicts.length + outcome.failed.length === 0
    if (clean && !viaDialog) {
      // 깨끗하게 끝났다 — 건수만 조용히. 읽기 전용 칸이 섞여 건너뛴 것은 같은 줄에 덧붙인다(흔한 일이라 상자를 띄우지 않는다)
      const skipped = plan.skipped.length ? ` · ${fill(now.t('wbs.range.toastSkipped'), { n: plan.skipped.length })}` : ''
      now.notify('ok', `${fill(now.t(kind === 'paste' ? 'wbs.range.pasted' : 'wbs.range.erased'), { n })}${skipped}`)
      setJob(null)
    } else {
      setJob({ kind, phase: 'done', plan, outcome })
    }
  }, [say, setRange])

  const start = useCallback((kind: RangeJob['kind'], plan: RangePlan) => {
    const o = optsRef.current
    if (plan.writes.length > RANGE_MAX_WRITES) { o.notify('err', fill(o.t('wbs.range.tooLarge'), { max: RANGE_MAX_WRITES })); return }
    if (plan.writes.length === 0) {
      // 쓸 칸이 없다 — 까닭이 있으면(편집 불가·값 오류·잘림) 그것을 보이고, 없으면(전부 이미 같은 값) 한 줄로 알린다
      const reasons = plan.skipped.length + plan.invalid.length + plan.clippedRows + plan.clippedCols
      if (reasons === 0) { o.notify('ok', o.t('wbs.range.nothing')); say(o.t('wbs.range.nothing')) }
      else setJob({ kind, phase: 'done', plan, outcome: NO_OUTCOME })
      return
    }
    if (plan.writes.length > (kind === 'paste' ? RANGE_CONFIRM_PASTE : RANGE_CONFIRM_CLEAR)) { setJob({ kind, phase: 'confirm', plan, outcome: null }); return }
    void run(kind, plan, false)
  }, [run, say])

  const paste = useCallback((text: string, at: GridCoord) => {
    const o = optsRef.current
    if (busyRef.current) { o.notify('err', o.t('wbs.range.busy')); return }
    if (text.length > RANGE_MAX_TEXT) { o.notify('err', fill(o.t('wbs.range.tooLarge'), { max: RANGE_MAX_WRITES })); return }
    // 기준 칸 = 범위의 왼쪽 위(주간 시트·스프레드시트와 같다 — 범위를 어느 방향으로 늘렸는지와 무관), 범위가 없으면 지금 칸.
    // 포커스를 기준 칸으로 옮겨 둔다: 붙여넣은 뒤의 범위는 그 칸에서 오른쪽 아래로 펼쳐진다
    const rect = currentRect()
    const anchor = rect ? { rowId: o.model.rows[rect.top].id, col: o.model.cols[rect.left] } : at
    if (rect) {
      rangeRef.current = { anchor: { rowId: o.model.rows[rect.bottom].id, col: o.model.cols[rect.right] }, head: anchor }
      o.grid.focusCell(anchor)
    }
    start('paste', planCellWrites(o.model, anchor, parseTsv(text), o.itemOf, o.perms))
  }, [currentRect, start])

  const clear = useCallback(() => {
    const o = optsRef.current
    if (busyRef.current) { o.notify('err', o.t('wbs.range.busy')); return }
    const rect = currentRect()
    if (rect) start('clear', planCellClear(o.model, rect, o.itemOf, o.perms))
  }, [currentRect, start])

  /* ── 키(탐색 모드) — 표의 onKeyDown 이 편집기·조합 가드를 지난 뒤 부른다. 먹었으면 true ── */
  const handleKey = useCallback((e: React.KeyboardEvent, at: GridCoord): boolean => {
    const o = optsRef.current
    const mod = e.ctrlKey || e.metaKey || e.altKey
    // Shift+방향키 — 데이터 열에서만 셀 범위다. 식별 열(번호·개요·작업명)의 Shift+↑↓ 는 행 범위 그대로(호출부가 이어서 처리한다)
    if (e.shiftKey && !mod && e.key.startsWith('Arrow') && isDataCol(at.col)) {
      const next = extendCellRange(o.model, rangeRef.current, at, e.key)
      if (!next) return false
      e.preventDefault()
      setRange(next, true)
      o.grid.focusCell(next.head)
      return true
    }
    if (!rangeRef.current) return false
    // Esc = 범위 해제 — 행 선택 해제보다 먼저 먹는다. 전체 화면·돋보기의 Esc(document 리스너)로 번지지 않게 한다
    if (e.key === 'Escape' && !mod && !e.shiftKey) {
      e.preventDefault()
      e.stopPropagation()
      setRange(null, true)
      return true
    }
    // Delete/Backspace = 범위의 편집 가능한 칸 지우기. 범위가 있을 때만이다 — 되돌리기가 없어, 눈에 보이는 범위를 잡은 뒤의 키만 지우기로 읽는다
    if ((e.key === 'Delete' || e.key === 'Backspace') && !mod && !e.shiftKey) {
      if (o.readOnly) return false
      e.preventDefault()
      clear()
      return true
    }
    // 보통의 이동 키 — 범위를 푼다(경계에서 포커스가 제자리여도). 이동 자체는 호출부가 한다
    if (!e.shiftKey && MOVE_KEYS.has(e.key)) setRange(null, false)
    return false
  }, [clear, setRange])

  /** 포커스가 범위의 끝 칸이 아닌 곳으로 갔다(다른 칸 클릭·이동·편집기 열림) — 범위는 풀린다. 편집 진입 = 선택이 한 칸으로 줄어드는 주간 시트 규칙과 같다 */
  const onFocusCapture = useCallback((e: React.FocusEvent<HTMLElement>) => {
    const range = rangeRef.current
    if (!range) return
    const target = e.target as HTMLElement
    if (target.hasAttribute(WBS_CELL_ATTR) && target.dataset.wbsCol === range.head.col && target.parentElement?.dataset.rowId === range.head.rowId) return
    setRange(null, false)
  }, [setRange])

  /** Shift+클릭 = 기준 칸부터 그 칸까지. 드래그 선택은 넣지 않았다 — 행 이동·간트 바 드래그와 같은 표에서 겹친다 */
  const onMouseDownCapture = useCallback((e: React.MouseEvent<HTMLElement>) => {
    swallowClickRef.current = false
    if (e.button !== 0 || !e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return
    const o = optsRef.current
    const target = e.target as HTMLElement
    if (target.closest('input,select,textarea,button,a,[contenteditable="true"]')) return
    const cell = target.closest<HTMLElement>(`[${WBS_CELL_ATTR}]`)
    const rowId = cell?.parentElement?.dataset.rowId
    const col = cell?.dataset.wbsCol
    if (!rowId || !col) return
    const next = clickCellRange(o.model, rangeRef.current, o.grid.activeRef.current, { rowId, col })
    if (!next) return
    e.preventDefault()   // 글자 선택·브라우저의 포커스 이동을 막고 아래에서 직접 옮긴다
    swallowClickRef.current = true
    setRange(next, true)
    o.grid.focusCell(next.head)
  }, [setRange])
  const onClickCapture = useCallback((e: React.MouseEvent<HTMLElement>) => {
    if (!swallowClickRef.current) return
    swallowClickRef.current = false
    e.stopPropagation()
    e.preventDefault()
  }, [])

  // 복사·붙여넣기 — document 에서 받는다. 편집 불가 문서의 copy/paste 이벤트는 브라우저마다 대상이 다르다(포커스 요소·선택 시작 요소·body) —
  // 표 래퍼에만 걸면 Tab 으로 들어온 포커스에서는 닿지 않을 수 있다. 가로채는 조건은 "포커스가 표의 칸에 있고 편집기 안이 아니다" 하나다
  useEffect(() => {
    const cellAt = (): GridCoord | null => {
      const active = document.activeElement
      if (!(active instanceof HTMLElement) || !gridRef.current?.contains(active) || active.closest(EDITOR)) return null
      return optsRef.current.grid.coordOf(active)
    }
    const onCopy = (e: ClipboardEvent) => {
      const at = cellAt()
      if (!at || !e.clipboardData) return
      // 글자를 끌어 고른 복사는 브라우저의 것이다
      const picked = window.getSelection?.()
      if (picked && !picked.isCollapsed) return
      const o = optsRef.current
      const rect = currentRect() ?? singleRect(o.model, at)
      if (!rect) return
      e.preventDefault()
      e.clipboardData.setData('text/plain', serializeTsv(rangeMatrix(o.model, rect, o.textOf)))
      const size = rectSize(rect)
      say(fill(o.t('wbs.range.copied'), { n: size.rows * size.cols }))
    }
    const onPaste = (e: ClipboardEvent) => {
      const at = cellAt()
      if (!at || !e.clipboardData || optsRef.current.readOnly) return
      e.preventDefault()
      const text = e.clipboardData.getData('text/plain')
      if (!text) { optsRef.current.notify('err', optsRef.current.t('wbs.range.clipboardEmpty')); return }
      paste(text, at)
    }
    document.addEventListener('copy', onCopy)
    document.addEventListener('paste', onPaste)
    return () => { document.removeEventListener('copy', onCopy); document.removeEventListener('paste', onPaste) }
  }, [currentRect, gridRef, paste, say])

  const confirm = useCallback(() => { if (job?.phase === 'confirm') void run(job.kind, job.plan, true) }, [job, run])
  const close = useCallback(() => { if (job?.phase !== 'running') setJob(null) }, [job])

  return { liveRef, handleKey, onFocusCapture, onMouseDownCapture, onClickCapture, job, confirm, close }
}
