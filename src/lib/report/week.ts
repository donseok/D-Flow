/* ── 주간업무 시트·보고서의 주차 서식(SP5 A — 스펙 D4, 계획 P4) ──
 * 주 계산(키·기간·이웃·라벨 숫자·표시 요일)은 src/lib/domain/calendar.ts 하나다(tests/domain/week-single-source). 이 파일은 그 숫자를
 * 한국어 서식 셋(시트 'M월 N주차'·파일명 'M월N주차'·보고서 'YYYY년 M월 N주차 (범위)')으로만 바꾼다 — 서식 셋이 이 파일의
 * weekLabelTexts 하나를 거친다. 범위는 표시 요일(기간 안 근무일, 0이면 기간 전체)의 첫날~끝날이다(5칸 고정 폐기). */
import {
  nextWeekKey, weekDisplayDays, weekKeyOf, weekLabelOf,
  type WeekStartRule, type WorkCalendar,
} from '@/lib/domain/calendar'
import { isValidIsoDate } from '@/lib/domain/validate'
import { t, type Locale } from '@/lib/i18n/dict'
import { intlLocale } from '@/lib/i18n/format'

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

/** 화면 표시 전용 주차 라벨(주차 이동 줄·빈 시트 안내) — 화면 언어를 따른다. ko: '10월 2주차 (10/5~10/9)', en: 'Oct · Week 2 (10/5–10/9)'.
 *  locale 을 주지 않으면 종전 한국어다. **저장·비교·파일 이름에 쓰지 않는다** — 문서 기본 제목(시트가 저장 값과 비교한다)·weekTag·보고서 라벨은
 *  제품 고정(개정 §2.9)이라 위 weekLabelTexts·sheetWeekMeta 의 한국어 값을 그대로 쓴다. 날짜는 두 언어 모두 M/D(en 사전의 관례대로 범위만 en dash). */
export function weekDisplayLabel(cal: WeekCal, key: string, locale: Locale = 'ko'): string {
  const { year, month, ordinal } = weekLabelOf(cal.weekStart, key)
  const days = weekDisplayDays(cal, key)
  // 달 이름은 Intl 이 낸다(ko '10월'·en 'Oct') — 달 이름 12개를 사전에 두지 않는다. date-only 라 UTC 로 고정(시간대 변환 없음)
  const monthName = new Intl.DateTimeFormat(intlLocale(locale), { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, 1)))
  return t(locale, 'weekly.week.labelWithRange')
    .replace('{month}', () => monthName)
    .replace('{ordinal}', String(ordinal))
    .replace('{from}', mdOf(days[0]))
    .replace('{to}', mdOf(days[days.length - 1]))
}

/** URL ?week= 의 정규화(계획 P9) — 유효한 'YYYY-MM-DD' 면 그 날짜가 속한 키, 아니면 오늘의 키. 과도기 주 안의 날짜는 과도기 키다([RF2]) */
export function normalizeWeekParam(rules: readonly WeekStartRule[], raw: string | null | undefined, today: string): string {
  const date = typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw) && isValidIsoDate(raw) ? raw : today
  return weekKeyOf(rules, date)
}
