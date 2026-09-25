import { describe, it, expect } from 'vitest'
import { identityTeamCodes, identityTeamLabel } from '@/lib/domain/identityTeams'
import { makeActor, makeMemberActor, makeSuperuser } from '../fixtures/actor'

// 헤더 소속 표시의 재료 — 계정 전역 팀(Actor.teamCode)은 0003 에서 사라졌고, 소속은 프로젝트별 명단의 대표 팀이다.
describe('identityTeamCodes — 프로젝트마다 대표 팀(첫 원소) 하나, 중복 제거, 가나다순', () => {
  it('비로그인·열화(null)는 빈 목록', () => {
    expect(identityTeamCodes(null)).toEqual([])
  })
  it('명단 팀이 없으면 빈 목록 — 플랫폼 관리자여도 소속을 지어내지 않는다', () => {
    expect(identityTeamCodes(makeActor())).toEqual([])
    expect(identityTeamCodes(makeSuperuser())).toEqual([])
  })
  it('한 프로젝트의 부 팀은 세지 않는다 — 대표 팀만', () => {
    expect(identityTeamCodes(makeMemberActor('p1', ['MES', 'ERP']))).toEqual(['MES'])
  })
  it('여러 프로젝트의 대표 팀을 모아 중복을 빼고 한글 이름 순으로 정렬한다', () => {
    const actor = makeActor({
      rosterTeams: new Map([
        ['p1', { teamIds: ['t1'], teamCodes: ['품질'] }],
        ['p2', { teamIds: ['t2', 't3'], teamCodes: ['ERP', 'MES'] }],
        ['p3', { teamIds: ['t4'], teamCodes: ['가공'] }],
        ['p4', { teamIds: ['t5'], teamCodes: ['품질'] }],
        ['p5', { teamIds: [], teamCodes: [] }],
      ]),
    })
    expect(identityTeamCodes(actor)).toEqual(['가공', '품질', 'ERP'])
  })
})

describe('identityTeamLabel — 0팀/1팀/n팀 표시', () => {
  it('0팀은 소속 미지정', () => expect(identityTeamLabel([])).toBe('소속 미지정'))
  it('1팀은 그 코드', () => expect(identityTeamLabel(['ERP'])).toBe('ERP'))
  it('n팀은 첫 팀 외 n-1', () => {
    expect(identityTeamLabel(['가공', 'ERP'])).toBe('가공 외 1')
    expect(identityTeamLabel(['가공', '품질', 'ERP'])).toBe('가공 외 2')
  })
})
