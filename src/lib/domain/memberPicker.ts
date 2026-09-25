import { compareKoreanName, sortByKoreanName } from './nameSort'
import type { ProjectMember, TeamCode } from './types'

export type MemberPickerView = 'name' | 'category'

export type MemberPickerSection =
  | { kind: 'all'; members: ProjectMember[] }
  | { kind: 'category'; category: TeamCode | null; members: ProjectMember[] }

interface BuildMemberPickerSectionsOptions {
  query?: string
  view: MemberPickerView
  /** 프로젝트 팀 마스터의 표시 순서. 목록에만 남은 과거 팀은 그 뒤에 보존한다. */
  categoryOrder?: readonly TeamCode[]
  /**
   * 현재 선택값(단일/다중 공용) — active===false 인 사람도 이미 선택돼 있으면 목록에서
   * 빼지 않는다(2026-09-25 컨트롤러 addendum). 선택돼 있지 않은 비활성 행은 기본 제외.
   */
  selectedIds?: readonly string[]
}
/** 대표 팀(teams[0]) — teamCode 단수 필드는 deprecated, teams 배열이 정본. */
function normalizedCategory(member: ProjectMember): TeamCode | null {
  const category = member.teams[0]?.code?.trim()
  return category || null
}

/** 이 사람이 주어진 팀 코드에 속하는가 — 대표 팀뿐 아니라 teams 배열 전체를 본다. */
export function memberBelongsToTeam(member: ProjectMember, teamCode: TeamCode): boolean {
  return member.teams.some(t => t.code === teamCode)
}

export const EXTERNAL_BADGE = '계정 미연결'
export const INACTIVE_BADGE = '비활성'

export interface MemberOptionView {
  id: string
  /** `이름 · 대표팀코드`(대표 팀이 있을 때만) — 선택기 옵션·칩이 공유하는 표기. */
  label: string
  /** 외부 인력('계정 미연결')·비활성('비활성') 안내. 없으면 null. 둘 다면 ` · `로 이어 붙인다. */
  badge: string | null
}

/** 선택기 옵션 한 행의 표시 모델(순수) — MemberSelectOptions·ProjectMemberMultiPicker·AssigneeComboBox 가 공유. */
export function memberOptionView(member: ProjectMember): MemberOptionView {
  const teamCode = normalizedCategory(member)
  const badges = [
    member.kind === 'external' ? EXTERNAL_BADGE : null,
    member.active ? null : INACTIVE_BADGE,
  ].filter((b): b is string => b !== null)
  return {
    id: member.id,
    label: teamCode ? `${member.name} · ${teamCode}` : member.name,
    badge: badges.length ? badges.join(' · ') : null,
  }
}

/**
 * 사람 선택기에 쓰는 표시 전용 모델.
 *
 * 서버의 전역 가나다순 계약은 건드리지 않고, 선택기 안에서만 이름순 또는 담당 카테고리별로
 * 재배치한다. 카테고리별 보기에서는 프로젝트 팀 마스터 순서 → 목록에만 존재하는 과거 팀 →
 * 담당 미지정 순이며, 각 그룹 안은 항상 가나다순이다.
 *
 * active===false 인 행은 기본 제외한다(쓰기 검증의 active 필터와 일치). 이미 선택된 값이면
 * selectedIds 로 예외를 둬 목록에 남긴다 — 호출부가 비활성 배지로 안내한다(2026-09-25 addendum).
 */
export function buildMemberPickerSections(
  members: readonly ProjectMember[],
  { query = '', view, categoryOrder = [], selectedIds = [] }: BuildMemberPickerSectionsOptions,
): MemberPickerSection[] {
  const keyword = query.trim().toLocaleLowerCase('ko-KR')
  const selectable = members.filter(member => member.active || selectedIds.includes(member.id))
  const filtered = keyword
    ? selectable.filter(member => (
      member.name.toLocaleLowerCase('ko-KR').includes(keyword)
      || member.teams.some(t => t.code.toLocaleLowerCase('ko-KR').includes(keyword))
    ))
    : [...selectable]
  const byName = sortByKoreanName(filtered, member => member.name)

  if (view === 'name') return [{ kind: 'all', members: byName }]

  const grouped = new Map<TeamCode | null, ProjectMember[]>()
  for (const member of byName) {
    const category = normalizedCategory(member)
    const group = grouped.get(category)
    if (group) group.push(member)
    else grouped.set(category, [member])
  }

  const order = new Map<string, number>()
  for (const category of categoryOrder) {
    const normalized = category.trim()
    if (normalized && !order.has(normalized)) order.set(normalized, order.size)
  }

  return [...grouped.entries()]
    .sort(([a], [b]) => {
      if (a === null) return b === null ? 0 : 1
      if (b === null) return -1
      const aOrder = order.get(a)
      const bOrder = order.get(b)
      if (aOrder !== undefined || bOrder !== undefined) {
        if (aOrder === undefined) return 1
        if (bOrder === undefined) return -1
        return aOrder - bOrder
      }
      return compareKoreanName(a, b)
    })
    .map(([category, categoryMembers]) => ({
      kind: 'category' as const,
      category,
      members: categoryMembers,
    }))
}
