// 옛 구분 행(WeeklySheetRow — section·module·sortOrder) 테스트를 옛 동작 그대로 돌리는 어댑터(SP4 계획 과제 21).
// 옛 점검은 안에서 sortWeeklyRows 로 정렬하고 sectionKeyOf 로 묶었다 — 이제 정렬은 호출부, 묶음은 groupOf 다.
// 과제 25 가 옛 행 타입·함수를 지우며 이 파일과 그 사용처를 함께 지운다.
import { sectionKeyOf, sortWeeklyRows, type WeeklySheetRow } from '@/lib/domain/weeklySheet'
import type { LintGroupOf } from '@/lib/domain/weeklyLint'

/** 옛 묶음 — 키·이름 모두 sectionKeyOf(표준 구분명이면 구분명, 아니면 '구분 · 모듈') */
export const legacyGroup: LintGroupOf<WeeklySheetRow> = (r) => {
  const key = sectionKeyOf(r)
  return { key, label: key }
}

/** 옛 화면 순서(구분 이름 순 → sortOrder) — 옛 점검이 안에서 하던 정렬 */
export const legacyOrdered = (rows: readonly WeeklySheetRow[]): WeeklySheetRow[] => sortWeeklyRows(rows)
