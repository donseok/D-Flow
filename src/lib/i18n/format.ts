// 날짜·숫자 형식 태그 — `Intl.*`·`toLocale*String` 에 넘길 BCP 47 태그의 단일 출처. 제품이 한국어 전용이라 'ko-KR' 하나다.
export const KO_LOCALE = 'ko-KR'

// ── 화면 날짜 표기의 한 꼴(BUG-20) ──
// 날짜는 4자리 연도 'YYYY-MM-DD', 시각이 붙으면 'YYYY-MM-DD HH:mm' 하나다. 2자리 연도('26.10.12')는 일.월.년으로 읽힐 수 있고,
// 화면마다 꼴이 달라('26.10.12'·'2026-10-12'·'2026.10.10 14:56'·'2026. 10. 10.') 같은 날을 다른 값처럼 보이게 했다.
// 예외는 좁은 자리뿐이다 — 간트 눈금·달력 머리·차트 축 눈금의 '10/12'·'26.10' 같은 축약은 그 자리의 것이다.
// 내보내기 파일(엑셀·PPT)의 표기는 양식이 정한다 — 이 함수들을 쓰지 않는다.
import { stampIn, ymdIn } from '@/lib/domain/calendar'

/** date-only 값('YYYY-MM-DD…')의 화면 표기 — 변환하지 않고 날짜 10자만 낸다. 없으면 empty */
export function formatYmd(date: string | null | undefined, empty = '-'): string {
  return date ? date.slice(0, 10) : empty
}

/** 달력 머리의 달 표기 'YYYY-MM' — 날짜(2026-10-12)와 같은 꼴(로케일 꼴 '2026. 10.' 을 섞지 않는다). month0 은 0 부터 */
export function formatYearMonth(year: number, month0: number): string {
  const d = new Date(Date.UTC(year, month0, 1))   // 범위를 벗어난 달(12 → 다음 해 1월)도 날짜 계산으로 넘긴다
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** instant 의 그 tz 날짜 'YYYY-MM-DD' — 읽을 수 없는 값·tz 미상은 empty */
export function formatDayIn(at: string | Date | null | undefined, timeZone: string | null, empty = '—'): string {
  if (!at || timeZone === null) return empty
  const d = typeof at === 'string' ? new Date(at) : at
  return Number.isNaN(d.getTime()) ? empty : ymdIn(timeZone, d)
}

/** instant 의 그 tz 벽시계 'YYYY-MM-DD HH:mm' — 읽을 수 없는 값·tz 미상은 empty */
export function formatStampIn(at: string | Date | null | undefined, timeZone: string | null, empty = '—'): string {
  if (!at || timeZone === null) return empty
  const d = typeof at === 'string' ? new Date(at) : at
  return Number.isNaN(d.getTime()) ? empty : stampIn(timeZone, d)
}
