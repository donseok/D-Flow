/** 이 해부터는 실제 기한으로 보지 않는다 — '기한 없음'을 9999-12-31 로 적어 둔 자료가 있다 */
export const FAR_FUTURE_FROM = '9000-01-01'

/** 기한 표시용 — 9999-12-31 같은 '끝없음' 표식은 기한 없음(null)으로 읽는다. 저장된 날짜는 건드리지 않는다 */
export function realDueDate(date: string | null | undefined): string | null {
  return date && date < FAR_FUTURE_FROM ? date : null
}
