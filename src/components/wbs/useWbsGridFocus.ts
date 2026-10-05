'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useEscHandler, ESC_PRIORITY } from '@/lib/ui/escStack'

export interface WbsCellCoord {
  rowId: string
  col: string
}

export interface UseWbsGridFocusOptions {
  /** 현재 화면에 표시되는 정렬·필터·펼침 반영된 행 목록 */
  rows: Array<{ id: string }>
  /** 탐색 가능한 열 ID 목록 (예: ['name', 'weight', 'pactual', 'deliverable', 'biz']) */
  columns: string[]
  /** 편집 가능한 열 ID 목록 */
  editableColumns?: string[]
  /** 특정 셀 편집 진입 콜백 */
  onStartEdit?: (rowId: string, col: string) => void
  /** 편집 취소 콜백 */
  onCancelEdit?: () => void
  /** 편집 완료 커밋 콜백 */
  onCommitEdit?: () => void
}

/**
 * WBS 그리드 키보드 및 포커스 모델 (개정 §5.9.2, D6-§8-grid, SPU2)
 * - 포커스를 `itemId + fieldId` 좌표로 추적하여 가상화·정렬·원격 갱신 후에도 위치 유지
 * - 탐색 모드: 방향키 셀 이동, Shift+방향키 범위, Enter/F2/문자 편집 진입, Tab 다음 셀
 * - 편집 모드: 방향키 커서 이동, Enter 다음 행, Tab 다음 열, Esc 편집 취소
 * - 행 선택(checkbox)과 셀 포커스/범위 분리
 */
