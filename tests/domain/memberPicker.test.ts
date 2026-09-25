import { describe, expect, it } from 'vitest'
import {
  buildMemberPickerSections, memberBelongsToTeam, memberOptionView, EXTERNAL_BADGE, INACTIVE_BADGE,
} from '@/lib/domain/memberPicker'
import type { ProjectMember, TeamCode } from '@/lib/domain/types'
import { makeRosterMember } from '../fixtures/rosterMember'

function member(id: string, name: string, teamCode: TeamCode | null): ProjectMember {
  return makeRosterMember({
    id,
    projectId: 'p1',
    name,
    email: null,
    team: teamCode,
    title: null,
    roleLabel: null,
    hasAccount: true,
    createdAt: '2026-08-02T00:00:00.000Z',
  })
}

function categories(sections: ReturnType<typeof buildMemberPickerSections>) {
  return sections.map(section => section.kind === 'category' ? section.category : 'all')
}

describe('buildMemberPickerSections', () => {
  it('이름 보기에서는 가나다순으로 정렬하고 입력 배열은 변경하지 않는다', () => {
    const members = [
      member('3', '홍길동', 'MES'),
      member('1', '김가영', 'ERP'),
      member('2', '박도연', null),
    ]
    const originalIds = members.map(item => item.id)

    const sections = buildMemberPickerSections(members, { view: 'name' })

    expect(sections).toHaveLength(1)
    expect(sections[0]).toMatchObject({ kind: 'all' })
    expect(sections[0].members.map(item => item.name))
      .toEqual(['김가영', '박도연', '홍길동'])
    expect(sections[0].members).not.toBe(members)
    expect(members.map(item => item.id)).toEqual(originalIds)
  })

  it('호출할 때 전달한 categoryOrder를 동적으로 반영한다', () => {
    const members = [
      member('1', '김메스', 'MES'),
      member('2', '박이알피', 'ERP'),
      member('3', '이피엠오', 'PMO'),
    ]

    expect(categories(buildMemberPickerSections(members, {
      view: 'category',
      categoryOrder: ['PMO', 'MES', 'ERP'],
    }))).toEqual(['PMO', 'MES', 'ERP'])

    expect(categories(buildMemberPickerSections(members, {
      view: 'category',
      categoryOrder: ['ERP', 'PMO', 'MES'],
    }))).toEqual(['ERP', 'PMO', 'MES'])
  })

  it('팀 마스터에 없는 과거 팀도 현재 팀 뒤에 보존한다', () => {
    const members = [
      member('1', '김현재', 'MES'),
      member('2', '박과거비', 'OLD-B'),
      member('3', '이과거에이', 'OLD-A'),
    ]

    const sections = buildMemberPickerSections(members, {
      view: 'category',
      categoryOrder: ['MES', 'ERP'],
    })

    expect(categories(sections)).toEqual(['MES', 'OLD-A', 'OLD-B'])
    expect(sections.flatMap(section => section.members.map(item => item.id)))
      .toEqual(['1', '3', '2'])
  })

  it('카테고리 안의 구성원은 항상 가나다순으로 정렬한다', () => {
    const members = [
      member('3', '최지훈', 'ERP'),
      member('1', '강정한', 'ERP'),
      member('2', '김기림', 'ERP'),
    ]

    const [erp] = buildMemberPickerSections(members, {
      view: 'category',
      categoryOrder: ['ERP'],
    })

    expect(erp).toMatchObject({ kind: 'category', category: 'ERP' })
    expect(erp.members.map(item => item.name)).toEqual(['강정한', '김기림', '최지훈'])
  })

  it('담당 미지정과 공백 카테고리를 하나로 묶어 항상 마지막에 둔다', () => {
    const members = [
      member('1', '김미지정', null),
      member('2', '박현재', 'MES'),
      member('3', '이미지정', '   '),
      member('4', '최과거', 'OLD'),
    ]

    const sections = buildMemberPickerSections(members, {
      view: 'category',
      categoryOrder: ['MES'],
    })

    expect(categories(sections)).toEqual(['MES', 'OLD', null])
    expect(sections.at(-1)).toMatchObject({ kind: 'category', category: null })
    expect(sections.at(-1)?.members.map(item => item.name)).toEqual(['김미지정', '이미지정'])
  })

  it('이름과 팀을 검색하며 영문 대소문자와 검색어 앞뒤 공백을 무시한다', () => {
    const members = [
      member('1', 'Alice Kim', 'MES'),
      member('2', 'Bob Lee', 'ERP'),
      member('3', '강정한', 'PMO'),
    ]

    const byName = buildMemberPickerSections(members, {
      view: 'name',
      query: '  ALICE  ',
    })
    expect(byName[0].members.map(item => item.id)).toEqual(['1'])

    const byTeam = buildMemberPickerSections(members, {
      view: 'category',
      query: ' eRp ',
      categoryOrder: ['MES', 'ERP', 'PMO'],
    })
    expect(categories(byTeam)).toEqual(['ERP'])
    expect(byTeam[0].members.map(item => item.id)).toEqual(['2'])
  })

  it('여러 팀에 속한 사람은 대표 팀이 아닌 팀 코드로 검색해도 걸린다(teams.some)', () => {
    const multiTeam = makeRosterMember({
      id: '9', projectId: 'p1', name: '여러팀김', email: null, title: null, roleLabel: null,
      hasAccount: true, createdAt: '2026-08-02T00:00:00.000Z',
      teams: [
        { id: 't-mes', code: 'MES', name: 'MES', isPrimary: true },
        { id: 't-erp', code: 'ERP', name: 'ERP', isPrimary: false },
      ],
    })
    const members = [member('1', '단일팀박', 'MES'), multiTeam]

    const sections = buildMemberPickerSections(members, { view: 'name', query: 'erp' })

    expect(sections[0].members.map(item => item.id)).toEqual(['9'])
  })

  it('active===false 인 사람은 기본 제외하지만, selectedIds 에 있으면 남긴다', () => {
    const activeMember = member('1', '활성김', 'MES')
    const inactiveMember = makeRosterMember({
      id: '2', projectId: 'p1', name: '비활성박', email: null, team: 'ERP', title: null,
      roleLabel: null, hasAccount: true, createdAt: '2026-08-02T00:00:00.000Z', active: false,
    })
    const members = [activeMember, inactiveMember]

    const excluded = buildMemberPickerSections(members, { view: 'name' })
    expect(excluded[0].members.map(item => item.id)).toEqual(['1'])

    const kept = buildMemberPickerSections(members, { view: 'name', selectedIds: ['2'] })
    expect(kept[0].members.map(item => item.id).sort()).toEqual(['1', '2'])
  })
})

