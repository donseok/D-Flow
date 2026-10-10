// WBS 표(시트)의 키보드 이동 계산 — 순수 도메인(JSX·DOM·I/O 없음). 개정 §5.9.2 "키보드": 탐색 모드 방향키 = 셀 이동, 포커스는
// itemId + fieldId 좌표로 든다(정렬·접힘·원격 갱신 뒤에도 같은 칸). 화면(useWbsGridNav·WbsGanttSheet)은 여기서 받은 좌표로 DOM 포커스만
// 옮긴다 — 좌표를 React 상태에 두지 않아 키 입력마다 표 전체가 다시 그려지지 않는다.
// 행·열은 "지금 화면에 보이는" 것만 받는다: 접힌 조상의 자손·완료 숨김·검색 밖의 행, 숨긴 열은 목록에 없으므로 이동이 건너뛴다.

/** 셀 좌표 — 행은 항목 id, 열은 열 key(`name`·`weight`·`cf:<필드>` …) */
export interface GridCoord { rowId: string; col: string }

/** 보이는 한 행. expandable = 접고 펼 수 있는 행(자식이 있고, 접힘이 화면에 반영되는 보기), expanded = 지금 펼쳐져 있음 */
export interface GridRow { id: string; parentId: string | null; expandable: boolean; expanded: boolean }

export interface GridModel {
  rows: readonly GridRow[]
  cols: readonly string[]
  /** 트리 열(작업명) — 여기서만 ←/→ 가 접기·펴기를 겸한다 */
  treeCol: string
  rowIndex: ReadonlyMap<string, number>
  colIndex: ReadonlyMap<string, number>
}

export function gridModel(rows: readonly GridRow[], cols: readonly string[], treeCol: string): GridModel {
  return {
    rows, cols, treeCol,
    rowIndex: new Map(rows.map((r, i) => [r.id, i])),
    colIndex: new Map(cols.map((c, i) => [c, i])),
  }
}

export interface GridKeyMods { ctrl: boolean; alt: boolean; shift: boolean }

/**
 * 키 하나의 결과 — 포커스 이동(제자리도 move 다: 경계에서 눌러도 키는 표가 먹는다), 그 행 접기·펴기,
 * 또는 행 범위 선택을 늘리고 줄이며 옮기기(range — Shift+↑↓. 선택을 쓸 수 없는 화면이면 호출부가 가로채지 않는다)
 */
export type GridKeyAction = { kind: 'move'; to: GridCoord } | { kind: 'toggle'; rowId: string } | { kind: 'range'; to: GridCoord }

const clamp = (n: number, max: number) => Math.max(0, Math.min(max, n))

/**
 * 탐색 모드의 이동 키 → 동작. 이동 키가 아니거나 표가 가로채면 안 되는 조합이면 null(호출부는 기본 동작을 막지 않는다).
 * - 방향키: 한 칸. 수식키가 붙으면 null — Alt/⌘+←→ 는 브라우저의 뒤로·앞으로다. 예외는 Shift+↑↓(다른 수식키 없이): 행 범위 선택(range).
 *   Shift+←→ 는 null 이다 — 셀 범위(개정 §5.9.2 의 직사각형 선택)는 여기가 아니라 wbsCellRange.ts 가 계산하고, 화면이 데이터 열의
 *   Shift+방향키를 이 함수보다 먼저 그쪽으로 보낸다. 여기 range 는 식별 열(번호·개요·작업명)에서만 쓰인다.
 * - 트리 열의 →: 접힌 행이면 편다(포커스는 그대로). 그 밖에는 오른쪽 칸 — 펼쳐진 부모에서도 오른쪽으로 나갈 수 있어야 한다(첫 자식은 ↓).
 * - 트리 열의 ←: 펼쳐진 행이면 접는다. 그 밖(잎·이미 접힌 행)에는 보이는 부모 행으로, 부모가 없으면(루트) 왼쪽 칸.
 * - Home/End: 그 행의 처음/끝 칸, Ctrl·⌘ 와 함께면 표의 처음/끝 칸. PageUp/PageDown: pageRows 만큼 위/아래 같은 열.
 */
