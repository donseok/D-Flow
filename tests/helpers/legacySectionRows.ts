// 옛 구분 행 모양과 그 정렬·묶음·라벨 규칙의 테스트 전용 사본(SP4 계획 과제 25). 과제 21 이 묶음 키를 받게 일반화한 점검·다시 쓰기
// 함수(lintWeeklySheet(rows, groupOf)·buildWeeklyRewriteSelection(rows, rect, labelOf))를 옛 모양 행으로 시험하는 테스트가 순서·묶음을
// 옛 규칙 그대로 맞추는 데 쓴다. 런타임(src)에는 이 규칙이 없다 — 주간 행은 영역 id 로 묶이고 순서·라벨은 영역에서 온다
// (src/lib/domain/weeklySheet.ts 의 visibleRows·rowLabel·areaGroupOf). 순서 목록은 옛 구분 순서의 자리다.
import { LEGACY_SENTINELS } from '../fixtures/legacy-sentinels'

/** 옛 주간 행 모양(구분 문자열·모듈·정렬 번호) */
export interface LegacySectionRow {
  id: string
  reportId: string
  section: string
  module: string
  sortOrder: number
  thisContent: string
  thisIssue: string
  nextContent: string
  nextIssue: string
}

/** 옛 구분 순서 — 목록에 있는 구분은 이 자리로, 없는 구분은 뒤로 */
export const LEGACY_SECTION_ORDER: readonly string[] = LEGACY_SENTINELS.weeklySections

const isListed = (section: string): boolean => LEGACY_SECTION_ORDER.includes(section)

/** 목록의 구분은 목록 순서로, 목록 밖 행은 그 뒤에서 sortOrder 순으로(입력은 바꾸지 않는다) */
export function legacySortRows<T extends Pick<LegacySectionRow, 'section' | 'sortOrder'>>(rows: readonly T[]): T[] {
  const rank = (section: string): number => {
    const i = LEGACY_SECTION_ORDER.indexOf(section.trim())
    return i < 0 ? LEGACY_SECTION_ORDER.length : i
  }
  return [...rows].sort((a, b) => rank(a.section) - rank(b.section) || a.sortOrder - b.sortOrder)
}

/** 행 라벨 — 구분 단독, 모듈이 다르면 '구분 · 모듈', 구분이 없으면 모듈, 둘 다 없으면 '기타' */
export function legacySectionLabel(row: Pick<LegacySectionRow, 'section' | 'module'>): string {
  const sec = row.section.trim(), mod = row.module.trim()
  if (!sec) return mod || '기타'
  return mod && mod !== sec ? `${sec} · ${mod}` : sec
}

/** 묶음 키 — 목록의 구분이면 구분 이름 하나, 아니면 라벨(모듈로 나뉜 행이 섞이지 않게) */
export function legacySectionKey(row: Pick<LegacySectionRow, 'section' | 'module'>): string {
  const sec = row.section.trim()
  return isListed(sec) ? sec : legacySectionLabel(row)
}
