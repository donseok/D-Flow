/* ── 주간업무 시트·보고서의 주차 서식(SP5 A — 스펙 D4, 계획 P4) ──
 * 주 계산(키·기간·이웃·라벨 숫자·표시 요일)은 src/lib/domain/calendar.ts 하나다(tests/domain/week-single-source). 이 파일은 그 숫자를
 * 한국어 서식 셋(시트 'M월 N주차'·파일명 'M월N주차'·보고서 'YYYY년 M월 N주차 (범위)')으로만 바꾼다 — 서식 셋이 이 파일의
 * weekLabelTexts 하나를 거친다. 범위는 표시 요일(기간 안 근무일, 0이면 기간 전체)의 첫날~끝날이다(5칸 고정 폐기). */
import {
  nextWeekKey, weekDisplayDays, weekKeyOf, weekLabelOf,
  type WeekStartRule, type WorkCalendar,
} from '@/lib/domain/calendar'
import { isValidIsoDate } from '@/lib/domain/validate'

export type WeekCal = Pick<WorkCalendar, 'weekStart' | 'workingDays' | 'offDates' | 'workDates'>

/** 'YYYY-MM-DD' → 'M/D'(date-only — 시간대 변환 없음) */
export function mdOf(iso: string): string {
  return `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`
}
function rangeOf(days: readonly string[]): string {
  return `${mdOf(days[0])}~${mdOf(days[days.length - 1])}`
}

export function weekLabelTexts(cal: WeekCal, key: string): { weekTag: string; label: string; reportLabel: string; range: string } {
  const { year, month, ordinal } = weekLabelOf(cal.weekStart, key)
  const range = rangeOf(weekDisplayDays(cal, key))
  return {
    weekTag: `${month}월${ordinal}주차`,
    label: `${month}월 ${ordinal}주차`,
    reportLabel: `${year}년 ${month}월 ${ordinal}주차 (${range})`,
    range,
  }
}

export interface SheetWeekMeta {
  weekTag: string    // '7월1주차' (파일명용)
  label: string      // '7월 1주차' (화면 표시용)
  thisRange: string  // 금주 표시 요일 범위
  nextRange: string  // 다음 키의 표시 요일 범위
}

export function sheetWeekMeta(cal: WeekCal, key: string): SheetWeekMeta {
  const t = weekLabelTexts(cal, key)
  return { weekTag: t.weekTag, label: t.label, thisRange: t.range, nextRange: rangeOf(weekDisplayDays(cal, nextWeekKey(cal.weekStart, key))) }
}

/** URL ?week= 의 정규화(계획 P9) — 유효한 'YYYY-MM-DD' 면 그 날짜가 속한 키, 아니면 오늘의 키. 과도기 주 안의 날짜는 과도기 키다([RF2]) */
export function normalizeWeekParam(rules: readonly WeekStartRule[], raw: string | null | undefined, today: string): string {
  const date = typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw) && isValidIsoDate(raw) ? raw : today
  return weekKeyOf(rules, date)
}
