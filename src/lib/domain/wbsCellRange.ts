// WBS 표의 셀 범위(직사각형) — 순수 계산(JSX·DOM·I/O 없음). 개정 §5.9.2 "Shift+방향키=범위 … 행 체크 선택과 셀 범위 선택은 다른 상태다.
// 주간 시트 모델(useSheetGrid.ts)을 이식한다". 주간 시트에서 가져온 것은 기준(anchor)·끝(head) 두 좌표의 직사각형과 TSV 왕복이고,
// 가져오지 않은 것은 상태 보관 방식이다 — 여기 좌표는 화면(useWbsCellRange)의 ref 에만 있다(시트에 가상화·행 메모가 없어 키마다 상태를 바꾸면
// 수천 행이 다시 그려진다 — wbsGridNav 와 같은 이유).
// 범위는 "지금 보이는" 모델(GridModel) 위에서만 계산한다: 접힌 행·숨긴 열은 모델에 없으므로 범위에도 없다.
// 붙여넣기·지우기의 계획(planCellWrites)은 칸마다 쓸 수 있는지·값이 맞는지만 가린다 — 저장은 화면이 기존 액션으로 한다(새 저장 모델 없음).
import type { GridCoord, GridModel } from './wbsGridNav'
import { formatPct1, weightToPct } from './format'
import { actualPctViolation, weightPctToFraction, weightViolation } from './wbsValueRules'
import type { CustomValues, FieldDef, FieldValue } from './customFields'
import { validateCustomValues, type FieldRowError } from './customFieldValues'

/** 식별 열 — 여기서의 Shift+↑↓ 는 행 범위(체크 선택)다. 셀 범위는 이 열들로 넘어가지 않는다 */
export const WBS_IDENTITY_COLS: ReadonlySet<string> = new Set(['no', 'outline', 'name'])
export const isDataCol = (col: string): boolean => !WBS_IDENTITY_COLS.has(col)

/** 기준 칸(Shift 를 처음 누른 칸)과 끝 칸(지금 포커스가 있는 칸) */
export interface CellRange { anchor: GridCoord; head: GridCoord }
/** 모델의 행·열 번호로 본 직사각형(양 끝 포함) */
export interface RangeRect { top: number; bottom: number; left: number; right: number }

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))
const sameCoord = (a: GridCoord, b: GridCoord) => a.rowId === b.rowId && a.col === b.col

/** 첫 데이터 열의 번호 — 식별 열은 왼쪽에 모여 있다(동결 열). 데이터 열이 없으면 -1 */
export function firstDataColIndex(m: GridModel): number {
  return m.cols.findIndex(isDataCol)
}

/**
 * 범위의 직사각형. 어느 끝이든 보이지 않게 됐거나(조상이 접힘·필터·열 숨김) 식별 열이면 null — 범위는 풀린 것이다
 * (끝 칸을 다른 칸으로 옮겨 잇지 않는다: 사용자가 고르지 않은 칸이 범위에 들어가 지워지거나 덮이면 안 된다).
 */
export function rangeRect(m: GridModel, range: CellRange | null): RangeRect | null {
  if (!range || !isDataCol(range.anchor.col) || !isDataCol(range.head.col)) return null
  const r1 = m.rowIndex.get(range.anchor.rowId)
  const r2 = m.rowIndex.get(range.head.rowId)
  const c1 = m.colIndex.get(range.anchor.col)
  const c2 = m.colIndex.get(range.head.col)
  if (r1 === undefined || r2 === undefined || c1 === undefined || c2 === undefined) return null
  return { top: Math.min(r1, r2), bottom: Math.max(r1, r2), left: Math.min(c1, c2), right: Math.max(c1, c2) }
}

export const rectSize = (r: RangeRect): { rows: number; cols: number } => ({ rows: r.bottom - r.top + 1, cols: r.right - r.left + 1 })
const inRect = (r: RangeRect | null, row: number, col: number) => r !== null && row >= r.top && row <= r.bottom && col >= r.left && col <= r.right

