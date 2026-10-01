import { vi } from 'vitest'
import { FIXTURE_TEAMS } from '../fixtures/teams'

/**
 * `@/lib/minutes/teamScope` 목(SP4 A2) — 회의록 액션·외부 API 테스트가 팀 원천을 통과시키는 공용 도우미. 범위와 무관하게
 * 고정 팀(FIXTURE_TEAMS)의 활성 코드·전체 코드를 돌려준다. 범위별로 다른 팀이 필요한 테스트는 자기 팩토리를 쓴다.
 *   vi.mock('@/lib/minutes/teamScope', async () => (await import('../helpers/team-scope-mock')).teamScopeMock())
 */
export function teamScopeMock(codes: readonly string[] = FIXTURE_TEAMS.filter((t) => t.active).map((t) => t.code)) {
  return {
    activeTeamCodesForMinuteScope: vi.fn(async () => [...codes]),
    teamCodesForMinuteScope: vi.fn(async () => FIXTURE_TEAMS.map((t) => t.code)),
  }
}
