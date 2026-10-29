import { describe, expect, it } from 'vitest'
import { weekLabelOf } from '@/lib/domain/calendar'
import type { WeeklySheetRow } from '@/lib/domain/weeklySheet'
import type { WeeklyArea } from '@/lib/domain/weeklySheet'
import { subLineText } from '@/lib/report/xml'
import type { WeeklyReportModel } from '@/lib/report/weekly'
import { buildWeeklyCatalog, leaveDatesText, splitTaskBlocks, weeklyCatalogSections, weeklyCatalogTasks } from '@/lib/report/catalog/weeklyBuild'
import { calUtcMon } from '../../helpers/calendarFixture'

function area(code: string, active: boolean, sort: number): WeeklyArea {
  return { id: code, code, name: code, sortOrder: sort, active, teams: [] }
}

function row(areaId: string, cells: Partial<WeeklySheetRow> = {}): WeeklySheetRow {
  return {
    id: `${areaId}-row`, reportId: 'r', areaId,
    thisContent: '', thisIssue: '', nextContent: '', nextIssue: '',
    ...cells,
  }
}

describe('weeklyCatalogSections', () => {
  it('빈 활성은 두고 빈 비활성은 빼며, 내용 있는 비활성은 활성 뒤에 온다', () => {
    const areas = [
      area('late-active', true, 2),
      area('early-active', true, 1),
      area('empty-off', false, 0),
      area('filled-off', false, 3),
    ]
    const rows = [
      row('early-active'),
      row('filled-off', { thisContent: '남음' }),
      row('empty-off'),
    ]
    const sections = weeklyCatalogSections(rows, areas, [])
    expect(sections.map((section) => section.code)).toEqual(['early-active', 'late-active', 'filled-off'])
  })

  it('이슈 칸은 빈 줄을 빼고, custom 은 행마다 문자열 하나', () => {
    const sections = weeklyCatalogSections(
      [row('a', { thisIssue: '하나\n\n둘', thisContent: '본문', custom: { note: ['가', '나'] } })],
      [area('a', true, 0)],
      ['note'],
    )
    expect(sections[0].this_issue).toEqual(['    하나', '    둘'])
    expect(sections[0].this_content).toEqual(['    본문'])
    expect(sections[0].custom.note).toEqual(['가\n나'])
  })
})