/**
 * Shift+방향키 한 번 — cur(지금 포커스 칸)에서 한 칸 늘리거나 줄인다. 기준은 "Shift 를 처음 누른 칸"이다: 직전 범위의 끝이 cur 가 아니면
 * (그 사이 포커스가 다른 길로 옮겨 갔다) cur 에서 새로 시작한다. 표의 끝·식별 열 경계에서는 제자리(범위는 그대로). 식별 열에서는 null.
 */
export function extendCellRange(m: GridModel, range: CellRange | null, cur: GridCoord, key: string): CellRange | null {
  const r = m.rowIndex.get(cur.rowId)
  const c = m.colIndex.get(cur.col)
  if (r === undefined || c === undefined || !isDataCol(cur.col)) return null
  const d = key === 'ArrowUp' ? [-1, 0] : key === 'ArrowDown' ? [1, 0] : key === 'ArrowLeft' ? [0, -1] : key === 'ArrowRight' ? [0, 1] : null
  if (!d) return null
  const anchor = range && sameCoord(range.head, cur) && rangeRect(m, range) ? range.anchor : cur
  const nr = clamp(r + d[0], 0, m.rows.length - 1)
  const nc = clamp(c + d[1], firstDataColIndex(m), m.cols.length - 1)
  return { anchor, head: { rowId: m.rows[nr].id, col: m.cols[nc] } }
}

/**
 * Shift+클릭 — 기준 칸부터 to 까지. 기준은 살아 있는 범위의 기준, 없으면 지금 포커스 칸(active — 데이터 열일 때), 그것도 없으면 to 자신.
 * to 가 식별 열이거나 보이지 않으면 null(그 열의 Shift+클릭은 종전 그대로다).
 */
export function clickCellRange(m: GridModel, range: CellRange | null, active: GridCoord | null, to: GridCoord): CellRange | null {
  if (!isDataCol(to.col) || !m.rowIndex.has(to.rowId) || !m.colIndex.has(to.col)) return null
  const usable = (c: GridCoord | null | undefined): c is GridCoord => !!c && isDataCol(c.col) && m.rowIndex.has(c.rowId) && m.colIndex.has(c.col)
  const anchor = rangeRect(m, range) ? range!.anchor : usable(active) ? active : to
  return { anchor, head: to }
}

/** 한 칸짜리 직사각형(범위가 없을 때의 복사 대상 — 식별 열도 된다). 보이지 않으면 null */
export function singleRect(m: GridModel, at: GridCoord): RangeRect | null {
  const r = m.rowIndex.get(at.rowId)
  const c = m.colIndex.get(at.col)
  return r === undefined || c === undefined ? null : { top: r, bottom: r, left: c, right: c }
}

/**
 * 표시를 바꿔야 하는 칸 — 두 직사각형 중 한쪽에만 든 칸. 같은 모델 위의 두 직사각형이어야 한다(번호가 같은 칸을 가리킨다).
 * 한 칸 늘릴 때 한 줄만 나온다: 범위 전체를 다시 칠하지 않는다.
 */
export function rectChanges(prev: RangeRect | null, next: RangeRect | null): { row: number; col: number; on: boolean }[] {
  const out: { row: number; col: number; on: boolean }[] = []
  const both = [prev, next].filter((r): r is RangeRect => r !== null)
  if (both.length === 0) return out
  const top = Math.min(...both.map(r => r.top)), bottom = Math.max(...both.map(r => r.bottom))
  const left = Math.min(...both.map(r => r.left)), right = Math.max(...both.map(r => r.right))
  for (let row = top; row <= bottom; row++) {
    for (let col = left; col <= right; col++) {
      const was = inRect(prev, row, col)
      const now = inRect(next, row, col)
      if (was !== now) out.push({ row, col, on: now })
    }
  }
  return out
}

/** 직사각형의 글자 격자(행 우선) — TSV 직렬화(sheetClipboard.serializeTsv)의 입력 */
export function rangeMatrix(m: GridModel, rect: RangeRect, textOf: (rowId: string, col: string) => string): string[][] {
  const out: string[][] = []
  for (let r = rect.top; r <= rect.bottom; r++) {
    const line: string[] = []
    for (let c = rect.left; c <= rect.right; c++) line.push(textOf(m.rows[r].id, m.cols[c]))
    out.push(line)
  }
  return out
}

