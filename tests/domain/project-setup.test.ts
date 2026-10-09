// 프로젝트 준비 체크리스트의 순수 판정(첫 사용 흐름) — 단계의 완료를 실제 상태로 가른다.
import { describe, expect, it } from 'vitest'
import { projectSetupSteps, setupProgress, setupStepHref, type SetupInput, type SetupStep } from '@/lib/domain/projectSetup'

const P = 'p-1'
/** 막 만든 프로젝트 — 이름·단계 이름·달력은 생성 때 정해지고 나머지는 비어 있다 */
function input(over: Partial<SetupInput> = {}): SetupInput {
  return {
    projectId: P,
    project: { name: '신규', startDate: null, endDate: null },
    levelLabels: { status: 'set', count: 2 },
    calendar: { timezone: 'set', workingDays: 'set', weekStart: 'set' },
    teams: [], weeklyEnabled: true, weeklyAreas: [],
    rosterCount: 1, pendingInvites: 0, wbsItems: 0,
    ...over,
  }
}
const stateOf = (steps: SetupStep[]) => Object.fromEntries(steps.map((s) => [s.id, s.state]))
const ALL_DONE = input({
  project: { name: '신규', startDate: '2026-10-01', endDate: '2026-12-31' },
  teams: [{ projectId: P, active: true }], weeklyAreas: [{ active: true }], rosterCount: 2, wbsItems: 1,
})

describe('projectSetupSteps', () => {
  it('막 만든 프로젝트: 단계 이름·달력만 완료, 나머지는 아직 — 순서는 화면 순서', () => {
    const steps = projectSetupSteps(input())
    expect(steps.map((s) => s.id)).toEqual(['basic', 'levels', 'teams', 'members', 'areas', 'calendar', 'firstData'])
    expect(stateOf(steps)).toEqual({ basic: 'todo', levels: 'done', teams: 'todo', members: 'todo', areas: 'todo', calendar: 'done', firstData: 'todo' })
  })
  it('전부 갖추면 모두 완료', () => {
    expect(projectSetupSteps(ALL_DONE).every((s) => s.state === 'done')).toBe(true)
  })

  it('기본 정보: 이름과 기간(시작·종료 둘 다)이 있어야 한다. 프로젝트 행을 못 읽었으면 확인 불가', () => {
    const basic = (project: SetupInput['project']) => stateOf(projectSetupSteps(input({ project }))).basic
    expect(basic({ name: '신규', startDate: '2026-10-01', endDate: '2026-12-31' })).toBe('done')
    expect(basic({ name: '신규', startDate: '2026-10-01', endDate: null })).toBe('todo')
    expect(basic({ name: '신규', startDate: null, endDate: '2026-12-31' })).toBe('todo')
    expect(basic({ name: '  ', startDate: '2026-10-01', endDate: '2026-12-31' })).toBe('todo')
    expect(basic(null)).toBe('unknown')
  })

  it('단계 이름: 저장된 값(set)이고 1개 이상 — 미설정(기본값)·손상·빈 목록은 아직', () => {
    const levels = (levelLabels: SetupInput['levelLabels']) => stateOf(projectSetupSteps(input({ levelLabels }))).levels
    expect(levels({ status: 'set', count: 3 })).toBe('done')
    expect(levels({ status: 'set', count: 0 })).toBe('todo')
    expect(levels({ status: 'default', count: 0 })).toBe('todo')
    expect(levels({ status: 'invalid', count: 0 })).toBe('todo')
    expect(levels({ status: 'required_missing', count: 0 })).toBe('todo')
  })

  describe('팀 — 전용 팀이 있으면 그것만, 없으면 상속한 공용 팀', () => {
    const teams = (list: SetupInput['teams']) => stateOf(projectSetupSteps(input({ teams: list }))).teams
    it('전용 팀이 하나라도 활성이면 완료', () => {
      expect(teams([{ projectId: P, active: true }])).toBe('done')
      expect(teams([{ projectId: P, active: false }, { projectId: P, active: true }])).toBe('done')
    })
    it('상속 팀: 전용 팀이 없고 워크스페이스 공용 팀이 1개 이상 활성이면 완료', () => {
      expect(teams([{ projectId: null, active: true }])).toBe('done')
      expect(teams([{ projectId: null, active: false }, { projectId: null, active: true }])).toBe('done')
    })
    it('공용 팀도 전용 팀도 없으면, 또는 공용 팀이 전부 비활성이면 아직', () => {
      expect(teams([])).toBe('todo')
      expect(teams([{ projectId: null, active: false }])).toBe('todo')
    })
    it('전용 팀을 만들었는데 전부 비활성이면 아직 — 그때는 공용 팀을 상속하지 않는다(노출 규칙과 같다)', () => {
      expect(teams([{ projectId: P, active: false }, { projectId: null, active: true }])).toBe('todo')
    })
    it('다른 프로젝트의 전용 팀은 세지 않는다', () => {
      expect(teams([{ projectId: 'p-other', active: true }])).toBe('todo')
    })
  })

  describe('멤버 — 명단 2명 이상, 또는 보낸 초대 1건 이상', () => {
    const members = (rosterCount: number | null, pendingInvites: number | null) =>
      stateOf(projectSetupSteps(input({ rosterCount, pendingInvites }))).members
    it('명단 2명 이상이면 완료, 혼자면 아직', () => {
      expect(members(2, 0)).toBe('done')
      expect(members(5, 0)).toBe('done')
      expect(members(1, 0)).toBe('todo')
      expect(members(0, 0)).toBe('todo')
    })
    it('초대 대체: 명단이 혼자여도 수락 전 초대가 1건 있으면 완료', () => {
      expect(members(1, 1)).toBe('done')
      expect(members(0, 3)).toBe('done')
    })
    it('한쪽을 못 읽었어도 다른 쪽이 조건을 채우면 완료, 아니면 확인 불가(미완료로 단정하지 않는다)', () => {
      expect(members(2, null)).toBe('done')
      expect(members(null, 1)).toBe('done')
      expect(members(1, null)).toBe('unknown')
      expect(members(null, 0)).toBe('unknown')
      expect(members(null, null)).toBe('unknown')
    })
  })

  describe('업무영역 — 주간보고 모듈이 켜져 있을 때만', () => {
    it('모듈 꺼짐: 단계 자체가 목록에 없다(영역이 있든 없든)', () => {
      for (const weeklyAreas of [[], [{ active: true }]]) {
        const steps = projectSetupSteps(input({ weeklyEnabled: false, weeklyAreas }))
        expect(steps.map((s) => s.id)).toEqual(['basic', 'levels', 'teams', 'members', 'calendar', 'firstData'])
      }
    })
    it('켜져 있으면 활성 영역 1개 이상이 완료 — 비활성만 있으면 아직', () => {
      const areas = (weeklyAreas: SetupInput['weeklyAreas']) => stateOf(projectSetupSteps(input({ weeklyAreas }))).areas
      expect(areas([{ active: true }])).toBe('done')
      expect(areas([{ active: false }])).toBe('todo')
      expect(areas([])).toBe('todo')
    })
  })

  it('달력: 시간대·근무 요일·주 시작이 모두 저장돼 있어야 한다 — 하나라도 미설정·손상이면 아직', () => {
    const calendar = (c: Partial<SetupInput['calendar']>) =>
      stateOf(projectSetupSteps(input({ calendar: { timezone: 'set', workingDays: 'set', weekStart: 'set', ...c } }))).calendar
    expect(calendar({})).toBe('done')
    expect(calendar({ timezone: 'default' })).toBe('todo')
    expect(calendar({ workingDays: 'default' })).toBe('todo')
    expect(calendar({ weekStart: 'invalid' })).toBe('todo')
  })

  it('첫 데이터: 작업 계획 항목 1개 이상 — 건수를 못 읽었으면 확인 불가', () => {
    const first = (wbsItems: number | null) => stateOf(projectSetupSteps(input({ wbsItems }))).firstData
    expect(first(1)).toBe('done')
    expect(first(0)).toBe('todo')
    expect(first(null)).toBe('unknown')
  })
})

