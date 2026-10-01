import { describe, expect, it, vi } from 'vitest'
// 주간 도구의 팀 필터는 매핑 유무와 무관하게 그 프로젝트의 등록 여부부터 본다 — teams/master 는 콜드스타트 시 실 DB 접근이
// 필요하므로 공유 목(tests/fixtures/teams 의 FIXTURE_TEAMS 고정값)으로 대체한다.
vi.mock('@/lib/teams/master', async () => (await import('../helpers/teams-master-mock')).teamsMasterMock())
import {
  createGetWbsChangeLogTool,
  createListWbsAttachmentsTool,
} from '@/lib/ai/tools/wbs'
import {
  createCompareWeeklySheetsTool,
  createGetWeeklySheetTool,
} from '@/lib/ai/tools/weekly'
import { createListMyMeetingsTool } from '@/lib/ai/tools/meetings'
import type { ToolExecutionContext } from '@/lib/ai/tools/types'
import {
  repositoryError,
  repositoryOk,
  type MyMeetingRepository,
  type MyMeetingSnapshot,
  type RepositoryResult,
  type WbsChangeLogSnapshot,
  type WbsSupplementalRepository,
  type WeeklyRepository,
  type WeeklySheetSnapshot,
} from '@/lib/repositories/types'
import type { ConfigArea, ConfigTeam, ProjectConfig } from '@/lib/settings/projectConfig'
import { makeProjectConfig } from '../helpers/projectConfigFixture'
import { SYNTHETIC_TEAMS } from '../fixtures/synthetic/teams'
import { SYNTHETIC_WEEKLY_AREAS } from '../fixtures/synthetic/areas'

const context: ToolExecutionContext = {
  userId: 'user-1',
  capabilities: ['wbs:read', 'weekly:read', 'meetings:read'],
  allowedProjectIds: ['p1', 'p2'],
  pageContext: null,
  now: '2026-07-20T09:00:00+09:00',
  timezone: 'Asia/Seoul',
}

// 합성 구성 R — 영역 실험(RES 주)·데이터(RES 주·OPS 보조)·운영(OPS 주), p1 은 공용 팀 RES·OPS 를 상속한다
const R_AREAS: ConfigArea[] = SYNTHETIC_WEEKLY_AREAS.research.map(a => ({ ...a }))
const R_TEAMS: ConfigTeam[] = SYNTHETIC_TEAMS.research.map(t => ({ ...t, projectId: null }))
const areaIdOf = (name: string): string => {
  const area = R_AREAS.find(a => a.name === name)
  if (!area) throw new Error(`합성 영역이 없다: ${name}`)
  return area.id
}
const weeklySettings = {
  getProjectConfig: vi.fn(async (projectId: string): Promise<RepositoryResult<ProjectConfig>> => repositoryOk(makeProjectConfig({}, {
    projectId, workspaceId: 'ws-1', teams: R_TEAMS, areas: { weekly_section: R_AREAS, issue_area: [] },
  }))),
}

function weeklySnapshot(
  reportId: string,
  weekStart: string,
  rows: Array<{
    id: string
    area: string
    thisContent?: string
    thisIssue?: string
    nextContent?: string
    nextIssue?: string
  }>,
  areas: ConfigArea[] = R_AREAS,
): WeeklySheetSnapshot {
  return {
    report: {
      id: reportId,
      projectId: 'p1',
      weekStart,
      title: `${weekStart} 주간업무`,
      updatedAt: `${weekStart}T01:00:00Z`,
    },
    rows: rows.map((row, index) => ({
      id: row.id,
      reportId,
      areaId: areaIdOf(row.area),
      thisContent: row.thisContent ?? '',
      thisIssue: row.thisIssue ?? '',
      nextContent: row.nextContent ?? '',
      nextIssue: row.nextIssue ?? '',
      updatedAt: `${weekStart}T0${index + 2}:00:00Z`,
    })),
    areas,
  }
}

