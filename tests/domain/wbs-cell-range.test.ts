// WBS 표의 셀 범위(직사각형) — 순수 계산. 개정 §5.9.2: Shift+방향키 = 범위(행 체크 선택과 다른 상태), §5.8: 붙여넣기·지우기는 칸마다
// 쓸 수 있는지·값이 맞는지를 가려 쓸 칸만 남긴다(편집 불가·값 오류·표 밖은 사유와 함께 빠진다).
import { describe, expect, it } from 'vitest'
import { gridModel, type GridModel } from '@/lib/domain/wbsGridNav'
import {
  cellCopyText, clickCellRange, extendCellRange, parseCustomCell, parseDateCell, parseNumberCell, planCellClear, planCellWrites, rangeMatrix,
  rangeRect, rectChanges, rectSize, singleRect, type CellRange, type CopyLabels, type RangeItem, type RangePerms,
} from '@/lib/domain/wbsCellRange'
import { parseTsv, serializeTsv } from '@/lib/domain/sheetClipboard'
import type { FieldDef } from '@/lib/domain/customFields'

const COLS = ['no', 'name', 'owners', 'deliverable', 'pstart', 'pend', 'weight', 'pactual', 'cf:qty', 'cf:kind']
const model = (rows: string[], cols = COLS): GridModel =>
  gridModel(rows.map(id => ({ id, parentId: null, expandable: false, expanded: true })), cols, 'name')
const M = model(['a', 'b', 'c', 'd'])
const at = (rowId: string, col: string) => ({ rowId, col })

const QTY = { key: 'qty', label: '수량', description: '', type: 'number', required: false, editable_by: 'member', show_in_list: true, searchable: false, sort: 0, active: true, limits: { decimals: 1, max: 100, unit: 'kg' } } as FieldDef
const KIND = { ...QTY, key: 'kind', label: '종류', type: 'select', sort: 1, limits: undefined, options: [{ code: 'a', label: '가', sort: 0, active: true }, { code: 'b', label: '나', sort: 1, active: true }] } as FieldDef
const MUST = { ...QTY, key: 'must', label: '필수', type: 'text', sort: 2, required: true, default: 'x', limits: undefined } as FieldDef
const ADMIN_ONLY = { ...QTY, key: 'adm', label: '관리', type: 'text', sort: 3, editable_by: 'admin', limits: undefined } as FieldDef

function row(over: Partial<RangeItem> & { id: string }): RangeItem {
  return { name: over.id, children: [], deliverable: null, plannedStart: '2026-07-01', plannedEnd: '2026-07-10', weight: null, plannedPct: 0, rolledActualPct: 0, achievement: null, custom: {}, ...over }
}
const perms = (over: Partial<RangePerms> = {}): RangePerms => ({
  weight: true, dates: true, actual: () => true, deliverable: () => true, custom: () => true,
  customDefs: [QTY, KIND], cellField: d => d.active && d.editable_by === 'member' && d.type !== 'multiline' && d.type !== 'multiselect',
  canAdminFields: false, bool: { yes: '예', no: '아니오' }, ...over,
})
const rowsById = (rows: RangeItem[]) => (id: string) => rows.find(r => r.id === id)

