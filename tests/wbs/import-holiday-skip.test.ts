// 가져오기 휴일 충돌(스펙 D7·개정 §4.2.3·W16) — Holiday 시트의 날짜가 프로젝트에 '근무' 예외로 있으면 그 날짜는 휴무로 덮지 않고(DB 갱신절 —
// 과제 11) 미리보기·결과에 '건너뜀(특정일 근무와 충돌)'으로 보인다. 내보내기는 휴무만(Excel 왕복은 off 만 — 지원 제한).
import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { exportHolidayRows, skippedHolidaysOf } from '@/lib/domain/holidayImport'
import { readHolidaysFromBuffer } from '@/lib/excel/parseWithProfile'
import { initialWizardState, reducer } from '@/lib/domain/importWizard'
import type { DetectionResult } from '@/lib/excel/detect'
import { LEGACY_EXCEL_PROFILE_V1 } from '../fixtures/excel/legacy-3row-profile'

const PROJECT = [
  { date: '2026-10-05', name: '창립기념일', kind: 'off' as const },
  { date: '2026-10-10', name: '대체 근무', kind: 'work' as const },
  { date: '2026-10-24', name: '', kind: 'work' as const },
]

describe('skippedHolidaysOf', () => {
  it('근무 예외와 겹치는 파일 휴일만, 날짜 순, 중복 없이', () => {
    const file = [{ date: '2026-10-24', name: '회사 휴일 B' }, { date: '2026-10-10', name: '회사 휴일 A' }, { date: '2026-10-10', name: '중복' }, { date: '2026-10-05', name: '창립기념일' }]
    expect(skippedHolidaysOf(file, PROJECT)).toEqual([
      { date: '2026-10-10', name: '회사 휴일 A', reason: 'work_exception' },
      { date: '2026-10-24', name: '회사 휴일 B', reason: 'work_exception' },
    ])
  })
  it('같은 날짜의 휴무 행은 건너뜀이 아니다(이름 갱신 — DB 갱신절이 off 행만 덮는다)', () => {
    expect(skippedHolidaysOf([{ date: '2026-10-05', name: '새 이름' }], PROJECT)).toEqual([])
  })
  it('예외가 없으면 빈 목록', () => {
    expect(skippedHolidaysOf([{ date: '2026-10-10', name: 'x' }], [])).toEqual([])
  })
})

describe('exportHolidayRows — 휴무만', () => {
  it('근무 예외는 내보내지 않고 이름은 남긴다', () => {
    expect(exportHolidayRows(PROJECT)).toEqual([{ date: '2026-10-05', name: '창립기념일' }])
  })
})

describe('readHolidaysFromBuffer — 미리보기가 실행과 같은 규칙으로 Holiday 시트를 읽는다', () => {
  function book(rows: unknown[][]): ArrayBuffer {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['코드', '업무명']]), 'WBS')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Holiday')
    const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    return out
  }
  it('날짜 열이 날짜인 행만(머리 행은 건너뛴다)', () => {
    const buf = book([['날짜', '이름'], ['2026-10-10', '회사 휴일'], ['메모', '']])
    expect(readHolidaysFromBuffer(buf, 'Holiday')).toEqual([{ date: '2026-10-10', name: '회사 휴일' }])
  })
  it('시트 이름이 없으면 빈 목록, 워크북이 아니면 null', () => {
    expect(readHolidaysFromBuffer(book([['날짜', '이름']]), null)).toEqual([])
    // 깨진 zip(xlsx 머리 PK 뒤가 망가짐)은 읽지 못한다 → null. 평문은 SheetJS 가 CSV 한 장(Sheet1)으로 읽으므로 Holiday 시트가 없다 → []
    expect(readHolidaysFromBuffer(new TextEncoder().encode('PK\x03\x04garbage-zip-bytes').buffer as ArrayBuffer, 'Holiday')).toBeNull()
    expect(readHolidaysFromBuffer(new TextEncoder().encode('not a workbook').buffer as ArrayBuffer, 'Holiday')).toEqual([])
  })
})

describe('마법사 상태 — 미리보기의 건너뜀을 들고 다닌다', () => {
  it('초기 상태는 빈 목록, 파일을 바꾸면 비운다', () => {
    expect(initialWizardState.skippedHolidays).toEqual([])
    const skipped = [{ date: '2026-10-10', name: '회사 휴일', reason: 'work_exception' as const }]
    const detection: DetectionResult = { sheetNames: ['WBS'], profile: LEGACY_EXCEL_PROFILE_V1, confidence: { header: 1, hierarchy: 1, logical: 1 }, preview: { headers: [], rows: [] }, warnings: [] }
    const s1 = reducer(initialWizardState, { type: 'inspectSuccess', detection, savedProfile: null, skippedHolidays: skipped })
    expect(reducer(s1, { type: 'fileSelected', fileName: 'b.xlsx' }).skippedHolidays).toEqual([])
  })
  it('inspectSuccess 가 skippedHolidays 를 싣고, 없으면 빈 목록', () => {
    const detection: DetectionResult = { sheetNames: ['WBS', 'Holiday'], profile: LEGACY_EXCEL_PROFILE_V1, confidence: { header: 1, hierarchy: 1, logical: 1 }, preview: { headers: [], rows: [] }, warnings: [] }
    const skipped = [{ date: '2026-10-10', name: '회사 휴일', reason: 'work_exception' as const }]
    expect(reducer(initialWizardState, { type: 'inspectSuccess', detection, savedProfile: null, skippedHolidays: skipped }).skippedHolidays).toEqual(skipped)
    expect(reducer(initialWizardState, { type: 'inspectSuccess', detection, savedProfile: null }).skippedHolidays).toEqual([])
  })
})
