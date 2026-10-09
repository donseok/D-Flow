'use client'
// WBS 표의 셀 포커스(roving tabindex) — DOM 쪽 절반. 계산은 순수 함수(src/lib/domain/wbsGridNav.ts)가 한다.
// 포커스 좌표(itemId + 열 key)는 ref 에만 둔다: 방향키마다 React 상태를 바꾸면 수천 행의 표 전체가 다시 그려진다. 그래서 탭 정지
// (tabindex=0 인 한 칸)도 DOM 에 직접 쓴다 — 셀은 모두 tabIndex={-1} 로 그려지고(React 가 보는 값은 늘 -1 이라 다시 그려도 건드리지
// 않는다), 렌더가 끝날 때마다 좌표의 칸에 0 이 붙어 있는지 맞춘다(행이 새로 생기거나 사라진 경우).
import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react'
import { resolveCoord, scrollToReveal, type GridCoord, type GridModel } from '@/lib/domain/wbsGridNav'

/** 본문 셀의 표지 — 포커스·키 처리는 이 표지가 있는 칸만 셀로 본다(머리 칸·간트 칸은 아니다) */
export const WBS_CELL_ATTR = 'data-wbs-cell'

const quoted = (v: string) => v.replace(/["\\]/g, '\\$&')

export function useWbsGridNav({ model, parentOf, scrollerRef }: {
  /** 지금 보이는 행·열 — 렌더마다 최신 값 */
  model: GridModel
  /** 사라진 행의 대체 칸을 찾을 때 쓰는 부모 조회(보이지 않는 행 포함) */
  parentOf: (rowId: string) => string | null | undefined
  /** 표의 스크롤 영역 — 화면 밖 칸으로 갈 때 이 영역을 움직인다 */
  scrollerRef: RefObject<HTMLElement | null>
}) {
  const gridRef = useRef<HTMLDivElement | null>(null)
  const activeRef = useRef<GridCoord | null>(null)
  const tabStopRef = useRef<HTMLElement | null>(null)
  const modelRef = useRef(model)
  modelRef.current = model
  const parentOfRef = useRef(parentOf)
  parentOfRef.current = parentOf

  const cellEl = useCallback((coord: GridCoord): HTMLElement | null => {
    const row = gridRef.current?.querySelector<HTMLElement>(`:scope > [data-row-id="${quoted(coord.rowId)}"]`)
    if (!row) return null
    for (const el of row.children) {
      if (el instanceof HTMLElement && el.hasAttribute(WBS_CELL_ATTR) && el.dataset.wbsCol === coord.col) return el
    }
    return null
  }, [])

  const setTabStop = useCallback((el: HTMLElement | null) => {
    const prev = tabStopRef.current
    if (prev && prev !== el) prev.tabIndex = -1
    if (el) el.tabIndex = 0
    tabStopRef.current = el
  }, [])

  /** 좌표만 옮긴다(포커스는 그대로) — 다른 경로가 행에 포커스를 줬을 때 Tab 이 그 행으로 돌아오게 */
  const setActive = useCallback((coord: GridCoord) => {
    const to = resolveCoord(modelRef.current, coord, parentOfRef.current)
    activeRef.current = to
    setTabStop(to ? cellEl(to) : null)
  }, [cellEl, setTabStop])

  /** sticky 머리 행·동결 열에 가려지지 않게 스크롤 영역을 움직인다 */
  const reveal = useCallback((el: HTMLElement) => {
    const sc = scrollerRef.current
    const head = gridRef.current?.firstElementChild
    if (!sc || !(head instanceof HTMLElement)) return
    const view = sc.getBoundingClientRect()
    let frozen = 0
    for (const h of head.children) if (h instanceof HTMLElement && getComputedStyle(h).position === 'sticky') frozen += h.offsetWidth
    const { dx, dy } = scrollToReveal(
      el.getBoundingClientRect(),
      { left: view.left + sc.clientLeft, top: view.top + sc.clientTop, right: view.left + sc.clientLeft + sc.clientWidth, bottom: view.top + sc.clientTop + sc.clientHeight },
      { left: frozen, top: head.offsetHeight },
      getComputedStyle(el).position === 'sticky',
    )
    if (dx) sc.scrollLeft += dx
    if (dy) sc.scrollTop += dy
  }, [scrollerRef])

  /** 그 칸으로 포커스를 옮긴다. 보이지 않는 좌표면 가장 가까운 보이는 칸으로. 옮겼으면 true */
  const focusCell = useCallback((coord: GridCoord): boolean => {
    const to = resolveCoord(modelRef.current, coord, parentOfRef.current)
    const el = to ? cellEl(to) : null
    if (!to || !el) return false
    activeRef.current = to
    setTabStop(el)
    el.focus({ preventScroll: true })
    reveal(el)
    return true
  }, [cellEl, reveal, setTabStop])

  /** 포커스가 표 안의 어느 칸(또는 그 안의 버튼·입력)으로 들어오면 그 칸이 현재 칸이다 — 마우스 클릭도 같은 길 */
  const onFocusCapture = useCallback((e: React.FocusEvent<HTMLElement>) => {
    const cell = (e.target as HTMLElement).closest<HTMLElement>(`[${WBS_CELL_ATTR}]`)
    const rowId = cell?.parentElement?.dataset.rowId
    const col = cell?.dataset.wbsCol
    if (!cell || !rowId || !col) return
    activeRef.current = { rowId, col }
    setTabStop(cell)
  }, [setTabStop])

  /** 키 이벤트의 대상이 속한 칸의 좌표. 행 자체에 포커스가 있으면(딥링크 도착 행) 그 행의 트리 열 */
  const coordOf = useCallback((target: HTMLElement): GridCoord | null => {
    const cell = target.closest<HTMLElement>(`[${WBS_CELL_ATTR}]`)
    const rowId = cell?.parentElement?.dataset.rowId
    const col = cell?.dataset.wbsCol
    if (rowId && col) return { rowId, col }
    return target.dataset.rowId ? { rowId: target.dataset.rowId, col: modelRef.current.treeCol } : null
  }, [])

  // 렌더마다(의존성 없음) 탭 정지를 맞춘다 — 대부분은 첫 비교에서 끝난다(같은 칸이 그대로 붙어 있다)
  useLayoutEffect(() => {
    const want = resolveCoord(modelRef.current, activeRef.current, parentOfRef.current)
    activeRef.current = want
    const stop = tabStopRef.current
    if (want && stop && stop.isConnected && stop.tabIndex === 0 && stop.dataset.wbsCol === want.col && stop.parentElement?.dataset.rowId === want.rowId) return
    setTabStop(want ? cellEl(want) : null)
  })

  return { gridRef, activeRef, focusCell, setActive, onFocusCapture, coordOf }
}
