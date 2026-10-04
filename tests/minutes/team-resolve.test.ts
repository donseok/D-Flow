import { describe, expect, it } from 'vitest'
import { teamForCode, teamsInScope, type TeamRef } from '@/lib/minutes/teamResolve'

// SP5 B2 — 회의록 팀 해석은 code 단위(D18). SQL minute_team_for_code 와 같은 규칙
const T = (id: string, code: string, projectId: string | null, active = true): TeamRef => ({ id, code, name: `${code} 팀`, projectId, active })
const TEAMS = [T('c-qa', 'QA', null), T('c-dev', 'DEV', null), T('p1-qa', 'QA', 'P1'), T('p2-ops', 'OPS', 'P2'), T('c-old', 'OLD', null, false)]

describe('teamForCode', () => {
  it('프로젝트 범위는 그 프로젝트의 같은 code 전용 팀이 먼저, 없으면 공용', () => {
    expect(teamForCode(TEAMS, { projectId: 'P1' }, 'QA')?.id).toBe('p1-qa')
    expect(teamForCode(TEAMS, { projectId: 'P1' }, 'DEV')?.id).toBe('c-dev')
    expect(teamForCode(TEAMS, { projectId: 'P2' }, 'QA')?.id).toBe('c-qa')
  })
  it('무프로젝트는 공용만 — 전용 팀은 고르지 않는다', () => {
    expect(teamForCode(TEAMS, { projectId: null }, 'QA')?.id).toBe('c-qa')
    expect(teamForCode(TEAMS, { projectId: null }, 'OPS')).toBeNull()
  })
  it('다른 프로젝트의 전용 팀은 어느 경우에도 고르지 않는다', () => {
    expect(teamForCode(TEAMS, { projectId: 'P1' }, 'OPS')).toBeNull()
  })
  it('활성 여부는 보지 않는다(과거 편철을 지킨다)', () => {
    expect(teamForCode(TEAMS, { projectId: null }, 'OLD')?.id).toBe('c-old')
  })
})

describe('teamsInScope', () => {
  it('전용 + 공용, code 가 겹치면 전용만 남는다', () => {
    expect(teamsInScope(TEAMS, { projectId: 'P1' }).map(t => t.id)).toEqual(['c-dev', 'p1-qa', 'c-old'])
    expect(teamsInScope(TEAMS, { projectId: null }).map(t => t.id)).toEqual(['c-qa', 'c-dev', 'c-old'])
  })
})
