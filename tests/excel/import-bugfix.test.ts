// 사용자 테스트 버그 리포트(2026-10-10)의 엑셀 가져오기 묶음 — 파일에서 항목까지(감지 → 파싱 → 링크)의 회귀.
// 픽스처는 리포트 부록 B 의 표(머리: 단계|작업|활동|시작일|종료일|가중치|실적%|산출물|팀)를 ExcelJS 로 만든다 — 사용자가 엑셀·openpyxl 로
// 만든 파일과 같은 꼴(글자 날짜·글자 숫자)과, 엑셀에서 직접 친 꼴(날짜 칸·숫자 칸·% 서식 칸)을 둘 다 본다.
import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import * as XLSX from 'xlsx'
import { detectWorkbook, detectLevelLabelColumns, detectOutlineHierarchy, WARN_HIERARCHY_NOT_FOUND } from '@/lib/excel/detect'
import { ERR_NAME_BLANK, ERR_OUTLINE_CODE_BLANK, linkByDepth, parseWithProfile, type ParsedRowN } from '@/lib/excel/parseWithProfile'
import { NOT_XLSX_ERROR, isXlsxBuffer, readSheetRows } from '@/lib/excel/sheetRows'
import { buildWorkbookWithProfile, WEIGHT_NUMBER_FORMAT } from '@/lib/excel/exportWithProfile'
import { buildWbsTemplateWorkbook } from '@/lib/excel/template'
import type { ExcelProfile } from '@/lib/excel/profile'
import type { ComputedItem } from '@/lib/domain/types'
import { planCellWrites, type RangeItem, type RangePerms } from '@/lib/domain/wbsCellRange'
import { gridModel, type GridRow } from '@/lib/domain/wbsGridNav'
import {
  actualPctViolation, importedWeightScale, importedWeightToFraction, weightPctToFraction, weightViolation,
} from '@/lib/domain/wbsValueRules'
import { formatWeightPct } from '@/lib/domain/format'

const H = ['단계', '작업', '활동', '시작일', '종료일', '가중치', '실적%', '산출물', '팀']
const LEVELS = ['단계', '작업', '활동']
/** 부록 B 의 행(openpyxl 로 넣은 꼴 — 전부 글자) */
const APPENDIX_B: string[][] = [
  ['2. 설계', '', '', '', '', '', '', '', ''],
  ['', '2.1 화면설계', '', '2026-10-20', '2026-10-31', '50', '30', '화면설계서', '플랫폼개발팀'],
  ['', '', '2.1.1 와이어프레임', '2026-10-20', '2026-10-24', '', '60', '와이어프레임', ''],
  ['', '2.2 DB설계', '', '2026-11-01', '2026-11-15', '50', '0', 'ERD', ''],
  ['', '2.3 역전일정', '', '2026-12-31', '2026-11-01', '30', '10', '', ''],
  ['', '2.4 범위초과', '', '2026-11-01', '2026-11-10', '30', '150', '', ''],
  ['', '', '', '2026-11-01', '2026-11-10', '10', '0', '이름없는행', ''],
  ['', '2.5 가중치음수', '', '2026-11-01', '2026-11-10', '-20', '0', '', ''],
]

