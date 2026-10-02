import { describe, expect, it } from 'vitest'
import { resolveTeamsForProject, teamCodesVisibleTo, teamsVisibleTo, type Team } from '@/lib/domain/teams'
import { teamViewOf, teamViewOfScope } from '@/lib/domain/authz'
import { makeActor, makeSuperuser } from '../fixtures/actor'

const team = (code: string, projectId: string | null, active = true, workspaceId = 'ws-1', sortOrder = 0): Team =>
  ({ id: `id-${code}-${projectId ?? workspaceId}`, code, name: code, color: '#6b7280', sortOrder, active, progressVisible: true, projectId, workspaceId })

describe('resolveTeamsForProject — 프로젝트 행 있으면 그것만, 없으면 그 프로젝트 워크스페이스의 공용 팀', () => {
  const globals = [team('PMO', null), team('ERP', null)]
  it('프로젝트 팀이 없으면 그 워크스페이스의 공용 팀을 반환한다', () => {
    expect(resolveTeamsForProject(globals, 'p1', 'ws-1').map(t => t.code)).toEqual(['PMO', 'ERP'])
  })
  it('프로젝트 팀이 있으면 그것만 반환한다(공용 혼입 없음)', () => {
    const all = [...globals, team('개발', 'p1'), team('QA', 'p1')]
    expect(resolveTeamsForProject(all, 'p1', 'ws-1').map(t => t.code)).toEqual(['개발', 'QA'])
  })
  it('다른 프로젝트의 팀은 보이지 않는다', () => {
    const all = [...globals, team('개발', 'p2')]
    expect(resolveTeamsForProject(all, 'p1', 'ws-1').map(t => t.code)).toEqual(['PMO', 'ERP'])
  })
  it('비활성 프로젝트 팀만 있어도 공용으로 복귀하지 않는다(폴백 판정은 비활성 포함)', () => {
    const all = [...globals, team('개발', 'p1', false)]
    expect(resolveTeamsForProject(all, 'p1', 'ws-1').map(t => t.code)).toEqual(['개발'])
  })
  it('공용과 동명인 프로젝트 팀이 공존할 수 있다', () => {
    const all = [...globals, team('PMO', 'p1')]
    const r = resolveTeamsForProject(all, 'p1', 'ws-1')
    expect(r).toHaveLength(1)
    expect(r[0].projectId).toBe('p1')
  })
  it('폴백은 그 프로젝트 워크스페이스의 공용 팀뿐 — 다른 워크스페이스의 공용 팀은 섞이지 않는다(SP2 §4.2)', () => {
    const all = [...globals, team('B팀', null, true, 'ws-2')]
    expect(resolveTeamsForProject(all, 'p1', 'ws-1').map(t => t.code)).toEqual(['PMO', 'ERP'])
    expect(resolveTeamsForProject(all, 'p9', 'ws-2').map(t => t.code)).toEqual(['B팀'])
  })
  it('워크스페이스를 모르는 프로젝트(미존재)는 빈 목록 — 아무 워크스페이스의 공용 팀으로도 폴백하지 않는다', () => {
    expect(resolveTeamsForProject([...globals, team('B팀', null, true, 'ws-2')], 'p-none', null)).toEqual([])
  })
})

describe('teamCodesVisibleTo — 회의록 담당 필터·검증의 팀 가시 범위(채팅·외부 GET·봇 공용)', () => {
  const all = [
    team('PMO', null, true, 'ws-a'), team('휴면', null, false, 'ws-a'),
    team('ERP', null, true, 'ws-b'),
    team('A전용', 'pa', true, 'ws-a'), team('A비공개', 'pa-priv', true, 'ws-a'),
    team('B전용', 'pb', true, 'ws-b'),
  ]
  it('소속 워크스페이스의 활성 공용 팀 + 볼 수 있는 프로젝트의 전용 팀 — 다른 워크스페이스·숨긴 프로젝트는 없다', () => {
    const codes = teamCodesVisibleTo(all, { all: false, workspaceIds: ['ws-a'], projectIds: ['pa'] })
    expect([...codes].sort()).toEqual(['A전용', 'PMO'])
  })
  it('플랫폼 관리자(all)는 전 워크스페이스의 활성 팀 전부(중복 코드는 하나)', () => {
    const codes = teamCodesVisibleTo([...all, team('PMO', null, true, 'ws-b')], { all: true })
    expect([...codes].sort()).toEqual(['A비공개', 'A전용', 'B전용', 'ERP', 'PMO'])
  })
  it('아무 범위도 없으면 빈 목록', () => {
    expect(teamCodesVisibleTo(all, { all: false, workspaceIds: [], projectIds: [] })).toEqual([])
  })
})

