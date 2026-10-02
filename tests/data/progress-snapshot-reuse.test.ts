// recordProgressSnapshot 은 대시보드가 방금 계산한 트리를 다시 만들지 않는다.
// 지금까지는 같은 요청 안에서 wbs_items 전량을 두 번 읽고 computeTree 를
// 두 번 돌렸다. 실시간 push 로 재조회가 잦아지면 그 중복이 그대로 배수로 커진다(2026-09-17 실측).
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { computeTree } from '@/lib/domain/rollup'
import { todayIn } from '@/lib/domain/calendar'
import type { BuildTreeOpts } from '@/lib/domain/tree'
import type { WbsRow } from '@/lib/domain/types'
import { teamOrderMap } from '@/lib/domain/teams'
import { FIXTURE_TEAM_CODES } from '../fixtures/teams'
import { calUtcSun } from '../helpers/calendarFixture'

vi.mock('@/lib/teams/source', () => ({ projectTeams: async () => [] }))
// 휴일·달력은 설정 해석기(달력 로더)가 싣는다(SP5 A 과제 13)
const cfgMock = vi.hoisted(() => ({ getProjectConfig: vi.fn() }))
vi.mock('@/lib/settings/projectConfig', () => ({ getProjectConfig: cfgMock.getProjectConfig }))
const { makeProjectConfig } = await import('../helpers/projectConfigFixture')

/** 픽스처 설정의 tz = 제품 기본값 UTC — 재사용 판정의 '오늘'(SP5 과제 22) */
const todayUtc = () => todayIn('UTC', new Date())

type Row = Record<string, unknown>
const reads: string[] = []
let upserted: Row | null = null

function builder(table: string, data: unknown) {
  reads.push(table)
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'order', 'maybeSingle', 'gt', 'limit']) b[m] = vi.fn(() => b)
  b.upsert = vi.fn((row: Row) => {
    upserted = row
    return Promise.resolve({ error: null })
  })
  b.then = (res: (v: { data: unknown; error: unknown }) => unknown, rej: (r: unknown) => unknown) =>
    Promise.resolve({ data, error: null, count: Array.isArray(data) ? data.length : null }).then(res, rej)
  return b
}

const TABLES: Record<string, unknown> = {}
const client = { from: (t: string) => builder(t, TABLES[t] ?? []) }

vi.mock('@/lib/supabase/server', () => ({ createServerClient: async () => client }))

const { recordProgressSnapshot } = await import('@/lib/data/snapshots')

const OPTS: BuildTreeOpts = { subActTeamOrder: teamOrderMap(FIXTURE_TEAM_CODES) }
const dbRow = (id: string, parent: string | null, actual: number | null) => ({
  id, parent_id: parent, code: id, sort_order: 1, name: id,
  planned_start: null, planned_end: null, weight: null, actual_pct: actual, is_owner_split: false,
})
const wbsRow = (id: string, parentId: string | null, actualPct: number | null): WbsRow => ({
  id, parentId, code: id, sortOrder: 1, name: id,
  biz: null, deliverable: null, plannedStart: null, plannedEnd: null,
  weight: null, actualPct, owners: [], isOwnerSplit: false,
})

beforeEach(() => {
  reads.length = 0
  upserted = null
  TABLES.wbs_items = [dbRow('P', null, null), dbRow('a', 'P', 100), dbRow('b', 'P', 0)]
  cfgMock.getProjectConfig.mockReset()
  cfgMock.getProjectConfig.mockResolvedValue(makeProjectConfig())
})

