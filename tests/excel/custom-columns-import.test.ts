import { describe, expect, it } from 'vitest'
// WBS 가져오기의 사용자 정의 필드 열(개정 §3.6.7 "임포트 마법사 자동 감지") — 헤더 → 필드 매핑 제안, 셀 → 필드 유형의 값,
// 행 단위 값 검사. 판정은 validateCustomValue 한 벌이고(DB 트리거와 같은 골든), 여기서는 그 판정이 행 오류 표로 옮겨지는지를 본다.
import golden from '../fixtures/parity/custom-fields-cases.json'
import { checkCustomRows, coerceCustomCell, profileColumns, suggestCustomColumns, withSuggestedCustomColumns } from '@/lib/excel/customColumns'
import { buildWorkbookWithProfile } from '@/lib/excel/exportWithProfile'
import { parseWithProfile } from '@/lib/excel/parseWithProfile'
import { deriveStandardExcelProfile } from '@/lib/excel/standardProfile'
import { detectWorkbook } from '@/lib/excel/detect'
import { validateCustomValue, type CustomValueError, type FieldDef } from '@/lib/domain/customFields'
import { computeTree } from '@/lib/domain/rollup'
import { teamOrderMap } from '@/lib/domain/teams'
import type { WbsRow } from '@/lib/domain/types'
import type { ExcelProfile } from '@/lib/excel/profile'
import { calUtcSun } from '../helpers/calendarFixture'

const def = (over: Partial<FieldDef>): FieldDef => ({
  key: 'qty', label: '검측 수량', description: '', type: 'number', required: false, editable_by: 'member',
  show_in_list: true, searchable: false, sort: 0, active: true, ...over,
} as FieldDef)
const OPTIONS = [
  { code: 'pending', label: '대기', sort: 0, active: true }, { code: 'pass', label: '통과', sort: 1, active: true },
  { code: 'legacy', label: '과거', sort: 2, active: false },
]
const QTY = def({ limits: { decimals: 1, unit: 'm³', min: 0, max: 1000 } })
const RESULT = def({ key: 'result', label: '실험 결과', type: 'select', sort: 1, options: OPTIONS })
const TAGS = def({ key: 'tags', label: '분류', type: 'multiselect', sort: 2, options: OPTIONS, limits: { maxItems: 2 } })
const DONE = def({ key: 'done', label: '검수 완료', type: 'boolean', sort: 3 })
const DUE = def({ key: 'due', label: '검수일', type: 'date', sort: 4 })
const NOTE = def({ key: 'note', label: '비고', type: 'text', sort: 5, limits: { maxLength: 5 } })
const MEMO = def({ key: 'memo', label: '상세 메모', type: 'multiline', sort: 6 })
const OFF = def({ key: 'old', label: '옛 필드', type: 'text', sort: 7, active: false })
const DEFS = [QTY, RESULT, TAGS, DONE, DUE, NOTE, MEMO, OFF]

