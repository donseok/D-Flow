import { DEFAULT_TEAMS } from '@/lib/domain/teams'

/**
 * `@/lib/teams/master` 목 — 6개 테스트 파일이 각자 복제해 쓰던 동일한 24줄을 여기 하나로 모았다.
 * 서버 팀 마스터는 더 이상 폴백하지 않는다(콜드스타트 실패 시 빈 목록) — 이 파일들은 팀 검증을
 * 거치는 프로덕션 경로를 실 DB 없이 통과시켜야 하므로, 과거 DEFAULT_TEAMS 폴백과 동일한 고정
 * 팀 목록을 이 목이 대신 공급한다. `DEFAULT_TEAMS` 자체(도메인 픽스처)에서 만들어 두 값이
 * 갈라지지 않게 한다.
 *
 * vi.mock 은 팩토리를 정적으로 끌어올린다(호이스팅) — 공유 헬퍼를 쓰려면 호출부에서
 * `vi.mock('@/lib/teams/master', async () => (await import('../helpers/teams-master-mock')).teamsMasterMock())`
 * 처럼 async 팩토리 안에서 동적 import 해야 한다(정적 import 로 끌어오면 호이스팅 규칙에 걸린다).
 */
export function teamsMasterMock() {
  const TEAMS = DEFAULT_TEAMS
  const codes = TEAMS.map(t => t.code)
  return {
    teamsForProjectSync: () => TEAMS,
    activeTeamCodesForProjectSync: () => codes,
    // 워크스페이스·가시 범위 접근자 — 이 목의 고정 팀은 워크스페이스를 가리지 않는다(워크스페이스 경계 검증은 개별 테스트가
    // 따로 목한다).
    teamsForWorkspaceSync: () => TEAMS,
    activeTeamCodesForWorkspaceSync: () => codes,
    activeTeamsForWorkspacesSync: () => TEAMS.filter(t => t.active),
    activeTeamCodesVisibleToSync: () => codes,
    workspaceTeamsForProjectSync: () => TEAMS,
    isRegisteredTeamCodeForProject: (code: string) => TEAMS.some(t => t.code === code),
    isActiveTeamCodeForProject: (code: string) => TEAMS.some(t => t.active && t.code === code),
    projectTeamRowsSync: () => [],
    refreshTeams: async () => true,
  }
}
