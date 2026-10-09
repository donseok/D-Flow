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

/** 담당 필터의 "팀 없음" 값(0052) — 필터는 팀 id(uuid)라 uuid 가 아닌 고정 글자를 쓴다. 화면 탭 키·`?team=`·목록 액션 인자가 같은 값이다.
 *  고르는 행은 team_id null ∧ team_code '' 뿐이다 — 팀 행이 지워져 team_id 만 빈 옛 회의록(team_code 원문이 남음)은 들지 않는다 */
export const NO_TEAM_FILTER = 'none'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 회의록 화면의 `?team=` 해석(SP5 B2 — 필터는 팀 id). 옛 링크의 `?team=<code>` 는 code 단위로 한 번 해석해 id 로 리다이렉트한다.
 *  teams 는 그 화면이 고르게 하는 팀 목록(필터 탭과 같은 것)이다.
 *  - id: 그 목록의 팀 id 면 그대로 필터. `?team=none`(NO_TEAM_FILTER)은 팀 없음 필터 — code 가 'none' 인 팀의 옛 링크보다 먼저다
 *  - redirect: 옛 code(→ 해석한 id) 또는 범위 밖·모르는 값(→ null = 팀 파라미터 제거)
 *  - none: 파라미터 없음 */
export type TeamParam = { kind: 'none' } | { kind: 'id'; id: string } | { kind: 'redirect'; id: string | null }

export function resolveTeamParam<T extends Pick<TeamRef, 'id' | 'code' | 'projectId'>>(
  raw: string | null | undefined, teams: readonly T[], scope: { projectId: string | null },
): TeamParam {
  const v = (raw ?? '').trim()
  if (!v) return raw === undefined || raw === null ? { kind: 'none' } : { kind: 'redirect', id: null }
  if (v === NO_TEAM_FILTER) return { kind: 'id', id: NO_TEAM_FILTER }
  if (UUID.test(v)) {
    const lower = v.toLowerCase()
    return teams.some(t => t.id.toLowerCase() === lower) ? { kind: 'id', id: lower } : { kind: 'redirect', id: null }
  }
  return { kind: 'redirect', id: teamForCode(teams, scope, v)?.id ?? null }
}
