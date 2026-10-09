// WBS 표 키보드 이동의 순수 계산(개정 §5.9.2) — 보이는 행·열만 받으므로 접힌 행·숨긴 열은 목록에 없다는 것이 곧 "건너뛴다"이다.
import { describe, expect, it } from 'vitest'
import { editMove, extendRowRange, gridKeyAction, gridModel, resolveCoord, rowRange, scrollToReveal, shiftRowRange, type GridRow, type RowRangeAnchor } from '@/lib/domain/wbsGridNav'

const NONE = { ctrl: false, alt: false, shift: false }
const row = (id: string, parentId: string | null, expandable = false, expanded = false): GridRow => ({ id, parentId, expandable, expanded })
// p1(펼침) > t1(접힘 — 자식 a1·a2 는 보이지 않는다) · t2(잎) / p2(펼침) > t3(잎)
const ROWS = [row('p1', null, true, true), row('t1', 'p1', true, false), row('t2', 'p1'), row('p2', null, true, true), row('t3', 'p2')]
const COLS = ['no', 'name', 'owners', 'weight', 'pactual']
const m = gridModel(ROWS, COLS, 'name')
const press = (rowId: string, col: string, key: string, mods = NONE, page?: number) => gridKeyAction(m, { rowId, col }, key, mods, page)
const to = (rowId: string, col: string) => ({ kind: 'move', to: { rowId, col } })

describe('gridKeyAction — 방향키', () => {
  it('위·아래는 보이는 행을 한 칸씩 — 접힌 행의 자손은 목록에 없어 건너뛴다', () => {
    expect(press('t1', 'weight', 'ArrowDown')).toEqual(to('t2', 'weight'))
    expect(press('t2', 'weight', 'ArrowUp')).toEqual(to('t1', 'weight'))
  })
  it('좌·우는 보이는 열을 한 칸씩 — 숨긴 열은 목록에 없다', () => {
    const narrow = gridModel(ROWS, ['no', 'name', 'pactual'], 'name')
    expect(gridKeyAction(narrow, { rowId: 't2', col: 'name' }, 'ArrowRight', NONE)).toEqual(to('t2', 'pactual'))
    expect(press('t2', 'weight', 'ArrowLeft')).toEqual(to('t2', 'owners'))
  })
  it('경계에서는 제자리 — 키는 표가 먹는다(null 이 아니다)', () => {
    expect(press('p1', 'no', 'ArrowUp')).toEqual(to('p1', 'no'))
    expect(press('t3', 'pactual', 'ArrowDown')).toEqual(to('t3', 'pactual'))
    expect(press('t3', 'pactual', 'ArrowRight')).toEqual(to('t3', 'pactual'))
    expect(press('p1', 'no', 'ArrowLeft')).toEqual(to('p1', 'no'))
  })
  it('수식키가 붙은 방향키는 가로채지 않는다 — Alt/⌘+←→ 는 브라우저의 뒤로·앞으로, Shift+←→ 는 셀 범위(아직 없다)', () => {
    for (const mods of [{ ...NONE, alt: true }, { ...NONE, ctrl: true }]) {
      for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) expect(press('t2', 'weight', key, mods), `${key} ${JSON.stringify(mods)}`).toBeNull()
    }
    for (const key of ['ArrowLeft', 'ArrowRight']) expect(press('t2', 'weight', key, { ...NONE, shift: true })).toBeNull()
    // Shift 에 다른 수식키가 겹치면 범위도 아니다
    for (const mods of [{ ctrl: true, alt: false, shift: true }, { ctrl: false, alt: true, shift: true }]) expect(press('t2', 'weight', 'ArrowDown', mods)).toBeNull()
  })
  it('Shift+↑↓ 는 행 범위(range) — 갈 칸은 방향키와 같고(접힌 행의 자손을 건너뛴다), 경계에서는 제자리', () => {
    const SHIFT = { ...NONE, shift: true }
    expect(press('t1', 'weight', 'ArrowDown', SHIFT)).toEqual({ kind: 'range', to: { rowId: 't2', col: 'weight' } })
    expect(press('t2', 'name', 'ArrowUp', SHIFT)).toEqual({ kind: 'range', to: { rowId: 't1', col: 'name' } })
    expect(press('p1', 'name', 'ArrowUp', SHIFT)).toEqual({ kind: 'range', to: { rowId: 'p1', col: 'name' } })
    expect(press('t3', 'name', 'ArrowDown', SHIFT)).toEqual({ kind: 'range', to: { rowId: 't3', col: 'name' } })
  })
  it('이동 키가 아니거나 좌표가 표에 없으면 null', () => {
    expect(press('t2', 'weight', 'a')).toBeNull()
    expect(press('t2', 'weight', 'Enter')).toBeNull()
    expect(press('gone', 'weight', 'ArrowDown')).toBeNull()
    expect(press('t2', 'hidden', 'ArrowDown')).toBeNull()
  })
})

