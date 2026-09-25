// 담당 영역(project_areas·area_teams) 순수 검증 — I/O 없음. kind 는 제품 고정, 행 값은 프로젝트 관리자 설정값.
// 소비처(주간보고 구분·이슈 영역)는 SP4/SP5 — 여기서는 저장 전 형태만 맞춘다.

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

/** 저장 전 검증. existing 은 같은 프로젝트의 영역(중복 kind/code 대조용) — DB 유니크가 최종 판정이다. */
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
