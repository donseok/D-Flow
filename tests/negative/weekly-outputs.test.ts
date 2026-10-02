// 부정 테스트 1(스펙 D7·§6.1, 비평 반영 Q19 — SP4 계획 과제 26). 사용자 정의 팀·영역만 있는 합성 구성 셋의 주간 출력에 SP4 센티널
// (옛 11구분명 ∪ 5팀 코드)이 0건이다. 대상 다섯: ① 기본 생성 시드(defaultWeeklyRows → seedOf — RPC p_seed 모양) ② 이월(carryOverRows)
// ③ 시트 PPT(buildSheetSections → fillSheetTemplate 의 zip 텍스트 파트) ④ 기본 갈래 주간 보고서(buildWeeklyReportModel →
// buildWeeklyNarrative·fillWeeklyTemplate, buildReportWorkbook 의 zip 텍스트 파트) ⑤ 봇 도구 층(get_weekly_sheet·compare_weekly_sheets 의
// 레코드·출처·사실 — LLM 없이 결정적. LLM 의 답은 SP8). 그 구성이 스스로 등록한 이름과 **같은** 센티널만 뺀다(sentinelsFor — 스펙 D8).
// 대조: 옛 이름을 스스로 등록한 구성은 그 이름이 출력에 나오고 정상 동작한다 — 같은 실행에서 탐지가 공허하지 않음을 보인다.
// 옛 이름의 평문은 tests/fixtures/legacy-sentinels.ts 에만 있다(계획 P6) — 이 파일은 그 목록에서 자리로 꺼낸다.
import { calUtcSun, monProjectValues } from '../helpers/calendarFixture'
import { describe, expect, it, vi } from 'vitest'
import { createCompareWeeklySheetsTool, createGetWeeklySheetTool } from '@/lib/ai/tools/weekly'
import type { ToolExecutionContext } from '@/lib/ai/tools/types'
import { carryOverRows, defaultWeeklyRows, seedOf } from '@/lib/domain/weeklyCarry'
import type { WeeklySheetRow } from '@/lib/domain/weeklySheet'
import type { ComputedItem } from '@/lib/domain/types'
import { buildReportWorkbook } from '@/lib/report/excel'
import { buildWeeklyNarrative } from '@/lib/report/narrative'
import { buildSheetSections, sheetLineText } from '@/lib/report/sheetNarrative'
import { fillSheetTemplate, fillWeeklyTemplate } from '@/lib/report/templateFill'
import { buildWeeklyReportModel } from '@/lib/report/weekly'
import { repositoryOk, type RepositoryResult, type WeeklyRepository, type WeeklySheetSnapshot } from '@/lib/repositories/types'
import type { ConfigArea, ConfigTeam, ProjectConfig } from '@/lib/settings/projectConfig'
import { LEGACY_SENTINELS, findSentinels, sentinelsFor, zipTextParts } from '../fixtures/legacy-sentinels'
import { SYNTHETIC_CONFIGS } from '../fixtures/synthetic/configs'
import { SYNTHETIC_PROJECT_ID, SYNTHETIC_TEAMS } from '../fixtures/synthetic/teams'
import { SYNTHETIC_WEEKLY_AREAS } from '../fixtures/synthetic/areas'
import { makeProjectConfig } from '../helpers/projectConfigFixture'

/** 한 구성의 입력 — 그 프로젝트의 팀·주간 영역·단계 이름 */
interface Setup {
  label: string
  projectId: string
  teams: readonly ConfigTeam[]
  areas: readonly ConfigArea[]
  levelLabels: readonly string[]
}

const FROM_WEEK = '2026-09-21'
const TO_WEEK = '2026-09-28'
const TODAY = '2026-09-30'
const META = { meta: { prevWeekRange: '9/21~9/27', weekRange: '9/28~10/4' } }
const SHEET_OPTS = { labels: { left: '금주실적', right: '차주계획' }, lineFormatter: sheetLineText }