describe('직사각형 — 기준 칸과 끝 칸', () => {
  it('두 칸 사이의 보이는 행·열 — 어느 방향으로 잡아도 같은 직사각형', () => {
    const r = rangeRect(M, { anchor: at('c', 'weight'), head: at('a', 'deliverable') })
    expect(r).toEqual({ top: 0, bottom: 2, left: 3, right: 6 })
    expect(rectSize(r!)).toEqual({ rows: 3, cols: 4 })
    expect(rangeRect(M, { anchor: at('a', 'deliverable'), head: at('c', 'weight') })).toEqual(r)
  })

  it('끝 칸이 보이지 않게 되면(행이 접힘·열이 숨김) 범위는 풀린다 — 다른 칸으로 옮겨 잇지 않는다', () => {
    const range: CellRange = { anchor: at('a', 'deliverable'), head: at('c', 'weight') }
    expect(rangeRect(model(['a', 'b', 'd']), range)).toBeNull()                       // 끝 행이 사라짐
    expect(rangeRect(model(['a', 'b', 'c'], COLS.filter(c => c !== 'weight')), range)).toBeNull()   // 끝 열이 숨김
    expect(rangeRect(M, null)).toBeNull()
  })

  it('사이의 행이 접히거나 열이 숨겨지면 그 칸만 범위에서 빠진다(보이는 칸만)', () => {
    const range: CellRange = { anchor: at('a', 'deliverable'), head: at('d', 'weight') }
    const fewer = model(['a', 'd'], COLS.filter(c => c !== 'pstart'))
    const rect = rangeRect(fewer, range)!
    expect(rectSize(rect)).toEqual({ rows: 2, cols: 3 })
    expect(rangeMatrix(fewer, rect, (r, c) => `${r}:${c}`)).toEqual([
      ['a:deliverable', 'a:pend', 'a:weight'], ['d:deliverable', 'd:pend', 'd:weight'],
    ])
  })

  it('식별 열(번호·개요·작업명)은 셀 범위가 아니다', () => {
    expect(rangeRect(M, { anchor: at('a', 'name'), head: at('b', 'weight') })).toBeNull()
    expect(extendCellRange(M, null, at('a', 'name'), 'ArrowDown')).toBeNull()
    expect(clickCellRange(M, null, at('a', 'weight'), at('b', 'name'))).toBeNull()
  })
})

describe('Shift+방향키 — 늘림·줄임·경계', () => {
  it('처음 누르면 지금 칸이 기준이 되고 한 칸 늘어난다', () => {
    expect(extendCellRange(M, null, at('b', 'pstart'), 'ArrowRight')).toEqual({ anchor: at('b', 'pstart'), head: at('b', 'pend') })
    expect(extendCellRange(M, null, at('b', 'pstart'), 'ArrowDown')).toEqual({ anchor: at('b', 'pstart'), head: at('c', 'pstart') })
  })

  it('끝 칸에서 이어 누르면 기준은 그대로 — 반대 방향은 줄이고, 기준을 지나면 반대쪽으로 늘어난다', () => {
    let r = extendCellRange(M, null, at('b', 'pstart'), 'ArrowDown')!
    r = extendCellRange(M, r, r.head, 'ArrowDown')!
    expect(rectSize(rangeRect(M, r)!)).toEqual({ rows: 3, cols: 1 })
    r = extendCellRange(M, r, r.head, 'ArrowUp')!
    r = extendCellRange(M, r, r.head, 'ArrowUp')!
    expect(r).toEqual({ anchor: at('b', 'pstart'), head: at('b', 'pstart') })   // 한 칸으로 줄었다 — 범위는 남는다
    r = extendCellRange(M, r, r.head, 'ArrowUp')!
    expect(rangeRect(M, r)).toEqual({ top: 0, bottom: 1, left: 4, right: 4 })
  })

  it('포커스가 다른 길로 옮겨 갔으면(끝 칸 ≠ 지금 칸) 지금 칸에서 새로 시작한다', () => {
    const old: CellRange = { anchor: at('a', 'pstart'), head: at('b', 'pend') }
    expect(extendCellRange(M, old, at('d', 'weight'), 'ArrowLeft')).toEqual({ anchor: at('d', 'weight'), head: at('d', 'pend') })
  })

  it('표의 끝과 식별 열 경계에서는 제자리 — 왼쪽으로는 첫 데이터 열에서 멈춘다', () => {
    expect(extendCellRange(M, null, at('a', 'owners'), 'ArrowLeft')).toEqual({ anchor: at('a', 'owners'), head: at('a', 'owners') })
    expect(extendCellRange(M, null, at('a', 'owners'), 'ArrowUp')!.head).toEqual(at('a', 'owners'))
    expect(extendCellRange(M, null, at('d', 'cf:kind'), 'ArrowRight')!.head).toEqual(at('d', 'cf:kind'))
    expect(extendCellRange(M, null, at('d', 'cf:kind'), 'ArrowDown')!.head).toEqual(at('d', 'cf:kind'))
    expect(extendCellRange(M, null, at('a', 'owners'), 'Enter')).toBeNull()
  })

  it('Shift+클릭 — 살아 있는 범위의 기준, 없으면 포커스 칸, 그것도 없으면(식별 열에 있었다) 그 칸 하나', () => {
    const range: CellRange = { anchor: at('a', 'pstart'), head: at('b', 'pend') }
    expect(clickCellRange(M, range, at('b', 'pend'), at('d', 'weight'))).toEqual({ anchor: at('a', 'pstart'), head: at('d', 'weight') })
    expect(clickCellRange(M, null, at('b', 'pend'), at('d', 'weight'))).toEqual({ anchor: at('b', 'pend'), head: at('d', 'weight') })
    expect(clickCellRange(M, null, at('b', 'name'), at('d', 'weight'))).toEqual({ anchor: at('d', 'weight'), head: at('d', 'weight') })
    expect(clickCellRange(M, null, null, at('zz', 'weight'))).toBeNull()
  })

  it('한 칸 늘릴 때 표시를 바꿀 칸은 새 줄뿐이다 — 범위 전체를 다시 칠하지 않는다', () => {
    const a = { top: 0, bottom: 1, left: 3, right: 5 }
    expect(rectChanges(a, { ...a, bottom: 2 })).toEqual([3, 4, 5].map(col => ({ row: 2, col, on: true })))
    expect(rectChanges({ ...a, bottom: 2 }, a)).toEqual([3, 4, 5].map(col => ({ row: 2, col, on: false })))
    expect(rectChanges(a, a)).toEqual([])
    expect(rectChanges(null, { top: 1, bottom: 1, left: 3, right: 3 })).toEqual([{ row: 1, col: 3, on: true }])
    expect(rectChanges(a, null)).toHaveLength(6)
    expect(rectChanges(null, null)).toEqual([])
  })
})