type Cell = string | number | Date | { value: number; numFmt: string }
/** ExcelJS 로 한 시트짜리 xlsx — 빈 글자는 칸을 만들지 않는다. { value, numFmt } 는 서식 있는 숫자 칸 */
async function book(rows: Cell[][], sheet = 'WBS'): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(sheet)
  rows.forEach((row, r) => row.forEach((v, c) => {
    if (v === '') return
    const cell = ws.getCell(r + 1, c + 1)
    if (typeof v === 'object' && !(v instanceof Date)) { cell.value = v.value; cell.numFmt = v.numFmt } else cell.value = v
  }))
  // Node 의 Buffer 는 풀(pool)의 일부일 수 있다 — 자기 구간만 복사해 ArrayBuffer 로 넘긴다
  const out = new Uint8Array(await wb.xlsx.writeBuffer() as ArrayBuffer)
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer
}
const detect = (buf: ArrayBuffer, levelLabels: readonly string[] = LEVELS) => {
  const d = detectWorkbook(buf, { levelLabels })
  if (!d.ok) throw new Error(d.error)
  return d.result
}
const parse = (buf: ArrayBuffer, profile: ExcelProfile) => {
  const p = parseWithProfile(buf, profile)
  if (!p.ok) throw new Error(p.error)
  return p
}
/** 표준 양식의 프로파일(감지 결과와 같아야 한다) */
const STANDARD: ExcelProfile = {
  version: 1, sheetName: 'WBS', holidaySheetName: null, headerRow: 0,
  hierarchy: { kind: 'columns', columns: [0, 1, 2] },
  logical: { extraAxis: null, code: null, name: null, deliverable: 7, start: 3, end: 4, weight: 5, actualPct: 6 },
  teamColumns: [[8, '*']], ownerMarks: { '●': 'primary', '△': 'support', '◎': 'primary', O: 'primary', o: 'primary' },
}

describe('BUG-07 — 표준 양식(단계|작업|활동|시작일|종료일|가중치|실적%|산출물|팀)의 자동 감지', () => {
  it('부록 B 파일 — 프로젝트의 단계 이름이 머리인 열 셋이 계층 열이고 방식은 열=계층이다(코드 열 ← 시작일이 아니다)', async () => {
    const r = detect(await book([H, ...APPENDIX_B]))
    expect(r.profile.hierarchy).toEqual({ kind: 'columns', columns: [0, 1, 2] })
    expect(r.profile.logical).toEqual(STANDARD.logical)
    expect(r.profile.teamColumns).toEqual([[8, '*']])
    expect(r.confidence.hierarchy).toBe(1)
    expect(r.uncertain).toBe(false)
    expect(r.hierarchyCandidates.columns).toEqual([0, 1, 2])
    // 열=계층에서는 '이름 열 없음' 경고가 뜻이 없다 — 내지 않는다
    expect(r.warnings.some((w) => w.includes('이름'))).toBe(false)
  })

  it('단계 이름은 프로젝트 설정값이다 — 이름이 다르면(대·중·소) 그 이름으로 찾고, 대소문자·앞뒤 공백을 무시한다', async () => {
    const rows = APPENDIX_B.slice(0, 4)
    const r = detect(await book([[' 대 ', '중', '소', ...H.slice(3)], ...rows]), ['대', '중', '소'])
    expect(r.profile.hierarchy).toEqual({ kind: 'columns', columns: [0, 1, 2] })
    expect(detectLevelLabelColumns(['phase', 'TASK', 'x'], ['Phase', 'Task', 'Activity'])).toEqual([0, 1])
    expect(detectLevelLabelColumns(['Phase', 'x', 'y'], ['Phase', 'Task'])).toBeNull()          // 하나뿐이면 후보가 아니다
    expect(detectLevelLabelColumns(['Task', 'Phase'], ['Phase', 'Task'])).toBeNull()             // 단계 순서와 열 순서가 뒤집혔다
  })

  it('단계 이름을 모르는 프로젝트 설정이어도(머리 불일치) 글자 날짜 열을 아웃라인 코드 열로 잡지 않는다 — 리포트의 오매핑', async () => {
    // 이름 없는 행 하나 때문에 "한 행에 한 칸" 비율이 90% 아래(7/8)라 열=계층 모양 규칙은 탈락한다. 예전에는 그다음 규칙이 '2026-10-20' 을
    // 아웃라인 코드로 읽어 코드 열 = 시작일, 이름 열 = 종료일(코드 열 + 1)이 됐다
    const r = detect(await book([H, ...APPENDIX_B]), ['Phase', 'Task', 'Activity'])
    expect(r.profile.hierarchy.kind === 'outline' && r.profile.hierarchy.column === 3).toBe(false)
    expect(r.profile.logical.code).toBeNull()
    expect(r.profile.logical.name).toBeNull()
    expect(r.profile.logical.start).toBe(3)
    expect(r.profile.logical.end).toBe(4)
    // 못 찾은 것은 추정하지 않고 사용자에게 넘긴다
    expect(r.uncertain).toBe(true)
    expect(r.warnings).toContain(WARN_HIERARCHY_NOT_FOUND)
  })

  it('엑셀의 날짜 칸(일련번호 + 날짜 서식)·정수 열(가중치)도 아웃라인 코드 후보가 아니다', async () => {
    const d = (iso: string) => new Date(`${iso}T00:00:00Z`)
    const rows: Cell[][] = [
      ['시작일', '종료일', '가중치', '비고'],
      [d('2026-10-20'), d('2026-10-31'), 50, 'a'], [d('2026-11-01'), d('2026-11-15'), 30, 'b'], [d('2026-11-02'), d('2026-11-16'), 20, 'c'],
    ]
    const r = detect(await book(rows), [])
    expect(r.hierarchyCandidates.outline).toBeNull()
    expect(r.uncertain).toBe(true)
    // 순수 규칙 — 제외 집합이 없으면 정수·날짜 글자가 그대로 걸린다(그래서 조립부가 제외 집합을 넘긴다)
    expect(detectOutlineHierarchy([['2026-10-20'], ['2026-11-01']])).toEqual({ column: 0, ratio: 1 })
    expect(detectOutlineHierarchy([['2026-10-20'], ['2026-11-01']], new Set([0]))).toBeNull()
  })

  it('진짜 아웃라인 양식은 그대로 감지한다 — 코드 열·이름 열(머리 낱말)', async () => {
    const r = detect(await book([['코드', '업무명', '시작일', '종료일'], ['1', '준비', '2026-10-20', '2026-10-31'], ['1.1', '거버넌스', '2026-10-20', '2026-10-24']]), [])
    expect(r.profile.hierarchy).toEqual({ kind: 'outline', column: 0 })
    expect(r.profile.logical.name).toBe(1)
    expect(r.uncertain).toBe(false)
    expect(r.hierarchyCandidates).toEqual({ columns: [], outline: 0, name: 1 })
  })
})

