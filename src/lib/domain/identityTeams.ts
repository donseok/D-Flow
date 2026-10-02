// 헤더 소속 표시의 재료(순수) — 계정 전역 팀(옛 Actor.teamCode)은 0003 에서 사라졌다.
// 소속은 프로젝트마다 명단의 대표 팀이고(rosterTeams 의 첫 원소), 한 사람이 여러 프로젝트·여러 팀에 걸칠 수 있다.
import type { Actor } from './authz'
import { compareKoreanName } from './nameSort'

/** 내 모든 프로젝트의 대표 팀 code — 중복 제거, 가나다순. 명단 팀이 없으면(플랫폼 관리자 포함) 빈 목록.
 *  workspaceId 를 주면 그 워크스페이스의 프로젝트만 센다(화면이 한 워크스페이스로 닫힌 곳의 기본 팀 — 다른 워크스페이스의 팀 코드가 기본값이 되지 않게). */
export function identityTeamCodes(actor: Actor | null, workspaceId?: string): string[] {
  if (!actor) return []
  const codes = new Set<string>()
  for (const [projectId, { teamCodes }] of actor.rosterTeams) {
    if (workspaceId !== undefined && actor.projectWorkspace.get(projectId) !== workspaceId) continue
    const primary = teamCodes[0]
    if (primary) codes.add(primary)
  }
  return [...codes].sort(compareKoreanName)
}

/** 0팀 '소속 미지정', 1팀 그 code, n팀 '첫 팀 외 n-1'. */
export function identityTeamLabel(codes: readonly string[]): string {
  if (codes.length === 0) return '소속 미지정'
  if (codes.length === 1) return codes[0]
  return `${codes[0]} 외 ${codes.length - 1}`
}