describe('buildWeeklyCatalog', () => {
  it('주차 원자는 weekLabelOf 이고 그룹 줄은 subLineText', () => {
    const weekStart = '2026-10-05'
    const label = weekLabelOf(calUtcMon.weekStart, weekStart)
    const model = {
      meta: {
        projectName: 'Acme', description: null, generatedAt: 't', today: weekStart,
        isoYear: 1999, isoWeek: 99, weekTag: 'tag', weekLabel: 'label',
        weekRange: 'r', nextWeekRange: 'n', weekStart, weekEnd: '2026-10-11',
        weekDays: [weekStart], weekDayLabels: ['월'],
        nextWeekStart: '2026-10-12', nextWeekDays: [], nextWeekDayLabels: [],
        prevWeekStart: '2026-09-28', prevWeekDays: [], prevWeekRange: 'p',
        totalLeaves: 0, phaseCount: 0, topLevelLabel: 'Phase',
      },
      kpi: {
        planned: 0, actual: 0, variance: 0, total: 0, done: 0, inProgress: 0, notStarted: 0, delayed: 0,
        doneThisWeek: 0, doneRatio: 0, inProgressRatio: 0, delayedRatio: 0,
      },
      phases: [], planActual: [], workload: [], issues: [], wbs: [], dev: [], devOwnerSummary: '',
      attendance: { thisWeek: [], nextWeek: [] },
      meetings: { thisWeek: [], nextWeek: [], total: 0 },
      announcements: { prevWeek: [], thisWeek: [] },
    } as unknown as WeeklyReportModel
    const catalog = buildWeeklyCatalog({
      model,
      calendar: calUtcMon,
      narrative: { prev: [], curr: [{ phase: 'P', num: 1, items: ['할 일', '- 이미'] }], issues: [], events: [] },
    })
    expect(catalog.report.week_year).toBe(label.year)
    expect(catalog.report.week_month).toBe(label.month)
    expect(catalog.report.week_ordinal).toBe(label.ordinal)
    expect(catalog.report.week_year).not.toBe(model.meta.isoYear)
    expect(catalog.report.week_days).toEqual([{ date: weekStart, dow: 1 }])
    expect(catalog.wbs_groups.curr[0].lines).toEqual([subLineText('할 일'), subLineText('- 이미')])
    // 회사 양식 머리글용 범위 — 표시 요일 첫날~끝날, 전주·차주는 달력의 이웃 주(월~금)
    expect(catalog.report.week_range_ymd).toBe('2026.10.05~2026.10.05')
    expect(catalog.report.next_week_range_ymd).toBe('2026.10.12~2026.10.16')
    expect(catalog.report.prev_week_range_ymd).toBe('2026.09.28~2026.10.02')
    expect(catalog.report.week_range_mmdd).toBe('10/05~10/05')
    expect(catalog.report.next_week_range_mmdd).toBe('10/12~10/16')
    expect(catalog.tasks).toEqual([])
  })

  it('휴가 — 차주·금주 줄(요일 칸에 유형 약칭)과 사람이 적던 꼴의 요약, 요일 날짜(일)', () => {
    const days = ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30']
    const next = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06']
    const model = {
      meta: { weekStart: '2026-10-26', weekDays: days, nextWeekDays: next, weekRange: '', nextWeekRange: '', prevWeekRange: '' },
      kpi: {}, attendance: { thisWeek: [], nextWeek: [] }, meetings: { thisWeek: [], nextWeek: [], total: 0 },
      announcements: { prevWeek: [], thisWeek: [] }, issues: [], phases: [], planActual: [], workload: [], wbs: [],
      leaves: {
        thisWeek: [
          { memberName: '하정철', title: '매니저', team: '부산운영팀', typeCode: 'annual', typeLabel: '연차', typeShort: '연', dates: ['2026-10-27'], perDay: [false, true, false, false, false] },
          { memberName: '김수형', title: '', team: '부산운영팀', typeCode: 'annual', typeLabel: '연차', typeShort: '연', dates: ['2026-10-28', '2026-10-29', '2026-10-30'], perDay: [false, false, true, true, true] },
        ],
        nextWeek: [
          { memberName: '최진혁', title: '', team: '부산운영팀', typeCode: 'half', typeLabel: '반차', typeShort: '반', dates: ['2026-11-02', '2026-11-04'], perDay: [true, false, true, false, false] },
        ],
      },
    } as unknown as WeeklyReportModel
    const catalog = buildWeeklyCatalog({ model, calendar: calUtcMon })
    expect(catalog.leaves.this_week_summary).toBe('하정철 매니저(연차 10/27), 김수형(연차 10/28 ~ 30)')
    expect(catalog.leaves.next_week).toEqual([{
      team: '부산운영팀', kind: '반차', member: '최진혁', title: '', dates: '11/02, 11/04', note: '',
      d1: '반', d2: '', d3: '반', d4: '', d5: '', d6: '', d7: '',
    }])
    expect(catalog.leaves.next_week_summary).toBe('최진혁(반차 11/02, 11/04)')
    expect([catalog.report.week_day1, catalog.report.week_day5, catalog.report.week_day6]).toEqual(['26', '30', ''])
    expect([catalog.report.next_week_day1, catalog.report.next_week_day5]).toEqual(['2', '6'])
    // 휴가 기록이 없는 모델(옛 모양)도 빈 값
    const bare = buildWeeklyCatalog({ model: { ...model, leaves: undefined } as unknown as WeeklyReportModel, calendar: calUtcMon })
    expect(bare.leaves).toEqual({ this_week: [], next_week: [], this_week_summary: '', next_week_summary: '' })
  })

  it('leaveDatesText — 표시 요일에서 이어진 날은 묶고, 달이 바뀌면 끝에도 달을 적는다', () => {
    const days = ['2026-10-28', '2026-10-29', '2026-10-30', '2026-11-02', '2026-11-03']
    expect(leaveDatesText(['2026-10-29'], days)).toBe('10/29')
    expect(leaveDatesText(['2026-10-28', '2026-10-29', '2026-10-30'], days)).toBe('10/28 ~ 30')
    expect(leaveDatesText(['2026-10-30', '2026-11-02'], days)).toBe('10/30 ~ 11/02')  // 주말을 건너 이어진 표시 요일
    expect(leaveDatesText(['2026-11-03', '2026-10-28'], days)).toBe('10/28, 11/03')
  })

  it('모델이 없으면 범위 값은 비고 tasks 는 넘긴 그대로다', () => {
    const tasks = weeklyCatalogTasks([row('a', { thisContent: '한 건' })], [area('a', true, 0)])
    const catalog = buildWeeklyCatalog({ tasks })
    expect(catalog.report.week_range_ymd).toBe('')
    expect(catalog.report.next_week_range_mmdd).toBe('')
    expect(catalog.tasks).toBe(tasks)
  })
})

