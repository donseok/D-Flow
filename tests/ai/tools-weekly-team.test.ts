import { describe, expect, it, vi } from 'vitest'
// 주간업무 봇 도구의 팀 필터(D24) — 원천은 area_teams(주 ∪ 보조) 하나다. 하드코딩 구분 매핑·팀 캐시·동명 구분 폴백이 없다.
// 팀 목록은 설정 저장소(getProjectConfig 의 teams — 그 워크스페이스 공용 ∪ 그 프로젝트 전용), 등록 판정은 프로젝트 화면과 같은 규칙
// (resolveTeamsForProject — 전용 팀이 있으면 그것만, 비활성 포함). 합성 구성 R(팀 RES·OPS, 영역 실험·데이터·운영)을 쓴다.
import { createCompareWeeklySheetsTool, createGetWeeklySheetTool } from '@/lib/ai/tools/weekly'
import type { ToolExecutionContext } from '@/lib/ai/tools/types'
import { areasForTeam } from '@/lib/domain/weeklySheet'
import { buildSheetSections } from '@/lib/report/sheetNarrative'
import type { ConfigArea, ConfigTeam, ProjectConfig } from '@/lib/settings/projectConfig'
import {
  repositoryError, repositoryOk, type RepositoryResult, type WeeklyRepository, type WeeklySheetSnapshot,
} from '@/lib/repositories/types'
import { makeProjectConfig } from '../helpers/projectConfigFixture'
import { SYNTHETIC_TEAMS } from '../fixtures/synthetic/teams'
import { SYNTHETIC_WEEKLY_AREAS } from '../fixtures/synthetic/areas'

const context: ToolExecutionContext = {
  userId: 'user-1',
  capabilities: ['weekly:read'],
  allowedProjectIds: ['p1', 'p2', 'p-proto'],
  pageContext: null,
  now: '2026-07-20T09:00:00+09:00',
  timezone: 'Asia/Seoul',
}

// p1 = 그 워크스페이스의 공용 팀(RES·OPS)을 상속하는 프로젝트
const AREAS: ConfigArea[] = SYNTHETIC_WEEKLY_AREAS.research.map(a => ({ ...a }))
const TEAMS: ConfigTeam[] = SYNTHETIC_TEAMS.research.map(t => ({ ...t, projectId: null }))
const areaIdOf = (name: string, areas: readonly ConfigArea[] = AREAS): string => {
  const area = areas.find(a => a.name === name)
  if (!area) throw new Error(`합성 영역이 없다: ${name}`)
  return area.id
}
const team = (id: string, code: string, projectId: string | null, active = true): ConfigTeam => ({
  id, code, name: code, sortOrder: 0, active, color: '#6b7280', progressVisible: true, projectId,
})

function config(projectId: string, teams: ConfigTeam[] = TEAMS, areas: ConfigArea[] = AREAS): ProjectConfig {
  return makeProjectConfig({}, { projectId, workspaceId: 'ws-1', teams, areas: { weekly_section: areas, issue_area: [] } })
}
const settingsOf = (byProject: Record<string, ProjectConfig>) => ({
  getProjectConfig: vi.fn(async (projectId: string): Promise<RepositoryResult<ProjectConfig>> => {
    const cfg = byProject[projectId]
    return cfg ? repositoryOk(cfg) : repositoryError<ProjectConfig>('PROJECT_SETTINGS_READ_FAILED', true)
  }),
})

function sheet(projectId: string, rows: Array<{ id: string; area: string; thisContent?: string }>, areas: ConfigArea[] = AREAS): WeeklySheetSnapshot {
  return {
    report: { id: 'r1', projectId, weekStart: '2026-07-20', title: '2026-07-20 주간업무', updatedAt: '2026-07-20T01:00:00Z' },
    rows: rows.map(r => ({
      id: r.id, reportId: 'r1', areaId: areaIdOf(r.area, areas),
      thisContent: r.thisContent ?? `${r.area} 업무`, thisIssue: '', nextContent: '', nextIssue: '',
      updatedAt: '2026-07-20T02:00:00Z',
    })),
    areas,
  }
}
const FULL = (projectId: string) => sheet(projectId, [
  { id: 'row-exp', area: '실험' }, { id: 'row-data', area: '데이터' }, { id: 'row-ops', area: '운영' },
])
const repoOf = (snapshot: WeeklySheetSnapshot): WeeklyRepository => ({ getSheet: vi.fn(async () => repositoryOk(snapshot)) })
// 인자 검증 단계 테스트 — 저장소에 도달하면 안 된다
const unreachable = (): WeeklyRepository => ({ getSheet: vi.fn(async () => { throw new Error('검증 실패 인자가 저장소까지 내려왔다') }) })