/* ── 복사: 칸의 글자 ── */

/** 계획에 필요한 행의 값(ComputedItem 의 부분 — 구조로 받는다) */
export interface RangeItem {
  id: string
  name: string
  children: readonly unknown[]
  deliverable: string | null
  plannedStart: string | null
  plannedEnd: string | null
  weight: number | null
  plannedPct: number
  rolledActualPct: number
  achievement: number | null
  /** null = 저장값을 읽지 못함(손상) — 그 행의 사용자 정의 필드는 쓰지 않는다 */
  custom?: CustomValues | null
}

/** 값이 아니라 화면 낱말로 보이는 열의 글자 — 화면(시트)이 준다(팀 이름·담당자 이름·사전 문구) */
export interface CopyLabels<T> {
  rowNo: (n: T) => string
  outline: (n: T) => string
  owners: (n: T) => string
  assignee: (n: T) => string
  status: (n: T) => string
  stage: (n: T) => string
  fieldDef: (key: string) => FieldDef | undefined
  bool: { yes: string; no: string }
}

/** 사용자 정의 필드 값의 복사 글자 — 숫자는 자릿수 구분·단위 없이(붙여넣기가 다시 읽는다), 선택은 이름, 예/아니오는 화면 낱말 */
export function customCopyText(def: FieldDef, value: FieldValue | undefined, bool: { yes: string; no: string }): string {
  if (value === undefined) return ''
  if (typeof value === 'boolean') return value ? bool.yes : bool.no
  if (typeof value === 'number') return String(value)
  const labels = (codes: readonly string[]) => codes.map(code => def.options?.find(o => o.code === code)?.label ?? code).join(', ')
  if (Array.isArray(value)) return labels(value)
  return def.type === 'select' ? labels([value]) : value
}

/**
 * 한 칸의 복사 글자. 화면에 보이는 값이 기준이되 붙여넣기가 다시 읽을 수 있는 꼴이다: 날짜는 YYYY-MM-DD(화면의 26.07.01 은 세기가 없다),
 * 퍼센트는 숫자+%, 빈 값은 화면의 '-'·'균등' 대신 빈 칸(다른 칸에 붙였을 때 '-' 가 값으로 들어가지 않게).
 * 잎의 실적%는 반올림하지 않은 값이다 — 같은 칸에 되붙여도 값이 바뀌지 않는다(편집기의 기준값과 같은 이유).
 */
export function cellCopyText<T extends RangeItem>(n: T, col: string, l: CopyLabels<T>): string {
  switch (col) {
    case 'no': return l.rowNo(n)
    case 'outline': return l.outline(n)
    case 'name': return n.name
    case 'owners': return l.owners(n)
    case 'assignee': return l.assignee(n)
    case 'status': return l.status(n)
    case 'stage': return l.stage(n)
    case 'deliverable': return n.deliverable ?? ''
    case 'pstart': return n.plannedStart ?? ''
    case 'pend': return n.plannedEnd ?? ''
    case 'weight': return n.weight == null ? '' : `${weightToPct(n.weight)}%`
    case 'pplan': return `${formatPct1(n.plannedPct)}%`
    case 'pactual': return n.children.length > 0 ? `${formatPct1(n.rolledActualPct)}%` : `${n.rolledActualPct}%`
    case 'achieve': return n.achievement == null ? '' : `${n.achievement}%`
    default: {
      if (!col.startsWith('cf:')) return ''
      const def = l.fieldDef(col.slice(3))
      return def && n.custom ? customCopyText(def, n.custom[def.key], l.bool) : ''
    }
  }
}

/* ── 붙여넣기·지우기: 값 읽기 ── */

export type CellParse<V> = { ok: true; value: V } | { ok: false; reason: RangeInvalidReason }