describe('복사 — 칸의 글자와 TSV', () => {
  const labels: CopyLabels<RangeItem> = {
    rowNo: () => '1', outline: () => '1.1', owners: () => '기획팀, 개발팀', assignee: () => '', status: () => '진행중', stage: () => 'IP',
    fieldDef: key => [QTY, KIND].find(d => d.key === key), bool: { yes: '예', no: '아니오' },
  }

  it('날짜는 YYYY-MM-DD, 퍼센트는 숫자+%, 빈 값은 빈 칸(화면의 - · 균등 이 아니다)', () => {
    const n = row({ id: 'a', deliverable: '설계서', weight: 0.125, rolledActualPct: 33.33, plannedPct: 66.66, achievement: 50, custom: { qty: 1234.5, kind: 'b' } })
    expect(['no', 'name', 'owners', 'assignee', 'status', 'stage', 'deliverable', 'pstart', 'pend', 'weight', 'pplan', 'pactual', 'achieve', 'cf:qty', 'cf:kind', 'cf:none', 'gantt']
      .map(c => cellCopyText(n, c, labels)))
      .toEqual(['1', 'a', '기획팀, 개발팀', '', '진행중', 'IP', '설계서', '2026-07-01', '2026-07-10', '12.5%', '66.7%', '33.33%', '50%', '1234.5', '나', '', ''])
    const empty = row({ id: 'e', plannedStart: null, plannedEnd: null, custom: null })
    expect(['deliverable', 'pstart', 'weight', 'achieve', 'cf:qty'].map(c => cellCopyText(empty, c, labels))).toEqual(['', '', '', '', ''])
  })

  it('부모의 실적%는 화면처럼 소수 1자리, 잎은 저장값 그대로(되붙여도 값이 바뀌지 않는다)', () => {
    expect(cellCopyText(row({ id: 'p', children: [{}], rolledActualPct: 33.3333 }), 'pactual', labels)).toBe('33.3%')
    expect(cellCopyText(row({ id: 'l', rolledActualPct: 33.33 }), 'pactual', labels)).toBe('33.33%')
  })

  it('TSV 왕복 — 탭·줄바꿈·따옴표가 든 칸과 빈 칸이 그대로 돌아온다', () => {
    const cells = [['보고서 "초안"', '', '2026-07-01'], ['두 줄\n산출물', '탭\t포함', '']]
    const tsv = serializeTsv(cells)
    expect(tsv).toBe('"보고서 ""초안"""\t\t2026-07-01\n"두 줄\n산출물"\t"탭\t포함"\t')
    expect(parseTsv(tsv)).toEqual(cells)
    expect(parseTsv('a\tb\r\nc\td\r\n')).toEqual([['a', 'b'], ['c', 'd']])   // 엑셀의 줄 끝·마지막 줄바꿈
  })

  it('한 칸 복사 — 범위가 없으면 그 칸 하나(식별 열도 된다)', () => {
    expect(singleRect(M, at('b', 'name'))).toEqual({ top: 1, bottom: 1, left: 1, right: 1 })
    expect(singleRect(M, at('zz', 'name'))).toBeNull()
  })
})