describe('setupProgress — 건너뛰기는 사용자의 표시, 완료는 서버 상태', () => {
  const steps = projectSetupSteps(input())   // basic·teams·members·areas·firstData 가 아직
  it('다음 단계는 아직이고 건너뛰지 않은 첫 단계', () => {
    expect(setupProgress(steps, new Set())).toEqual({ total: 7, done: 2, skipped: 0, next: 'basic', settled: false })
    expect(setupProgress(steps, new Set(['basic']))).toMatchObject({ skipped: 1, next: 'teams' })
    expect(setupProgress(steps, new Set(['basic', 'teams', 'members']))).toMatchObject({ skipped: 3, next: 'areas' })
  })
  it('남은 단계를 모두 건너뛰면 남은 일이 없다(settled) — 완료 수는 그대로다', () => {
    expect(setupProgress(steps, new Set(['basic', 'teams', 'members', 'areas', 'firstData'])))
      .toEqual({ total: 7, done: 2, skipped: 5, next: null, settled: true })
  })
  it('서버 상태가 완료면 그것이 우선 — 완료된 단계의 건너뛰기 표시는 세지 않는다', () => {
    expect(setupProgress(projectSetupSteps(ALL_DONE), new Set(['basic', 'teams'])))
      .toEqual({ total: 7, done: 7, skipped: 0, next: null, settled: true })
  })
  it('모르는 단계 id 의 건너뛰기(옛 저장값·꺼진 모듈의 단계)는 무시한다', () => {
    const off = projectSetupSteps(input({ weeklyEnabled: false }))
    expect(setupProgress(off, new Set(['areas', 'nope']))).toMatchObject({ total: 6, skipped: 0, next: 'basic' })
  })
  it('확인 불가(unknown) 단계는 다음 할 일로 내밀지 않는다', () => {
    const s = projectSetupSteps({ ...ALL_DONE, wbsItems: null })
    expect(setupProgress(s, new Set())).toEqual({ total: 7, done: 6, skipped: 0, next: null, settled: true })
  })
})

describe('setupStepHref — 각 단계의 설정 위치', () => {
  it('설정 화면의 절 또는 그 일을 하는 화면', () => {
    expect(setupStepHref(P, 'basic')).toBe('/p/p-1/settings#project-general')
    expect(setupStepHref(P, 'levels')).toBe('/p/p-1/settings#project-general')
    expect(setupStepHref(P, 'teams')).toBe('/p/p-1/settings#project-team')
    expect(setupStepHref(P, 'areas')).toBe('/p/p-1/settings#project-team')
    expect(setupStepHref(P, 'calendar')).toBe('/p/p-1/settings#project-calendar')
    expect(setupStepHref(P, 'members')).toBe('/p/p-1/members')
    expect(setupStepHref(P, 'firstData')).toBe('/p/p-1/wbs')
  })
})