describe('주간 봇 도구 — 팀 필터 = area_teams(주 ∪ 보조)', () => {
  it('RES 는 실험·데이터(둘 다 주), OPS 는 데이터(보조)·운영(주)을 잡는다 — 영역 순서대로', async () => {
    const settings = settingsOf({ p1: config('p1') })
    const tool = createGetWeeklySheetTool(repoOf(FULL('p1')), settings)
    const res = await tool.execute({ projectId: 'p1', weekStart: '2026-07-20', team: 'RES' }, context)
    const ops = await tool.execute({ projectId: 'p1', weekStart: '2026-07-20', team: 'OPS' }, context)
    expect(res.ok && res.result.records.map(r => r.section)).toEqual(['실험', '데이터'])
    expect(ops.ok && ops.result.records.map(r => r.section)).toEqual(['데이터', '운영'])
    expect(ops.ok && ops.result.records.map(r => r.areaId)).toEqual([areaIdOf('데이터'), areaIdOf('운영')])
  })

  it('compare_weekly_sheets 도 같은 영역 집합으로 거른다', async () => {
    const settings = settingsOf({ p1: config('p1') })
    // 두 주차 각각의 스냅샷 — 같은 스냅샷(7/20)을 두 주에 돌려주면 범위 검사(isScopedWeeklySnapshot)가 막는다
    const repo: WeeklyRepository = {
      getSheet: vi.fn(async (_projectId: string, weekStart: string) => {
        const snap = FULL('p1')
        return repositoryOk({ ...snap, report: { ...snap.report, weekStart } })
      }),
    }
    const res = await createCompareWeeklySheetsTool(repo, settings).execute(
      { projectId: 'p1', fromWeekStart: '2026-07-13', toWeekStart: '2026-07-20', team: 'RES' }, context,
    )
    expect(res.ok && res.result.records.map(r => r.section)).toEqual(['실험', '데이터'])
  })

  it('W18 패리티 — 도구의 팀 필터 결과 = 보고서(buildSheetSections)의 같은 팀 영역(같은 areasForTeam 입력)', async () => {
    const snapshot = FULL('p1')
    const tool = createGetWeeklySheetTool(repoOf(snapshot), settingsOf({ p1: config('p1') }))
    for (const code of ['RES', 'OPS']) {
      const res = await tool.execute({ projectId: 'p1', weekStart: '2026-07-20', team: code }, context)
      const teamAreas = areasForTeam(AREAS, TEAMS, code)
      const reportAreaIds = buildSheetSections(snapshot.rows, AREAS).map(s => s.areaId).filter(id => teamAreas.has(id))
      expect(res.ok && res.result.records.map(r => r.areaId), code).toEqual(reportAreaIds)
    }
  })

  it('등록되지 않은 팀은 알 수 없는 담당팀이다 — 저장소에 닿지 않는다', async () => {
    const repo = unreachable()
    const result = await createGetWeeklySheetTool(repo, settingsOf({ p1: config('p1') })).execute(
      { projectId: 'p1', weekStart: '2026-07-20', team: 'NOPE' }, context,
    )
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT', message: '알 수 없는 담당팀입니다.' } })
    expect(repo.getSheet).not.toHaveBeenCalled()
  })

  it('등록 팀인데 맡은 영역이 0 이면 영역 용어로 안내한다(조용한 빈 결과 금지) — 두 도구 모두', async () => {
    const withQa = config('p1', [...TEAMS, team('t-qa', 'QA', null)])
    const settings = settingsOf({ p1: withQa })
    const get = await createGetWeeklySheetTool(unreachable(), settings).execute(
      { projectId: 'p1', weekStart: '2026-07-20', team: 'QA' }, context,
    )
    const compare = await createCompareWeeklySheetsTool(unreachable(), settings).execute(
      { projectId: 'p1', fromWeekStart: '2026-07-13', toWeekStart: '2026-07-20', team: 'QA' }, context,
    )
    const message = "'QA' 팀이 맡은 주간보고 영역이 없습니다 — 프로젝트 설정의 업무영역에서 담당 팀을 지정하세요."
    expect(get).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT', message } })
    expect(compare).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT', message } })
  })

  it('동명 영역 폴백이 없다 — 팀 code 와 같은 이름의 영역이 있어도 담당으로 지정하지 않았으면 영역 0 이다', async () => {
    const qaArea: ConfigArea = { id: 'area-qa', kind: 'weekly_section', code: 'QA', name: 'QA', sortOrder: 9, active: true, teams: [] }
    const settings = settingsOf({ p1: config('p1', [...TEAMS, team('t-qa', 'QA', null)], [...AREAS, qaArea]) })
    const result = await createGetWeeklySheetTool(unreachable(), settings).execute(
      { projectId: 'p1', weekStart: '2026-07-20', team: 'QA' }, context,
    )
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } })
    expect((result as { error: { message: string } }).error.message).toContain('맡은 주간보고 영역이 없습니다')
  })

  it('전용 팀이 하나라도 있으면 그것만 등록 팀이다 — 상속하던 공용 팀 code 는 알 수 없는 팀(프로젝트 화면과 같은 규칙)', async () => {
    const p2 = config('p2', [...TEAMS, team('t-qa2', 'QA', 'p2')])
    const result = await createGetWeeklySheetTool(unreachable(), settingsOf({ p2 })).execute(
      { projectId: 'p2', weekStart: '2026-07-20', team: 'RES' }, context,
    )
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT', message: '알 수 없는 담당팀입니다.' } })
  })

  it('비활성 팀도 등록 팀이다(비활성 포함 판정) — 그 팀이 맡은 영역을 조회한다', async () => {
    const inactiveOps = TEAMS.map(t => (t.code === 'OPS' ? { ...t, active: false } : t))
    const res = await createGetWeeklySheetTool(repoOf(FULL('p1')), settingsOf({ p1: config('p1', inactiveOps) })).execute(
      { projectId: 'p1', weekStart: '2026-07-20', team: 'OPS' }, context,
    )
    expect(res.ok && res.result.records.map(r => r.section)).toEqual(['데이터', '운영'])
  })

  it('접근 판정이 먼저다 — 볼 수 없는 프로젝트는 설정·저장소를 읽지 않는다', async () => {
    const settings = settingsOf({ 'p-other': config('p-other') })
    for (const tool of [createGetWeeklySheetTool(unreachable(), settings), createCompareWeeklySheetsTool(unreachable(), settings)]) {
      const args = tool.name === 'get_weekly_sheet'
        ? { projectId: 'p-other', weekStart: '2026-07-20', team: 'RES' }
        : { projectId: 'p-other', fromWeekStart: '2026-07-13', toWeekStart: '2026-07-20', team: 'RES' }
      await expect(tool.execute(args, context)).resolves.toMatchObject({ ok: false, error: { code: 'ACCESS_DENIED' } })
    }
    expect(settings.getProjectConfig).not.toHaveBeenCalled()
  })

  it('설정을 못 읽으면 도구 실패다 — 팀 없음으로 위장하지 않고 저장소에 닿지 않는다', async () => {
    const repo = unreachable()
    const result = await createGetWeeklySheetTool(repo, settingsOf({})).execute(
      { projectId: 'p1', weekStart: '2026-07-20', team: 'RES' }, context,
    )
    expect(result).toMatchObject({ ok: false, error: { code: 'DATA_SOURCE_ERROR', repositoryErrorCode: 'PROJECT_SETTINGS_READ_FAILED' } })
    expect(repo.getSheet).not.toHaveBeenCalled()
  })

  it('team 인자가 없으면 설정을 읽지 않는다', async () => {
    const settings = settingsOf({ p1: config('p1') })
    const res = await createGetWeeklySheetTool(repoOf(FULL('p1')), settings).execute({ projectId: 'p1', weekStart: '2026-07-20' }, context)
    expect(res.ok && res.result.records).toHaveLength(3)
    expect(settings.getProjectConfig).not.toHaveBeenCalled()
  })

  it.each(['constructor', '__proto__', 'toString'])('프로토타입 키와 같은 팀 코드(%s)도 던지지 않고 그 팀의 영역만 잡는다', async (code) => {
    const protoTeam = team(`t-${code}`, code, null)
    const areas: ConfigArea[] = AREAS.map(a => (a.name === '운영' ? { ...a, teams: [{ teamId: protoTeam.id, kind: 'primary' }] } : { ...a, teams: [] }))
    const snapshot = sheet('p-proto', [{ id: 'row-exp', area: '실험' }, { id: 'row-ops', area: '운영' }], areas)
    const res = await createGetWeeklySheetTool(repoOf(snapshot), settingsOf({ 'p-proto': config('p-proto', [protoTeam], areas) })).execute(
      { projectId: 'p-proto', weekStart: '2026-07-20', team: code }, context,
    )
    expect(res.ok).toBe(true)
    expect(res.ok && res.result.records.map(r => r.section)).toEqual(['운영'])
  })
})

describe('주간 봇 도구 — section 인자는 영역 이름 또는 code(앞뒤 공백·대소문자 무시)', () => {
  it('이름·code 어느 쪽으로도 같은 영역을 잡고, 모르는 이름은 0건이다', async () => {
    const tool = createGetWeeklySheetTool(repoOf(FULL('p1')), settingsOf({}))
    const exp = AREAS.find(a => a.name === '실험')!
    for (const section of [' 실험 ', exp.code.toLocaleLowerCase('ko-KR'), exp.code.toUpperCase()]) {
      const res = await tool.execute({ projectId: 'p1', weekStart: '2026-07-20', section }, context)
      expect(res.ok && res.result.records.map(r => r.areaId), section).toEqual([exp.id])
    }
    const none = await tool.execute({ projectId: 'p1', weekStart: '2026-07-20', section: '없는 영역' }, context)
    expect(none.ok && none.result.records).toEqual([])
  })
})