describe('BUG-01·09·33 — 행 번호가 붙은 검증 오류', () => {
  it('부록 B 파일 — 날짜 역전·실적% 범위 초과·이름 없는 행·음수 가중치가 엑셀 행 번호와 함께 한 번에 나온다(500 이 아니다)', async () => {
    const parsed = parse(await book([H, ...APPENDIX_B]), STANDARD)
    // 이름 없는 행(엑셀 8행)은 파서가 행 오류로 낸다 — 항목으로 만들지 않는다
    expect(parsed.rowErrors).toEqual([{ excelRow: 8, message: ERR_NAME_BLANK }])
    expect(parsed.rows.map((r) => r.name)).not.toContain('')
    const linked = linkByDepth(parsed.rows)
    expect(linked.ok).toBe(false)
    if (linked.ok) return
    expect([...parsed.rowErrors, ...linked.errors].sort((a, b) => a.excelRow - b.excelRow)).toEqual([
      { excelRow: 6, message: '시작일이 종료일보다 늦음' },
      { excelRow: 7, message: '실적%는 0~100 범위여야 합니다(입력값 150)' },
      { excelRow: 8, message: '작업명이 비어 있습니다' },
      { excelRow: 9, message: '가중치는 0 이상이어야 합니다' },
    ])
  })

  it('실적% 경계 — 0·100 은 통과, -1·100.5 는 오류. 화면 편집과 같은 함수다', () => {
    const row = (actualPct: number, excelRow: number): ParsedRowN => ({
      depth: 0, code: null, name: 'x', extraAxis: null, deliverable: null, plannedStart: null, plannedEnd: null,
      weight: null, actualPct, owners: [], excelRow,
    })
    expect(linkByDepth([row(0, 2), row(100, 3)]).ok).toBe(true)
    const bad = linkByDepth([row(-1, 2), row(100.5, 3)])
    expect(bad.ok ? [] : bad.errors.map((e) => e.excelRow)).toEqual([2, 3])
    for (const v of [0, 100, -1, 100.5, 150]) expect(actualPctViolation(v) !== null, String(v)).toBe(pasteRejects('pactual', String(v)))
  })

  it('행 번호는 엑셀의 실제 번호다 — 빈 행 뒤의 오류가 한 줄씩 밀리지 않는다', async () => {
    const rows: Cell[][] = [H, APPENDIX_B[0], ['', '', '', '', '', '', '', '', ''], ['', '', '', '', '', '', '', '', ''], ['', '2.4 범위초과', '', '', '', '', '150', '', '']]
    const buf = await book(rows)
    expect(readSheetRows(XLSX.read(buf, { type: 'array' }).Sheets.WBS).excelRows).toEqual([1, 2, 5])
    const parsed = parse(buf, STANDARD)
    const linked = linkByDepth(parsed.rows)
    expect(linked.ok ? [] : linked.errors).toEqual([{ excelRow: 5, message: '실적%는 0~100 범위여야 합니다(입력값 150)' }])
  })

  it('이름도 값도 없는 행(양식이 읽지 않는 칸에만 글자)은 건너뛰고 그 수를 센다 — 오류가 아니다', async () => {
    const memo = ['', '', '', '', '', '', '', '', '', '여기는 메모']   // 양식 밖(10번째) 칸
    const parsed = parse(await book([H, APPENDIX_B[0], memo, APPENDIX_B[3], memo]), STANDARD)
    expect(parsed.skippedRows).toBe(2)
    expect(parsed.rowErrors).toEqual([])
    expect(parsed.rows.map((r) => r.name)).toEqual(['2. 설계', '2.2 DB설계'])
  })

  it('아웃라인 양식 — 코드가 빈 행·이름이 빈 행도 같은 규칙이다', async () => {
    const outline: ExcelProfile = {
      ...STANDARD, hierarchy: { kind: 'outline', column: 0 },
      logical: { extraAxis: null, code: 0, name: 1, deliverable: 2, start: null, end: null, weight: null, actualPct: null }, teamColumns: [],
    }
    const parsed = parse(await book([['코드', '업무명', '산출물', '메모'], ['1', '준비', '', ''], ['', '코드 없는 행', '', ''], ['1.1', '', '산출물만', ''], ['', '', '', '메모만']]), outline)
    expect(parsed.rowErrors).toEqual([{ excelRow: 3, message: ERR_OUTLINE_CODE_BLANK }, { excelRow: 4, message: ERR_NAME_BLANK }])
    expect(parsed.skippedRows).toBe(1)
    expect(parsed.rows.map((r) => r.code)).toEqual(['1'])
  })
})