describe('gridKeyAction — 트리 열의 ←/→', () => {
  it('→: 접힌 행은 편다. 펼쳐진 행·잎은 오른쪽 칸으로 나간다(트리 열에 갇히지 않는다)', () => {
    expect(press('t1', 'name', 'ArrowRight')).toEqual({ kind: 'toggle', rowId: 't1' })
    expect(press('p1', 'name', 'ArrowRight')).toEqual(to('p1', 'owners'))
    expect(press('t2', 'name', 'ArrowRight')).toEqual(to('t2', 'owners'))
  })
  it('←: 펼쳐진 행은 접는다. 잎·이미 접힌 행은 부모 행으로, 루트는 왼쪽 칸으로', () => {
    expect(press('p1', 'name', 'ArrowLeft')).toEqual({ kind: 'toggle', rowId: 'p1' })
    expect(press('t2', 'name', 'ArrowLeft')).toEqual(to('p1', 'name'))
    expect(press('t1', 'name', 'ArrowLeft')).toEqual(to('p1', 'name'))
    const collapsedRoot = gridModel([row('p1', null, true, false)], COLS, 'name')
    expect(gridKeyAction(collapsedRoot, { rowId: 'p1', col: 'name' }, 'ArrowLeft', NONE)).toEqual(to('p1', 'no'))
  })
  it('부모가 보이지 않으면(완료 숨김·검색) 왼쪽 칸', () => {
    const orphan = gridModel([row('t9', 'hidden-parent')], COLS, 'name')
    expect(gridKeyAction(orphan, { rowId: 't9', col: 'name' }, 'ArrowLeft', NONE)).toEqual(to('t9', 'no'))
  })
  it('접을 수 없는 보기(검색 — expandable=false)에서는 자식이 있어도 이동만 한다', () => {
    const search = gridModel([row('p1', null, false, true), row('t1', 'p1', false, true)], COLS, 'name')
    expect(gridKeyAction(search, { rowId: 'p1', col: 'name' }, 'ArrowLeft', NONE)).toEqual(to('p1', 'no'))
    expect(gridKeyAction(search, { rowId: 'p1', col: 'name' }, 'ArrowRight', NONE)).toEqual(to('p1', 'owners'))
  })
  it('트리 열이 아니면 ←/→ 는 늘 칸 이동이다', () => {
    expect(press('t1', 'owners', 'ArrowLeft')).toEqual(to('t1', 'name'))
    expect(press('p1', 'weight', 'ArrowRight')).toEqual(to('p1', 'pactual'))
  })
})

describe('gridKeyAction — Home/End/Page', () => {
  it('Home/End 는 그 행의 처음/끝 칸, Ctrl·⌘ 와 함께면 표의 처음/끝 칸', () => {
    expect(press('t2', 'owners', 'Home')).toEqual(to('t2', 'no'))
    expect(press('t2', 'owners', 'End')).toEqual(to('t2', 'pactual'))
    expect(press('t2', 'owners', 'Home', { ...NONE, ctrl: true })).toEqual(to('p1', 'no'))
    expect(press('t2', 'owners', 'End', { ...NONE, ctrl: true })).toEqual(to('t3', 'pactual'))
  })
  it('PageUp/PageDown 은 같은 열에서 쪽 단위 — 경계에서 멈추고, 쪽 크기가 0 이하여도 한 행은 간다', () => {
    expect(press('p1', 'weight', 'PageDown', NONE, 3)).toEqual(to('p2', 'weight'))
    expect(press('p2', 'weight', 'PageDown', NONE, 3)).toEqual(to('t3', 'weight'))
    expect(press('t2', 'weight', 'PageUp', NONE, 10)).toEqual(to('p1', 'weight'))
    expect(press('t2', 'weight', 'PageDown', NONE, 0)).toEqual(to('p2', 'weight'))
  })
})

