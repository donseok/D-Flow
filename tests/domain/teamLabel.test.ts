// 팀 표시 라벨(팀 유연화 1단계) — 화면 글자는 바꿀 수 있는 이름이고 code 는 식별자다. 같은 이름이 둘이면 `이름 (code)` 로 가르고,
// 목록에 없는 code 는 code 그대로(이름을 지어내지 않는다). 색인 본문은 `이름 (code)` 를 함께 적는다.
import { describe, expect, it } from 'vitest'
import { teamLabel, teamLabelLookup, teamNameWithCode } from '@/lib/domain/teamLabel'
import { groupByOwner } from '@/lib/domain/kanban'
import { deriveStandardExcelProfile, resolveTeamColumns } from '@/lib/excel/standardProfile'
import { activeCodes, teamIdsMatching, teamsInView, teamsVisibleTo } from '@/lib/domain/teams'
import { teamRows } from '../helpers/teams-source-mock'

const PLAN = { code: 'TEAM_A', name: '기획팀' }
const OPS = { code: 'OPS', name: 'OPS' }

describe('teamLabel — 한 팀의 표시 라벨', () => {
  it('이름을 보인다 — code 와 같으면 그 한 낱말, 다르면 이름만', () => {
    expect(teamLabel(PLAN, [PLAN, OPS])).toBe('기획팀')
    expect(teamLabel(OPS, [PLAN, OPS])).toBe('OPS')
  })
  it('같은 목록에 같은 이름의 다른 팀이 있으면 `이름 (code)` 로 가른다 — 둘 다', () => {
    const a = { code: 'PLAN_1', name: '기획팀' }, b = { code: 'PLAN_2', name: '기획팀' }
    expect([a, b, OPS].map((t) => teamLabel(t, [a, b, OPS]))).toEqual(['기획팀 (PLAN_1)', '기획팀 (PLAN_2)', 'OPS'])
  })
  it('이름이 비었거나 공백뿐이면 code — 빈 글자를 그리지 않는다', () => {
    expect(teamLabel({ code: 'QA', name: '  ' }, [])).toBe('QA')
  })
  it('code 까지 같은 두 팀(공용·전용이 같은 code·같은 이름)은 글자로 가를 수 없다 — 같은 라벨', () => {
    const pub = { code: 'QA', name: '품질' }, own = { code: 'QA', name: '품질' }
    expect(teamLabel(pub, [pub, own])).toBe('품질')
  })
  it('같은 code 에 이름만 다른 두 팀(공용·전용)은 이름이 가른다 — code 를 덧붙이지 않는다', () => {
    const pub = { code: 'QA', name: '품질(공용)' }, own = { code: 'QA', name: '품질(전용)' }
    expect([pub, own].map((t) => teamLabel(t, [pub, own]))).toEqual(['품질(공용)', '품질(전용)'])
  })
})

describe('teamLabelLookup — code 로 찾기', () => {
  it('목록의 팀은 그 라벨, 목록 밖 code 는 code 그대로(비활성 팀 담당·공급자 없는 화면)', () => {
    const labelOf = teamLabelLookup([PLAN, OPS])
    expect(labelOf('TEAM_A')).toBe('기획팀')
    expect(labelOf('OPS')).toBe('OPS')
    expect(labelOf('GONE')).toBe('GONE')
    expect(teamLabelLookup([])('TEAM_A')).toBe('TEAM_A')
  })
  it('code 는 정확히 대조한다(담당·필터와 같은 규칙) · 같은 code 가 둘이면 앞 팀', () => {
    const labelOf = teamLabelLookup([{ code: 'QA', name: '품질(전용)' }, { code: 'QA', name: '품질(공용)' }])
    expect(labelOf('QA')).toBe('품질(전용)')
    expect(labelOf('qa')).toBe('qa')
  })
})

