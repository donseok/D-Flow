/**
 * WBS 항목의 한 줄 제목 '{code} {name}' — 이름이 이미 그 코드로 시작하면 이름만 쓴다.
 * 화면에서 추가한 항목은 코드가 이름의 첫 토막이라(addWbsItem — "1.2 설계"의 '1.2', "임시 점검"의 '임시') 그대로 붙이면
 * '임시 임시 점검'처럼 첫 단어가 두 번 나온다(사용자 테스트 DF-019). 가져온 항목(코드 'W-1' 꼴)은 그대로 '{code} {name}' 이다.
 */
export function wbsDisplayTitle(code: string | null | undefined, name: string): string {
  const c = (code ?? '').trim()
  const n = name.trim()
  if (!c) return n
  if (n === c || n.startsWith(`${c} `) || n.startsWith(`${c}.`)) return n
  return `${c} ${n}`.trim()
}
