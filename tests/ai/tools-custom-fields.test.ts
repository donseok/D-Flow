import { describe, expect, it, vi } from 'vitest'
// 봇 읽기 도구의 사용자 정의 필드 덧붙임(개정 §3.6.9 — SP5c 소유). WBS 항목 상세·주간 읽기 도구가 그 프로젝트의 searchable 활성 필드를
// `라벨: 값` 으로 덧붙인다. 값 서식은 화면·색인과 같은 한 벌(formatCustomValue)이고, 정의·값을 못 읽으면 "필드 없음"으로 위장하지 않는다.
import { calWithOff, monProjectValues } from '../helpers/calendarFixture'
import { fixedToolTeams } from '../helpers/tool-team-source'
import { fixedToolFields } from '../helpers/tool-field-source'
import { fixedToolLevels } from '../helpers/tool-level-source'
import { makeProjectConfig } from '../helpers/projectConfigFixture'
import { createFindWbsItemsTool, createGetWbsItemDetailTool, type WbsToolItemRecord } from '@/lib/ai/tools/wbs'
import { createGetWeeklySheetTool, type WeeklySheetToolRecord } from '@/lib/ai/tools/weekly'
import type { ToolExecutionContext } from '@/lib/ai/tools/types'
import type { FieldDef } from '@/lib/domain/customFields'
import { formatCustomValue } from '@/lib/domain/customFields'
import { repositoryOk, type WbsProjectSnapshot, type WbsRepository, type WeeklyRepository, type WeeklySheetSnapshot } from '@/lib/repositories/types'
import type { ConfigArea } from '@/lib/settings/projectConfig'
import { SYNTHETIC_WEEKLY_AREAS } from '../fixtures/synthetic/areas'

const context: ToolExecutionContext = {
  userId: 'user-1', capabilities: ['wbs:read', 'weekly:read'], allowedProjectIds: ['p1'],
  pageContext: null, now: '2026-07-20T09:00:00+09:00', timezone: 'Asia/Seoul',
}
const def = (over: Partial<FieldDef>): FieldDef => ({
  key: 'qty', label: '검측 수량', description: '', type: 'number', required: false, editable_by: 'member',
  show_in_list: false, searchable: true, sort: 0, active: true, ...over,
} as FieldDef)
const QTY = def({ limits: { decimals: 1, unit: 'm³' } })
const RESULT = def({ key: 'result', label: '실험 결과', type: 'select', sort: 1, options: [
  { code: 'pass', label: '합격', sort: 0, active: true }, { code: 'old', label: '옛 판정', sort: 1, active: false },
] })
const DONE = def({ key: 'done', label: '검수 완료', type: 'boolean', sort: 2 })
const HIDDEN = def({ key: 'memo', label: '내부 메모', type: 'text', sort: 3, searchable: false })
const OFF = def({ key: 'legacy', label: '옛 필드', type: 'text', sort: 4, active: false })
const DEFS = [DONE, HIDDEN, OFF, RESULT, QTY]   // 설정 순서와 무관하게 sort 순으로 나온다

const wbsSnapshot = (custom: WbsProjectSnapshot['items'][number]['custom']): WbsProjectSnapshot => ({
  projectId: 'p1', baseDate: '2026-07-20', holidays: [], calendar: calWithOff([]), dependencies: [],
  items: [{
    id: 'task-1', projectId: 'p1', parentId: null, code: '1', sortOrder: 1, name: '기초 타설', biz: '콘크리트', deliverable: '검측서',
    plannedStart: '2026-07-20', plannedEnd: '2026-07-22', weight: null, actualPct: 50,
    owners: [], isOwnerSplit: false, updatedAt: '2026-07-20T01:00:00Z', custom,
  }],
})
const wbsRepo = (snapshot: WbsProjectSnapshot) => ({ getProjectSnapshot: vi.fn(async () => repositoryOk(snapshot)) }) satisfies WbsRepository
const VALUES = { qty: 12.5, result: 'old', done: false, memo: '보이지 않아야 한다', legacy: '비활성 값' }

async function detail(snapshot: WbsProjectSnapshot, fields = fixedToolFields({ wbs_item: DEFS })) {
  const r = await createGetWbsItemDetailTool(wbsRepo(snapshot), fixedToolTeams(), fields, fixedToolLevels()).execute({ projectId: 'p1', itemId: 'task-1' }, context)
  if (!r.ok) throw new Error(`도구 실패: ${r.error.code}`)
  return r.result
}

