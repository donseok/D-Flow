// 회의록 도메인의 팀 목록 — 회의록이 속한 범위(프로젝트, 없으면 워크스페이스)로 좁힌다(SP2 §4.2).
// 전 워크스페이스 공용 목록으로 검증하면 다른 워크스페이스의 팀 코드가 통과한다. 범위는 대상 행이나 호출자의 스코프에서 온다.
// 원천은 요청 범위 팀 원천(SP4 A2 — src/lib/teams/source.ts). 세션 없는 경로(외부 회의록 API)는 { client: admin } 을 넘긴다.
// 조회 실패는 TeamsUnavailableError 로 올라간다 — 빈 목록으로 위장하지 않으므로 호출부가 오류로 올린다.
// 호출자 쪽 필터(대상 행 없이 호출자 범위로 거르는 담당 필터)는 원천의 teamCodesVisibleTo(teamViewOf) 를 쓴다.
import { activeCodes } from '@/lib/domain/teams'
import type { TeamCode } from '@/lib/domain/types'
import type { ConfigReadClient } from '@/lib/settings/projectConfig'
import { projectTeams, workspaceTeams } from '@/lib/teams/source'

/** 회의록 한 건의 범위 — 회의록의 워크스페이스는 바뀌지 않고, 프로젝트는 그 워크스페이스 안에서만 바뀐다. */
export interface MinuteScope {
  projectId: string | null
  workspaceId: string
}
type Opts = { client?: ConfigReadClient }

const teamsOf = (scope: MinuteScope, opts?: Opts) =>
  scope.projectId ? projectTeams(scope.projectId, opts) : workspaceTeams(scope.workspaceId, opts)

/** 담당 팀 검증·편철용 활성 팀 코드 — 프로젝트가 있으면 그 프로젝트의 팀, 없으면 그 워크스페이스의 공용 팀. */
export async function activeTeamCodesForMinuteScope(scope: MinuteScope, opts?: Opts): Promise<TeamCode[]> {
  return activeCodes(await teamsOf(scope, opts))
}

/** 등록 팀 코드(비활성 포함) — 폴더 루트의 팀 기본 폴더명 예약어(앵커 사칭) 판정용. */
export async function teamCodesForMinuteScope(scope: MinuteScope, opts?: Opts): Promise<TeamCode[]> {
  return (await teamsOf(scope, opts)).map((t) => t.code)
}

/** 등록 팀 이름(비활성 포함) — 최상위 일반 폴더가 팀 루트 이름(= 팀 이름)을 선점하지 못하게(SP5 B2, DB MINUTE_FOLDER_NAME_RESERVED 의 앞단). */
export async function teamNamesForMinuteScope(scope: MinuteScope, opts?: Opts): Promise<string[]> {
  return (await teamsOf(scope, opts)).map((t) => t.name.trim())
}