/** 날짜 칸 — YYYY-MM-DD·YYYY.MM.DD·YYYY/M/D, 그리고 화면 표기 YY.MM.DD(2000년대로 읽는다). 빈 칸·'-' 는 비움. 달력에 없는 날은 거부 */
export function parseDateCell(raw: string): CellParse<string | null> {
  const s = raw.trim()
  if (s === '' || s === '-') return { ok: true, value: null }
  const hit = /^(\d{4}|\d{2})[-./](\d{1,2})[-./](\d{1,2})\.?$/.exec(s)
  if (!hit) return { ok: false, reason: 'date' }
  const y = hit[1].length === 2 ? 2000 + Number(hit[1]) : Number(hit[1])
  const iso = `${String(y).padStart(4, '0')}-${hit[2].padStart(2, '0')}-${hit[3].padStart(2, '0')}`
  const d = new Date(`${iso}T00:00:00.000Z`)
  return y > 0 && Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === iso ? { ok: true, value: iso } : { ok: false, reason: 'date' }
}

/** 숫자 칸 — 끝의 %·자릿수 쉼표·공백은 걷는다. 빈 칸은 null. 지수·16진 꼴은 숫자로 읽지 않는다(Number 가 받아 주는 꼴이 전부 사람의 숫자는 아니다) */
export function parseNumberCell(raw: string): CellParse<number | null> {
  const s = raw.trim().replace(/%$/, '').replace(/[,\s]/g, '')
  if (s === '') return raw.trim() === '' ? { ok: true, value: null } : { ok: false, reason: 'number' }
  return /^-?\d+(\.\d+)?$/.test(s) ? { ok: true, value: Number(s) } : { ok: false, reason: 'number' }
}

const TRUE_WORDS = ['true', '1', 'y', 'yes']
const FALSE_WORDS = ['false', '0', 'n', 'no']

/** 사용자 정의 필드 칸의 글자 → 값(유형별). undefined = 비움(키를 지운다). 값의 규칙(길이·범위·선택지 활성)은 행 검증(validateCustomValues)이 본다 */
export function parseCustomCell(def: FieldDef, raw: string, bool: { yes: string; no: string }): CellParse<FieldValue | undefined> {
  const s = raw.trim()
  if (s === '') return { ok: true, value: undefined }
  switch (def.type) {
    case 'number': {
      const unit = def.limits?.unit
      const n = parseNumberCell(unit && s.endsWith(unit) ? s.slice(0, -unit.length) : s)
      if (!n.ok) return n
      return n.value === null ? { ok: false, reason: 'number' } : { ok: true, value: n.value }   // 단위만 있고 숫자가 없다
    }
    case 'date': {
      const d = parseDateCell(s)
      return d.ok ? { ok: true, value: d.value ?? undefined } : d
    }
    case 'boolean': {
      const low = s.toLowerCase()
      if (low === bool.yes.toLowerCase() || TRUE_WORDS.includes(low)) return { ok: true, value: true }
      if (low === bool.no.toLowerCase() || FALSE_WORDS.includes(low)) return { ok: true, value: false }
      return { ok: false, reason: { field: 'type' } }
    }
    case 'select': {
      const options = def.options ?? []
      const hit = options.find(o => o.code === s) ?? options.find(o => o.label === s) ?? options.find(o => o.label.toLowerCase() === s.toLowerCase())
      return hit ? { ok: true, value: hit.code } : { ok: false, reason: { field: 'option' } }
    }
    // 한 줄 글자. 여러 줄·다중 선택은 셀에서 고치지 않는 유형이라 여기까지 오지 않는다(편집 가능 판정에서 걸린다) — 와도 글자 그대로 넘겨 행 검증이 가린다
    default: return { ok: true, value: s }
  }
}

/* ── 붙여넣기·지우기: 계획 ── */

/** 쓰지 않고 건너뛴 사유 — readonly 읽기 전용 열·필드, workflow 흐름 열(RPC 전용), denied 권한 없음, rollup 하위에서 계산되는 실적 */
export type RangeSkipReason = 'readonly' | 'workflow' | 'denied' | 'rollup'
/** 값이 맞지 않는 사유. field = 사용자 정의 필드의 검증 코드(화면의 필드 오류 문구와 같은 표) */
export type RangeInvalidReason = 'date' | 'dateOrder' | 'number' | 'range' | 'weightMin' | 'required' | 'length' | { field: FieldRowError }