describe('suggestCustomColumns — 헤더 → 필드 매핑 제안', () => {
  const none = new Set<number>()

  it('헤더가 필드 라벨과 같으면 그 열을 그 필드로 제안한다', () => {
    expect(suggestCustomColumns(['코드', '검측 수량', '실험 결과'], DEFS, none)).toEqual([[1, 'qty'], [2, 'result']])
  })

  it('헤더가 key 와 같아도 제안한다', () => {
    expect(suggestCustomColumns(['qty', 'x', 'result'], DEFS, none)).toEqual([[0, 'qty'], [2, 'result']])
  })

  it('공백·대소문자·전각을 정규화해 비교한다', () => {
    expect(suggestCustomColumns(['  검측수량 ', '실험　결과', 'ＤＯＮＥ'], [QTY, RESULT, DONE], none))
      .toEqual([[0, 'qty'], [1, 'result'], [2, 'done']])
    expect(suggestCustomColumns(['Inspected Quantity'], [def({ label: 'inspected  quantity' })], none)).toEqual([[0, 'qty']])
  })

  it('한 필드는 열 하나 — 같은 라벨의 열이 둘이면 왼쪽, key 열과 라벨 열이 함께 있으면 key 열이다', () => {
    expect(suggestCustomColumns(['검측 수량', '검측 수량'], DEFS, none)).toEqual([[0, 'qty']])
    expect(suggestCustomColumns(['검측 수량', 'QTY'], DEFS, none)).toEqual([[1, 'qty']])
  })

  it('부분 일치·비슷한 낱말은 제안하지 않는다(추측 금지)', () => {
    expect(suggestCustomColumns(['수량', '검측 수량(m³)', '결과'], DEFS, none)).toEqual([])
  })

  it('비활성 필드와 프로파일이 이미 쓰는 열은 제안하지 않는다', () => {
    expect(suggestCustomColumns(['옛 필드', 'old'], DEFS, none)).toEqual([])
    expect(suggestCustomColumns(['검측 수량', '검측 수량'], DEFS, new Set([0]))).toEqual([[1, 'qty']])
  })

  it('key 일치가 라벨 일치보다 먼저다 — 한 필드의 key 가 다른 필드의 라벨과 같아도 key 쪽이 잡는다', () => {
    const a = def({ key: 'alpha', label: '가' })
    const b = def({ key: 'beta', label: 'alpha', sort: 1 })
    expect(suggestCustomColumns(['alpha', 'beta'], [a, b], none)).toEqual([[0, 'alpha'], [1, 'beta']])
  })

  it('같은 라벨의 활성 필드가 둘이면 어느 쪽인지 모른다 — 제안하지 않는다', () => {
    expect(suggestCustomColumns(['수량'], [def({ key: 'a', label: '수량' }), def({ key: 'b', label: '수량', sort: 1 })], none)).toEqual([])
  })

  it('빈 헤더·정의 없음은 제안 없음', () => {
    expect(suggestCustomColumns(['', '  '], DEFS, none)).toEqual([])
    expect(suggestCustomColumns(['검측 수량'], [], none)).toEqual([])
  })

  it('withSuggestedCustomColumns — 계층·논리·팀 열을 피해 감지 양식에 싣고, 제안이 없으면 양식을 그대로 돌려준다', () => {
    const profile: ExcelProfile = {
      version: 1, sheetName: 'WBS', holidaySheetName: null, headerRow: 0,
      hierarchy: { kind: 'columns', columns: [0, 1] },
      logical: { extraAxis: null, code: null, name: null, deliverable: 2, start: null, end: null, weight: null, actualPct: null },
      teamColumns: [[3, 'RES']], ownerMarks: { '●': 'primary' },
    }
    expect([...profileColumns(profile)].sort()).toEqual([0, 1, 2, 3])
    const headers = ['검측 수량', '실험 결과', '비고', 'qty', '실험 결과']   // 0~3 은 이미 쓰는 열
    expect(withSuggestedCustomColumns(profile, headers, DEFS).customColumns).toEqual([[4, 'result']])
    expect(withSuggestedCustomColumns(profile, ['a', 'b'], DEFS)).toBe(profile)
  })
})

describe('coerceCustomCell — 엑셀 셀 → 필드 유형의 값', () => {
  it('선택: code 는 그대로, 내보내기가 쓴 라벨은 code 로(비활성 포함) — 모르는 값은 그대로 둬 판정이 거부한다', () => {
    expect(coerceCustomCell(RESULT, 'pass')).toBe('pass')
    expect(coerceCustomCell(RESULT, ' 통과 ')).toBe('pass')
    expect(coerceCustomCell(RESULT, '과거')).toBe('legacy')
    expect(coerceCustomCell(RESULT, '없는값')).toBe('없는값')
  })

  it('다중 선택: `a, b` 를 code 배열로', () => {
    expect(coerceCustomCell(TAGS, '대기, pass')).toEqual(['pending', 'pass'])
    expect(coerceCustomCell(TAGS, 'pass')).toEqual(['pass'])
    expect(coerceCustomCell(TAGS, '대기,없는값')).toEqual(['pending', '없는값'])
  })

  it('예/아니오: 셀의 불리언은 그대로, 표시 문구는 불리언으로 — 그 밖은 그대로', () => {
    expect(coerceCustomCell(DONE, true)).toBe(true)
    expect(coerceCustomCell(DONE, '예')).toBe(true)
    expect(coerceCustomCell(DONE, '아니오')).toBe(false)
    expect(coerceCustomCell(DONE, 'No')).toBe(false)
    expect(coerceCustomCell(DONE, '글쎄')).toBe('글쎄')
    expect(coerceCustomCell(DONE, 1)).toBe(1)           // 숫자를 참·거짓으로 짐작하지 않는다
  })

  it('숫자: 숫자 셀은 그대로, 표시 서식(자릿수 구분·단위)의 텍스트는 숫자로 — 숫자가 아니면 그대로', () => {
    expect(coerceCustomCell(QTY, 12.5)).toBe(12.5)
    expect(coerceCustomCell(QTY, '1,234.5 m³')).toBe(1234.5)
    expect(coerceCustomCell(QTY, ' 0 ')).toBe(0)
    expect(coerceCustomCell(QTY, '많음')).toBe('많음')
    expect(coerceCustomCell(QTY, '12 kg')).toBe('12 kg')
  })

  it('텍스트: 숫자·불리언 셀은 글자로, 날짜는 손대지 않는다', () => {
    expect(coerceCustomCell(NOTE, 123)).toBe('123')
    expect(coerceCustomCell(MEMO, false)).toBe('false')
    expect(coerceCustomCell(DUE, '2026-10-08')).toBe('2026-10-08')
    expect(coerceCustomCell(DUE, 45000)).toBe(45000)
  })
})

