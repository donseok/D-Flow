// 설정 액션의 주 시작 편집(SP5 스펙 §4.2·D53, 개정 §2.8.7) — 오늘은 프로젝트 tz 의 날짜, 문서 수는 그 프로젝트 주간보고, 목록 입력은 거부,
// 판독 실패는 unavailable(RPC 미호출), DB 의 SETTINGS_CODE_IN_USE 는 막는 주차를 키 오류로 돌려준다([RF3]).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeSettingsDb } from '../helpers/fakeSettingsDb'
const h = vi.hoisted(() => ({ requireProjectAdmin: vi.fn(), requireWorkspaceAdmin: vi.fn(), adminFor: vi.fn(), revalidatePath: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: h.revalidatePath }))
vi.mock('@/lib/authz', () => ({ requireProjectAdmin: h.requireProjectAdmin, requireWorkspaceAdmin: h.requireWorkspaceAdmin }))
vi.mock('@/lib/supabase/adminFor', () => ({ adminFor: h.adminFor }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn(async () => { throw new Error('세션 클라이언트를 쓰면 안 된다') }) }))
import { updateProjectSettings, type SettingsPatch } from '@/app/actions/settings'
import { makeActor } from '../fixtures/actor'

const PID = '00000000-0000-0000-7e57-0000000019a1', WID = '00000000-0000-0000-7e57-00000000aa5c'
const CMD = '00000000-0000-4000-8000-0000000019a2'
const MON0 = [{ day: 'monday', from: null }]
let db: FakeSettingsDb
const patch = (over: Partial<SettingsPatch>): SettingsPatch => ({ expectedRevision: 1, commandId: CMD, set: {}, unset: [], ...over })
const project = (values: Record<string, unknown>) =>
  db.addProject({ id: PID, workspaceId: WID, revision: 1, values: { 'core.level_labels': ['Phase', 'Task'], 'modules.enabled': ['weekly'], ...values } })

beforeEach(() => {
  vi.clearAllMocks()
  db = new FakeSettingsDb().addWorkspace({ id: WID, values: { 'modules.allowed': ['weekly'] }, revision: 1 })
  h.adminFor.mockImplementation((scope: Record<string, string>) => ({ ...scope, admin: db.client() }))
  const actor = makeActor({ userId: 'u-admin', workspaceRoles: new Map([[WID, 'admin']]) })
  h.requireProjectAdmin.mockResolvedValue({ ok: true, actor })
  h.requireWorkspaceAdmin.mockResolvedValue({ ok: true, actor })
})
afterEach(() => { vi.useRealTimers() })

describe('updateProjectSettings — calendar.week_start', () => {
  it('오늘은 프로젝트 tz 의 날짜다 — UTC 로는 09-27(일, E ≤ T 라 10-04), LA 로는 09-26(토) 이라 E = 09-27', async () => {
    vi.useFakeTimers({ now: new Date('2026-09-27T02:00:00Z'), toFake: ['Date'] })
    project({ 'calendar.timezone': 'America/Los_Angeles', 'calendar.week_start': MON0 })
    db.weeklyReports.push({ project_id: PID, week_start: '2026-09-21' })
    const r = await updateProjectSettings(PID, patch({ set: { 'calendar.week_start': 'sunday' } }))
    expect(r).toMatchObject({ ok: true, kind: 'applied', revision: 2 })
    expect(db.projects.get(PID)!.values['calendar.week_start']).toEqual([{ day: 'monday', from: null }, { day: 'sunday', from: '2026-09-27' }])
  })
  it('주간보고가 0건이면 요일 하나로 교체한다 — 다른 프로젝트의 문서는 세지 않는다', async () => {
    project({ 'calendar.week_start': [{ day: 'sunday', from: null }] })
    db.weeklyReports.push({ project_id: '00000000-0000-0000-7e57-0000000019a9', week_start: '2026-09-20' })
    expect(await updateProjectSettings(PID, patch({ set: { 'calendar.week_start': 'monday' } }))).toMatchObject({ ok: true })
    expect(db.projects.get(PID)!.values['calendar.week_start']).toEqual(MON0)
  })
  it('목록을 보내면 CONFIG_INVALID(키 오류) — RPC 미호출(과거 규칙 위조 방지)', async () => {
    project({})
    const r = await updateProjectSettings(PID, patch({ set: { 'calendar.week_start': [{ day: 'monday', from: null }] } }))
    expect(r).toMatchObject({ ok: false, kind: 'invalid', code: 'CONFIG_INVALID', fieldErrors: [{ key: 'calendar.week_start' }] })
    expect(db.rpcCalls).toHaveLength(0)
  })
  it('주간보고 판독이 실패하면 unavailable — 0건으로 위장해 교체하지 않는다(RPC 미호출)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    project({ 'calendar.week_start': MON0 })
    db.failTable = 'weekly_reports'
    const r = await updateProjectSettings(PID, patch({ set: { 'calendar.week_start': 'sunday' } }))
    expect(r).toMatchObject({ ok: false, kind: 'unavailable', code: 'CONFIG_UNAVAILABLE', retryable: true })
    expect(db.rpcCalls).toHaveLength(0)
  })
  it('저장된 시간대가 손상이면 주 시작을 바꾸지 않는다(fail-closed) — 다른 키 저장은 된다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    project({ 'calendar.timezone': 'Asia/Seol', 'calendar.week_start': MON0 })
    const r = await updateProjectSettings(PID, patch({ set: { 'calendar.week_start': 'sunday' } }))
    expect(r).toMatchObject({ ok: false, kind: 'invalid', fieldErrors: [{ key: 'calendar.week_start', message: expect.stringContaining('시간대') }] })
    expect(await updateProjectSettings(PID, patch({ set: { 'core.extra_axis_label': 'Track' } }))).toMatchObject({ ok: true })
  })
  it('[RF3] unset(기본값으로) 이 월요일 문서에 막히면 CONFIG_IN_USE — 막는 주차가 키 오류 문구에 있다', async () => {
    project({ 'calendar.week_start': MON0 })
    db.weeklyReports.push({ project_id: PID, week_start: '2026-09-21' })
    db.refCheck = (_s, _set, unset) => unset.includes('calendar.week_start')
      ? { code: '23514', message: 'SETTINGS_CODE_IN_USE:calendar.week_start', details: JSON.stringify({ key: 'calendar.week_start', weeks: ['2026-09-21'] }) }
      : null
    const r = await updateProjectSettings(PID, patch({ unset: ['calendar.week_start'] }))
    expect(r).toMatchObject({ ok: false, kind: 'invalid', code: 'CONFIG_IN_USE',
      fieldErrors: [{ key: 'calendar.week_start', message: expect.stringContaining('2026-09-21') }], error: expect.stringContaining('2026-09-21') })
    expect(db.projects.get(PID)!.values['calendar.week_start']).toEqual(MON0)
  })
  it('detail 이 모르는 모양이면 일반 CONFIG_IN_USE 문구(키 오류 없음)', async () => {
    project({ 'calendar.week_start': MON0 })
    db.refCheck = () => ({ code: '23514', message: 'SETTINGS_CODE_IN_USE:calendar.week_start', details: 'not-json' })
    expect(await updateProjectSettings(PID, patch({ unset: ['calendar.week_start'] })))
      .toMatchObject({ ok: false, code: 'CONFIG_IN_USE', fieldErrors: [], error: expect.stringContaining('사용 중인 항목') })
  })
})
