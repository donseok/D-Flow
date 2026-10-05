import type { ExcelProfile } from '@/lib/excel/profile'

/** 레거시 3행 헤더 규약 v1(5팀 열) — 라운드트립 계약 테스트의 기준(SP4 A2 에서 src/lib/excel/profile.ts 에서 옮김, W25).
 *  표준 레이아웃의 특수형이다 — deriveStandardExcelProfile(5팀, ['Phase','Task','Activity']) 와 같다(W26). 런타임은 쓰지 않는다. */
export const LEGACY_EXCEL_PROFILE_V1: ExcelProfile = {
  version: 1,
  sheetName: 'WBS',
  holidaySheetName: 'Holiday',
  headerRow: 2,
  hierarchy: { kind: 'columns', columns: [1, 2, 3] },
  // name: null — columns 계층(Phase/Task/Activity)은 계층 열 자체가 이름의 출처라 별도 이름 열이 없다.
  logical: { extraAxis: 0, code: null, name: null, deliverable: 11, start: 12, end: 13, weight: 14, actualPct: 16 },
  teamColumns: [[6, 'PMO'], [7, 'ERP'], [8, 'MES'], [9, '가공'], [10, 'MDM']],
  ownerMarks: { '●': 'primary', '△': 'support' },
  customColumns: [],
}
