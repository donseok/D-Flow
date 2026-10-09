import { describe, it, expect } from 'vitest'
import { identityTeamCodes, identityTeamLabel, identityTeamLabels } from '@/lib/domain/identityTeams'
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

describe('identityTeamCodes(actor, workspaceId) — 그 워크스페이스 프로젝트의 대표 팀만(FA3)', () => {
  const actor = makeActor({
    projectWorkspace: new Map([['p1', 'ws-1'], ['p2', 'ws-2'], ['p3', 'ws-2']]),
    rosterTeams: new Map([
      ['p1', { teamIds: ['t1'], teamCodes: ['품질'] }],
      ['p2', { teamIds: ['t2'], teamCodes: ['ERP'] }],
      ['p3', { teamIds: ['t3'], teamCodes: ['MES'] }],
    ]),
  })
  it('워크스페이스를 주면 그 워크스페이스의 프로젝트만', () => {
    expect(identityTeamCodes(actor, 'ws-1')).toEqual(['품질'])
    expect(identityTeamCodes(actor, 'ws-2')).toEqual(['ERP', 'MES'])
    expect(identityTeamCodes(actor, 'ws-none')).toEqual([])
  })
  it('인자가 없으면 전체(헤더 소속 표시) — 기존 동작', () => {
    expect(identityTeamCodes(actor)).toEqual(['품질', 'ERP', 'MES'])
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

// 계정 메뉴의 소속 글자 — code 가 아니라 팀 이름. 식별(identityTeamCodes)은 그대로 code 다.
describe('identityTeamLabels — 대표 팀의 이름(표시 전용)', () => {
  const actor = makeActor({
    projectWorkspace: new Map([['p1', 'ws-1'], ['p2', 'ws-1'], ['p3', 'ws-2'], ['p4', 'ws-1']]),
    rosterTeams: new Map([
      ['p1', { teamIds: ['t1', 't9'], teamCodes: ['QA', 'ERP'], teamNames: ['품질', '전사'] }],
      ['p2', { teamIds: ['t2'], teamCodes: ['OPS'], teamNames: ['운영'] }],
      ['p3', { teamIds: ['t3'], teamCodes: ['MES'], teamNames: ['제조'] }],
      ['p4', { teamIds: ['t1'], teamCodes: ['QA'], teamNames: ['품질'] }],
    ]),
  })
  it('프로젝트마다 대표 팀의 이름 — 중복 제거, 가나다순. code 목록은 바뀌지 않는다', () => {
    expect(identityTeamLabels(actor)).toEqual(['운영', '제조', '품질'])
    expect(identityTeamCodes(actor)).toEqual(['MES', 'OPS', 'QA'])
  })
  it('workspaceId 를 주면 그 워크스페이스의 프로젝트만', () => {
    expect(identityTeamLabels(actor, 'ws-1')).toEqual(['운영', '품질'])
    expect(identityTeamLabels(actor, 'ws-2')).toEqual(['제조'])
  })
  it('이름을 모르면(teamNames 없음) code 그대로 — 이름을 지어내지 않는다', () => {
    expect(identityTeamLabels(makeMemberActor('p1', ['MES', 'ERP']))).toEqual(['MES'])
    expect(identityTeamLabels(null)).toEqual([])
  })
  it('code 가 다른 두 팀의 이름이 같으면 `이름 (code)` 로 가른다', () => {
    const dup = makeActor({ rosterTeams: new Map([
      ['p1', { teamIds: ['t1'], teamCodes: ['QA'], teamNames: ['품질'] }],
      ['p2', { teamIds: ['t2'], teamCodes: ['QC'], teamNames: ['품질'] }],
    ]) })
    expect(identityTeamLabels(dup)).toEqual(['품질 (QA)', '품질 (QC)'])
  })
})
