/** Keep month labels bounded, including valid far-future dates such as 9999-12-31. */
export function portfolioMonthTicks(start: string, end: string, limit = 8): string[] {
  const [startYear, startMonth, startDay] = start.split('-').map(Number)
  const [endYear, endMonth] = end.split('-').map(Number)
  if (![startYear, startMonth, startDay, endYear, endMonth, limit].every(Number.isFinite) || limit < 1) return []
  const first = startYear * 12 + startMonth - 1 + (startDay === 1 ? 0 : 1)
  const last = endYear * 12 + endMonth - 1
  const stride = Math.max(1, Math.ceil((last - first + 1) / Math.floor(limit)))
  const ticks: string[] = []
  for (let month = first; month <= last; month += stride) {
    ticks.push(`${String(Math.floor(month / 12)).padStart(4, '0')}-${String(month % 12 + 1).padStart(2, '0')}-01`)
  }
  return ticks
}