export function useWbsGridFocus({
  rows,
  columns,
  editableColumns = ['name', 'weight', 'pactual', 'deliverable', 'biz'],
  onStartEdit,
  onCancelEdit,
  onCommitEdit,
}: UseWbsGridFocusOptions) {
  const [activeCell, setActiveCellState] = useState<WbsCellCoord | null>(null)
  const activeCellRef = useRef<WbsCellCoord | null>(null)
  activeCellRef.current = activeCell
  const [isEditing, setIsEditing] = useState(false)
  const [rangeAnchor, setRangeAnchor] = useState<WbsCellCoord | null>(null)

  // rows 빠른 인덱스 맵
  const rowIndexMap = useMemo(() => {
    const map = new Map<string, number>()
    rows.forEach((r, i) => map.set(r.id, i))
    return map
  }, [rows])

  // columns 인덱스 맵
  const colIndexMap = useMemo(() => {
    const map = new Map<string, number>()
    columns.forEach((c, i) => map.set(c, i))
    return map
  }, [columns])

  // rows/columns가 갱신되어도 activeCell.rowId가 남아있으면 itemId+fieldId 포커스 유지
  useEffect(() => {
    if (activeCell) {
      if (!rowIndexMap.has(activeCell.rowId)) {
        // 행이 완전히 사라진 경우 포커스 해제
        setActiveCellState(null)
        activeCellRef.current = null
        setIsEditing(false)
      } else if (!colIndexMap.has(activeCell.col)) {
        // 열이 숨겨진 경우 첫 열로 복귀
        if (columns.length > 0) {
          const next = { rowId: activeCell.rowId, col: columns[0] }
          setActiveCellState(next)
          activeCellRef.current = next
        }
      }
    }
  }, [rowIndexMap, colIndexMap, activeCell, columns])

  // Esc 핸들러 연동 (CELL 우선순위: PICKER(30) 아래, MODAL(10) 위)
  useEscHandler(
    useCallback(() => {
      if (isEditing) {
        setIsEditing(false)
        onCancelEdit?.()
      } else if (activeCellRef.current) {
        setActiveCellState(null)
        activeCellRef.current = null
        setRangeAnchor(null)
      }
    }, [isEditing, onCancelEdit]),
    { priority: ESC_PRIORITY.CELL, enabled: Boolean(activeCell || isEditing) }
  )

  const setActiveCell = useCallback((cell: WbsCellCoord | null) => {
    setActiveCellState(cell)
    activeCellRef.current = cell
    setRangeAnchor(cell)
    setIsEditing(false)
  }, [])

  const startEdit = useCallback(
    (cell?: WbsCellCoord) => {
      const target = cell ?? activeCellRef.current
      if (!target) return
      if (!editableColumns.includes(target.col)) return

      setActiveCellState(target)
      activeCellRef.current = target
      setIsEditing(true)
      onStartEdit?.(target.rowId, target.col)
    },
    [editableColumns, onStartEdit]
  )

  const stopEdit = useCallback(
    (commit = true) => {
      setIsEditing(false)
      if (commit) {
        onCommitEdit?.()
      } else {
        onCancelEdit?.()
      }
    },
    [onCommitEdit, onCancelEdit]
  )

  /** 인덱스 기반 좌표 이동 도우미 */
  const moveActive = useCallback(
    (rowDelta: number, colDelta: number, extendRange = false) => {
      const current = activeCellRef.current
      if (!current || rows.length === 0 || columns.length === 0) {
        if (rows.length > 0 && columns.length > 0) {
          const first = { rowId: rows[0].id, col: columns[0] }
          setActiveCellState(first)
          activeCellRef.current = first
          setRangeAnchor(first)
        }
        return
      }

      const currentRowIdx = rowIndexMap.get(current.rowId) ?? 0
      const currentColIdx = colIndexMap.get(current.col) ?? 0

      const nextRowIdx = Math.max(0, Math.min(rows.length - 1, currentRowIdx + rowDelta))
      const nextColIdx = Math.max(0, Math.min(columns.length - 1, currentColIdx + colDelta))

      const nextCell: WbsCellCoord = {
        rowId: rows[nextRowIdx].id,
        col: columns[nextColIdx],
      }

      setActiveCellState(nextCell)
      activeCellRef.current = nextCell
      if (!extendRange) {
        setRangeAnchor(nextCell)
      }
    },
    [rows, columns, rowIndexMap, colIndexMap]
  )

  /** 키보드 이벤트 핸들러 */
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // 한글 조합 중이면 간섭하지 않음
      if (e.nativeEvent.isComposing || (e as unknown as { keyCode?: number }).keyCode === 229) {
        return
      }

      if (isEditing) {
        // 편집 모드:
        if (e.key === 'Enter') {
          e.preventDefault?.()
          stopEdit(true)
          // 아래 행으로 이동
          moveActive(1, 0)
        } else if (e.key === 'Tab') {
          e.preventDefault?.()
          stopEdit(true)
          // Tab: 다음 열 이동 (Shift+Tab: 이전 열)
          moveActive(0, e.shiftKey ? -1 : 1)
        } else if (e.key === 'Escape') {
          e.preventDefault?.()
          stopEdit(false)
        }
        return
      }

      // 탐색 모드:
      if (e.key === 'ArrowDown') {
        e.preventDefault?.()
        moveActive(1, 0, e.shiftKey)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault?.()
        moveActive(-1, 0, e.shiftKey)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault?.()
        moveActive(0, 1, e.shiftKey)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault?.()
        moveActive(0, -1, e.shiftKey)
      } else if (e.key === 'Tab') {
        e.preventDefault?.()
        moveActive(0, e.shiftKey ? -1 : 1)
      } else if (e.key === 'Enter' || e.key === 'F2') {
        e.preventDefault?.()
        const current = activeCellRef.current
        if (current && editableColumns.includes(current.col)) {
          startEdit(current)
        }
      }
    },
    [isEditing, editableColumns, moveActive, startEdit, stopEdit]
  )

  /** 셀 클릭 핸들러 */
  const onCellClick = useCallback(
    (rowId: string, col: string, e?: React.MouseEvent) => {
      const coord: WbsCellCoord = { rowId, col }
      setActiveCellState(coord)
      activeCellRef.current = coord
      if (e?.shiftKey && rangeAnchor) {
        // Shift+Click: 범위 확장 (anchor 유지)
      } else {
        setRangeAnchor(coord)
        setIsEditing(false)
      }
    },
    [rangeAnchor]
  )

  /** 셀 더블 클릭 핸들러 (바로 편집 진입) */
  const onCellDoubleClick = useCallback(
    (rowId: string, col: string) => {
      const coord: WbsCellCoord = { rowId, col }
      setActiveCellState(coord)
      activeCellRef.current = coord
      setRangeAnchor(coord)
      if (editableColumns.includes(col)) {
        startEdit(coord)
      }
    },
    [editableColumns, startEdit]
  )

  /** 포커스 상태 확인 */
  const isCellFocused = useCallback(
    (rowId: string, col: string) => {
      return activeCell?.rowId === rowId && activeCell?.col === col
    },
    [activeCell]
  )

  /** 범위 선택 상태 확인 */
  const isCellSelected = useCallback(
    (rowId: string, col: string) => {
      if (!activeCell || !rangeAnchor) return false
      const r1 = Math.min(rowIndexMap.get(activeCell.rowId) ?? 0, rowIndexMap.get(rangeAnchor.rowId) ?? 0)
      const r2 = Math.max(rowIndexMap.get(activeCell.rowId) ?? 0, rowIndexMap.get(rangeAnchor.rowId) ?? 0)
      const c1 = Math.min(colIndexMap.get(activeCell.col) ?? 0, colIndexMap.get(rangeAnchor.col) ?? 0)
      const c2 = Math.max(colIndexMap.get(activeCell.col) ?? 0, colIndexMap.get(rangeAnchor.col) ?? 0)

      const r = rowIndexMap.get(rowId)
      const c = colIndexMap.get(col)
      if (r === undefined || c === undefined) return false

      return r >= r1 && r <= r2 && c >= c1 && c <= c2
    },
    [activeCell, rangeAnchor, rowIndexMap, colIndexMap]
  )

  return {
    activeCell,
    isEditing,
    setActiveCell,
    startEdit,
    stopEdit,
    onKeyDown,
    onCellClick,
    onCellDoubleClick,
    isCellFocused,
    isCellSelected,
  }
}