describe('checkCustomRows — 행 단위 오류 표', () => {
  const row = (excelRow: number, custom?: Record<string, unknown>) => ({ excelRow, name: `행${excelRow}`, ...(custom ? { custom } : {}) })

  it('유효한 값은 필드 유형의 값으로 바뀌어 실리고 오류가 없다 — 입력 행은 바뀌지 않는다', () => {
    const input = [row(4, { qty: '12.5 m³', result: '통과', tags: '대기, 통과', done: '예', due: '2026-10-08', note: 7, memo: '첫 줄\n둘째 줄' }), row(5)]
    const snapshot = JSON.stringify(input)
    const checked = checkCustomRows(input, DEFS)
    expect(checked.errors).toEqual([])
    expect(checked.rows[0].custom).toEqual({ qty: 12.5, result: 'pass', tags: ['pending', 'pass'], done: true, due: '2026-10-08', note: '7', memo: '첫 줄\n둘째 줄' })
    expect(checked.rows[0].name).toBe('행4')
    expect(checked.rows[1]).toBe(input[1])
    expect(JSON.stringify(input)).toBe(snapshot)
  })

  it('타입 불일치·모르는 옵션·범위·길이 위반이 엑셀 행 번호와 필드 라벨·원래 값과 함께 실린다', () => {
    const { errors } = checkCustomRows([
      row(4, { qty: '많음' }),
      row(5, { result: '없는값' }),
      row(7, { qty: 1000.5, note: '여섯글자넘음' }),
      row(9, { tags: '대기, 통과, 과거' }),
      row(10, { done: '글쎄', due: '2026-02-30' }),
      row(11, { qty: 1.25 }),
    ], DEFS)
    expect(errors.map(e => e.excelRow)).toEqual([4, 5, 7, 7, 9, 10, 10, 11])
    expect(errors[0].message).toContain('검측 수량')
    expect(errors[0].message).toContain('숫자 형식이 아닙니다')
    expect(errors[0].message).toContain('많음')
    expect(errors[1].message).toContain('실험 결과')
    expect(errors[1].message).toContain('선택지에 없는 값')
    expect(errors[2].message).toContain('허용 범위')
    expect(errors[3].message).toContain('최대 5자')
    expect(errors[4].message).toContain('최대 2개')
    expect(errors[5].message).toContain('예/아니오')
    expect(errors[6].message).toContain('날짜')
    expect(errors[7].message).toContain('소수 1자리')
  })

  it('새 값으로 비활성 선택지는 넣을 수 없다(가져오기는 INSERT — 변경 전 값이 없다)', () => {
    const { errors } = checkCustomRows([row(4, { result: '과거' })], DEFS)
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toContain('비활성 선택지')
  })

  it('정의에 없는 key·비활성 필드는 열 전체의 문제 — 처음 만난 행에 한 번만 싣고 값은 보내지 않는다', () => {
    const checked = checkCustomRows([row(4, { ghost: 'a', old: 'b', qty: 1 }), row(5, { ghost: 'c', old: 'd' })], DEFS)
    expect(checked.errors.map(e => e.excelRow)).toEqual([4, 4])
    expect(checked.errors[0].message).toContain("'ghost'")
    expect(checked.errors[1].message).toContain('옛 필드')
    expect(checked.errors[1].message).toContain('비활성')
    expect(checked.rows[0].custom).toEqual({ qty: 1 })
    expect(checked.rows[1].custom).toEqual({})
  })

  it('필수 필드의 빈 칸은 오류가 아니다 — INSERT 트리거가 기본값으로 채운다(§3.6.4)', () => {
    const required = def({ key: 'result', label: '실험 결과', type: 'select', options: OPTIONS, required: true, default: 'pending' })
    expect(checkCustomRows([row(4), row(5, { qty: 1 })], [QTY, required]).errors).toEqual([])
  })

  it('판정은 validateCustomValue 한 벌이다 — DB 트리거와 같은 골든에서 셀 변환이 없는 케이스는 같은 판정을 낸다', () => {
    const defs = golden.defs as Record<string, FieldDef>
    let covered = 0
    for (const c of golden.cases as { name: string; def: string; value: unknown; error: CustomValueError | null; prev?: unknown }[]) {
      const d = defs[c.def]
      // 가져오기는 INSERT 다(변경 전 값 없음). 빈 칸(null)은 파서가 싣지 않는다. 셀 변환이 값을 바꾸는 케이스는 위 변환 테스트 몫이다
      if ('prev' in c || c.value === null || JSON.stringify(coerceCustomCell(d, c.value)) !== JSON.stringify(c.value)) continue
      covered += 1
      const { errors } = checkCustomRows([row(4, { [d.key]: c.value })], [d])
      expect(errors.length > 0, c.name).toBe(c.error !== null)
      expect(validateCustomValue(d, c.value), c.name).toBe(c.error)
    }
    expect(covered).toBeGreaterThanOrEqual(60)
  })
})

