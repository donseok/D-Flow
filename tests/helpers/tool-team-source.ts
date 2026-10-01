import type { ToolTeamSource } from '@/lib/ai/tools/teamSource'
import { FIXTURE_TEAM_CODES } from '../fixtures/teams'

/**
 * 봇 도구의 팀 원천(SP4 A2 P16) — 고정 코드. 함수를 주면 프로젝트(가시 범위 조회면 null)마다 다른 코드. calls 는 읽은 순서
 * (`project:<id>` 또는 `visible`) — "팀은 접근 판정 뒤에만 읽는다"를 단언할 때 쓴다. throwOn 을 주면 그 조회가 실패한다.
 */
export function fixedToolTeams(
  codes: readonly string[] | ((projectId: string | null) => readonly string[]) = FIXTURE_TEAM_CODES,
  opts: { throwOn?: 'project' | 'visible' } = {},
): ToolTeamSource & { calls: string[] } {
  const calls: string[] = []
  const pick = (pid: string | null) => [...(typeof codes === 'function' ? codes(pid) : codes)]
  return {
    calls,
    async projectTeamCodes(projectId) {
      calls.push(`project:${projectId}`)
      if (opts.throwOn === 'project') throw new Error('teams down')
      return pick(projectId)
    },
    async visibleTeamCodes() {
      calls.push('visible')
      if (opts.throwOn === 'visible') throw new Error('teams down')
      return pick(null)
    },
  }
}