/** 한 칸의 쓰기 — 값과 "화면이 본 값"(expected)을 함께 든다. 저장은 expected 가 서버와 같을 때만 반영된다(개정 §5.8 — 무통보 덮어쓰기 0건) */
export type RangeWrite =
  | { kind: 'deliverable'; rowId: string; col: 'deliverable'; value: string | null; expected: string | null }
  | { kind: 'date'; rowId: string; col: 'pstart' | 'pend'; value: string | null; expected: string | null }
  | { kind: 'weight'; rowId: string; col: 'weight'; value: number | null; expected: number | null }
  | { kind: 'actual'; rowId: string; col: 'pactual'; value: number; expected: number }
  /** expected = 그 행의 custom 전체(행 단위 CAS — 셀 편집기·상세 패널과 같은 길) */
  | { kind: 'custom'; rowId: string; col: string; key: string; value: FieldValue | undefined; expected: CustomValues }

export interface RangePlan {
  writes: RangeWrite[]
  /** 이미 같은 값 — 쓰지 않는다 */
  unchanged: number
  skipped: { rowId: string; col: string; reason: RangeSkipReason }[]
  invalid: { rowId: string; col: string; raw: string; reason: RangeInvalidReason }[]
  /** 표 아래로 넘쳐 버린 줄 수 · 오른쪽으로 넘쳐 버린 열 수(가장 긴 줄 기준) */
  clippedRows: number
  clippedCols: number
  /** 실제로 덮은 직사각형(붙여넣은 뒤 범위로 보인다). 한 칸도 들어가지 못했으면 null */
  rect: RangeRect | null
}

/**
 * 편집 가능 판정의 재료 — 화면이 지금 인라인 편집·대량 작업에 쓰는 판정을 그대로 넘긴다(여기서 새 규칙을 만들지 않는다):
 * weight = canEditWeight ∧ ¬조회 전용, dates = 프로젝트 관리자(대량 작업 바·상세 패널의 조건), actual = canEditActual(행),
 * deliverable = canEditDeliverable(행), custom = 관리자 ∨ canEditDeliverable(행)(사용자 정의 필드 칸의 canEdit), cellField = cellEditableField.
 */
export interface RangePerms {
  weight: boolean
  dates: boolean
  actual: (rowId: string) => boolean
  deliverable: (rowId: string) => boolean
  custom: (rowId: string) => boolean
  /** 그 엔티티의 필드 정의 전부(행 전체 검증에 쓴다) */
  customDefs: readonly FieldDef[]
  /** 시트 셀에서 고칠 수 있는 필드인가 — 활성·멤버 편집·한 줄 유형 */
  cellField: (def: FieldDef) => boolean
  /** 필드 범위의 관리자 여부(validateCustomValues 의 canAdmin) */
  canAdminFields: boolean
  bool: { yes: string; no: string }
}

/** 산출물 길이 상한 — 일괄 저장 액션(wbsBulk)의 값 상한과 같다 */
export const DELIVERABLE_MAX = 4000
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/**
 * 글자 격자를 기준 칸(왼쪽 위)부터 덮는 계획. 칸마다 — 쓸 수 없는 칸은 건너뛰고(사유), 값이 맞지 않는 칸은 그 칸만 빼고(사유), 이미 같은 값은
 * 쓰지 않고, 표 밖으로 넘친 줄·열은 잘라 센다. 빈 글자는 "비움"이다 — 비울 수 없는 칸(실적%·필수 필드)은 값이 맞지 않는 칸으로 남는다.
 * 줄마다 길이가 달라도 된다(짧은 줄의 뒤 칸은 건드리지 않는다).
 */
