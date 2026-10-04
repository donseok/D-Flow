import { describe, expect, it } from 'vitest'
import { weekLabelOf } from '@/lib/domain/calendar'
import type { WeeklySheetRow } from '@/lib/domain/weeklySheet'
import type { WeeklyArea } from '@/lib/domain/weeklySheet'
import { subLineText } from '@/lib/report/xml'
import type { WeeklyReportModel } from '@/lib/report/weekly'
import { buildWeeklyCatalog, weeklyCatalogSections } from '@/lib/report/catalog/weeklyBuild'
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
        totalLeaves: 0, phaseCount: 0,
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
  })
})
