/**
 * 사용자 정의 roving 라디오(`button role="radio"`)의 방향키 규칙 — APG 라디오 그룹: →/↓ 다음, ←/↑ 이전(둘 다 순환), Home 처음, End 끝.
 * 테마(ThemeRadioGroup)·언어(AccountView) 두 그룹이 같은 규칙을 쓴다. 그 밖의 키는 null(호출부가 기본 동작을 막지 않는다).
 */
export function rovingRadioIndex(key: string, i: number, n: number): number | null {
  if (key === 'ArrowRight' || key === 'ArrowDown') return (i + 1) % n
  if (key === 'ArrowLeft' || key === 'ArrowUp') return (i - 1 + n) % n
  if (key === 'Home') return 0
  if (key === 'End') return n - 1
  return null
}
