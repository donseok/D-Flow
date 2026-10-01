import { describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ getActor: vi.fn(), listProjectsWithState: vi.fn(), createServerClient: vi.fn(), getComputedWbs: vi.fn(), projectTeams: vi.fn() }))
vi.mock('@/lib/authz', () => ({ getActor: m.getActor }))
vi.mock('@/app/actions/project', () => ({ listProjectsWithState: m.listProjectsWithState }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: m.createServerClient }))
vi.mock('@/lib/data/wbs', () => ({ getComputedWbs: m.getComputedWbs }))
vi.mock('@/lib/teams/source', () => ({ projectTeams: m.projectTeams }))
vi.mock('@/lib/authz/portfolioAccess', () => ({ canViewPortfolio: () => true }))

import { getPortfolioInputs } from '@/lib/data/portfolio'
import { keysetTable } from '../helpers/keysetTable'
import { seoulToday } from '@/lib/domain/dates'
import { addDaysCal } from '@/lib/domain/dashboard'

describe('getPortfolioInputs — 팀 원천 실패는 그 행만 degraded(SP4 A2 P19)', () => {
  it('한 프로젝트의 팀 읽기가 실패해도 화면 전체가 멈추지 않는다 — 그 행만 items null·팀 빈 목록, 나머지 행은 정상', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    m.getActor.mockResolvedValue({ isSuperuser: true })
    m.listProjectsWithState.mockResolvedValue({ projects: [{ id: 'pA', name: 'A' }, { id: 'pB', name: 'B' }], degraded: false })
    const empty: Record<string, unknown> = { then: (r: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(r) }
    for (const k of ['select', 'in', 'eq', 'gte', 'order']) empty[k] = () => empty
    m.createServerClient.mockResolvedValue({ from: () => empty })
    m.getComputedWbs.mockResolvedValue({ items: [], today: '2026-03-02' })
    m.projectTeams.mockImplementation(async (pid: string) => {
      if (pid === 'pB') throw new Error('teams down')
      return [{ id: 't', code: 'RES', name: 'RES', color: '#6b7280', sortOrder: 0, active: true, progressVisible: true, projectId: 'pA', workspaceId: 'w' }]
    })
    const { inputs } = await getPortfolioInputs()
    const byId = new Map(inputs.map((i) => [i.projectId, i]))
    expect(byId.get('pA')).toMatchObject({ teams: ['RES'], items: [] })
    expect(byId.get('pB')).toMatchObject({ teams: [], items: null })
    expect(m.projectTeams).toHaveBeenCalledWith('pA')
    err.mockRestore()
  })
})

// A2-1 리뷰 정확성 P2 — 스냅샷 60일 IN 조회가 한 응답(max_rows 1000)에서 잘리면 최근 날짜가 빠진 채 추세가 낡은 시점으로 계산됐다.
// (project_id, snap_date) 복합 키셋으로 끝까지 읽고, 실패·읽는 사이 변경은 로그 + 추세 비표기(일부만 쓰지 않는다).
describe('getPortfolioInputs — 스냅샷 60일 끝까지 읽기', () => {
  const pids = Array.from({ length: 17 }, (_, i) => `00000000-0000-0000-7e57-0000000019${i.toString(16).padStart(2, '0')}`)   // …1900~…1910
  const today = seoulToday()
  const days = Array.from({ length: 61 }, (_, i) => addDaysCal(today, -60 + i))   // 창 안 61일(gte 포함)
  const snaps = pids.flatMap((pid, pi) => days.map((d, di) => ({ project_id: pid, snap_date: d, actual_pct: pi + di / 100, planned_pct: 50 })))
  const setup = (table: ReturnType<typeof keysetTable>) => {
    m.getActor.mockResolvedValue({ isSuperuser: true })
    m.listProjectsWithState.mockResolvedValue({ projects: pids.map((id, i) => ({ id, name: `P${i}` })), degraded: false })
    const empty: Record<string, unknown> = { then: (r: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(r) }
    for (const k of ['select', 'in', 'eq', 'gte', 'order']) empty[k] = () => empty
    m.createServerClient.mockResolvedValue({ from: (t: string) => (t === 'wbs_progress_snapshots' ? table.make() : empty) })
    m.getComputedWbs.mockResolvedValue({ items: [], today })
    m.projectTeams.mockResolvedValue([])
  }

  it('17개 × 61일(1,037행) — 한 응답 1,000행을 넘어도 모든 프로젝트의 최근 날짜까지 읽는다(날짜 오름차순)', async () => {
    expect(snaps.length).toBeGreaterThan(1000)
    const table = keysetTable(snaps)
    setup(table)
    const { inputs } = await getPortfolioInputs()
    for (const i of inputs) {
      expect(i.snapshots, i.projectId).toHaveLength(61)
      expect(i.snapshots.at(-1)?.date, i.projectId).toBe(today)
      expect(i.snapshots.map((s) => s.date)).toEqual(days)
    }
    expect(table.log.length).toBeGreaterThan(1)   // 쪽을 넘겼다
    expect(table.log[1].some((c) => c.method === 'or')).toBe(true)
    expect(table.log[0].filter((c) => c.method === 'order').map((c) => c.args[0])).toEqual(['project_id', 'snap_date'])
  })

  it('읽는 사이 변경(count 불일치)·조회 오류는 로그 + 추세 비표기 — 일부만 읽은 스냅샷을 쓰지 않는다, 나머지 화면은 그대로', async () => {
    for (const table of [
      keysetTable(snaps, { afterResponse: (n, rows) => (n === 1 ? rows.slice(0, -1) : undefined) }),
      keysetTable(snaps, { error: { message: 'boom' } }),
    ]) {
      const err = vi.spyOn(console, 'error').mockImplementation(() => {})
      setup(table)
      const { inputs } = await getPortfolioInputs()
      expect(inputs).toHaveLength(17)
      for (const i of inputs) expect(i.snapshots, i.projectId).toEqual([])
      expect(inputs.every((i) => Array.isArray(i.items))).toBe(true)
      expect(err.mock.calls.some((c) => String(c[0]).includes('스냅샷 조회 실패'))).toBe(true)
      err.mockRestore()
    }
  })
})