describe('editMove — 편집 확정 뒤의 칸', () => {
  it('Enter = 아래, Tab = 오른쪽, Shift+Tab = 왼쪽. 경계면 제자리', () => {
    expect(editMove(m, { rowId: 't1', col: 'weight' }, 'down')).toEqual({ rowId: 't2', col: 'weight' })
    expect(editMove(m, { rowId: 't1', col: 'weight' }, 'right')).toEqual({ rowId: 't1', col: 'pactual' })
    expect(editMove(m, { rowId: 't1', col: 'weight' }, 'left')).toEqual({ rowId: 't1', col: 'owners' })
    expect(editMove(m, { rowId: 't3', col: 'pactual' }, 'down')).toEqual({ rowId: 't3', col: 'pactual' })
    expect(editMove(m, { rowId: 't3', col: 'pactual' }, 'right')).toEqual({ rowId: 't3', col: 'pactual' })
  })
  it('표에 없는 좌표는 그대로 돌려준다(호출부가 보이는 칸으로 맞춘다)', () => {
    expect(editMove(m, { rowId: 'gone', col: 'weight' }, 'down')).toEqual({ rowId: 'gone', col: 'weight' })
  })
})

describe('resolveCoord — 기억한 좌표를 보이는 표에 맞춘다', () => {
  const parents = new Map<string, string | null>([['a1', 't1'], ['t1', 'p1'], ['p1', null], ['x1', 'x0'], ['x0', null]])
  const parentOf = (id: string) => parents.get(id)
  it('처음(null)이면 첫 행의 트리 열, 그대로 보이면 그대로', () => {
    expect(resolveCoord(m, null, parentOf)).toEqual({ rowId: 'p1', col: 'name' })
    expect(resolveCoord(m, { rowId: 't2', col: 'weight' }, parentOf)).toEqual({ rowId: 't2', col: 'weight' })
  })
  it('행이 접혀 사라졌으면 보이는 가장 가까운 조상 — 열은 지킨다', () => {
    expect(resolveCoord(m, { rowId: 'a1', col: 'weight' }, parentOf)).toEqual({ rowId: 't1', col: 'weight' })
  })
  it('조상도 없으면(삭제·필터) 첫 행. 열이 숨겨졌으면 트리 열, 트리 열도 없으면 첫 열', () => {
    expect(resolveCoord(m, { rowId: 'x1', col: 'weight' }, parentOf)).toEqual({ rowId: 'p1', col: 'weight' })
    expect(resolveCoord(m, { rowId: 't2', col: 'deliverable' }, parentOf)).toEqual({ rowId: 't2', col: 'name' })
    expect(resolveCoord(gridModel(ROWS, ['no', 'weight'], 'name'), { rowId: 't2', col: 'deliverable' }, parentOf)).toEqual({ rowId: 't2', col: 'no' })
  })
  it('보이는 행이나 열이 없으면 null. 부모 사슬이 돌아도 멈춘다', () => {
    expect(resolveCoord(gridModel([], COLS, 'name'), { rowId: 't2', col: 'name' }, parentOf)).toBeNull()
    expect(resolveCoord(gridModel(ROWS, [], 'name'), null, parentOf)).toBeNull()
    expect(resolveCoord(m, { rowId: 'loop', col: 'name' }, () => 'loop')).toEqual({ rowId: 'p1', col: 'name' })
  })
})

describe('scrollToReveal — sticky 머리 행·동결 열에 가려지지 않게', () => {
  const view = { left: 0, top: 0, right: 1000, bottom: 600 }
  const pinned = { left: 400, top: 58 }
  it('다 보이는 칸은 움직이지 않는다', () => {
    expect(scrollToReveal({ left: 500, top: 100, right: 580, bottom: 140 }, view, pinned, false)).toEqual({ dx: 0, dy: 0 })
  })
  it('머리 행 아래·동결 열 아래에 깔린 칸은 그만큼 되돌린다', () => {
    expect(scrollToReveal({ left: 380, top: 40, right: 460, bottom: 80 }, view, pinned, false)).toEqual({ dx: -20, dy: -18 })
  })
  it('아래·오른쪽으로 넘친 칸은 끝이 보이게', () => {
    expect(scrollToReveal({ left: 960, top: 590, right: 1040, bottom: 630 }, view, pinned, false)).toEqual({ dx: 40, dy: 30 })
  })
  it('동결 열의 칸은 가로로 움직이지 않는다(늘 보인다)', () => {
    expect(scrollToReveal({ left: 44, top: 620, right: 404, bottom: 660 }, view, pinned, true)).toEqual({ dx: 0, dy: 60 })
  })
  it('보이는 영역보다 큰 칸은 시작 쪽을 맞춘다', () => {
    expect(scrollToReveal({ left: 600, top: 100, right: 1400, bottom: 140 }, view, pinned, false).dx).toBe(200)
  })
})