describe('값 읽기', () => {
  it('날짜 — ISO·점·빗금·화면 표기(YY.MM.DD), 빈 칸과 - 는 비움, 달력에 없는 날은 거부', () => {
    expect(parseDateCell('2026-07-01')).toEqual({ ok: true, value: '2026-07-01' })
    expect(parseDateCell(' 2026.7.1 ')).toEqual({ ok: true, value: '2026-07-01' })
    expect(parseDateCell('2026/07/01')).toEqual({ ok: true, value: '2026-07-01' })
    expect(parseDateCell('26.07.01')).toEqual({ ok: true, value: '2026-07-01' })
    expect(parseDateCell('')).toEqual({ ok: true, value: null })
    expect(parseDateCell('-')).toEqual({ ok: true, value: null })
    for (const bad of ['2026-02-30', '7/1/2026', '내일', '20260701', '2026-13-01']) expect(parseDateCell(bad)).toEqual({ ok: false, reason: 'date' })
  })

  it('숫자 — % · 쉼표를 걷는다. 지수·16진·글자는 숫자가 아니다', () => {
    expect(parseNumberCell('12.5%')).toEqual({ ok: true, value: 12.5 })
    expect(parseNumberCell(' 1,234 ')).toEqual({ ok: true, value: 1234 })
    expect(parseNumberCell('')).toEqual({ ok: true, value: null })
    for (const bad of ['1e3', '0x10', '균등', '%', '1.2.3']) expect(parseNumberCell(bad)).toEqual({ ok: false, reason: 'number' })
  })

  it('사용자 정의 필드 — 유형별(숫자의 단위·선택의 이름과 코드·예/아니오)', () => {
    const bool = { yes: '예', no: '아니오' }
    expect(parseCustomCell(QTY, '12.5 kg', bool)).toEqual({ ok: true, value: 12.5 })
    expect(parseCustomCell(QTY, 'kg', bool)).toEqual({ ok: false, reason: 'number' })
    expect(parseCustomCell(QTY, '', bool)).toEqual({ ok: true, value: undefined })
    expect(parseCustomCell(KIND, '나', bool)).toEqual({ ok: true, value: 'b' })
    expect(parseCustomCell(KIND, 'a', bool)).toEqual({ ok: true, value: 'a' })
    expect(parseCustomCell(KIND, '다', bool)).toEqual({ ok: false, reason: { field: 'option' } })
    const FLAG = { ...QTY, key: 'flag', type: 'boolean', limits: undefined } as FieldDef
    expect(parseCustomCell(FLAG, '예', bool)).toEqual({ ok: true, value: true })
    expect(parseCustomCell(FLAG, 'FALSE', bool)).toEqual({ ok: true, value: false })
    expect(parseCustomCell(FLAG, '글쎄', bool)).toEqual({ ok: false, reason: { field: 'type' } })
    const DAY = { ...QTY, key: 'day', type: 'date', limits: undefined } as FieldDef
    expect(parseCustomCell(DAY, '26.07.01', bool)).toEqual({ ok: true, value: '2026-07-01' })
  })
})