export function planCellWrites(
  m: GridModel, anchor: GridCoord, matrix: readonly (readonly string[])[], rowOf: (rowId: string) => RangeItem | undefined, perms: RangePerms,
): RangePlan {
  const plan: RangePlan = { writes: [], unchanged: 0, skipped: [], invalid: [], clippedRows: 0, clippedCols: 0, rect: null }
  const r0 = m.rowIndex.get(anchor.rowId)
  const c0 = m.colIndex.get(anchor.col)
  if (r0 === undefined || c0 === undefined || matrix.length === 0) return plan
  const width = matrix.reduce((w, line) => Math.max(w, line.length), 0)
  const rowsFit = Math.min(matrix.length, m.rows.length - r0)
  const colsFit = Math.min(width, m.cols.length - c0)
  plan.clippedRows = matrix.length - rowsFit
  plan.clippedCols = width - colsFit
  if (rowsFit < 1 || colsFit < 1) return plan
  plan.rect = { top: r0, bottom: r0 + rowsFit - 1, left: c0, right: c0 + colsFit - 1 }
  const defByKey = new Map(perms.customDefs.map(d => [d.key, d]))

  for (let i = 0; i < rowsFit; i++) {
    const rowId = m.rows[r0 + i].id
    const row = rowOf(rowId)
    const line = matrix[i]
    const dates: Extract<RangeWrite, { kind: 'date' }>[] = []
    const customs: { col: string; key: string; raw: string; value: FieldValue | undefined }[] = []
    for (let j = 0; j < Math.min(line.length, colsFit); j++) {
      const col = m.cols[c0 + j]
      const raw = line[j]
      const skip = (reason: RangeSkipReason) => { plan.skipped.push({ rowId, col, reason }) }
      const bad = (reason: RangeInvalidReason) => { plan.invalid.push({ rowId, col, raw, reason }) }
      if (!row) { skip('readonly'); continue }
      if (col === 'stage') { skip('workflow'); continue }
      if (col === 'deliverable') {
        if (!perms.deliverable(rowId)) { skip('denied'); continue }
        const value = raw.trim() || null
        if (value !== null && value.length > DELIVERABLE_MAX) { bad('length'); continue }
        if (value === row.deliverable) plan.unchanged++
        else plan.writes.push({ kind: 'deliverable', rowId, col, value, expected: row.deliverable })
      } else if (col === 'pstart' || col === 'pend') {
        if (!perms.dates) { skip('denied'); continue }
        const d = parseDateCell(raw)
        if (!d.ok) { bad(d.reason); continue }
        const expected = col === 'pstart' ? row.plannedStart : row.plannedEnd
        if (d.value === expected) plan.unchanged++
        else dates.push({ kind: 'date', rowId, col, value: d.value, expected })
      } else if (col === 'weight') {
        if (!perms.weight) { skip('denied'); continue }
        const n = parseNumberCell(raw)
        if (!n.ok) { bad(n.reason); continue }
        if (n.value !== null && weightViolation(n.value)) { bad('weightMin'); continue }
        // 화면 값(100 기준 2자리)과 같으면 쓰지 않는다 — %↔분수 왕복의 반올림값을 다시 저장하지 않는다(편집기의 무변경 판정과 같다)
        const shown = row.weight == null ? null : weightToPct(row.weight)
        if (n.value === shown) plan.unchanged++
        else plan.writes.push({ kind: 'weight', rowId, col, value: n.value === null ? null : weightPctToFraction(n.value), expected: row.weight })
      } else if (col === 'pactual') {
        if (row.children.length > 0) { skip('rollup'); continue }
        if (!perms.actual(rowId)) { skip('denied'); continue }
        const n = parseNumberCell(raw)
        if (!n.ok) { bad(n.reason); continue }
        if (n.value === null) { bad('required'); continue }   // 실적%는 비울 수 없다(편집기도 빈 값을 받지 않는다)
        if (actualPctViolation(n.value)) { bad('range'); continue }
        if (n.value === Number(row.rolledActualPct)) plan.unchanged++
        else plan.writes.push({ kind: 'actual', rowId, col, value: n.value, expected: Number(row.rolledActualPct) })
      } else if (col.startsWith('cf:')) {
        const def = defByKey.get(col.slice(3))
        if (!def || !perms.cellField(def) || !row.custom) { skip('readonly'); continue }
        if (!perms.custom(rowId)) { skip('denied'); continue }
        const v = parseCustomCell(def, raw, perms.bool)
        if (!v.ok) { bad(v.reason); continue }
        if (same(v.value, row.custom[def.key])) plan.unchanged++
        else customs.push({ col, key: def.key, raw, value: v.value })
      } else {
        skip('readonly')   // 식별 열·담당팀·담당자·진척·계획%·계획대비 — 표에서 값으로 쓰지 않는 열
      }
    }
    // 시작일 > 종료일 — 이 행에 쓰려는 날짜와 그대로 둘 날짜를 합쳐 본다. 어긋나면 그 행의 날짜 칸을 둘 다 쓰지 않는다(서버도 같은 판정으로 거부한다)
    if (dates.length && row) {
      const start = dates.find(d => d.col === 'pstart')?.value ?? (dates.some(d => d.col === 'pstart') ? null : row.plannedStart)
      const end = dates.find(d => d.col === 'pend')?.value ?? (dates.some(d => d.col === 'pend') ? null : row.plannedEnd)
      if (start && end && start > end) for (const d of dates) plan.invalid.push({ rowId, col: d.col, raw: d.value ?? '', reason: 'dateOrder' })
      else plan.writes.push(...dates)
    }
    // 사용자 정의 필드는 행 전체로 검증한다(저장이 행 custom 전체의 CAS 다) — 서버(saveCustomFieldValues)와 같은 검증 함수
    if (customs.length && row?.custom) {
      const next: CustomValues = { ...row.custom }
      for (const c of customs) { if (c.value === undefined) delete next[c.key]; else next[c.key] = c.value }
      const checked = validateCustomValues(perms.customDefs, next, row.custom, perms.canAdminFields)
      if (checked.ok) {
        for (const c of customs) plan.writes.push({ kind: 'custom', rowId, col: c.col, key: c.key, value: c.value, expected: row.custom })
      } else {
        // 내 칸의 오류면 그 칸만, 내 칸 밖의 오류(그 행의 다른 필드가 이미 규칙에 어긋나 있다)면 행이 통째로 저장되지 않으므로 그 행의 칸 전부
        const mine = customs.filter(c => checked.errors[c.key] !== undefined)
        const fallback = Object.values(checked.errors)[0]
        for (const c of mine.length ? mine : customs) plan.invalid.push({ rowId, col: c.col, raw: c.raw, reason: { field: checked.errors[c.key] ?? fallback } })
        if (mine.length && mine.length < customs.length) {
          // 틀린 칸을 뺀 나머지만으로 다시 본다 — 한 칸의 잘못이 같은 행의 맞는 칸을 막지 않게
          const rest = customs.filter(c => !mine.includes(c))
          const retry: CustomValues = { ...row.custom }
          for (const c of rest) { if (c.value === undefined) delete retry[c.key]; else retry[c.key] = c.value }
          const again = validateCustomValues(perms.customDefs, retry, row.custom, perms.canAdminFields)
          for (const c of rest) {
            if (again.ok) plan.writes.push({ kind: 'custom', rowId, col: c.col, key: c.key, value: c.value, expected: row.custom })
            else plan.invalid.push({ rowId, col: c.col, raw: c.raw, reason: { field: again.errors[c.key] ?? Object.values(again.errors)[0] } })
          }
        }
      }
    }
  }
  return plan
}

/** 직사각형의 칸을 비우는 계획 — 빈 글자를 붙여넣는 것과 같다(비울 수 있는 칸의 규칙이 한 벌이다) */
export function planCellClear(m: GridModel, rect: RangeRect, rowOf: (rowId: string) => RangeItem | undefined, perms: RangePerms): RangePlan {
  const { rows, cols } = rectSize(rect)
  const blank = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ''))
  return planCellWrites(m, { rowId: m.rows[rect.top].id, col: m.cols[rect.left] }, blank, rowOf, perms)
}