/** 화면의 붙여넣기 검증(planCellWrites)이 그 칸의 값을 거부하는가 — 가져오기와 같은 규칙인지 대조하려고 화면 경로를 그대로 부른다 */
function pasteRejects(col: 'pactual' | 'weight', raw: string): boolean {
  const item: RangeItem = {
    id: 'r1', name: 'x', children: [], deliverable: null, plannedStart: null, plannedEnd: null, weight: null,
    plannedPct: 0, rolledActualPct: 1, achievement: null, custom: {},
  }
  const perms: RangePerms = {
    weight: true, dates: true, actual: () => true, deliverable: () => true, custom: () => true, customDefs: [], cellField: () => true,
    canAdminFields: true, bool: { yes: '예', no: '아니오' },
  }
  const model = gridModel([{ id: 'r1', parentId: null, expandable: false, expanded: false } satisfies GridRow], ['name', col], 'name')
  return planCellWrites(model, { rowId: 'r1', col }, [[raw]], () => item, perms).invalid.length > 0
}

describe('BUG-02 — 가중치 단위: 화면과 가져오기가 같은 값을 저장한다', () => {
  const weights = async (cells: Cell[]) => {
    const rows: Cell[][] = [H, APPENDIX_B[0], ...cells.map((w, i): Cell[] => ['', `작업 ${i}`, '', '', '', w, '', '', ''])]
    return parse(await book(rows), STANDARD).rows.slice(1).map((r) => r.weight)
  }

  it('엑셀의 50(숫자·글자)은 화면에 50 을 넣은 것과 같은 값(0.5)이고 50% 로 보인다 — 5000% 가 아니다', async () => {
    const ui = weightPctToFraction(50)                       // 셀 편집기·붙여넣기가 저장하는 값
    const [asNumber, asText, asPctText] = await weights([50, '50', '50%'])
    expect(asNumber).toBe(ui)
    expect(asText).toBe(ui)
    expect(asPctText).toBe(ui)
    expect(formatWeightPct(asNumber as number)).toBe('50%')
    expect(formatWeightPct(50)).toBe('5000%')                // 고치기 전에 저장되던 값의 표시
  })

  it('% 서식 칸(엑셀이 50% 로 보이는 0.5)은 값 그대로 — 서식 없는 50 과 한 파일에 섞여도 같은 50% 다', async () => {
    const pct = (value: number) => ({ value, numFmt: '0%' })
    expect(await weights([pct(0.5), 50, pct(0.25), 25])).toEqual([0.5, 0.5, 0.25, 0.25])
    // % 서식 칸만 있는 파일 — 1 을 넘는 값(200%)도 그대로다
    expect(await weights([pct(2), pct(0.5)])).toEqual([2, 0.5])
  })

  it('서식 없는 값이 전부 0~1 이면 분수(합 1 관례 — 이전 양식·이전 내보내기 파일)로 읽는다', async () => {
    expect(await weights([0.5, 0.3, 0.2, 1])).toEqual([0.5, 0.3, 0.2, 1])
    // 하나라도 1 을 넘으면 파일 전체가 % 다 — 행마다 다르게 풀면 형제 비율이 깨진다
    expect(await weights([0.5, 30, 20])).toEqual([0.005, 0.3, 0.2])
  })

  it('규칙 함수 — 배율은 파일에 하나, 음수·빈 칸은 배율 판정에 끼지 않는다', () => {
    const plain = (value: number) => ({ value, percentFormat: false })
    expect(importedWeightScale([])).toBe(1)
    expect(importedWeightScale([plain(0.5), plain(1)])).toBe(1)
    expect(importedWeightScale([plain(0.5), plain(50)])).toBe(0.01)
    expect(importedWeightScale([{ value: 2, percentFormat: true }, plain(0.5)])).toBe(1)   // % 서식 칸은 배율 판정에서 빠진다
    expect(importedWeightScale([plain(-20), plain(0.5)])).toBe(1)
    expect(importedWeightToFraction(plain(60), 0.01)).toBe(60 / 100)
    expect(importedWeightToFraction({ value: 0.6, percentFormat: true }, 0.01)).toBe(0.6)
    expect(weightViolation(0)).toBeNull()
    expect(weightViolation(-0.2)).toBe('weightMin')
    expect(weightViolation(Number.POSITIVE_INFINITY)).toBe('weightMin')
  })

  it('음수 가중치는 화면(붙여넣기)과 가져오기 둘 다 거부한다(BUG-09)', async () => {
    const parsed = parse(await book([H, APPENDIX_B[0], APPENDIX_B[7]]), STANDARD)
    const linked = linkByDepth(parsed.rows)
    expect(linked.ok ? [] : linked.errors).toEqual([{ excelRow: 3, message: '가중치는 0 이상이어야 합니다' }])
    expect(weightViolation(weightPctToFraction(-20))).toBe('weightMin')
    expect(pasteRejects('weight', '-20')).toBe(true)
    expect(pasteRejects('weight', '50')).toBe(false)
  })

  it('내보내기 → 가져오기 왕복 — 가중치 칸은 % 서식으로 나가 1 을 넘는 값도 같은 값으로 돌아온다', () => {
    const item = (id: string, weight: number | null): ComputedItem => ({
      id, parentId: null, level: 'phase', code: id, sortOrder: 0, name: id, biz: null, deliverable: null,
      plannedStart: null, plannedEnd: null, weight, actualPct: null, owners: [], isOwnerSplit: false, children: [],
      plannedPct: 0, rolledActualPct: 0, achievement: null, status: 'not_started',
    } as unknown as ComputedItem)
    const profile: ExcelProfile = { ...STANDARD, teamColumns: [], hierarchy: { kind: 'columns', columns: [0] }, logical: { ...STANDARD.logical, deliverable: null, start: null, end: null, actualPct: null, weight: 1 } }
    const built = buildWorkbookWithProfile([item('A', 2), item('B', 0.5), item('C', null)], profile, [], { expandSubActs: false, levelLabels: ['단계'] })
    if (!built.ok) throw new Error(built.error)
    const ws = XLSX.read(built.buffer, { type: 'array', cellNF: true }).Sheets.WBS
    expect((ws.B2 as XLSX.CellObject).v).toBe(2)                      // 값은 저장 단위 그대로
    expect((ws.B2 as XLSX.CellObject).z).toBe(WEIGHT_NUMBER_FORMAT)   // 엑셀에는 200.00% 로 보인다
    expect(parse(built.buffer, profile).rows.map((r) => r.weight)).toEqual([2, 0.5, null])
  })

  it('양식 파일(예시 행)의 가중치는 % 서식 칸이다 — 0.5 가 50% 로 보이고 50% 로 들어온다', () => {
    const buf = buildWbsTemplateWorkbook('D-Flow')
    const d = detect(buf, [])
    const rows = parse(buf, d.profile).rows
    expect(rows.find((r) => r.code === '1.1.1')?.weight).toBe(0.5)
    expect(rows.find((r) => r.code === '2.1')?.weight).toBe(0.6)
    expect(isXlsxBuffer(buf)).toBe(true)
  })
})

