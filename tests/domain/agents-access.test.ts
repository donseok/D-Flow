import { describe, expect, it } from 'vitest'
import { canViewAgents, seatmapProjectIds } from '@/lib/authz/agentsAccess'
import { KO } from '@/lib/i18n/dict/ko'
import { EN } from '@/lib/i18n/dict/en'
import { makeActor as actor, WS } from '../fixtures/actor'

describe('canViewAgents — 슈퍼유저 또는 역할이 있는 프로젝트 1개 이상(좌석표 v1 스펙 §5-1, 2026-09-14 멤버 개방)', () => {
  it('슈퍼유저·관리자·멤버는 본다', () => {
    expect(canViewAgents(actor({ isSuperuser: true }))).toBe(true)
    expect(canViewAgents(actor({ projectRoles: new Map([['p1', 'admin' as const]]) }))).toBe(true)
    expect(canViewAgents(actor({ projectRoles: new Map([['p1', 'member' as const]]) }))).toBe(true)
  })
  it('역할 없음(조회 전용)·null 은 못 본다 — fail-closed', () => {
    expect(canViewAgents(actor({}))).toBe(false)
    expect(canViewAgents(null)).toBe(false)
  })
})

describe('seatmapProjectIds — 층 목록', () => {
  // 내 워크스페이스(WS)의 프로젝트 p1·p2 — Actor 는 이 연결이 있어야 프로젝트를 안다(존재 은닉).
  const inWs = { projectWorkspace: new Map([['p1', WS], ['p2', WS]]) }
  it('슈퍼유저는 null(전체), 그 외는 역할이 있는 프로젝트만(member 포함), 역할 없으면 빈 배열', () => {
    expect(seatmapProjectIds(actor({ isSuperuser: true }))).toBeNull()
    expect(seatmapProjectIds(actor({ ...inWs, projectRoles: new Map([['p1', 'admin' as const], ['p2', 'member' as const]]) }))).toEqual(['p1', 'p2'])
    expect(seatmapProjectIds(actor({}))).toEqual([])
    expect(seatmapProjectIds(null)).toEqual([])
  })
  // canViewAgents 는 워크스페이스 관리자를 역할 보유자로 본다 — 층 목록도 같은 축이어야 '들어왔는데 층 0개'가 안 된다.
  it('(a) 명단 행 없는 워크스페이스 관리자는 그 워크스페이스 프로젝트 전부 — 페이지 게이트와 일치', () => {
    const wsAdmin = actor({ ...inWs, workspaceRoles: new Map([[WS, 'admin' as const]]) })
    expect(canViewAgents(wsAdmin)).toBe(true)
    expect(seatmapProjectIds(wsAdmin)).toEqual(['p1', 'p2'])
  })
  it('(b) 명단 member(p1) 인 워크스페이스 관리자도 p1 만이 아니라 전부', () => {
    const a = actor({ ...inWs, workspaceRoles: new Map([[WS, 'admin' as const]]), projectRoles: new Map([['p1', 'member' as const]]) })
    expect(seatmapProjectIds(a)).toEqual(['p1', 'p2'])
  })
  it('(c) 조회 전용(명단 역할 없음, 워크스페이스 member)은 층 없음·게이트 거부', () => {
    const viewer = actor({ ...inWs })
    expect(canViewAgents(viewer)).toBe(false)
    expect(seatmapProjectIds(viewer)).toEqual([])
  })
  it('(d) 슈퍼유저는 null — 워크스페이스·명단과 무관', () => {
    expect(seatmapProjectIds(actor({ ...inWs, isSuperuser: true }))).toBeNull()
  })
  it('내 워크스페이스 밖 프로젝트는 명단 역할이 있어도 빠진다 — roleIn 존재 은닉과 같은 판정', () => {
    const a = actor({ projectWorkspace: new Map([['p1', WS]]), projectRoles: new Map([['p1', 'member' as const], ['p-foreign', 'admin' as const]]) })
    expect(seatmapProjectIds(a)).toEqual(['p1'])
  })
})

describe('nav 사전 키', () => {
  it('전역 좌석표와 프로젝트 에이전트 라벨이 ko/en 양쪽에 있다', () => {
    expect(KO['nav.agents']).toBe('전체 스튜디오'); expect(EN['nav.agents']).toBe('All studios')
    expect(KO['nav.projectAgents']).toBe('에이전트'); expect(EN['nav.projectAgents']).toBe('Agents')
  })
})