export function gridKeyAction(m: GridModel, cur: GridCoord, key: string, mods: GridKeyMods, pageRows = 10): GridKeyAction | null {
  const r = m.rowIndex.get(cur.rowId)
  const c = m.colIndex.get(cur.col)
  if (r === undefined || c === undefined) return null
  const lastRow = m.rows.length - 1
  const lastCol = m.cols.length - 1
  const at = (ri: number, ci: number): GridKeyAction => ({ kind: 'move', to: { rowId: m.rows[clamp(ri, lastRow)].id, col: m.cols[clamp(ci, lastCol)] } })
  const plain = !mods.ctrl && !mods.alt && !mods.shift
  switch (key) {
    case 'ArrowUp':
    case 'ArrowDown': {
      const next = at(r + (key === 'ArrowUp' ? -1 : 1), c)
      if (plain) return next
      return mods.shift && !mods.ctrl && !mods.alt && next.kind === 'move' ? { kind: 'range', to: next.to } : null
    }
    case 'ArrowRight': {
      if (!plain) return null
      const row = m.rows[r]
      if (cur.col === m.treeCol && row.expandable && !row.expanded) return { kind: 'toggle', rowId: row.id }
      return at(r, c + 1)
    }
    case 'ArrowLeft': {
      if (!plain) return null
      const row = m.rows[r]
      if (cur.col === m.treeCol) {
        if (row.expandable && row.expanded) return { kind: 'toggle', rowId: row.id }
        const parent = row.parentId === null ? undefined : m.rowIndex.get(row.parentId)
        if (parent !== undefined) return at(parent, c)
      }
      return at(r, c - 1)
    }
    case 'Home': return mods.alt || mods.shift ? null : mods.ctrl ? at(0, 0) : at(r, 0)
    case 'End': return mods.alt || mods.shift ? null : mods.ctrl ? at(lastRow, lastCol) : at(r, lastCol)
    case 'PageUp': return plain ? at(r - Math.max(1, pageRows), c) : null
    case 'PageDown': return plain ? at(r + Math.max(1, pageRows), c) : null
    default: return null
  }
}

/** 편집을 확정한 뒤 옮겨 갈 칸 — Enter 는 아래, Tab 은 오른쪽, Shift+Tab 은 왼쪽. 경계면 제자리(표 밖으로 나가지 않는다) */
export function editMove(m: GridModel, cur: GridCoord, dir: 'down' | 'up' | 'right' | 'left'): GridCoord {
  const r = m.rowIndex.get(cur.rowId)
  const c = m.colIndex.get(cur.col)
  if (r === undefined || c === undefined) return cur
  const dr = dir === 'down' ? 1 : dir === 'up' ? -1 : 0
  const dc = dir === 'right' ? 1 : dir === 'left' ? -1 : 0
  return { rowId: m.rows[clamp(r + dr, m.rows.length - 1)].id, col: m.cols[clamp(c + dc, m.cols.length - 1)] }
}

/**
 * 행 범위 선택의 기준. rowId = Shift 를 처음 누른 행(또는 마지막으로 Space·체크박스로 뒤집은 행), base = 그때의 선택 —
 * 범위를 줄여도 base 의 행은 남는다. head = 범위가 마지막으로 닿은 행(포커스가 다른 길로 떠났는지 가리는 데 쓴다).
 */
export interface RowRangeAnchor { rowId: string; base: ReadonlySet<string>; head: string }

/** 두 행 사이(양 끝 포함)의 보이는 행 id — 접힌 행의 자손·필터 밖 행은 모델에 없으므로 범위에도 없다. 어느 쪽이든 보이지 않으면 빈 목록 */
export function rowRange(m: GridModel, fromId: string, toId: string): string[] {
  const a = m.rowIndex.get(fromId)
  const b = m.rowIndex.get(toId)
  if (a === undefined || b === undefined) return []
  const out: string[] = []
  for (let i = Math.min(a, b); i <= Math.max(a, b); i++) out.push(m.rows[i].id)
  return out
}