describe('행 범위 선택 — rowRange·shiftRowRange·extendRowRange', () => {
  const ids = (set: ReadonlySet<string>) => ROWS.map(r => r.id).filter(id => set.has(id))
  /** Shift+방향키를 차례로 누른 것처럼 — [지금 행, 갈 행] 쌍을 이어 적용한다 */
  const walk = (start: ReadonlySet<string>, steps: [string, string][], anchor: RowRangeAnchor | null = null) => {
    let state = { selection: new Set(start), anchor: anchor as RowRangeAnchor }
    let a = anchor
    for (const [cur, to] of steps) { state = shiftRowRange(m, state.selection, a, cur, to); a = state.anchor }
    return state
  }

  it('rowRange 는 양 끝을 포함하고 방향을 가리지 않는다 — 보이지 않는 행이 끼면 빈 목록', () => {
    expect(rowRange(m, 't1', 'p2')).toEqual(['t1', 't2', 'p2'])
    expect(rowRange(m, 'p2', 't1')).toEqual(['t1', 't2', 'p2'])
    expect(rowRange(m, 't2', 't2')).toEqual(['t2'])
    expect(rowRange(m, 'a1', 't2')).toEqual([])
  })
  it('늘림 — 기준 행(Shift 를 처음 누른 행)부터 닿은 행까지', () => {
    const r = walk(new Set(), [['t1', 't2'], ['t2', 'p2']])
    expect(ids(r.selection)).toEqual(['t1', 't2', 'p2'])
    expect(r.anchor).toMatchObject({ rowId: 't1', head: 'p2' })
  })
  it('줄임 — 되돌아오면 빠진 행이 풀린다. 기준을 지나 반대쪽으로 넘어가면 그쪽으로 다시 늘어난다', () => {
    expect(ids(walk(new Set(), [['t1', 't2'], ['t2', 'p2'], ['p2', 't2']]).selection)).toEqual(['t1', 't2'])
    expect(ids(walk(new Set(), [['t1', 't2'], ['t2', 't1'], ['t1', 'p1']]).selection)).toEqual(['p1', 't1'])
  })
  it('먼저 골라 둔 행은 범위를 줄여도 남는다(base)', () => {
    expect(ids(walk(new Set(['t3']), [['p1', 't1'], ['t1', 't2'], ['t2', 't1']]).selection)).toEqual(['p1', 't1', 't3'])
    // 범위가 덮었다가 물러난 행도 원래 골라 둔 것이면 남는다
    expect(ids(walk(new Set(['t2']), [['p1', 't1'], ['t1', 't2'], ['t2', 't1']]).selection)).toEqual(['p1', 't1', 't2'])
  })
  it('접힌 행의 자손은 범위에 들지 않는다 — 보이는 행만 고른다', () => {
    const r = walk(new Set(), [['p1', 't1'], ['t1', 't2']])
    expect([...r.selection].sort()).toEqual(['p1', 't1', 't2'])
    expect(r.selection.has('a1')).toBe(false)
  })
  it('경계 — 첫 행·끝 행에서 제자리로 눌러도 그 행은 선택된다', () => {
    expect(ids(walk(new Set(), [['p1', 'p1']]).selection)).toEqual(['p1'])
    expect(ids(walk(new Set(), [['p2', 't3'], ['t3', 't3']]).selection)).toEqual(['p2', 't3'])
  })
  it('포커스가 다른 길로 떠났다 오면(직전 범위의 끝이 지금 행이 아니다) 지금 행이 새 기준이다 — 앞 범위는 base 로 남는다', () => {
    const first = walk(new Set(), [['p1', 't1']])
    const second = shiftRowRange(m, first.selection, first.anchor, 'p2', 't3')
    expect(ids(second.selection)).toEqual(['p1', 't1', 'p2', 't3'])
    expect(second.anchor.rowId).toBe('p2')
  })
  it('extendRowRange(Shift+Space) — 기준이 있으면 거기서부터, 없거나 기준 행이 사라졌으면 그 행 하나', () => {
    const anchor: RowRangeAnchor = { rowId: 't1', base: new Set(['t1']), head: 't1' }
    expect(ids(extendRowRange(m, new Set(['t1']), anchor, 'p2', 'p2').selection)).toEqual(['t1', 't2', 'p2'])
    expect(ids(extendRowRange(m, new Set(), null, 't2', 't2').selection)).toEqual(['t2'])
    const gone: RowRangeAnchor = { rowId: 'a1', base: new Set(['a1']), head: 'a1' }
    const r = extendRowRange(m, new Set(['t3']), gone, 't2', 't2')
    expect(ids(r.selection)).toEqual(['t2', 't3'])
    expect(r.anchor.rowId).toBe('t2')
  })
  it('입력 선택을 고치지 않는다(새 집합을 돌려준다)', () => {
    const sel = new Set(['t3'])
    shiftRowRange(m, sel, null, 'p1', 't1')
    expect([...sel]).toEqual(['t3'])
  })
})
