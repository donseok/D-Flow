import 'server-only'

// 봇 도구의 팀 원천(SP4 A2 P16) — 도구 생성자·실행 컨텍스트에는 클라이언트가 없다. 조립 지점(createDefaultChatToolRegistry)의 세션
// 클라이언트로 요청 범위 원천(src/lib/teams/source.ts)을 묶어 도구에 넘긴다. 실패는 그대로 올린다 — 오케스트레이터가 도구 실패로 올린다.
// 도구는 이 파일에서 형(ToolTeamSource)만 import 한다(테스트는 tests/helpers/tool-team-source.ts 의 고정 원천을 넘긴다).
import type { TeamView } from '@/lib/domain/authz'
import { activeCodes } from '@/lib/domain/teams'
import type { TeamCode } from '@/lib/domain/types'
import type { ConfigReadClient } from '@/lib/settings/projectConfig'
import { projectTeams, teamCodesVisibleTo } from '@/lib/teams/source'

export interface ToolTeamSource {
  /** 그 프로젝트 팀(전용 우선·공용 폴백)의 활성 코드 — activeCodes 순 */
  projectTeamCodes(projectId: string): Promise<TeamCode[]>
  /** 가시 범위의 활성 팀 코드 — view 는 teamViewOfScope(context) 로만 만든다 */
  visibleTeamCodes(view: TeamView): Promise<TeamCode[]>
}

export function createToolTeamSource(client: ConfigReadClient): ToolTeamSource {
  return {
    projectTeamCodes: async (projectId) => activeCodes(await projectTeams(projectId, { client })),
    visibleTeamCodes: (view) => teamCodesVisibleTo(view, { client }),
  }
}
