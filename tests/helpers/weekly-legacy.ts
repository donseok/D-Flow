// 옛 구분 행(LegacySectionRow — section·module·sortOrder) 테스트를 옛 동작 그대로 돌리는 어댑터(SP4 계획 과제 21).
// 옛 점검은 안에서 legacySortRows 로 정렬하고 legacySectionKey 로 묶었다 — 이제 정렬은 호출부, 묶음은 groupOf 다.
// 과제 25 가 src 의 옛 정의를 지운 뒤에는 테스트 전용 사본(./legacySectionRows)을 감싼다 — 런타임에는 이 규칙이 없다.
import { legacySectionKey, legacySortRows, type LegacySectionRow } from './legacySectionRows'
import type { LintGroupOf } from '@/lib/domain/weeklyLint'

/** 옛 묶음 — 키·이름 모두 legacySectionKey(표준 구분명이면 구분명, 아니면 '구분 · 모듈') */
export const legacyGroup: LintGroupOf<LegacySectionRow> = (r) => {
  const key = legacySectionKey(r)
  return { key, label: key }
}

/** 옛 화면 순서(구분 이름 순 → sortOrder) — 옛 점검이 안에서 하던 정렬 */
export const legacyOrdered = (rows: readonly LegacySectionRow[]): LegacySectionRow[] => legacySortRows(rows)