describe('붙여넣기 계획 — 칸마다 가린다', () => {
  const rows = [
    row({ id: 'a', deliverable: '옛 산출물', weight: 0.4, rolledActualPct: 10, custom: { qty: 1 } }),
    row({ id: 'b', children: [{}], rolledActualPct: 50 }),
    row({ id: 'c' }),
    row({ id: 'd', custom: null }),
  ]
  const plan = (anchor: { rowId: string; col: string }, tsv: string, p = perms()) => planCellWrites(M, anchor, parseTsv(tsv), rowsById(rows), p)

  it('쓸 칸에는 값과 화면이 본 값(expected)이 함께 실린다', () => {
    const p = plan(at('a', 'deliverable'), '새 산출물\t2026-07-02\t26.07.20\t50%\t80%\t2.5\t나')
    expect(p.writes).toEqual([
      { kind: 'deliverable', rowId: 'a', col: 'deliverable', value: '새 산출물', expected: '옛 산출물' },
      { kind: 'weight', rowId: 'a', col: 'weight', value: 0.5, expected: 0.4 },
      { kind: 'actual', rowId: 'a', col: 'pactual', value: 80, expected: 10 },
      { kind: 'date', rowId: 'a', col: 'pstart', value: '2026-07-02', expected: '2026-07-01' },
      { kind: 'date', rowId: 'a', col: 'pend', value: '2026-07-20', expected: '2026-07-10' },
      { kind: 'custom', rowId: 'a', col: 'cf:qty', key: 'qty', value: 2.5, expected: { qty: 1 } },
      { kind: 'custom', rowId: 'a', col: 'cf:kind', key: 'kind', value: 'b', expected: { qty: 1 } },
    ])
    expect([p.unchanged, p.skipped, p.invalid, p.clippedRows, p.clippedCols]).toEqual([0, [], [], 0, 0])
    expect(p.rect).toEqual({ top: 0, bottom: 0, left: 3, right: 9 })
  })

  it('이미 같은 값은 쓰지 않는다 — 가중치는 화면 값(100 기준)으로 견준다', () => {
    const p = plan(at('a', 'deliverable'), '옛 산출물\t2026-07-01\t2026-07-10\t40%\t10\t1')
    expect(p.writes).toEqual([])
    expect(p.unchanged).toBe(6)
  })

  it('편집할 수 없는 칸은 사유와 함께 건너뛴다 — 읽기 전용 열·흐름 열·롤업 부모의 실적·권한 없음·손상된 필드 값', () => {
    const withStage = model(['a', 'b', 'c', 'd'], ['no', 'name', 'owners', 'stage', 'pactual', 'cf:qty', 'cf:adm'])
    const p = planCellWrites(withStage, at('b', 'owners'), parseTsv('팀\tXX\t70\t3\t메모\n팀\tXX\t70\t3\n팀\tXX\t70\t3'), rowsById(rows),
      perms({ customDefs: [QTY, ADMIN_ONLY], actual: id => id !== 'c' }))
    expect(p.skipped).toEqual([
      { rowId: 'b', col: 'owners', reason: 'readonly' }, { rowId: 'b', col: 'stage', reason: 'workflow' }, { rowId: 'b', col: 'pactual', reason: 'rollup' },
      { rowId: 'b', col: 'cf:adm', reason: 'readonly' },   // 관리자 전용 필드는 셀에서 고치지 않는다
      { rowId: 'c', col: 'owners', reason: 'readonly' }, { rowId: 'c', col: 'stage', reason: 'workflow' }, { rowId: 'c', col: 'pactual', reason: 'denied' },
      { rowId: 'd', col: 'owners', reason: 'readonly' }, { rowId: 'd', col: 'stage', reason: 'workflow' },
      { rowId: 'd', col: 'cf:qty', reason: 'readonly' },   // 저장값을 읽지 못한 행
    ])
    expect(p.writes.map(w => `${w.rowId}:${w.col}`)).toEqual(['b:cf:qty', 'c:cf:qty', 'd:pactual'])
  })

  it('권한이 없으면 가중치·계획일·산출물·필드가 전부 건너뛰어진다', () => {
    const p = plan(at('c', 'deliverable'), 'x\t2026-07-02\t2026-07-03\t10\t20\t3',
      perms({ weight: false, dates: false, actual: () => false, deliverable: () => false, custom: () => false }))
    expect(p.writes).toEqual([])
    expect(p.skipped.map(s => s.reason)).toEqual(['denied', 'denied', 'denied', 'denied', 'denied', 'denied'])
  })

  it('값이 맞지 않는 칸은 그 칸만 빠지고 같은 행의 나머지는 쓴다', () => {
    const p = plan(at('c', 'deliverable'), '산출물\t내일\t2026-07-12\t-5\t101\t7.25\t다')
    expect(p.invalid.map(i => [i.col, i.raw, i.reason])).toEqual([
      ['pstart', '내일', 'date'], ['weight', '-5', 'weightMin'], ['pactual', '101', 'range'],
      ['cf:kind', '다', { field: 'option' }], ['cf:qty', '7.25', { field: 'decimals' }],
    ])
    expect(p.writes.map(w => w.col)).toEqual(['deliverable', 'pend'])
  })

  it('한 행의 필드 칸 가운데 틀린 것만 빠진다 — 맞는 칸은 그 행에 쓴다', () => {
    const p = plan(at('c', 'cf:qty'), '500\t나')
    expect(p.invalid).toEqual([{ rowId: 'c', col: 'cf:qty', raw: '500', reason: { field: 'range' } }])
    expect(p.writes).toEqual([{ kind: 'custom', rowId: 'c', col: 'cf:kind', key: 'kind', value: 'b', expected: {} }])
  })

  it('시작일이 종료일보다 늦어지는 행은 날짜 칸을 쓰지 않는다 — 그대로 둘 날짜와 합쳐 본다', () => {
    expect(plan(at('c', 'pstart'), '2026-08-01').invalid).toEqual([{ rowId: 'c', col: 'pstart', raw: '2026-08-01', reason: 'dateOrder' }])
    expect(plan(at('c', 'pstart'), '2026-08-01\t2026-08-05').writes).toHaveLength(2)
    expect(plan(at('c', 'pstart'), '2026-08-01\t').writes.map(w => w.col)).toEqual(['pstart', 'pend'])   // 종료일을 비우면 어긋날 것이 없다
  })

  it('표 밖으로 넘친 줄·열은 잘라 센다. 줄마다 길이가 달라도 된다', () => {
    const p = plan(at('c', 'cf:qty'), '1\t나\t넘침\n2\n3\n4')
    expect([p.clippedRows, p.clippedCols]).toEqual([2, 1])
    expect(p.rect).toEqual({ top: 2, bottom: 3, left: 8, right: 9 })
    expect(p.writes.map(w => `${w.rowId}:${w.col}`)).toEqual(['c:cf:qty', 'c:cf:kind'])   // d 는 필드 값이 손상된 행
    expect(p.skipped).toEqual([{ rowId: 'd', col: 'cf:qty', reason: 'readonly' }])
  })

  it('보이지 않는 기준 칸·빈 글자는 아무 계획도 만들지 않는다', () => {
    expect(plan(at('zz', 'weight'), '1').rect).toBeNull()
    expect(planCellWrites(M, at('a', 'weight'), [], rowsById(rows), perms()).writes).toEqual([])
  })
})

