import { vi } from 'vitest'
import type { Team } from '@/lib/domain/teams'
import { FIXTURE_TEAMS } from '../fixtures/teams'

/**
 * `@/lib/teams/source` 목(스펙 §4.2.1 — 소비처 테스트의 공용 도우미). vi.mock 팩토리는 호이스팅되므로 호출부에서
 *   vi.mock('@/lib/teams/source', async () => (await import('../helpers/teams-source-mock')).teamsSourceMock())
 * 처럼 async 팩토리 안에서 동적 import 한다. 케이스마다 값을 바꾸려면 테스트 파일이 import 한 함수에
 *   vi.mocked(projectTeams).mockResolvedValue([...])
 * 를 건다. TeamsUnavailableError 는 목 모듈의 클래스다 — 소비처가 같은 모듈에서 import 하므로 instanceof 가 맞는다.
 * 기본 팀은 FIXTURE_TEAMS(공용 팀 다섯) — projectTeams 는 그대로, projectOwnTeams 는 전용 팀(projectId 있음)만, workspaceTeams 는 공용만,
 * visibleTeams·teamCodesVisibleTo 는 활성 팀 전부(가시 범위 판정은 순수 teamsVisibleTo 의 몫 — 소비처 테스트는 값을 바꿔 건다).
 */
export function teamsSourceMock(teams: readonly Team[] = FIXTURE_TEAMS) {
  class TeamsUnavailableError extends Error {
    readonly code = 'TEAMS_UNAVAILABLE' as const
    constructor(message = '팀 목록을 불러오지 못했습니다.', options?: { cause?: unknown }) {
      super(message, options)
      this.name = 'TeamsUnavailableError'
    }
  }
  return {
    TeamsUnavailableError,
    projectTeams: vi.fn(async (): Promise<Team[]> => [...teams]),
    projectOwnTeams: vi.fn(async (): Promise<Team[]> => teams.filter((t) => t.projectId !== null)),
    workspaceTeams: vi.fn(async (): Promise<Team[]> => teams.filter((t) => t.projectId === null)),
    visibleTeams: vi.fn(async (): Promise<Team[]> => teams.filter((t) => t.active)),
    teamCodesVisibleTo: vi.fn(async (): Promise<string[]> => teams.filter((t) => t.active).map((t) => t.code)),
  }
}
