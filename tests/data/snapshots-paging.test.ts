import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { keysetTable } from '../helpers/keysetTable'

const m = vi.hoisted(() => ({ createServerClient: vi.fn(), projectTeams: vi.fn(), getProjectConfig: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: m.createServerClient }))
// 휴일은 달력 로더(설정 해석기 — 끝까지 + kind)가 읽는다(SP5 A 과제 13). 휴일 쪽 나눔은 tests/calendar/load.test.ts 가 본다
vi.mock('@/lib/settings/projectConfig', () => ({ getProjectConfig: m.getProjectConfig }))
vi.mock('@/lib/teams/source', () => ({ projectTeams: m.projectTeams }))

import { getSnapshots, recordProgressSnapshot } from '@/lib/data/snapshots'
import { makeProjectConfig } from '../helpers/projectConfigFixture'

const PID = '00000000-0000-0000-7e57-000000001920'
const day = (i: number) => new Date(Date.UTC(2023, 0, 1 + i)).toISOString().slice(0, 10)

beforeEach(() => { vi.clearAllMocks(); m.projectTeams.mockResolvedValue([]) })

describe('getSnapshots — 이력을 끝까지(스펙 §4.6 의 같은 결함, SP4 A2)', () => {
  it('한 응답의 상한(3행)을 넘어도 날짜 오름차순 전부 — 최근 쪽이 잘리지 않는다, 키는 snap_date', async () => {
    const t = keysetTable(Array.from({ length: 7 }, (_, i) => ({ project_id: PID, snap_date: day(i), actual_pct: String(i), planned_pct: '50' })), { maxRows: 3 })
    m.createServerClient.mockResolvedValue({ from: () => t.make() })
    const r = await getSnapshots(PID)
    expect(r.ok && r.rows.map((x) => x.date)).toEqual(Array.from({ length: 7 }, (_, i) => day(i)))
    expect(t.log[1]).toEqual(expect.arrayContaining([{ method: 'gt', args: ['snap_date', day(2)] }]))
  })
  it('읽는 사이 행 수가 바뀌거나 조회 오류면 ok:false(고정 문구) — 이력 0건으로 위장하지 않는다', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const moving = keysetTable([{ project_id: PID, snap_date: day(0), actual_pct: 1, planned_pct: 1 }, { project_id: PID, snap_date: day(1), actual_pct: 1, planned_pct: 1 }],
      { maxRows: 1, afterResponse: (n, rows) => (n === 1 ? [...rows, { project_id: PID, snap_date: day(5), actual_pct: 1, planned_pct: 1 }] : undefined) })
    m.createServerClient.mockResolvedValue({ from: () => moving.make() })
    expect(await getSnapshots(PID)).toEqual({ ok: false, error: '진척 이력을 불러오지 못했습니다.' })
    m.createServerClient.mockResolvedValue({ from: () => keysetTable([], { error: { message: 'boom' } }).make() })
    expect(await getSnapshots(PID)).toEqual({ ok: false, error: '진척 이력을 불러오지 못했습니다.' })
    err.mockRestore()
  })
})

describe('recordProgressSnapshot — 재계산 경로를 끝까지·팀 순서는 요청 범위 원천(받은 클라이언트로)', () => {
  // '오늘' = 프로젝트 tz(픽스처 기본 UTC)의 오늘(SP5 과제 22) — 시스템 시각을 2026-03-02 정오(UTC)로 고정한다(Date 만 — 타이머는 그대로)
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-03-02T12:00:00Z')) })
  afterEach(() => { vi.useRealTimers() })
  const item = (i: number) => ({ id: `i${String(i).padStart(4, '0')}`, project_id: PID, parent_id: null, code: String(i), sort_order: i, name: `항목 ${i}`,
    planned_start: '2026-03-02', planned_end: '2026-03-02', weight: null, actual_pct: i < 2 ? 100 : 0, is_owner_split: false })
  it('wbs_items(키 id)가 상한(2행)을 넘어도 전부로 계산한다 — 받은 클라이언트로 팀·달력(휴일)을 읽는다', async () => {
    const items = keysetTable(Array.from({ length: 4 }, (_, i) => item(i)), { maxRows: 2 })
    m.getProjectConfig.mockResolvedValue(makeProjectConfig({}, { holidays: ['2026-01-01', '2026-01-02', '2026-01-03'].map((date) => ({ date, name: '', kind: 'off' as const })) }))
    const upserts: unknown[] = []
    const admin = {
      from: (t: string) => t === 'wbs_items' ? items.make()
        : { upsert: (row: unknown) => { upserts.push(row); return Promise.resolve({ error: null }) } },
    }
    await recordProgressSnapshot(PID, admin as never)
    expect(upserts).toEqual([expect.objectContaining({ project_id: PID, snap_date: '2026-03-02', actual_pct: 50 })])
    expect(items.log.length).toBeGreaterThan(1)
    expect(m.getProjectConfig).toHaveBeenCalledWith(PID, { client: admin })
    expect(m.projectTeams).toHaveBeenCalledWith(PID, { client: admin })
  })
  it('wbs_items 를 읽는 사이 변경이면 기록하지 않고 로그만 — 잘린 트리의 공정율을 오늘 값으로 남기지 않는다', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const items = keysetTable([item(0), item(1), item(2)], { maxRows: 2, afterResponse: (n, rows) => (n === 1 ? [...rows, item(7)] : undefined) })
    const upserts: unknown[] = []
    m.getProjectConfig.mockResolvedValue(makeProjectConfig())
    const sb = { from: (t: string) => t === 'wbs_items' ? items.make()
      : { upsert: (row: unknown) => { upserts.push(row); return Promise.resolve({ error: null }) } } }
    await recordProgressSnapshot(PID, sb as never)
    expect(upserts).toEqual([])
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })
})