describe('get_wbs_item_detail — 사용자 정의 필드', () => {
  it('searchable 활성 필드만 sort 순으로 `라벨: 값` — 화면과 같은 서식(단위·자릿수·옵션 라벨·예/아니오)', async () => {
    const result = await detail(wbsSnapshot(VALUES))
    const record = result.records[0] as WbsToolItemRecord
    expect(record.customFields).toEqual(['검측 수량: 12.5 m³', '실험 결과: 옛 판정', '검수 완료: 아니오'])
    // 값 서식은 한 벌이다 — 도구가 따로 만들지 않는다
    expect(record.customFields?.[0]).toBe(`${QTY.label}: ${formatCustomValue(QTY, 12.5)}`)
    expect(result.status).toBe('ok')
    expect(result.warnings).toEqual([])
  })

  it('searchable=false·비활성 필드의 값은 어디에도 실리지 않는다', async () => {
    const text = JSON.stringify(await detail(wbsSnapshot(VALUES)))
    expect(text).not.toContain('내부 메모')
    expect(text).not.toContain('보이지 않아야 한다')
    expect(text).not.toContain('옛 필드')
    expect(text).not.toContain('비활성 값')
  })

  it('0·false 는 값이다 — 빠지지 않는다. 값이 없는 필드는 줄을 만들지 않는다', async () => {
    const record = (await detail(wbsSnapshot({ qty: 0, done: false }))).records[0] as WbsToolItemRecord
    expect(record.customFields).toEqual(['검측 수량: 0.0 m³', '검수 완료: 아니오'])
  })

  it('여러 줄 값은 한 항목에 머문다(라벨 없는 줄로 쪼개지지 않는다)', async () => {
    const note = def({ key: 'note', label: '비고', type: 'multiline' })
    const result = await detail(wbsSnapshot({ note: '첫 줄\n둘째 줄' }), fixedToolFields({ wbs_item: [note] }))
    expect((result.records[0] as WbsToolItemRecord).customFields).toEqual(['비고: 첫 줄\n둘째 줄'])
  })

  it('정의가 없거나 값이 없으면 customFields 키 자체가 없다(기존 출력 불변)', async () => {
    expect('customFields' in (await detail(wbsSnapshot(VALUES), fixedToolFields())).records[0]).toBe(false)
    expect('customFields' in (await detail(wbsSnapshot({}))).records[0]).toBe(false)
    expect('customFields' in (await detail(wbsSnapshot(undefined))).records[0]).toBe(false)
  })

  it('정의 조회 실패는 도구 실패다 — "필드 없음"으로 답하지 않는다', async () => {
    const tool = createGetWbsItemDetailTool(wbsRepo(wbsSnapshot(VALUES)), fixedToolTeams(), fixedToolFields({}, { throwOn: 'wbs_item' }), fixedToolLevels())
    await expect(tool.execute({ projectId: 'p1', itemId: 'task-1' }, context)).rejects.toThrow('fields down')
  })

  it('값을 읽지 못한 항목(custom=null)은 partial + 경고 — 값 없음으로 위장하지 않는다', async () => {
    const result = await detail(wbsSnapshot(null))
    expect(result.status).toBe('partial')
    expect(result.warnings).toHaveLength(1)
    expect('customFields' in result.records[0]).toBe(false)
    // searchable 활성 필드가 없으면 덧붙일 것이 없으므로 경고도 없다
    expect((await detail(wbsSnapshot(null), fixedToolFields({ wbs_item: [HIDDEN, OFF] }))).status).toBe('ok')
  })

  it('필드 정의는 접근 판정·항목 확인 뒤에만 읽는다', async () => {
    const fields = fixedToolFields({ wbs_item: DEFS })
    const repo = wbsRepo(wbsSnapshot(VALUES))
    const tool = createGetWbsItemDetailTool(repo, fixedToolTeams(), fields, fixedToolLevels())
    expect(await tool.execute({ projectId: 'p1', itemId: 'task-1' }, { ...context, allowedProjectIds: [] })).toMatchObject({ ok: false, error: { code: 'ACCESS_DENIED' } })
    expect(await tool.execute({ projectId: 'p1', itemId: 'task-1' }, { ...context, capabilities: [] })).toMatchObject({ ok: false, error: { code: 'ACCESS_DENIED' } })
    expect(await tool.execute({ projectId: 'p1', itemId: 'nope' }, context)).toMatchObject({ ok: true, result: { facts: { itemFound: false } } })
    expect(fields.calls).toEqual([])
    await tool.execute({ projectId: 'p1', itemId: 'task-1' }, context)
    expect(fields.calls).toEqual(['p1:wbs_item'])
  })

  it('목록 도구(find_wbs_items)는 필드를 덧붙이지 않는다 — 덧붙임은 항목 상세뿐이다', async () => {
    const r = await createFindWbsItemsTool(wbsRepo(wbsSnapshot(VALUES)), fixedToolTeams(), fixedToolLevels()).execute({ projectId: 'p1', query: '타설' }, context)
    if (!r.ok) throw new Error('도구 실패')
    expect(r.result.records).toHaveLength(1)
    expect(JSON.stringify(r.result)).not.toContain('검측 수량')
  })
})

