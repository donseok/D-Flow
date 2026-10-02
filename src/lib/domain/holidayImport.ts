// 날짜 예외와 Excel Holiday 시트의 경계(스펙 D7·개정 §4.2.3) — 순수. Excel 왕복은 휴무(off)만이 지원 범위다(지원 제한).
// 가져오기: 파일의 휴일 날짜에 프로젝트의 '근무' 예외가 있으면 DB 갱신절(… where kind = 'off')이 그 행을 덮지 않는다 — 화면은 그 날짜를 '건너뜀'으로 보인다.
// 내보내기: 휴무만 시트에 쓴다(근무 예외를 휴일로 내보내면 다시 가져올 때 휴무가 된다).

export interface SkippedHoliday { date: string; name: string; reason: 'work_exception' }

const byDate = (a: { date: string }, b: { date: string }) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)

/** 파일 휴일 가운데 프로젝트에 근무 예외가 있는 날짜 — 날짜 유일(첫 이름)·오름차순 */
export function skippedHolidaysOf(
  fileHolidays: readonly { date: string; name: string }[],
  projectHolidays: readonly { date: string; kind: 'off' | 'work' }[],
): SkippedHoliday[] {
  const work = new Set(projectHolidays.filter((h) => h.kind === 'work').map((h) => h.date))
  const seen = new Map<string, SkippedHoliday>()
  for (const h of fileHolidays) {
    if (work.has(h.date) && !seen.has(h.date)) seen.set(h.date, { date: h.date, name: h.name, reason: 'work_exception' })
  }
  return [...seen.values()].sort(byDate)
}

/** 내보내기 Holiday 시트의 행 — 휴무만, 이름 유지, 오름차순 */
export function exportHolidayRows(rows: readonly { date: string; name: string; kind: 'off' | 'work' }[]): { date: string; name: string }[] {
  return rows.filter((h) => h.kind === 'off').map((h) => ({ date: h.date, name: h.name })).sort(byDate)
}
