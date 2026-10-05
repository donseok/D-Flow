/**
 * 팀 생성·개명이 회의록 팀 루트 때문에 막힐 때의 문구(SP5 B2 — D52). create_team·개명 동기 트리거(teams_name_sync_minute_roots)가
 * 같은 두 토큰을 낸다. 순수 — 토큰이 아니면 null(호출부의 기존 매핑으로).
 */
export const TEAM_ROOT_NAME_CONFLICT_MSG =
  '같은 이름의 회의록 최상위 폴더가 이미 있어 이 팀 이름을 쓸 수 없습니다. 다른 이름을 고르거나 그 폴더의 이름을 먼저 바꾸세요.'
export const TEAM_ROOT_NAME_TOO_LONG_MSG = '팀 이름이 60자를 넘어 회의록 폴더 이름으로 쓸 수 없습니다. 60자 이하로 줄이세요.'

export function teamRootNameError(error: { code?: string; message?: string } | null | undefined): string | null {
  const m = error?.message ?? ''
  if (m.includes('TEAM_ROOT_NAME_CONFLICT')) return TEAM_ROOT_NAME_CONFLICT_MSG
  if (m.includes('TEAM_ROOT_NAME_TOO_LONG')) return TEAM_ROOT_NAME_TOO_LONG_MSG
  return null
}