const SETUPS: Setup[] = SYNTHETIC_CONFIGS.map((c) => ({
  label: c.id,
  projectId: SYNTHETIC_PROJECT_ID[c.id],
  teams: SYNTHETIC_TEAMS[c.id],
  areas: SYNTHETIC_WEEKLY_AREAS[c.id],
  levelLabels: c.project['core.level_labels'],
}))

/** 옛 이름을 스스로 등록한 구성 — 둘째 구분명을 영역 이름으로, 둘째 팀 코드를 팀으로(스펙 §6.1 의 대조 "팀·영역") */
const [, LEGACY_AREA] = LEGACY_SENTINELS.weeklySections
const [, LEGACY_TEAM] = LEGACY_SENTINELS.teamCodes
const SELF_NAMED: Setup = {
  label: 'self-named',
  projectId: 'p-self-named',
  teams: [{
    id: 't-self', code: LEGACY_TEAM, name: LEGACY_TEAM, sortOrder: 0, active: true, color: '#4f46e5', progressVisible: true,
    projectId: 'p-self-named',
  }],
  areas: [{
    id: 'a-self', kind: 'weekly_section', code: 'SELF', name: LEGACY_AREA, sortOrder: 1, active: true,
    teams: [{ teamId: 't-self', kind: 'primary' }],
  }],
  levelLabels: ['Phase', 'Task'],
}

/** 그 구성이 스스로 등록한 이름(팀·영역의 code·name) — 이것과 같은 센티널만 뺀다 */
const registered = (s: Setup): string[] => [...s.teams.flatMap((t) => [t.code, t.name]), ...s.areas.flatMap((a) => [a.code, a.name])]
const watched = (s: Setup): string[] => sentinelsFor('SP4', registered(s))
const zipText = async (buf: ArrayBuffer | Uint8Array): Promise<string> =>
  (await zipTextParts(buf)).map((p) => `${p.name}\n${p.text}`).join('\n')

/** 영역마다 한 행 — 내용은 그 구성의 이름(영역·담당 팀 이름)과 중립 낱말로만 만든다. 차주 칸도 채워 이월 원본이 되게 한다 */
function rowsOf(s: Setup, reportId: string, week: string): WeeklySheetRow[] {
  return s.areas.map((a, i) => {
    const owners = s.teams.filter((t) => a.teams.some((x) => x.teamId === t.id)).map((t) => t.name).join('·') || '담당 미지정'
    return {
      id: `${reportId}-row-${i + 1}`, reportId, areaId: a.id,
      thisContent: `1. ${a.name} ${week} 실적\n2. ${owners} 검토`,
      thisIssue: `- ${a.name} 일정 협의`,
      nextContent: `1. ${a.name} 차주 계획`,
      nextIssue: `- ${owners} 회의`,
    }
  })
}

function snapshotOf(s: Setup, week: string, reportId: string): WeeklySheetSnapshot {
  return {
    report: { id: reportId, projectId: s.projectId, weekStart: week, title: `${week} 주간업무`, updatedAt: `${week}T01:00:00Z` },
    rows: rowsOf(s, reportId, week).map((r) => ({ ...r, updatedAt: `${week}T02:00:00Z` })),
    areas: [...s.areas],
  }
}

function botFixture(s: Setup) {
  const sheets = new Map([[FROM_WEEK, snapshotOf(s, FROM_WEEK, 'r-from')], [TO_WEEK, snapshotOf(s, TO_WEEK, 'r-to')]])
  const repository: WeeklyRepository = {
    getSheet: vi.fn(async (_projectId: string, weekStart: string) =>
      repositoryOk<WeeklySheetSnapshot | null>(sheets.get(weekStart) ?? null)),
  }
  const settings = {
    getProjectConfig: vi.fn(async (): Promise<RepositoryResult<ProjectConfig>> => repositoryOk(makeProjectConfig(monProjectValues, {
      projectId: s.projectId, workspaceId: 'ws-negative', teams: [...s.teams], areas: { weekly_section: [...s.areas], issue_area: [] },
    }))),
  }
  const context: ToolExecutionContext = {
    userId: 'u-negative', capabilities: ['weekly:read'], allowedProjectIds: [s.projectId], pageContext: null,
    now: '2026-09-30T09:00:00+09:00', timezone: 'Asia/Seoul',
  }
  return { repository, settings, context }
}

