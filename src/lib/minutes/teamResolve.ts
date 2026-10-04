/**
 * 회의록 팀 해석(SP5 B2 — 스펙 D18) — 순수. I/O 없음. SQL `minute_team_for_code`(0024)와 같은 code 단위 규칙이다:
 *   프로젝트 범위 → 그 프로젝트의 같은 code 전용 팀, 없으면 같은 워크스페이스의 같은 code 공용 팀
 *   무프로젝트   → 같은 code 공용 팀만
 *   다른 프로젝트의 전용 팀은 어느 경우에도 고르지 않는다. 활성 여부는 보지 않는다(과거 편철을 지킨다 — 비활성 거부는 호출부·트리거 몫).
 * 호출부는 한 워크스페이스의 팀만 넘긴다(워크스페이스 경계는 조회가 정한다).
 */
export interface TeamRef {
  id: string
  code: string
  name: string
  /** null = 공용 팀 */
  projectId: string | null
  active: boolean
}

export function teamForCode<T extends Pick<TeamRef, 'code' | 'projectId'>>(
  teams: readonly T[], scope: { projectId: string | null }, code: string,
): T | null {
  if (scope.projectId) {
    const own = teams.find(t => t.projectId === scope.projectId && t.code === code)
    if (own) return own
  }
  return teams.find(t => t.projectId === null && t.code === code) ?? null
}

/** 한 범위에서 고를 수 있는 팀(전용 + 공용, code 가 겹치면 전용) — 업로드·필터 선택지. 순서는 입력 순서 */
export function teamsInScope<T extends Pick<TeamRef, 'code' | 'projectId'>>(
  teams: readonly T[], scope: { projectId: string | null },
): T[] {
  const ownCodes = new Set(scope.projectId ? teams.filter(t => t.projectId === scope.projectId).map(t => t.code) : [])
  return teams.filter(t => (scope.projectId !== null && t.projectId === scope.projectId)
    || (t.projectId === null && !ownCodes.has(t.code)))
}