describe('memberOptionView', () => {
  it('외부 인력(kind===external)에는 배지를 싣고, 라벨은 이름 · 대표팀코드다', () => {
    const external = makeRosterMember({
      id: '1', projectId: 'p1', name: '외부이', email: null, team: 'MES', title: null,
      roleLabel: null, hasAccount: false, createdAt: '2026-08-02T00:00:00.000Z',
    })

    const view = memberOptionView(external)

    expect(view.label).toBe('외부이 · MES')
    expect(view.badge).toBe(EXTERNAL_BADGE)
  })

  it('팀이 없으면 라벨은 이름만이다', () => {
    const noTeam = makeRosterMember({
      id: '1', projectId: 'p1', name: '무팀김', email: null, team: null, title: null,
      roleLabel: null, hasAccount: true, createdAt: '2026-08-02T00:00:00.000Z',
    })

    expect(memberOptionView(noTeam).label).toBe('무팀김')
    expect(memberOptionView(noTeam).badge).toBeNull()
  })

  it('비활성 선택값은 비활성 배지를 싣는다(외부 인력이면 함께)', () => {
    const inactiveExternal = makeRosterMember({
      id: '1', projectId: 'p1', name: '비활성외부', email: null, team: null, title: null,
      roleLabel: null, hasAccount: false, createdAt: '2026-08-02T00:00:00.000Z', active: false,
    })

    expect(memberOptionView(inactiveExternal).badge).toBe(`${EXTERNAL_BADGE} · ${INACTIVE_BADGE}`)
  })
})

describe('memberBelongsToTeam', () => {
  it('teams 배열 어디에 있어도 참이다(대표 팀 아니어도)', () => {
    const m = makeRosterMember({
      id: '1', projectId: 'p1', name: '홍길동', email: null, title: null, roleLabel: null,
      hasAccount: true, createdAt: '2026-08-02T00:00:00.000Z',
      teams: [
        { id: 't-mes', code: 'MES', name: 'MES', isPrimary: true },
        { id: 't-erp', code: 'ERP', name: 'ERP', isPrimary: false },
      ],
    })

    expect(memberBelongsToTeam(m, 'ERP')).toBe(true)
    expect(memberBelongsToTeam(m, 'PMO')).toBe(false)
  })
})