describe('teamNameWithCode — 색인 본문·봇 문맥의 표기', () => {
  it('`이름 (code)` — 이름이 code 와 같거나 없으면 한 번만', () => {
    expect(teamNameWithCode('TEAM_A', '기획팀')).toBe('기획팀 (TEAM_A)')
    expect(teamNameWithCode('OPS', 'OPS')).toBe('OPS')
    expect(teamNameWithCode('OPS', null)).toBe('OPS')
    expect(teamNameWithCode('OPS', '  ')).toBe('OPS')
  })
})

describe('code 로 남는 자리 — 식별자는 이름을 바꿔도 그대로다', () => {
  const teams = [...teamRows(['TEAM_A'], { name: '기획팀' }), ...teamRows(['OPS'], { sortOrder: 1 })]
  it('칸반 담당 열 — 머리 글자(title)는 이름, 열의 key(드롭·필터·봇 반환 키)는 code', () => {
    const cols = groupByOwner([], activeCodes(teams), teams)
    expect(cols.map((c) => c.key)).toEqual(['TEAM_A', 'OPS', '미배정'])
    expect(cols.map((c) => c.title)).toEqual(['기획팀', 'OPS', '미배정'])
    // 봇 도구는 팀 목록을 넘기지 않는다 — 머리도 code 그대로(반환 키가 바뀌지 않는다)
    expect(groupByOwner([], activeCodes(teams)).map((c) => c.title)).toEqual(['TEAM_A', 'OPS', '미배정'])
  })
  it('엑셀 내보내기의 팀 열 머리는 code — 가져오기가 같은 값으로 대조한다(왕복 키)', () => {
    const cols = resolveTeamColumns([], activeCodes(teams))
    expect(cols).toEqual(['TEAM_A', 'OPS'])
    expect(deriveStandardExcelProfile(cols, ['단계', '작업']).teamColumns.map(([, head]) => head)).toEqual(['TEAM_A', 'OPS'])
    expect(JSON.stringify(deriveStandardExcelProfile(cols, ['단계', '작업']))).not.toContain('기획팀')
  })
})

describe('teamIdsMatching·teamsInView — 회의록 담당 필터를 팀 id 집합으로', () => {
  const W = 'ws-1', P = 'p-1'
  const all = [
    ...teamRows(['QA'], { id: 't-qa', name: '품질', workspaceId: W }),
    ...teamRows(['QA'], { id: 't-qa-p', name: '품질(전용)', workspaceId: W, projectId: P }),
    ...teamRows(['OPS'], { id: 't-ops', name: '운영', workspaceId: W, sortOrder: 2 }),
    ...teamRows(['OLD'], { id: 't-old', name: '옛팀', workspaceId: W, active: false }),
    ...teamRows(['QA'], { id: 't-qa-x', name: '품질', workspaceId: 'ws-2' }),
  ]
  const view = { all: false as const, workspaceIds: [W], projectIds: [P] }
  it('teamsInView 는 같은 code 의 공용·전용 팀을 모두 남긴다(teamsVisibleTo 는 code 마다 하나) — 비활성·범위 밖은 뺀다', () => {
    expect(teamsInView(all, view).map((t) => t.id).sort()).toEqual(['t-ops', 't-qa', 't-qa-p'])
    expect(teamsVisibleTo(all, view).map((t) => t.code)).toEqual(['QA', 'OPS'])
  })
  it('code 로 주면 그 code 의 팀 전부, 이름으로 주면 그 이름의 팀', () => {
    const inView = teamsInView(all, view)
    expect(teamIdsMatching(inView, 'QA').sort()).toEqual(['t-qa', 't-qa-p'])
    expect(teamIdsMatching(inView, '운영')).toEqual(['t-ops'])
    expect(teamIdsMatching(inView, ' 품질(전용) ')).toEqual(['t-qa-p'])
  })
  it('맞는 팀이 없으면 빈 목록 — 대소문자가 다르면 다른 값이고, 빈 값·비활성 팀·다른 워크스페이스의 팀은 맞지 않는다', () => {
    const inView = teamsInView(all, view)
    for (const key of ['qa', '', '  ', 'OLD', '옛팀', 'NOPE']) expect(teamIdsMatching(inView, key), key).toEqual([])
  })
})
