// 회의록 도메인의 팀 목록 — 회의록이 속한 범위(프로젝트, 없으면 워크스페이스)로 좁힌다(SP2 §4.2).
// 전 워크스페이스 공용 목록(activeTeamCodesSync·teamsSync)으로 검증하면 다른 워크스페이스의 팀 코드가 통과한다.
// 범위는 대상 행이나 호출자의 스코프에서 온다 — 클라이언트 입력으로 정하지 않는다.
// 워크스페이스 접근자는 팀 캐시를 한 번도 못 채웠으면 throw 한다 — 빈 목록으로 위장하지 않으므로 호출부가 오류로 올린다.
import {
  activeTeamCodesForProjectSync, activeTeamCodesForWorkspaceSync, teamsForProjectSync, teamsForWorkspaceSync,
} from '@/lib/teams/master'
import type { TeamCode } from '@/lib/domain/types'

/** 회의록 한 건의 범위 — 회의록의 워크스페이스는 바뀌지 않고, 프로젝트는 그 워크스페이스 안에서만 바뀐다. */
export interface MinuteScope {
  projectId: string | null
  workspaceId: string
}

/** 담당 팀 검증·편철용 활성 팀 코드 — 프로젝트가 있으면 그 프로젝트의 팀, 없으면 그 워크스페이스의 공용 팀. */
export function activeTeamCodesForMinuteScope(scope: MinuteScope): TeamCode[] {
  return scope.projectId
    ? activeTeamCodesForProjectSync(scope.projectId)
    : activeTeamCodesForWorkspaceSync(scope.workspaceId)
}

/** 등록 팀 코드(비활성 포함) — 폴더 루트의 팀 기본 폴더명 예약어(앵커 사칭) 판정용. */
export function teamCodesForMinuteScope(scope: MinuteScope): TeamCode[] {
  return (scope.projectId ? teamsForProjectSync(scope.projectId) : teamsForWorkspaceSync(scope.workspaceId))
    .map(t => t.code)
}

/** 여러 워크스페이스 공용 팀의 활성 코드 합집합(첫 등장 순) — 대상 행 없이 호출자의 워크스페이스들로 거르는 필터용. */
export function activeTeamCodesForWorkspacesSync(workspaceIds: Iterable<string>): TeamCode[] {
  return [...new Set([...workspaceIds].flatMap(wid => activeTeamCodesForWorkspaceSync(wid)))]
}