describe('menu-detail read tools', () => {
  it('fails closed before WBS audit/attachment repository access', async () => {
    const repository: WbsSupplementalRepository = {
      getChangeLog: vi.fn(),
      listAttachmentMetadata: vi.fn(),
    }
    const denied = { ...context, allowedProjectIds: [] }

    await expect(createGetWbsChangeLogTool(repository).execute(
      { projectId: 'p1', itemId: 'w1' }, denied,
    )).resolves.toMatchObject({ ok: false, error: { code: 'ACCESS_DENIED' } })
    await expect(createListWbsAttachmentsTool(repository).execute(
      { projectId: 'p1', itemId: 'w1' }, denied,
    )).resolves.toMatchObject({ ok: false, error: { code: 'ACCESS_DENIED' } })
    expect(repository.getChangeLog).not.toHaveBeenCalled()
    expect(repository.listAttachmentMetadata).not.toHaveBeenCalled()
  })

  it('returns whitelisted WBS change history and metadata-only attachments', async () => {
    const repository: WbsSupplementalRepository = {
      getChangeLog: vi.fn(async () => repositoryOk<WbsChangeLogSnapshot | null>({
        itemId: 'w1', itemCode: '1.1', itemName: 'ERP 설계', itemUpdatedAt: 'u1', truncated: false,
        entries: [{
          id: 1, wbsItemId: 'w1', field: 'actual_pct', oldValue: '10', newValue: '30',
          changedAt: '2026-07-19T01:00:00Z', actorLabel: 'ERP 멤버',
          actorTeam: 'ERP', actorRole: 'member',
        }],
      })),
      listAttachmentMetadata: vi.fn(async () => repositoryOk({
        itemId: 'w1', itemCode: '1.1', itemName: 'ERP 설계', itemUpdatedAt: 'u1', truncated: false,
        attachments: [{
          id: 'a1', wbsItemId: 'w1', fileName: '설계서.pdf', size: 1200,
          mime: 'application/pdf', createdAt: '2026-07-19T02:00:00Z',
        }],
      })),
    }

    const history = await createGetWbsChangeLogTool(repository).execute(
      { projectId: 'p1', itemId: 'w1' }, context,
    )
    const attachments = await createListWbsAttachmentsTool(repository).execute(
      { projectId: 'p1', itemId: 'w1' }, context,
    )

    expect(history).toMatchObject({
      ok: true,
      result: { records: [{ field: 'actual_pct', actorLabel: 'ERP 멤버', actorRole: 'member' }] },
    })
    expect(attachments).toMatchObject({
      ok: true,
      result: {
        records: [{ fileName: '설계서.pdf', size: 1200 }],
        sources: [{ entityType: 'attachment', updatedAt: null }],
      },
    })
    expect(JSON.stringify(attachments)).not.toMatch(/filePath|file_path|signed|uploadedBy|email/i)
  })

  it('rejects supplemental WBS results bound to a different item', async () => {
    const repository: WbsSupplementalRepository = {
      getChangeLog: vi.fn(async () => repositoryOk<WbsChangeLogSnapshot | null>({
        itemId: 'w2', itemCode: '2.1', itemName: '다른 작업', itemUpdatedAt: null, truncated: false,
        entries: [],
      })),
      listAttachmentMetadata: vi.fn(async () => repositoryOk({
        itemId: 'w2', itemCode: '2.1', itemName: '다른 작업', itemUpdatedAt: null, truncated: false,
        attachments: [],
      })),
    }

    await expect(createGetWbsChangeLogTool(repository).execute(
      { projectId: 'p1', itemId: 'w1' }, context,
    )).resolves.toMatchObject({ ok: false, error: { code: 'DATA_SOURCE_ERROR' } })
    await expect(createListWbsAttachmentsTool(repository).execute(
      { projectId: 'p1', itemId: 'w1' }, context,
    )).resolves.toMatchObject({ ok: false, error: { code: 'DATA_SOURCE_ERROR' } })
  })

  it('filters a team by the areas it owns in area_teams (primary ∪ support) — no section-name mapping', async () => {
    const sheet = weeklySnapshot('r1', '2026-07-20', [
      { id: 'exp', area: '실험', thisContent: '실험 업무' },
      { id: 'data', area: '데이터', thisContent: '데이터 업무' },
      { id: 'ops', area: '운영', thisContent: '운영 업무' },
    ])
    const repository: WeeklyRepository = {
      getSheet: vi.fn(async () => repositoryOk(sheet)),
    }

    const res = await createGetWeeklySheetTool(repository, weeklySettings).execute(
      { projectId: 'p1', weekStart: '2026-07-20', team: 'RES' }, context,
    )
    const ops = await createGetWeeklySheetTool(repository, weeklySettings).execute(
      { projectId: 'p1', weekStart: '2026-07-20', team: 'OPS' }, context,
    )

    expect(res.ok && res.result.records.map(row => row.section)).toEqual(['실험', '데이터'])
    expect(ops.ok && ops.result.records.map(row => row.section)).toEqual(['데이터', '운영'])
    // 출처는 영역 id 를 qualifier 로 싣는다 — 비교 레코드의 증거를 영역으로 묶는 열쇠(evidence.ts)
    expect(res.ok && res.result.sources.filter(s => s.entityType === 'weekly_row').map(s => s.qualifier))
      .toEqual([{ anchor: `area:${areaIdOf('실험')}` }, { anchor: `area:${areaIdOf('데이터')}` }])
  })

  it('rejects a weekly response for a different week or report id', async () => {
    const wrongWeek = weeklySnapshot('r1', '2026-07-13', [])
    const wrongRow = weeklySnapshot('r1', '2026-07-20', [
      { id: 'row-1', area: '실험', thisContent: '업무' },
    ])
    wrongRow.rows[0].reportId = 'r-other'

    const wrongWeekRepository: WeeklyRepository = {
      getSheet: vi.fn(async () => repositoryOk(wrongWeek)),
    }
    const wrongRowRepository: WeeklyRepository = {
      getSheet: vi.fn(async () => repositoryOk(wrongRow)),
    }
    const args = { projectId: 'p1', weekStart: '2026-07-20' }

    await expect(createGetWeeklySheetTool(wrongWeekRepository, weeklySettings).execute(args, context))
      .resolves.toMatchObject({ ok: false, error: { code: 'DATA_SOURCE_ERROR' } })
    await expect(createGetWeeklySheetTool(wrongRowRepository, weeklySettings).execute(args, context))
      .resolves.toMatchObject({ ok: false, error: { code: 'DATA_SOURCE_ERROR' } })
  })

  it('compares two weekly sheets by area id — a renamed area is the same area (W14)', async () => {
    // 지난주에는 '실험' 영역의 이름이 '실험 준비'였다 — 같은 id 라 같은 영역의 변경으로 본다(문자열 키였다면 삭제 + 추가)
    const renamedBefore = R_AREAS.map(a => (a.name === '실험' ? { ...a, name: '실험 준비' } : a))
    const before = weeklySnapshot('r-before', '2026-07-13', [
      { id: 'old-exp', area: '실험', thisContent: '요건 분석' },
      { id: 'old-ops', area: '운영', thisContent: '점검 기준' },
    ], renamedBefore)
    const after = weeklySnapshot('r-after', '2026-07-20', [
      { id: 'new-exp', area: '실험', thisContent: '설계 완료' },
      { id: 'new-data', area: '데이터', thisContent: '수집 준비' },
      { id: 'new-ops', area: '운영', thisContent: '점검 기준' },
    ])
    const repository: WeeklyRepository = {
      getSheet: vi.fn(async (_projectId, weekStart) => repositoryOk(
        weekStart === '2026-07-13' ? before : after,
      )),
    }

    const result = await createCompareWeeklySheetsTool(repository, weeklySettings).execute({
      projectId: 'p1', fromWeekStart: '2026-07-13', toWeekStart: '2026-07-20', team: 'RES',
    }, context)

    expect(repository.getSheet).toHaveBeenCalledTimes(2)
    expect(repository.getSheet).toHaveBeenCalledWith('p1', '2026-07-13')
    expect(repository.getSheet).toHaveBeenCalledWith('p1', '2026-07-20')
    expect(result.ok && result.result.records.map(row => [row.areaId, row.section, row.change])).toEqual([
      [areaIdOf('실험'), '실험', 'changed'],      // 라벨은 뒤 주차(개명 뒤) 이름
      [areaIdOf('데이터'), '데이터', 'added'],
    ])
    expect(result).toMatchObject({
      ok: true,
      result: { facts: { changed: 1, added: 1, removed: 0, totalCompared: 2 } },
    })
    // 팀 없이 보면 운영은 내용이 같아 unchanged 다
    const all = await createCompareWeeklySheetsTool(repository, weeklySettings).execute({
      projectId: 'p1', fromWeekStart: '2026-07-13', toWeekStart: '2026-07-20',
    }, context)
    expect(all.ok && all.result.records.map(row => [row.section, row.change])).toEqual([
      ['실험', 'changed'], ['데이터', 'added'], ['운영', 'unchanged'],
    ])
  })

  it('keeps a missing comparison sheet distinct from a failed read', async () => {
    const missing: WeeklyRepository = {
      getSheet: vi.fn(async () => repositoryOk<WeeklySheetSnapshot | null>(null)),
    }
    const missingResult = await createCompareWeeklySheetsTool(missing, weeklySettings).execute({
      projectId: 'p1', fromWeekStart: '2026-07-13', toWeekStart: '2026-07-20',
    }, context)
    expect(missingResult).toMatchObject({
      ok: true,
      result: { facts: { fromReportFound: false, toReportFound: false }, records: [] },
    })

    const failed: WeeklyRepository = {
      getSheet: vi.fn(async (_projectId, weekStart) => weekStart === '2026-07-13'
        ? repositoryError<WeeklySheetSnapshot | null>('WEEKLY_REPORT_READ_FAILED', true)
        : repositoryOk<WeeklySheetSnapshot | null>(null)),
    }
    const failedResult = await createCompareWeeklySheetsTool(failed, weeklySettings).execute({
      projectId: 'p1', fromWeekStart: '2026-07-13', toWeekStart: '2026-07-20',
    }, context)
    expect(failedResult).toMatchObject({
      ok: false,
      error: { code: 'DATA_SOURCE_ERROR', repositoryErrorCode: 'WEEKLY_REPORT_READ_FAILED' },
    })
  })

  it('lists only server-verified personal meetings and exposes no attendee identity fields', async () => {
    const snapshot: MyMeetingSnapshot = {
      meetings: [{
        id: 'm1', projectId: 'p1', title: '주간회의', meetingDate: '2026-07-20',
        startTime: '10:00', endTime: '11:00', location: 'A 회의실', category: 'routine', body: '',
        recurrence: 'weekly', recurrenceUntil: null, createdBy: 'other-user', createdByName: '담당자',
        createdAt: '2026-07-01T00:00:00Z', updatedAt: '2026-07-19T00:00:00Z',
        attendeeIds: ['private-member-id'], projectName: '프로젝트 1', isMine: true, mineBy: 'attendee',
      }],
      exceptions: [{ meetingId: 'm1', occurrenceDate: '2026-07-27', kind: 'cancelled' }],
    }
    const repository: MyMeetingRepository = {
      listMyMeetings: vi.fn(async () => repositoryOk(snapshot)),
    }
    const result = await createListMyMeetingsTool(repository).execute({
      from: '2026-07-20', to: '2026-08-03', limit: 20,
    }, context)

    expect(repository.listMyMeetings).toHaveBeenCalledWith(
      'user-1', ['p1', 'p2'], '2026-07-20', '2026-08-03',
    )
    expect(result.ok && result.result.records.map(row => row.occurrenceDate)).toEqual([
      '2026-07-20', '2026-08-03',
    ])
    if (result.ok) {
      expect(result.result.records[0]).toMatchObject({
        projectName: '프로젝트 1', mineBy: 'attendee',
      })
    }
    expect(JSON.stringify(result)).not.toMatch(/private-member-id|attendeeIds|email/i)
  })

  it('fails closed before a personal-meeting repository call when capability is absent', async () => {
    const repository: MyMeetingRepository = { listMyMeetings: vi.fn() }
    const result = await createListMyMeetingsTool(repository).execute({
      from: '2026-07-20', to: '2026-07-26',
    }, { ...context, capabilities: [] })
    expect(result).toMatchObject({ ok: false, error: { code: 'ACCESS_DENIED' } })
    expect(repository.listMyMeetings).not.toHaveBeenCalled()
  })
})