const AREAS: ConfigArea[] = SYNTHETIC_WEEKLY_AREAS.research.map(a => ({ ...a }))
const weeklyCfg = (defs: FieldDef[] | 'invalid') => {
  const cfg = makeProjectConfig({ ...monProjectValues, ...(defs === 'invalid' ? {} : { 'fields.weekly_row': defs }) },
    { projectId: 'p1', workspaceId: 'ws-1', areas: { weekly_section: AREAS, issue_area: [] } })
  if (defs === 'invalid') (cfg.keys as Record<string, unknown>)['fields.weekly_row'] = { status: 'invalid', error: '손상' }
  return cfg
}
const weeklySheet = (customs: WeeklySheetSnapshot['rows'][number]['custom'][]): WeeklySheetSnapshot => ({
  report: { id: 'r1', projectId: 'p1', weekStart: '2026-07-20', title: '주간', updatedAt: null },
  rows: customs.map((custom, i) => ({
    id: `row-${i}`, reportId: 'r1', areaId: AREAS[i].id, thisContent: `업무 ${i}`, thisIssue: '', nextContent: '', nextIssue: '', updatedAt: null, custom,
  })),
  areas: AREAS,
})
async function weekly(defs: FieldDef[] | 'invalid', customs: WeeklySheetSnapshot['rows'][number]['custom'][]) {
  const repo: WeeklyRepository = { getSheet: vi.fn(async () => repositoryOk(weeklySheet(customs))) }
  const settings = { getProjectConfig: vi.fn(async () => repositoryOk(weeklyCfg(defs))) }
  return createGetWeeklySheetTool(repo, settings).execute({ projectId: 'p1', weekStart: '2026-07-20' }, context)
}

describe('get_weekly_sheet — 사용자 정의 필드', () => {
  it('행마다 searchable 활성 필드를 `라벨: 값` 으로 덧붙인다 — 값 없는 행은 키가 없다', async () => {
    const r = await weekly(DEFS, [{ qty: 3, memo: '숨김', legacy: '옛' }, {}])
    if (!r.ok) throw new Error('도구 실패')
    const records = r.result.records as WeeklySheetToolRecord[]
    expect(records[0].customFields).toEqual(['검측 수량: 3.0 m³'])
    expect('customFields' in records[1]).toBe(false)
    expect(JSON.stringify(r.result)).not.toContain('숨김')
    expect(JSON.stringify(r.result)).not.toContain('옛 필드')
    expect(r.result.status).toBe('ok')
  })

  it('정의 키가 손상이면 도구 실패다 — 필드 없는 주간업무로 답하지 않는다', async () => {
    const r = await weekly('invalid', [{ qty: 3 }])
    expect(r).toMatchObject({ ok: false })
    expect(JSON.stringify(r)).not.toContain('업무 0')
  })

  it('값을 읽지 못한 행(custom=null)은 partial + 경고', async () => {
    const r = await weekly(DEFS, [null, { qty: 1 }])
    if (!r.ok) throw new Error('도구 실패')
    expect(r.result.status).toBe('partial')
    expect(r.result.warnings).toHaveLength(1)
    expect((r.result.records as WeeklySheetToolRecord[])[1].customFields).toEqual(['검측 수량: 1.0 m³'])
  })

  it('정의가 없는 프로젝트는 종전 출력 그대로다', async () => {
    const r = await weekly([], [{ qty: 3 }])
    if (!r.ok) throw new Error('도구 실패')
    expect(r.result.status).toBe('ok')
    expect(r.result.records.every(record => !('customFields' in (record as object)))).toBe(true)
  })
})
