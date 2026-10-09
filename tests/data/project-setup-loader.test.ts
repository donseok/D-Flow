// 준비 체크리스트 로더 — 설정은 넘겨받은 해석기 결과를 쓰고 건수 셋만 읽는다. 초대는 service_role 로 그 프로젝트 하나에 좁혀 센다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => ({ unstable_rethrow: () => {} }))
const h = vi.hoisted(() => ({ session: vi.fn(), admin: vi.fn(), adminFor: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn(async () => ({ from: h.session })) }))
vi.mock('@/lib/supabase/adminFor', () => ({ adminFor: h.adminFor }))

import { loadProjectSetupSteps } from '@/lib/data/projectSetup'
import type { ProjectConfig } from '@/lib/settings/projectConfig'

const P = '00000000-0000-4000-8000-000000000001'
type Result = { count: number | null; error: { message: string } | null }
function chain(result: Result) {
  const c: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'is', 'gt']) c[m] = vi.fn(() => c)
  c.then = (res: (v: Result) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej)
  return c as Record<string, ReturnType<typeof vi.fn>> & PromiseLike<Result>
}
const set = <T,>(value: T) => ({ status: 'set' as const, value })
function cfg(over: Record<string, unknown> = {}): ProjectConfig {
  return {
    projectId: P, workspaceId: 'ws-1',
    keys: {
      'core.level_labels': set(['단계', '작업']),
      'calendar.timezone': set('Asia/Seoul'), 'calendar.working_days': set([1, 2, 3, 4, 5]), 'calendar.week_start': set(0),
    },
    teams: [{ id: 't1', projectId: null, active: true }],
    areas: { weekly_section: [{ id: 'a1', active: true }], issue_area: [] },
    ...over,
  } as unknown as ProjectConfig
}
const PROJECT = { name: '신규', startDate: '2026-10-01', endDate: '2026-12-31' }
let roster: ReturnType<typeof chain>, wbs: ReturnType<typeof chain>, invites: ReturnType<typeof chain>
let errorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  roster = chain({ count: 2, error: null }); wbs = chain({ count: 3, error: null }); invites = chain({ count: 0, error: null })
  h.session.mockReset(); h.session.mockImplementation((t: string) => (t === 'project_members' ? roster : t === 'wbs_items' ? wbs : (() => { throw new Error('세션으로 읽지 않는 표: ' + t) })()))
  h.admin.mockReset(); h.admin.mockImplementation((t: string) => (t === 'project_invites' ? invites : (() => { throw new Error('service_role 로 읽지 않는 표: ' + t) })()))
  h.adminFor.mockReset(); h.adminFor.mockImplementation((scope: { projectId: string }) => ({ ...scope, admin: { from: h.admin } }))
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => { errorSpy.mockRestore() })

describe('loadProjectSetupSteps', () => {
  it('전부 갖춘 프로젝트 — 모든 단계 완료. 건수는 그 프로젝트로 좁혀 센다', async () => {
    const steps = (await loadProjectSetupSteps(cfg(), { project: PROJECT, weeklyEnabled: true }))!
    expect(steps.map((s) => [s.id, s.state])).toEqual([
      ['basic', 'done'], ['levels', 'done'], ['teams', 'done'], ['members', 'done'], ['areas', 'done'], ['calendar', 'done'], ['firstData', 'done'],
    ])
    expect(roster.eq).toHaveBeenCalledWith('project_id', P)
    expect(roster.eq).toHaveBeenCalledWith('active', true)
    expect(wbs.eq).toHaveBeenCalledWith('project_id', P)
    // 초대는 세션에 열려 있지 않은 표 — service_role 을 그 프로젝트 스코프로 만들고 수락 전(회수·만료 아님)만 센다
    expect(h.adminFor).toHaveBeenCalledWith({ projectId: P })
    expect(invites.eq).toHaveBeenCalledWith('project_id', P)
    expect(invites.is).toHaveBeenCalledWith('redeemed_at', null)
    expect(invites.is).toHaveBeenCalledWith('revoked_at', null)
    expect(invites.gt).toHaveBeenCalledWith('expires_at', expect.any(String))
    expect(invites.select).toHaveBeenCalledWith('id', { count: 'exact', head: true })   // 행 내용은 읽지 않는다
  })

  it('주간보고가 꺼져 있으면 업무영역 단계가 없다', async () => {
    const steps = (await loadProjectSetupSteps(cfg(), { project: PROJECT, weeklyEnabled: false }))!
    expect(steps.map((s) => s.id)).not.toContain('areas')
  })

  it('작업 계획 건수를 넘기면(개요 화면) 다시 세지 않는다', async () => {
    const steps = (await loadProjectSetupSteps(cfg(), { project: PROJECT, weeklyEnabled: true, wbsItems: 0 }))!
    expect(steps.find((s) => s.id === 'firstData')!.state).toBe('todo')
    expect(h.session).not.toHaveBeenCalledWith('wbs_items')
  })

  it('설정 키 상태를 그대로 읽는다 — 달력이 미설정(기본값)·단계 이름이 손상이면 아직', async () => {
    const steps = (await loadProjectSetupSteps(cfg({ keys: {
      'core.level_labels': { status: 'invalid', error: 'x' },
      'calendar.timezone': { status: 'default', value: 'UTC', from: 'product' }, 'calendar.working_days': set([1]), 'calendar.week_start': set(0),
    } }), { project: PROJECT, weeklyEnabled: true }))!
    expect(steps.find((s) => s.id === 'levels')!.state).toBe('todo')
    expect(steps.find((s) => s.id === 'calendar')!.state).toBe('todo')
  })

  it('건수 조회 실패는 0 으로 위장하지 않는다 — 그 단계만 확인 불가, 원인은 로그', async () => {
    roster = chain({ count: null, error: { message: 'boom' } }); wbs = chain({ count: null, error: null })
    const steps = (await loadProjectSetupSteps(cfg(), { project: PROJECT, weeklyEnabled: true }))!
    expect(steps.find((s) => s.id === 'members')!.state).toBe('unknown')
    expect(steps.find((s) => s.id === 'firstData')!.state).toBe('unknown')
    expect(steps.find((s) => s.id === 'teams')!.state).toBe('done')
    expect(errorSpy).toHaveBeenCalledTimes(2)
  })

  it('클라이언트를 만들지 못하는 등 예외가 나면 null — 화면 본체를 막지 않는다(체크리스트만 빠진다)', async () => {
    h.adminFor.mockImplementation(() => { throw new Error('adminFor: 스코프 id 가 올바르지 않다') })
    expect(await loadProjectSetupSteps(cfg(), { project: PROJECT, weeklyEnabled: true })).toBeNull()
    expect(errorSpy).toHaveBeenCalledTimes(1)
  })

  it('초대 대체 — 명단이 혼자여도 수락 전 초대가 있으면 멤버 단계 완료', async () => {
    roster = chain({ count: 1, error: null }); invites = chain({ count: 1, error: null })
    const steps = (await loadProjectSetupSteps(cfg(), { project: PROJECT, weeklyEnabled: true }))!
    expect(steps.find((s) => s.id === 'members')!.state).toBe('done')
  })
})