describe('BUG-04 — 엑셀이 아닌 파일', () => {
  const text = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer

  it('확장자만 .xlsx 인 글자 파일 — 감지·파싱 모두 "유효한 엑셀 파일이 아닙니다" 로 끝난다(본문 글자가 열 이름이 되지 않는다)', () => {
    const bogus = text('this is not a real xlsx file\n')
    expect(isXlsxBuffer(bogus)).toBe(false)
    expect(detectWorkbook(bogus)).toEqual({ ok: false, error: NOT_XLSX_ERROR })
    expect(parseWithProfile(bogus, STANDARD)).toEqual({ ok: false, error: NOT_XLSX_ERROR })
    // 고치기 전의 사실 — SheetJS 는 이 글자를 CSV 한 장으로 읽어 준다(오류가 아니다). 그래서 읽기 전에 막는다
    expect(XLSX.read(bogus, { type: 'array' }).SheetNames).toEqual(['Sheet1'])
  })

  it('CSV·빈 파일·옛 .xls(OLE)·빈 ZIP 도 아니다. ZIP 머리 뒤가 깨진 파일은 읽기 실패로 알린다(삼키지 않는다)', () => {
    expect(isXlsxBuffer(text('단계,작업\n1,2\n'))).toBe(false)
    expect(isXlsxBuffer(new ArrayBuffer(0))).toBe(false)
    expect(isXlsxBuffer(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).buffer)).toBe(false)
    expect(isXlsxBuffer(new Uint8Array([0x50, 0x4b, 0x05, 0x06]).buffer)).toBe(false)
    const broken = text('PK\x03\x04garbage-zip-bytes')
    expect(isXlsxBuffer(broken)).toBe(true)
    expect(detectWorkbook(broken)).toEqual({ ok: false, error: '워크북을 읽을 수 없습니다' })
    expect(parseWithProfile(broken, STANDARD)).toEqual({ ok: false, error: '워크북을 읽을 수 없습니다' })
  })

  it('머리만 있는 파일은 읽을 항목이 0건이다 — 실행 라우트가 이것을 성공으로 답하지 않는다(tests/api/import-execute.test.ts)', async () => {
    const parsed = parse(await book([H]), STANDARD)
    expect(parsed.rows).toEqual([])
    const linked = linkByDepth(parsed.rows)
    expect(linked.ok && linked.items.length).toBe(0)
  })
})