describe('teamViewOf — Actor 의 팀 가시 범위', () => {
  it('멤버: 소속 워크스페이스들 + 그 안에서 숨기지 않은 프로젝트', () => {
    const actor = makeActor({
      workspaceRoles: new Map([['ws-a', 'member']]),
      projectWorkspace: new Map([['pa', 'ws-a'], ['pa-priv', 'ws-a']]),
    })
    const view = teamViewOf(actor, ['pa-priv'])
    expect(view.all).toBe(false)
    if (view.all) return
    expect([...view.workspaceIds]).toEqual(['ws-a'])
    expect([...view.projectIds]).toEqual(['pa'])
  })
  it('플랫폼 관리자는 멤버십과 무관하게 전부 — 멤버십 없는 관리자가 빈 집합이 되지 않는다', () => {
    expect(teamViewOf(makeSuperuser({ workspaceRoles: new Map() }), [])).toEqual({ all: true })
  })
})

describe('teamViewOfScope — 봇 접근 범위(accessScope → 도구 컨텍스트)의 팀 가시 범위', () => {
  it('플랫폼 관리자만 전부', () => {
    expect(teamViewOfScope({ isSuperuser: true, workspaceIds: [], allowedProjectIds: [] })).toEqual({ all: true })
  })
  it('아니면 소속 워크스페이스 + 스코프 프로젝트(비공개 판정 끝난 allowedProjectIds)', () => {
    expect(teamViewOfScope({ isSuperuser: false, workspaceIds: ['ws-a'], allowedProjectIds: ['pa'] }))
      .toEqual({ all: false, workspaceIds: ['ws-a'], projectIds: ['pa'] })
  })
  it('플래그·워크스페이스가 없으면 거짓·빈 범위(fail-closed)', () => {
    expect(teamViewOfScope({ allowedProjectIds: ['pa'] })).toEqual({ all: false, workspaceIds: [], projectIds: ['pa'] })
  })
  it('teamViewOf(actor) 는 같은 규칙 — 숨긴 비공개 프로젝트를 뺀 스코프로 위임한다', () => {
    const actor = makeActor({ workspaceRoles: new Map([['ws-a', 'member']]), projectWorkspace: new Map([['pa', 'ws-a'], ['pp', 'ws-a']]) })
    expect(teamViewOf(actor, ['pp'])).toEqual(teamViewOfScope({ isSuperuser: false, workspaceIds: ['ws-a'], allowedProjectIds: ['pa'] }))
  })
})

describe('teamsVisibleTo — 가시 범위의 활성 팀 행(SP4 A2 — teamCodesVisibleTo 와 같은 규칙, 이름·색을 싣는다)', () => {
  const t = (id: string, code: string, ws: string, pid: string | null, over: Partial<Team> = {}): Team => ({
    id, code, name: `${code} 팀`, color: '#6b7280', sortOrder: 0, active: true, progressVisible: true, projectId: pid, workspaceId: ws, ...over,
  })
  const ALL = [
    t('a', 'OPS', 'w1', null, { sortOrder: 1 }), t('b', 'RES', 'w1', null), t('c', 'CIV', 'w2', null),
    t('d', 'MEP', 'w1', 'p1'), t('e', 'SAF', 'w1', 'p2'), t('f', 'OPS', 'w2', null, { sortOrder: 1 }), t('g', 'ARC', 'w1', null, { active: false }),
  ]
  it('보이는 워크스페이스의 공용 + 보이는 프로젝트의 전용, 활성만, activeCodes 순, 같은 code 는 첫 것', () => {
    const got = teamsVisibleTo(ALL, { all: false, workspaceIds: ['w1'], projectIds: ['p1'] })
    expect(got.map((x) => x.id)).toEqual(['d', 'b', 'a'])
    expect(got[0]).toMatchObject({ code: 'MEP', name: 'MEP 팀' })
  })
  it('{ all: true } 는 전부(활성) — code 가 겹치면 첫 것만', () => {
    expect(teamsVisibleTo(ALL, { all: true }).map((x) => x.code)).toEqual(['CIV', 'MEP', 'RES', 'SAF', 'OPS'])
  })
  it('teamCodesVisibleTo 는 teamsVisibleTo 의 code 와 같다', () => {
    for (const view of [{ all: true } as const, { all: false as const, workspaceIds: ['w2'], projectIds: ['p2'] }]) {
      expect(teamCodesVisibleTo(ALL, view)).toEqual(teamsVisibleTo(ALL, view).map((x) => x.code))
    }
  })
})