describe('splitTaskBlocks · weeklyCatalogTasks — 업무 건 단위', () => {
  it('빈 줄과 "[분류] 제목" 줄에서 건을 나누고, 들여쓰기·글머리 글자는 그대로 둔다(탭은 공백 넷)', () => {
    const text = '[생산계획] 간트 연동\n  ▪ 목적 : 연계\n\t–  개발\n[통합관제] 크레인 제한\n ㄴ 유효성\n\n\n세 번째 건\n   - 세부\n'
    expect(splitTaskBlocks(text)).toEqual([
      ['[생산계획] 간트 연동', '  ▪ 목적 : 연계', '    –  개발'],
      ['[통합관제] 크레인 제한', ' ㄴ 유효성'],
      ['세 번째 건', '   - 세부'],
    ])
    // 들여쓴 "[" 줄(두 칸 이상)은 건 안의 줄이다
    expect(splitTaskBlocks('[A] 제목\n  [참고] 안쪽')).toEqual([['[A] 제목', '  [참고] 안쪽']])
    expect(splitTaskBlocks('\n  \n')).toEqual([])
  })

  it('같은 제목의 금주·차주 건을 한 항목으로 묶고, 짝 없는 차주 건은 영역 끝에, 글 없는 영역은 건이 없다', () => {
    const areas = [area('q', true, 1), area('empty', true, 2), area('g', true, 3), area('off', false, 4)]
    const rows = [
      row('q', { thisContent: '[생산계획] 간트\n–  개발\n\n[통합관제] 크레인', nextContent: '[통합관제]  크레인\n–  반영\n\n[신규] 다음 주만' }),
      row('empty'),
      row('g', { thisContent: '세로고정 상차', nextContent: '' }),
      row('off', { nextContent: '비활성이지만 글이 있다' }),
    ]
    const tasks = weeklyCatalogTasks(rows, areas)
    expect(tasks.map((t) => [t.code, t.title, t.this_content, t.next_content])).toEqual([
      ['q', '[생산계획] 간트', ['[생산계획] 간트', '–  개발'], []],
      ['q', '[통합관제] 크레인', ['[통합관제] 크레인'], ['[통합관제]  크레인', '–  반영']],
      ['q', '[신규] 다음 주만', [], ['[신규] 다음 주만']],
      ['g', '세로고정 상차', ['세로고정 상차'], []],
      ['off', '비활성이지만 글이 있다', [], ['비활성이지만 글이 있다']],
    ])
    // 제목에 [분류] 가 없으면 [영역 이름] 을 붙인 줄이 tagged 다
    expect(tasks[3].this_tagged).toEqual(['[g] 세로고정 상차'])
    expect(tasks[0].this_tagged).toEqual(tasks[0].this_content)
    expect(tasks[3].next_tagged).toEqual([])
  })

  it('작성 항목이 있으면 첫 항목의 칸을 쓰고, 한 영역의 여러 행은 건으로 이어 붙인다', () => {
    const tasks = weeklyCatalogTasks(
      [row('a', { thisContent: '첫 행 건' }), { ...row('a', { thisContent: '둘째 행 건' }), id: 'a-row-2' }],
      [area('a', true, 0)],
      [{ id: 'content', label: '내용', carryOver: true }, { id: 'issue', label: '이슈', carryOver: false }],
    )
    expect(tasks.map((t) => t.title)).toEqual(['첫 행 건', '둘째 행 건'])
  })
})
