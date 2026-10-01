// 담당 영역(project_areas·area_teams) 순수 검증 — I/O 없음. kind 는 제품 고정, 행 값은 프로젝트 관리자 설정값.
// 소비처: 주간보고 영역(SP4 — 시트·이월·PPT·봇)과 이슈 영역(SP5). 담당 팀 0개를 허용한다 — 주간 영역은 담당 팀 없이도 쓰고
// 봇의 팀 필터에서 빠질 뿐이다(스펙 §4.1.3). 저장은 RPC upsert_project_area 한 길이고 여기서는 저장 전 형태만 맞춘다.
import type { Team } from './teams'

export const AREA_KINDS = ['weekly_section', 'issue_area'] as const
export type AreaKind = (typeof AREA_KINDS)[number]
export type AreaTeamKind = 'primary' | 'support'

export interface AreaTeamInput { teamId: string; kind: AreaTeamKind }
export interface AreaInput {
  id?: string
  kind: AreaKind
  code: string
  name: string
  sortOrder: number
  active: boolean
  teams: AreaTeamInput[]
}

/** 영역 순서의 절댓값 상한 — RPC 의 정수 형식(최대 아홉 자리)과 같다 */
export const AREA_SORT_ORDER_MAX = 999_999_999

/** 저장 전 검증. existing 은 같은 프로젝트의 영역(중복 kind/code 대조용) — DB 유니크가 최종 판정이다(upsertArea 는 [] 를 넘기고 23505 로 판정). */
export function validateArea(
  input: AreaInput,
  existing: readonly { id: string; kind: AreaKind; code: string }[],
): { ok: true; value: AreaInput } | { ok: false; error: string } {
  if (!(AREA_KINDS as readonly string[]).includes(input.kind)) return { ok: false, error: '알 수 없는 영역 종류입니다.' }
  const code = input.code.trim()
  if (!code) return { ok: false, error: '영역 코드를 입력하세요.' }
  const name = input.name.trim()
  if (!name) return { ok: false, error: '영역 이름을 입력하세요.' }
  if (typeof input.sortOrder !== 'number' || !Number.isInteger(input.sortOrder)) return { ok: false, error: '순서는 정수여야 합니다.' }
  // RPC(upsert_project_area)의 순서 형식 `^-?[0-9]{1,9}$` 과 같은 한도 — 넘으면 RPC 가 22023 AREA_INVALID_INPUT 을 내 "잠시 후 다시"류 결함
  // 문구가 됐다(A1-4 권한 리뷰 P3 — A2 이월 Z5 F-3). 입력 단계에서 사람이 고칠 수 있는 문구로 막는다
  if (Math.abs(input.sortOrder) > AREA_SORT_ORDER_MAX) return { ok: false, error: `순서는 -${AREA_SORT_ORDER_MAX}~${AREA_SORT_ORDER_MAX} 사이여야 합니다.` }
  if (existing.some(a => a.kind === input.kind && a.code === code && a.id !== input.id)) {
    return { ok: false, error: `'${code}' 코드가 이미 있습니다.` }
  }
  const seen = new Set<string>()
  for (const t of input.teams) {
    if (t.kind !== 'primary' && t.kind !== 'support') return { ok: false, error: '담당 팀 구분은 주·보조만 됩니다.' }
    if (seen.has(t.teamId)) return { ok: false, error: '같은 팀을 두 번 지정할 수 없습니다.' }
    seen.add(t.teamId)
  }
  return { ok: true, value: { ...input, code, name } }
}

/** code 는 이슈 ID 접두 등에 쓰여 불변이다(트리거 project_areas_guard). 액션 사전검사와 트리거 오류 매핑이 같은 문구를 쓴다. */
export const ERR_AREA_CODE_IMMUTABLE = '영역 코드는 바꿀 수 없습니다. 새 영역을 만들고 이전 영역을 비활성으로 두세요.'

/** 영역 편집기의 팀 선택지 — active=false 인 팀은 이미 배정된 영역에서만 보인다(해제할 수 있게). 새로 고를 수는 없다. */
export interface AreaTeamOption { id: string; code: string; active: boolean }

/**
 * 주간 영역 편집기의 팀 선택지(SP4 §4.1.8) — 그 프로젝트 팀(projectTeams 규칙, 비활성 포함 — 편집기가 활성만 새로 고르게 거른다)
 * + 어떤 영역에 이미 배정됐지만 그 목록 밖인 팀(전환 전 공용 팀 배정 등 — 비활성 선택지로 그 영역에서만 보여 해제할 수 있다).
 * 서버(upsertArea)의 허용 집합 "프로젝트 팀 ∪ 그 영역에 이미 배정된 팀"과 같은 재료다. 목록 밖 팀의 code 는 해석기 팀
 * (그 워크스페이스 공용 ∪ 그 프로젝트 전용)에서 찾고, 거기도 없으면 뺀다(표는 '알 수 없는 팀'으로 보인다).
 */
export function areaTeamOptions(
  projectTeams: readonly Pick<Team, 'id' | 'code' | 'active'>[],
  knownTeams: readonly { id: string; code: string }[],
  areas: readonly { teams: readonly { teamId: string }[] }[],
): AreaTeamOption[] {
  const out: AreaTeamOption[] = projectTeams.map(t => ({ id: t.id, code: t.code, active: t.active }))
  const seen = new Set(out.map(t => t.id))
  const codeOf = new Map(knownTeams.map(t => [t.id, t.code]))
  for (const a of areas) {
    for (const { teamId } of a.teams) {
      if (seen.has(teamId)) continue
      seen.add(teamId)
      const code = codeOf.get(teamId)
      if (code !== undefined) out.push({ id: teamId, code, active: false })
    }
  }
  return out
}