/** 봇 도구 층의 결정적 출력 — 팀 없이·팀마다, 한 주 조회·두 주 비교. 레코드·출처·사실을 JSON 으로 */
async function botOutputs(s: Setup): Promise<string[]> {
  const { repository, settings, context } = botFixture(s)
  const get = createGetWeeklySheetTool(repository, settings)
  const compare = createCompareWeeklySheetsTool(repository, settings)
  const runs = [
    await get.execute({ projectId: s.projectId, weekStart: TO_WEEK }, context),
    await compare.execute({ projectId: s.projectId, fromWeekStart: FROM_WEEK, toWeekStart: TO_WEEK }, context),
  ]
  for (const t of s.teams) {
    runs.push(await get.execute({ projectId: s.projectId, weekStart: TO_WEEK, team: t.code }, context))
    runs.push(await compare.execute({ projectId: s.projectId, fromWeekStart: FROM_WEEK, toWeekStart: TO_WEEK, team: t.code }, context))
  }
  return runs.map((r) => {
    if (!r.ok) throw new Error(`도구 실패: ${JSON.stringify(r.error)}`)
    return JSON.stringify({ records: r.result.records, sources: r.result.sources, facts: r.result.facts })
  })
}

const node = (over: Partial<ComputedItem> & Pick<ComputedItem, 'id' | 'name'>): ComputedItem => ({
  parentId: null, code: '1', sortOrder: 1, biz: null, deliverable: null, plannedStart: null, plannedEnd: null, weight: null,
  actualPct: null, owners: [], isOwnerSplit: false, plannedPct: 0, rolledActualPct: 0, achievement: null, status: 'not_started',
  children: [], depth: 0, ...over,
})

/** 기본 갈래 보고서의 WBS — 루트 하나 아래 팀마다 이번 주에 걸친 진행 중 말단 하나(담당 = 그 구성의 팀 code) */
function wbsOf(s: Setup): ComputedItem[] {
  const rootId = `${s.projectId}-root`
  const leafLabel = s.levelLabels[s.levelLabels.length - 1]
  const leaves = s.teams.map((t, i) => node({
    id: `${s.projectId}-leaf-${i + 1}`, parentId: rootId, code: `1.${i + 1}`, sortOrder: i + 1, depth: 1,
    name: `${t.name} ${leafLabel} ${i + 1}`, owners: [{ team: t.code, kind: 'primary' }],
    status: 'in_progress', plannedStart: '2026-09-28', plannedEnd: '2026-10-09', actualPct: 40, plannedPct: 30, rolledActualPct: 40,
  }))
  return [node({
    id: rootId, name: `${s.levelLabels[0]} 1`, weight: 1, plannedPct: 30, rolledActualPct: 40, status: 'in_progress', children: leaves,
  })]
}

async function reportOutputs(s: Setup): Promise<{ pptx: string; xlsx: string; leafName: string }> {
  const items = wbsOf(s)
  const model = buildWeeklyReportModel(
    items, { name: `Acme ${s.label}`, description: null, start_date: '2026-09-01', end_date: '2026-12-31' }, TODAY,
    { teams: s.teams.map((t) => t.code), levelLabels: s.levelLabels, generatedAt: '2026-09-30 09:00', calendar: calUtcSun },
  )
  return {
    pptx: await zipText(await fillWeeklyTemplate(buildWeeklyNarrative(model), model)),
    xlsx: await zipText(await buildReportWorkbook(model)),
    leafName: items[0].children[0].name,
  }
}