describe('지우기 계획 — 빈 값이 허용되는 칸만', () => {
  const rows = [
    row({ id: 'a', deliverable: '산출물', weight: 0.4, rolledActualPct: 10, custom: { qty: 1, must: '값' } }),
    row({ id: 'b', deliverable: null, weight: null, plannedStart: null, plannedEnd: null, custom: { must: '값' } }),
  ]
  const m = model(['a', 'b'], ['no', 'name', 'deliverable', 'pstart', 'pend', 'weight', 'pactual', 'cf:qty', 'cf:must'])

  it('산출물·계획일·가중치·선택 필드는 비우고, 실적%와 필수 필드는 비울 수 없는 칸으로 남는다. 이미 빈 칸은 쓰지 않는다', () => {
    const p = planCellClear(m, { top: 0, bottom: 1, left: 2, right: 8 }, rowsById(rows), perms({ customDefs: [QTY, MUST] }))
    expect(p.writes).toEqual([
      { kind: 'deliverable', rowId: 'a', col: 'deliverable', value: null, expected: '산출물' },
      { kind: 'weight', rowId: 'a', col: 'weight', value: null, expected: 0.4 },
      { kind: 'date', rowId: 'a', col: 'pstart', value: null, expected: '2026-07-01' },
      { kind: 'date', rowId: 'a', col: 'pend', value: null, expected: '2026-07-10' },
      { kind: 'custom', rowId: 'a', col: 'cf:qty', key: 'qty', value: undefined, expected: { qty: 1, must: '값' } },
    ])
    expect(p.invalid.map(i => [i.rowId, i.col, i.reason])).toEqual([
      ['a', 'pactual', 'required'], ['a', 'cf:must', { field: 'required' }], ['b', 'pactual', 'required'], ['b', 'cf:must', { field: 'required' }],
    ])
    expect(p.unchanged).toBe(5)   // b 의 산출물·시작·종료·가중치·수량
  })
})