describe('기본 양식 왕복 — 내보내기 → 감지(헤더 제안) → 파싱 → 검사에서 7타입 값이 보존된다', () => {
  const ACTIVE = DEFS.filter(d => d.active).map(d => (d.key === 'note' ? { ...d, limits: { maxLength: 50 } } : d))
  const CUSTOM = { qty: 12.5, result: 'pass', tags: ['pending', 'pass'], done: false, due: '2026-10-08', note: '한 줄 메모', memo: '첫 줄\n둘째 줄' }
  const src: WbsRow[] = [
    { id: 'P1', parentId: null, code: '1', sortOrder: 0, name: '1. 단계', biz: null, deliverable: null, plannedStart: null, plannedEnd: null, weight: null, actualPct: null, owners: [], isOwnerSplit: false },
    { id: 'A1', parentId: 'P1', code: '1.1', sortOrder: 1, name: '세부작업', biz: null, deliverable: '산출물', plannedStart: '2026-10-01', plannedEnd: '2026-10-10', weight: null, actualPct: 80, owners: [{ team: 'RES', kind: 'primary' }], isOwnerSplit: false, custom: CUSTOM },
  ]
  const items = computeTree(src, '2026-10-01', calUtcSun, { subActTeamOrder: teamOrderMap(['RES']) })

  it('헤더(필드 라벨)만으로 필드 열을 되찾고, 표시 서식(옵션 라벨·`a, b`)을 code 로 되돌린다', () => {
    const exportProfile = deriveStandardExcelProfile(['RES'], ['Phase', 'Activity'], ACTIVE)
    const exported = buildWorkbookWithProfile(items, exportProfile, [], { expandSubActs: false, levelLabels: ['Phase', 'Activity'], customFieldDefs: ACTIVE })
    if (!exported.ok) throw new Error('내보내기 실패')

    const detected = detectWorkbook(exported.buffer)
    if (!detected.ok) throw new Error(`감지 실패: ${detected.error}`)
    // 감지기만으로는 필드 열을 모른다 — 헤더 제안이 내보낸 양식의 customColumns 와 같은 열·key 를 되찾는다
    expect(detected.result.profile.customColumns ?? []).toEqual([])
    const profile = withSuggestedCustomColumns(detected.result.profile, detected.result.preview.headers, ACTIVE)
    expect(profile.customColumns).toEqual(exportProfile.customColumns)

    const parsed = parseWithProfile(exported.buffer, profile)
    if (!parsed.ok) throw new Error(`파싱 실패: ${parsed.error}`)
    const checked = checkCustomRows(parsed.rows, ACTIVE)
    expect(checked.errors).toEqual([])
    expect(checked.rows.find(r => r.name === '세부작업')?.custom).toEqual(CUSTOM)
    expect(checked.rows.find(r => r.name === '1. 단계')?.custom).toBeUndefined()
  })
})