describe.each(SETUPS.map((s) => [s.label, s] as const))('합성 구성 %s — 주간 출력에 SP4 센티널 0건', (_label, s) => {
  const sentinels = watched(s)

  it('① 기본 생성 시드 — 그 구성의 활성 영역마다 한 행(고정 구분 행 없음)', () => {
    const seed = seedOf(defaultWeeklyRows(s.areas))
    expect(seed.map((r) => r.area_id)).toEqual(s.areas.filter((a) => a.active).map((a) => a.id))
    expect(findSentinels(JSON.stringify(seed), sentinels)).toEqual([])
  })

  it('② 이월 — 차주 칸이 자기 영역의 금주 칸으로 가고 옛 이름이 없다', () => {
    const result = carryOverRows(rowsOf(s, 'r-from', FROM_WEEK), s.areas)
    if (!result.ok) throw new Error(`이월 거부: ${JSON.stringify(result)}`)
    expect(result.rows.map((r) => r.areaId)).toEqual(s.areas.map((a) => a.id))
    expect(findSentinels(JSON.stringify(seedOf(result.rows)), sentinels)).toEqual([])
  })

  it('③ 시트 PPT — 페이지 머리가 그 구성의 영역 이름이고 텍스트 파트에 옛 이름이 없다', async () => {
    const text = await zipText(await fillSheetTemplate(buildSheetSections(rowsOf(s, 'r-to', TO_WEEK), s.areas), META, SHEET_OPTS))
    for (const a of s.areas) expect(text, a.name).toContain(a.name)
    expect(findSentinels(text, sentinels)).toEqual([])
  })

  it('④ 기본 갈래 주간 보고서 — PPT·Excel 텍스트 파트에 옛 이름이 없다', async () => {
    const { pptx, xlsx, leafName } = await reportOutputs(s)
    expect(xlsx).toContain(leafName)
    expect(findSentinels(pptx, sentinels)).toEqual([])
    expect(findSentinels(xlsx, sentinels)).toEqual([])
  }, 20_000)

  it('⑤ 봇 도구 층 — 팀 없이·팀마다 조회와 비교의 레코드·출처·사실에 옛 이름이 없다', async () => {
    const outputs = await botOutputs(s)
    expect(outputs).toHaveLength(2 + s.teams.length * 2)
    const first = JSON.parse(outputs[0]) as { records: { section: string }[] }
    expect(first.records.map((r) => r.section)).toEqual(s.areas.map((a) => a.name))
    for (const out of outputs) expect(findSentinels(out, sentinels)).toEqual([])
  })
})

describe('대조 — 옛 이름을 스스로 등록한 구성은 그 이름이 나오고 정상 동작한다(스펙 D8)', () => {
  const own = watched(SELF_NAMED)
  const all = sentinelsFor('SP4', [])

  it('빼는 센티널은 등록한 두 이름뿐이다(포함 관계로는 빼지 않는다)', () => {
    expect(all.filter((w) => !own.includes(w))).toEqual([LEGACY_AREA, LEGACY_TEAM])
  })

  it('봇 도구 — 그 팀 code 로 거르면 그 영역 행이 나오고, 출력의 옛 이름은 등록한 두 이름뿐이다', async () => {
    const { repository, settings, context } = botFixture(SELF_NAMED)
    const res = await createGetWeeklySheetTool(repository, settings).execute(
      { projectId: SELF_NAMED.projectId, weekStart: TO_WEEK, team: LEGACY_TEAM }, context,
    )
    expect(res.ok && res.result.records.map((r) => r.section)).toEqual([LEGACY_AREA])
    const text = (await botOutputs(SELF_NAMED)).join('\n')
    expect(findSentinels(text, all)).toEqual([LEGACY_AREA, LEGACY_TEAM])
    expect(findSentinels(text, own)).toEqual([])
  })

  it('시트 PPT·기본 갈래 보고서 — 등록한 이름이 출력에 있고 그 밖의 옛 이름은 없다', async () => {
    const sheet = await zipText(await fillSheetTemplate(
      buildSheetSections(rowsOf(SELF_NAMED, 'r-to', TO_WEEK), SELF_NAMED.areas), META, SHEET_OPTS,
    ))
    const { pptx, xlsx } = await reportOutputs(SELF_NAMED)
    expect(sheet).toContain(LEGACY_AREA)
    expect(xlsx).toContain(LEGACY_TEAM)
    for (const text of [sheet, pptx, xlsx]) expect(findSentinels(text, own)).toEqual([])
  }, 20_000)
})