/**
 * 기준 행부터 to 까지를 선택한다 — 결과 선택 = 기준의 base ∪ 범위(그래서 범위를 줄이면 빠진 행이 풀리고, 먼저 골라 둔 행은 남는다).
 * 기준이 없거나 기준 행이 더는 보이지 않으면 start 에서 새로 잡는다(base = 지금 선택).
 */
export function extendRowRange(
  m: GridModel, selection: ReadonlySet<string>, anchor: RowRangeAnchor | null, start: string, to: string,
): { selection: Set<string>; anchor: RowRangeAnchor } {
  const from = anchor && m.rowIndex.has(anchor.rowId) ? anchor : { rowId: start, base: selection, head: start }
  const next = new Set(from.base)
  for (const id of rowRange(m, from.rowId, to)) next.add(id)
  return { selection: next, anchor: { rowId: from.rowId, base: from.base, head: to } }
}

/**
 * Shift+↑↓ 한 번 — cur(지금 포커스 행)에서 to 로. 기준은 "Shift 를 처음 누른 행"이다: 직전 범위의 끝(head)이 cur 가 아니면
 * (그 사이 포커스가 방향키·마우스로 옮겨 갔다) 이어 가지 않고 cur 에서 새로 시작한다.
 */
export function shiftRowRange(
  m: GridModel, selection: ReadonlySet<string>, anchor: RowRangeAnchor | null, cur: string, to: string,
): { selection: Set<string>; anchor: RowRangeAnchor } {
  return extendRowRange(m, selection, anchor && anchor.head === cur ? anchor : null, cur, to)
}

/**
 * 기억한 좌표를 지금 보이는 표에 맞춘다(탭 정지 = 표 안에서 tabindex=0 인 한 칸). 처음(null)이면 첫 행의 트리 열.
 * 열이 숨겨졌으면 트리 열(없으면 첫 열), 행이 사라졌으면(조상이 접힘·필터) 보이는 가장 가까운 조상, 그것도 없으면 첫 행.
 * 보이는 행이나 열이 하나도 없으면 null.
 */
export function resolveCoord(m: GridModel, coord: GridCoord | null, parentOf: (rowId: string) => string | null | undefined): GridCoord | null {
  if (m.rows.length === 0 || m.cols.length === 0) return null
  const fallbackCol = m.colIndex.has(m.treeCol) ? m.treeCol : m.cols[0]
  if (!coord) return { rowId: m.rows[0].id, col: fallbackCol }
  const col = m.colIndex.has(coord.col) ? coord.col : fallbackCol
  let rowId: string | null | undefined = coord.rowId
  // 부모 사슬이 순환해도 멈추게 걸음 수를 묶는다(정상 데이터에서는 깊이만큼만 돈다)
  for (let guard = 0; rowId && !m.rowIndex.has(rowId) && guard < 10_000; guard++) rowId = parentOf(rowId)
  return { rowId: rowId && m.rowIndex.has(rowId) ? rowId : m.rows[0].id, col }
}

export interface Box { left: number; top: number; right: number; bottom: number }

/**
 * 포커스가 간 칸이 스크롤 영역에서 가려지지 않게 움직일 양. 머리 행(위)과 동결 열(왼쪽)은 sticky 라 그 아래로 칸이 숨는다 —
 * 브라우저의 scrollIntoView 는 그 덮개를 모른다. pinned = 덮개의 크기, cellPinned = 그 칸 자체가 동결 열(가로로는 늘 보인다).
 * 칸이 보이는 영역보다 크면 시작 쪽(위·왼쪽)을 맞춘다.
 */
export function scrollToReveal(cell: Box, view: Box, pinned: { left: number; top: number }, cellPinned: boolean): { dx: number; dy: number } {
  const axis = (start: number, end: number, lo: number, hi: number) => {
    if (start < lo || end - start > hi - lo) return start - lo
    if (end > hi) return end - hi
    return 0
  }
  return {
    dx: cellPinned ? 0 : axis(cell.left, cell.right, view.left + pinned.left, view.right),
    dy: axis(cell.top, cell.bottom, view.top + pinned.top, view.bottom),
  }
}