describe('recordProgressSnapshot — 이미 계산된 트리 재사용', () => {
  it('트리를 넘기지 않으면 wbs_items 를 직접 읽는다 (종전 경로)', async () => {
    await recordProgressSnapshot('p1', client as never)
    expect(reads).toContain('wbs_items')
    expect(upserted).toMatchObject({ project_id: 'p1', actual_pct: 50 })
  })

  it('트리를 넘기면 wbs_items 를 다시 읽지 않는다', async () => {
    const roots = computeTree(
      [wbsRow('P', null, null), wbsRow('a', 'P', 100), wbsRow('b', 'P', 0)],
      todayUtc(), calUtcSun, OPTS,
    )
    await recordProgressSnapshot('p1', client as never, { roots, today: todayUtc(), timeZone: 'UTC' })
    expect(reads).not.toContain('wbs_items')
    expect(reads).not.toContain('holidays')
    expect(cfgMock.getProjectConfig).not.toHaveBeenCalled()
  })

  it('재사용해도 기록되는 값이 같다', async () => {
    await recordProgressSnapshot('p1', client as never)
    const direct = upserted

    upserted = null
    const roots = computeTree(
      [wbsRow('P', null, null), wbsRow('a', 'P', 100), wbsRow('b', 'P', 0)],
      todayUtc(), calUtcSun, OPTS,
    )
    await recordProgressSnapshot('p1', client as never, { roots, today: todayUtc(), timeZone: 'UTC' })

    expect(upserted).toMatchObject({
      project_id: 'p1',
      snap_date: (direct as Row).snap_date,
      actual_pct: (direct as Row).actual_pct,
      planned_pct: (direct as Row).planned_pct,
    })
  })

  it('트리의 기준일이 오늘이 아니면 재사용하지 않는다 — base_date 가 설정된 프로젝트', () => {
    // 대시보드는 base_date 로 계산한다. 스냅샷은 '오늘'의 기록이라 기준일이 다르면
    // 같은 트리를 쓸 수 없다. 그 경우엔 종전대로 직접 읽어 계산해야 한다.
    return recordProgressSnapshot('p1', client as never, {
      roots: computeTree([wbsRow('P', null, null)], '2020-01-01', calUtcSun, OPTS),
      today: '2020-01-01',
      timeZone: 'UTC',
    }).then(() => {
      expect(reads).toContain('wbs_items')
      expect(upserted).toMatchObject({ snap_date: todayUtc(), actual_pct: 50 })
    })
  })

  describe('스냅샷의 오늘은 그 프로젝트 tz(SP5 과제 22 — 계획 D-22d)', () => {
    // 2026-10-04T03:00Z = 서울 10-04 12:00 / LA 10-03 20:00
    beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-04T03:00:00Z')) })
    afterEach(() => { vi.useRealTimers() })

    it('재사용 — 트리의 tz 가 LA 면 LA 의 오늘(10-03)로 판정해 재사용한다(설정을 다시 읽지 않는다)', async () => {
      const roots = computeTree([wbsRow('P', null, null), wbsRow('a', 'P', 100), wbsRow('b', 'P', 0)], '2026-10-03', calUtcSun, OPTS)
      await recordProgressSnapshot('p1', client as never, { roots, today: '2026-10-03', timeZone: 'America/Los_Angeles' })
      expect(reads).not.toContain('wbs_items')
      expect(cfgMock.getProjectConfig).not.toHaveBeenCalled()
      expect(upserted).toMatchObject({ snap_date: '2026-10-03' })
    })

    it('직접 계산 — 프로젝트 달력이 LA 면 LA 의 오늘로 기록한다(서울 10-04 가 아니다)', async () => {
      cfgMock.getProjectConfig.mockResolvedValue(makeProjectConfig({ 'calendar.timezone': 'America/Los_Angeles' }))
      await recordProgressSnapshot('p1', client as never)
      expect(reads).toContain('wbs_items')
      expect(upserted).toMatchObject({ snap_date: '2026-10-03' })
    })

    it('프로젝트 달력이 손상이면 기록하지 않는다 — 기본 tz 로 대체하지 않고 로그만', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      cfgMock.getProjectConfig.mockResolvedValue(makeProjectConfig({ 'calendar.timezone': 'Asia/Seol' }))
      await recordProgressSnapshot('p1', client as never)
      expect(upserted).toBeNull()
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('[snapshot]'), expect.anything())
      spy.mockRestore()
    })
  })

})
