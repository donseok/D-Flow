// 팀 기준정보 순수 도메인 — I/O 없음. 런타임 원천은 요청 범위 lib/teams/source.ts 하나(SP4).
import { josa } from '@/lib/i18n/particle'
import type { TeamView } from './authz'
import type { TeamCode } from './types'
import { EXCEL_HEADER_WORDS, isHeaderWordMatch } from '@/lib/excel/headerWords'

export interface Team {
  id: string
  /** 식별 코드(teams.code) — 불변. 담당·엑셀 팀 열·필터·봇 대조가 이 값으로 판정한다. */
  code: TeamCode
  /** 표시 이름(teams.name) — 만들 때 code 와 같고 SP4 A2 부터 개명할 수 있다(code 는 그대로, 스펙 D37). */
  name: string
  /** 저장된 색(teams.color, hex — 0003 기본값, 생성 순 팔레트 pickTeamColor). 화면 색 슬롯은 SP4 B 가 이 값으로 정한다(D3). */
  color: string
  sortOrder: number
  active: boolean
  /** 대시보드 '팀별 진척현황' 노출 여부(진척 제외 팀 규칙의 데이터화). */
  progressVisible: boolean
  /** null = 그 워크스페이스의 공용 팀(회의록·또박또박·계정의 유일한 축). 값 = 그 프로젝트 전용 팀(0071). */
  projectId: string | null
  /** 소속 워크스페이스(0003 not null). "전역 팀"은 워크스페이스마다 따로다 — 접근자가 이 값으로 좁힌다(SP2 §4.2). */
  workspaceId: string
}

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

/** 팀 이름으로 쓸 수 없는 낱말(SP4 D38) — 엑셀 머리 낱말 ∪ 그 프로젝트의 단계 이름 ∪ 추가 축 이름. 감지기가 그 머리를 계층·논리 열로
 *  읽으므로 같은 이름의 팀 열은 감지에서 사라진다. 공용 팀은 여러 프로젝트에 걸려 단계 이름이 하나로 정해지지 않는다 — 머리 낱말만 본다(K14). */
export function reservedTeamNames(input: { levelLabels: readonly string[]; extraAxisLabel: string | null }): string[] {
  return [...new Set([...EXCEL_HEADER_WORDS, ...input.levelLabels, ...(input.extraAxisLabel ? [input.extraAxisLabel] : [])])]
}

export const TEAM_CODE_MAX = 20

/** 팀 추가 입력 검증 — 중복 검사는 액션(DB 대조)에서. reserved 는 호출부가 reservedTeamNames 로 파생해 넘긴다(공용 팀은 EXCEL_HEADER_WORDS).
 *  예약어 비교는 감지기와 같게 대소문자·전각·공백을 무시한다. what 은 오류 문구의 낱말이다 — 가져오기는 엑셀의 값이 이름이자 code 라
 *  '팀 이름'(기본), 관리 화면의 코드 칸은 '팀 코드'(checkNewTeam). */
export function normalizeNewTeamCode(
  input: string, reserved: readonly string[], what: '팀 이름' | '팀 코드' = '팀 이름',
): { ok: true; code: string } | { ok: false; error: string } {
  const code = input.trim()
  if (!code) return { ok: false, error: `${what === '팀 코드' ? '팀 코드를' : '팀 이름을'} 입력하세요.` }
  if (code.length > TEAM_CODE_MAX) return { ok: false, error: `${what === '팀 코드' ? '팀 코드는' : '팀 이름은'} ${TEAM_CODE_MAX}자 이하여야 합니다.` }
  if (reserved.some((w) => isHeaderWordMatch(w, code))) {
    return { ok: false, error: `${josa(`'${code}'`, '은/는')} 엑셀 양식 예약어라 ${what === '팀 코드' ? '팀 코드로' : '팀 이름으로'} 쓸 수 없습니다.` }
  }
  return { ok: true, code }
}

/** 여러 팀 이름의 사전 검사(SP4 A1-5 R1) — 입력 순서대로 normalizeNewTeamCode 를 적용하고(중복은 한 번), 첫 불가 이름을 입력 그대로 돌려준다.
 *  가져오기 라우트가 되돌릴 수 없는 공용 팀 전환·409 확인 목록 앞에서 부른다 — 쓸 수 없는 이름이 든 요청은 아무 부수효과도 남기지 않는다.
 *  reserved 는 그 프로젝트의 예약어(reservedTeamNames — SP4 D38). */
export function validateNewTeamCodes(
  inputs: readonly string[], reserved: readonly string[],
): { ok: true; codes: string[] } | { ok: false; team: string; error: string } {
  const codes: string[] = []
  for (const input of inputs) {
    const n = normalizeNewTeamCode(input, reserved)
    if (!n.ok) return { ok: false, team: input, error: n.error }
    if (!codes.includes(n.code)) codes.push(n.code)
  }
  return { ok: true, codes }
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

/** 조회자가 볼 수 있는 활성 팀(activeCodes 순, 같은 code 는 첫 것만) — 회의록 담당 필터·검증(채팅·외부 GET·봇)과 봇 이름 매칭의 단일 판정.
 *  view 는 domain/authz 의 teamViewOf·teamViewOfScope 만 만든다(전부를 여는 뷰는 플랫폼 관리자 판정과 한 곳에).
 *  프로젝트에 연결된 회의록의 담당은 그 프로젝트 팀이라, 소속 워크스페이스의 공용 팀만으로는 전용 팀 코드가 빠진다. */
export function teamsVisibleTo(all: readonly Team[], view: TeamView): Team[] {
  const seen = new Set<string>()
  return teamsInView(all, view).filter((t) => (seen.has(t.code) ? false : (seen.add(t.code), true)))
}

/** teamsVisibleTo 에서 "같은 code 는 첫 것만" 을 뺀 것 — 조회자가 볼 수 있는 활성 팀 전부(activeCodes 순). 같은 code 의 공용·전용 팀이
 *  모두 남는다: 회의록 담당 필터가 code·이름으로 받은 값을 팀 id 집합으로 바꿀 때 쓴다(teamIdsMatching) */
export function teamsInView(all: readonly Team[], view: TeamView): Team[] {
  const ws = view.all ? null : new Set(view.workspaceIds)
  const ps = view.all ? null : new Set(view.projectIds)
  return all
    .filter((t) => t.active && (view.all || (t.projectId === null ? ws!.has(t.workspaceId) : ps!.has(t.projectId))))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code, 'ko'))
}

/** 담당 필터 값(code 또는 이름) → 그 값에 맞는 팀 id 전부(중복 없음). code 는 정확히, 이름은 앞뒤 공백만 걷고 정확히 대조한다(대소문자를
 *  구분한다 — code 대조와 같은 규칙). teams 는 그 범위에서 보이는 팀이다(teamsInView·RLS 로 좁힌 행). 화면의 담당 필터(minutes.team_id)와
 *  같은 기준으로 거르기 위한 것 — code 문자열(minutes.team_code 사본)로 거르면 이름으로 준 값이 맞지 않는다 */
export function teamIdsMatching(teams: readonly Pick<Team, 'id' | 'code' | 'name'>[], key: string): string[] {
  const k = key.trim()
  if (!k) return []
  return [...new Set(teams.filter((t) => t.code === k || t.name.trim() === k).map((t) => t.id))]
}

/** teamsVisibleTo 의 code — 같은 규칙(SP4 A2 에서 행 판정 위로 옮겼다. 결과는 옛 정의와 같다) */
export function teamCodesVisibleTo(all: readonly Team[], view: TeamView): TeamCode[] {
  return teamsVisibleTo(all, view).map((t) => t.code)
}
