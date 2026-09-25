import { describe, expect, it } from 'vitest'
import { canEditActual, canAttachDeliverable, actorTeamCodesFor, actorTeamIdsFor } from '@/lib/domain/permissions'
import type { ComputedItem } from '@/lib/domain/types'
import { makeAdminActor, makeMemberActor } from '../fixtures/actor'

// SP1: 계정 전역 팀(memberships)이 없어졌다 — '내 팀' = 그 프로젝트 명단의 내 팀 전부(project_member_teams).
const P = 'p1'
const leaf = (ownerTeam: string) =>
  ({ children: [], owners: [{ team: ownerTeam, kind: 'primary' }] } as unknown as ComputedItem)

describe('실적 편집 — 내 팀 = 프로젝트 명단의 내 팀 전부(다중 팀)', () => {
  it('명단 팀 일치면 허용', () => {
    expect(canEditActual(leaf('개발'), makeMemberActor(P, ['개발']), P)).toBe(true)
  })
  it('대표 팀이 아닌 두 번째 팀 담당 항목도 허용 — 다중 팀', () => {
    const a = makeMemberActor(P, ['개발', 'QA'])
    expect(canEditActual(leaf('개발'), a, P)).toBe(true)
    expect(canEditActual(leaf('QA'), a, P)).toBe(true)
  })
  it('명단 팀과 불일치면 거부', () => {
    expect(canEditActual(leaf('QA'), makeMemberActor(P, ['개발']), P)).toBe(false)
  })
  it('다른 프로젝트의 명단 팀은 판정에 쓰지 않는다', () => {
    const a = makeMemberActor(P, [], { rosterTeams: new Map([['p2', { teamIds: ['t-dev'], teamCodes: ['개발'] }]]) })
    expect(canEditActual(leaf('개발'), a, P)).toBe(false)
  })
})

describe('actorTeamCodesFor / actorTeamIdsFor', () => {
  it('명단 팀을 대표 팀부터 순서대로 돌려준다', () => {
    const a = makeMemberActor(P, ['ERP', 'MES'])
    expect(actorTeamCodesFor(a, P)).toEqual(['ERP', 'MES'])
    expect(actorTeamIdsFor(a, P)).toEqual(['t-ERP', 't-MES'])
  })
  it('명단 팀이 없으면 빈 배열', () => {
    expect(actorTeamCodesFor(makeMemberActor(P), P)).toEqual([])
    expect(actorTeamIdsFor(makeMemberActor(P), 'p-none')).toEqual([])
  })
  it('사본을 돌려준다 — 호출부가 변형해도 Actor 는 그대로', () => {
    const a = makeMemberActor(P, ['ERP'])
    actorTeamCodesFor(a, P).push('X')
    actorTeamIdsFor(a, P).push('t-X')
    expect(a.rosterTeams.get(P)).toEqual({ teamIds: ['t-ERP'], teamCodes: ['ERP'] })
  })
})

describe('산출물 첨부 어포던스 — canAttachDeliverable (WbsGanttSheet, attachments.ts can_attach RLS와 같은 명단 팀 규칙)', () => {
  it('명단 팀이 담당인 멤버는 첨부할 수 있다', () => {
    expect(canAttachDeliverable(leaf('개발'), makeMemberActor(P, ['개발']), P)).toBe(true)
  })
  it('관리자는 담당 무관 전체 첨부 가능', () => {
    expect(canAttachDeliverable(leaf('QA'), makeAdminActor(P), P)).toBe(true)
  })
  it('명단 팀이 없는 멤버는 첨부할 수 없다', () => {
    expect(canAttachDeliverable(leaf('개발'), makeMemberActor(P), P)).toBe(false)
  })
})
