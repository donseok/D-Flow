// 팀 기준정보 순수 도메인 — I/O 없음. 런타임 소스는 lib/teams/master.ts(서버 캐시).
import type { TeamCode } from './types'

export interface Team {
  id: string
  /** 표시명이자 식별 코드(teams.code). teams.name은 code와 동기. */
  code: TeamCode
  sortOrder: number
  active: boolean
  /** 대시보드 '팀별 진척현황' 노출 여부(진척 제외 팀 규칙의 데이터화). */
  progressVisible: boolean
  /** null = 그 워크스페이스의 공용 팀(회의록·또박또박·계정의 유일한 축). 값 = 그 프로젝트 전용 팀(0071). */
  projectId: string | null
  /** 소속 워크스페이스(0003 not null). "전역 팀"은 워크스페이스마다 따로다 — 접근자가 이 값으로 좁힌다(SP2 §4.2). */
  workspaceId: string
}

/** 미제공 TeamsProvider 기본값 + 테스트 픽스처(2026-07 5팀). 서버 팀 마스터는 폴백하지 않는다
 *  — SP4 에서 fixtures 로 이동. DB 행이 아니라 소속 워크스페이스가 없다(workspaceId '' — 어떤 워크스페이스 접근자에도 걸리지 않는다). */
export const DEFAULT_TEAMS: readonly Team[] = [
  { id: 'default-pmo', code: 'PMO', sortOrder: 0, active: true, progressVisible: true, projectId: null, workspaceId: '' },
  { id: 'default-erp', code: 'ERP', sortOrder: 1, active: true, progressVisible: true, projectId: null, workspaceId: '' },
  { id: 'default-mes', code: 'MES', sortOrder: 2, active: true, progressVisible: true, projectId: null, workspaceId: '' },
  { id: 'default-gagong', code: '가공', sortOrder: 3, active: true, progressVisible: true, projectId: null, workspaceId: '' },
  { id: 'default-mdm', code: 'MDM', sortOrder: 4, active: true, progressVisible: false, projectId: null, workspaceId: '' },
]

export const DEFAULT_TEAM_CODES: readonly TeamCode[] = DEFAULT_TEAMS.map(t => t.code)

/** 활성 팀 코드 — sortOrder, 동률이면 code 순. 탭·필터·셀렉트 공용 순서. */
export function activeCodes(teams: readonly Team[]): TeamCode[] {
  return [...teams]
    .filter(t => t.active)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code, 'ko'))
    .map(t => t.code)
}

/** 코드→표시 순서 인덱스(담당 정렬용). */
export function teamOrderMap(codes: readonly TeamCode[]): Map<string, number> {
  return new Map(codes.map((c, i) => [c, i]))
}

/** 엑셀 헤더에서 팀 열 탐색에 쓰이는 이름들 — 팀명으로 쓰면 열 맵이 오염된다. */
export const RESERVED_TEAM_NAMES: readonly string[] = [
  'Biz', 'Phase', 'Task', 'Activity', '담당', '산출물', '계획',
  '시작', '종료', '가중치', '실적%', '계획%', '계획대비%', '상태',
]

const TEAM_CODE_MAX = 20

/** 관리 화면 팀 추가 입력 검증 — 중복 검사는 액션(DB 대조)에서. */
export function normalizeNewTeamCode(
  input: string,
): { ok: true; code: string } | { ok: false; error: string } {
  const code = input.trim()
  if (!code) return { ok: false, error: '팀 이름을 입력하세요.' }
  if (code.length > TEAM_CODE_MAX) return { ok: false, error: `팀 이름은 ${TEAM_CODE_MAX}자 이하여야 합니다.` }
  if ((RESERVED_TEAM_NAMES as readonly string[]).includes(code)) {
    return { ok: false, error: `'${code}'는 엑셀 양식 예약어라 팀 이름으로 쓸 수 없습니다.` }
  }
  return { ok: true, code }
}

/** 프로젝트 화면의 팀 목록 해석 — 프로젝트 행이 하나라도 있으면(비활성 포함) 그것만, 없으면 그 프로젝트 워크스페이스의
 *  공용 팀으로 폴백. 비활성 포함으로 판정해야 "전 팀 비활성화"가 공용 상속으로 오해 복귀하지 않는다(스펙 §2).
 *  workspaceId 는 그 프로젝트의 워크스페이스다 — 모르면(null, 존재하지 않는 프로젝트) 어느 워크스페이스로도 폴백하지 않는다.
 *  폴백이 전 워크스페이스의 공용 팀이면 다른 워크스페이스의 팀 코드가 화면·검증으로 흐른다(SP2 §4.2). */
export function resolveTeamsForProject(all: readonly Team[], projectId: string, workspaceId: string | null): Team[] {
  const own = all.filter(t => t.projectId === projectId)
  if (own.length > 0) return own
  if (workspaceId === null) return []
  return all.filter(t => t.projectId === null && t.workspaceId === workspaceId)
}

/** 여러 워크스페이스의 활성 공용 팀(activeCodes 순, 코드가 겹치면 첫 것만) — 앱 레이아웃이 TeamsProvider 로 내리는 목록.
 *  워크스페이스마다 같은 코드가 있을 수 있다 — 겹친 채 내리면 탭·필터가 같은 팀을 두 번 그린다. */
export function activeTeamsForWorkspaces(all: readonly Team[], workspaceIds: Iterable<string>): Team[] {
  const ws = new Set(workspaceIds)
  const seen = new Set<string>()
  return [...all]
    .filter(t => t.active && t.projectId === null && ws.has(t.workspaceId))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code, 'ko'))
    .filter(t => {
      if (seen.has(t.code)) return false
      seen.add(t.code)
      return true
    })
}

/** 조회자에게 보이는 팀의 범위 — 플랫폼 관리자(all)는 전 워크스페이스, 아니면 소속 워크스페이스들의 공용 팀과
 *  볼 수 있는 프로젝트들의 전용 팀. Actor 에서 만드는 규칙은 domain/authz 의 teamViewOf. */
export type TeamView =
  | { all: true }
  | { all: false; workspaceIds: Iterable<string>; projectIds: Iterable<string> }

/** 조회자가 볼 수 있는 활성 팀 코드(activeCodes 순, 중복 없음) — 회의록 담당 필터·검증(채팅·외부 GET·봇)의 단일 판정.
 *  프로젝트에 연결된 회의록의 담당은 그 프로젝트 팀이라, 소속 워크스페이스의 공용 팀만으로는 전용 팀 코드가 빠진다. */
export function teamCodesVisibleTo(all: readonly Team[], view: TeamView): TeamCode[] {
  if (view.all) return [...new Set(activeCodes(all))]
  const ws = new Set(view.workspaceIds)
  const ps = new Set(view.projectIds)
  return [...new Set(activeCodes(all.filter(t => (t.projectId === null ? ws.has(t.workspaceId) : ps.has(t.projectId)))))]
}
