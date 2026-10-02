/** 'YYYY-MM-DD' + n일. Date.UTC 가 월/연 경계를 자동 처리. (사본 5벌 흡수 — 이 파일이 단일 출처)
 *  주 계산·요일·'오늘'·근무일은 src/lib/domain/calendar.ts 다(스펙 SP5 §4.1). 이 파일은 tz 무관 날짜 산술만 둔다. */
export function addDaysIso(dateIso: string, days: number): string {
  const [y, m, d] = dateIso.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + days))
  const pad2 = (n: number) => String(n).padStart(2, '0')
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`
}

/**
 * @deprecated UI 위험 파일 src/app/(app)/layout.tsx 의 한 줄만 쓴다 — SP5 과제 32(`ui/sp5-calendar`)가 그 호출을 워크스페이스 tz 의
 * todayIn 으로 바꾸며 이 함수를 지운다. 새 호출 금지(tests/domain/dates.test.ts 가 호출 파일을 하나로 고정한다).
 */
export function seoulToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
}
