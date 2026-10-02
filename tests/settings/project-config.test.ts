// 프로젝트 해석기(개정 §2.5, 스펙 §3.5) — 상태 넷, 0행·오류 throw, 손상은 그 키만, unknownKeys, 클라이언트 주입, 요청 캐시.
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ createServerClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: mocks.createServerClient }))
import { getProjectConfig, levelDepthOf } from '@/lib/settings/projectConfig'
import { valueOf } from '@/lib/settings/registry'
import { ConfigKeyError, ConfigUnavailableError } from '@/lib/settings/errors'
import { DEFAULT_STAGE_CREDITS } from '@/lib/domain/stageCredits'
import { keysetTable } from '../helpers/keysetTable'

const PID = '00000000-0000-4000-8000-00000000aa01'
const WID = '00000000-0000-4000-8000-00000000bb01'
type Res = { data: unknown; error: { message: string } | null; count?: number | null }
/** 표별 응답을 준다. 호출 순서와 select 문자열을 기록해 조회 셋을 단언한다 */
function fakeClient(res: { settings: Res; areas: Res; teams: Res; holidays?: ReturnType<typeof keysetTable> }) {
  const holidays = res.holidays ?? keysetTable([])
  const calls: { table: string; select: string; selectOpts?: unknown; filters: string[] }[] = []
  const chain = (table: string, r: Res) => {
    const rec: { table: string; select: string; selectOpts?: unknown; filters: string[] } = { table, select: '', filters: [] as string[] }
    calls.push(rec)
    const b: Record<string, unknown> = {}
    b.select = (s: string, o?: unknown) => { rec.select = s; rec.selectOpts = o; return b }
    b.eq = (c: string, v: unknown) => { rec.filters.push(`eq:${c}=${v}`); return b }
    b.or = (s: string) => { rec.filters.push(`or:${s}`); return b }
    b.order = () => Promise.resolve(r)
    b.maybeSingle = () => Promise.resolve(r)
    return b
  }
  const client = { from: (t: string) => t === 'holidays' ? holidays.make()
    : chain(t, t === 'project_settings' ? res.settings : t === 'project_areas' ? res.areas : res.teams) }
  return { client: client as never, calls, holidays }
}
const row = (values: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  data: { project_id: PID, values, revision: 3, schema_version: 1, projects: { workspace_id: WID }, ...extra }, error: null,
})
const ok = (data: unknown): Res => ({ data, error: null })

beforeEach(() => { mocks.createServerClient.mockReset(); vi.restoreAllMocks() })

describe('getProjectConfig', () => {
  it('저장값은 set, 없는 키는 product 기본값, 필수 키 없음은 required_missing. 조회는 셋이고 teams 는 워크스페이스 공용도 싣는다', async () => {
    const { client, calls } = fakeClient({
      settings: row({ 'core.milestone_keywords': ['오픈'] }),
      areas: ok([{ id: 'a1', kind: 'weekly_section', code: 'W1', name: '구분1', sort_order: 0, active: true, area_teams: [{ team_id: 't1', kind: 'primary' }] }]),
      teams: ok([{ id: 't1', code: 'DEV', name: '개발', sort_order: 0, active: true, color: '#6b7280', progress_visible: true, project_id: PID },
        { id: 't0', code: 'PMO', name: 'PMO', sort_order: 1, active: true, color: '#6b7280', progress_visible: false, project_id: null }]),
    })
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const cfg = await getProjectConfig(PID, { client })
    // required_missing 도 invalid 처럼 키당 한 줄 남긴다 — 화면·봇·export 가 실패를 보이는데 로그가 없으면 원인을 못 찾는다(FM-13)
    expect(err.mock.calls).toEqual([['[settings] required_missing', { scope: 'project', id: PID, key: 'core.level_labels' }]])
    err.mockRestore()
    expect(mocks.createServerClient).not.toHaveBeenCalled()
    expect(cfg.projectId).toBe(PID); expect(cfg.workspaceId).toBe(WID); expect(cfg.revision).toBe(3); expect(cfg.schemaAhead).toBe(false)
    expect(cfg.keys['core.milestone_keywords']).toEqual({ status: 'set', value: ['오픈'] })
    expect(cfg.keys['core.level_labels']).toEqual({ status: 'required_missing' })
    expect(cfg.keys['core.extra_axis_label']).toEqual({ status: 'default', value: null, from: 'product' })
    expect(cfg.keys['workflow.stage_credits']).toEqual({ status: 'default', value: DEFAULT_STAGE_CREDITS, from: 'product' })
    expect(cfg.keys['modules.enabled']).toMatchObject({ status: 'default', from: 'product' })
    expect(cfg.unknownKeys).toEqual([])
    expect(cfg.areas.weekly_section).toEqual([{ id: 'a1', kind: 'weekly_section', code: 'W1', name: '구분1', sortOrder: 0, active: true, teams: [{ teamId: 't1', kind: 'primary' }] }])
    expect(cfg.areas.issue_area).toEqual([])
    expect(cfg.teams.map((t) => [t.code, t.projectId])).toEqual([['DEV', PID], ['PMO', null]])
    expect(calls.map((c) => c.table)).toEqual(['project_settings', 'project_areas', 'teams'])
    expect(calls[0].select).toContain('projects!inner(workspace_id)')
    expect(calls[2].filters).toEqual([`eq:workspace_id=${WID}`, `or:project_id.is.null,project_id.eq.${PID}`])
  })
  it('팀 조회는 행 수(count)를 함께 받고, 응답이 총합보다 짧으면(max_rows 에서 잘림) 목록을 돌려주지 않고 ConfigUnavailableError(A1-5 R4 — 잘린 팀 목록이 "팀 없음"으로 흐르지 않는다)', async () => {
    const team = (i: number) => ({ id: `t${i}`, code: `T${i}`, name: `T${i}`, sort_order: i, active: true, color: '#6b7280', progress_visible: true, project_id: PID })
    const full = fakeClient({ settings: row({}), areas: ok([]), teams: { data: [team(1), team(2)], error: null, count: 2 } })
    await expect(getProjectConfig(PID, { client: full.client })).resolves.toMatchObject({ teams: [{ code: 'T1' }, { code: 'T2' }] })
    expect(full.calls[2].selectOpts).toEqual({ count: 'exact' })
    const cut = fakeClient({ settings: row({}), areas: ok([]), teams: { data: [team(1), team(2)], error: null, count: 1001 } })
    await expect(getProjectConfig(PID, { client: cut.client })).rejects.toBeInstanceOf(ConfigUnavailableError)
  })
  it('[A2-1 Q5] 팀 code 의 앞뒤 공백은 걷고, 걷은 뒤 빈 code 행은 팀이 아니다(팀 원천·옛 팀 캐시와 같은 정리)', async () => {
    const team = (id: string, code: string) => ({ id, code, name: code, sort_order: 0, active: true, color: '#6b7280', progress_visible: true, project_id: PID })
    const { client } = fakeClient({ settings: row({}), areas: ok([]), teams: { data: [team('t1', ' DEV '), team('t2', '  '), team('t3', 'OPS')], error: null, count: 3 } })
    expect((await getProjectConfig(PID, { client })).teams.map((t) => t.code)).toEqual(['DEV', 'OPS'])
  })
  it('손상 값은 그 키만 invalid 이고 로그 한 줄, 다른 키는 정상. 미등록 키는 unknownKeys', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { client } = fakeClient({
      settings: row({ 'core.level_labels': ['A', 'A'], 'core.milestone_keywords': ['x'], 'legacy.something': 1 }),
      areas: ok([]), teams: ok([]),
    })
    const cfg = await getProjectConfig(PID, { client })
    expect(cfg.keys['core.level_labels']).toEqual({ status: 'invalid', error: '단계 이름이 중복됩니다.' })
    expect(cfg.keys['core.milestone_keywords']).toEqual({ status: 'set', value: ['x'] })
    expect(cfg.unknownKeys).toEqual(['legacy.something'])
    expect(err).toHaveBeenCalledTimes(1)
    expect(err.mock.calls[0][0]).toBe('[settings] invalid')
    expect(err.mock.calls[0][1]).toEqual({ scope: 'project', id: PID, key: 'core.level_labels', error: '단계 이름이 중복됩니다.' })
  })
  it('bigint revision 을 PostgREST 가 문자열로 줘도 number 로 바꾼다(Review Focus 2 — CAS 비교가 조용히 어긋나지 않게)', async () => {
    const { client } = fakeClient({ settings: row({}, { revision: '9007199254740991', schema_version: '1' }), areas: ok([]), teams: ok([]) })
    const cfg = await getProjectConfig(PID, { client })
    expect(cfg.revision).toBe(9007199254740991)
    expect(typeof cfg.revision).toBe('number')
    expect(cfg.schemaVersion).toBe(1)
  })
  it('세대가 앞서면 schemaAhead 이고 아는 키만 읽는다', async () => {
    const { client } = fakeClient({ settings: row({ 'core.level_labels': ['P'] }, { schema_version: 2 }), areas: ok([]), teams: ok([]) })
    const cfg = await getProjectConfig(PID, { client })
    expect(cfg.schemaAhead).toBe(true); expect(cfg.schemaVersion).toBe(2)
    expect(cfg.keys['core.level_labels']).toEqual({ status: 'set', value: ['P'] })
  })
  it('0행·조회 오류는 ConfigUnavailableError — 기본값으로 풀지 않는다', async () => {
    const none = fakeClient({ settings: ok(null), areas: ok([]), teams: ok([]) })
    await expect(getProjectConfig(PID, { client: none.client })).rejects.toBeInstanceOf(ConfigUnavailableError)
    const broken = fakeClient({ settings: { data: null, error: { message: 'db down' } }, areas: ok([]), teams: ok([]) })
    await expect(getProjectConfig(PID, { client: broken.client })).rejects.toMatchObject({ code: 'CONFIG_UNAVAILABLE' })
    const areasBroken = fakeClient({ settings: row({}), areas: { data: null, error: { message: 'x' } }, teams: ok([]) })
    await expect(getProjectConfig(PID, { client: areasBroken.client })).rejects.toBeInstanceOf(ConfigUnavailableError)
  })
  it('values 가 객체가 아니면 ConfigUnavailableError — 전 키를 기본값으로 풀지 않는다', async () => {
    for (const values of [null, [], 'x', 3]) {
      const c = fakeClient({ settings: row({}, { values }), areas: ok([]), teams: ok([]) })
      await expect(getProjectConfig(PID, { client: c.client }), String(values)).rejects.toBeInstanceOf(ConfigUnavailableError)
    }
  })
  it('클라이언트를 안 넘기면 세션 클라이언트를 만든다', async () => {
    const { client } = fakeClient({ settings: row({}), areas: ok([]), teams: ok([]) })
    mocks.createServerClient.mockResolvedValue(client)
    await getProjectConfig(PID)
    expect(mocks.createServerClient).toHaveBeenCalledTimes(1)
  })
  it('valueOf — set·default 는 값, invalid 는 CONFIG_INVALID, required_missing 은 CONFIG_REQUIRED. levelDepthOf 는 라벨 수', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { client } = fakeClient({ settings: row({ 'core.level_labels': ['Phase', 'Task', 'Act'], 'wbs.excel_profile': { version: 2 } }), areas: ok([]), teams: ok([]) })
    const cfg = await getProjectConfig(PID, { client })
    expect(valueOf(cfg, 'core.level_labels')).toEqual(['Phase', 'Task', 'Act'])
    expect(valueOf(cfg, 'core.extra_axis_label')).toBeNull()
    expect(levelDepthOf(cfg)).toBe(3)
    expect(() => valueOf(cfg, 'wbs.excel_profile')).toThrow(ConfigKeyError)
    try { valueOf(cfg, 'wbs.excel_profile') } catch (e) { expect(e).toMatchObject({ code: 'CONFIG_INVALID', key: 'wbs.excel_profile' }) }
    const missing = await getProjectConfig(PID, { client: fakeClient({ settings: row({}), areas: ok([]), teams: ok([]) }).client })
    expect(() => valueOf(missing, 'core.level_labels')).toThrow(expect.objectContaining({ code: 'CONFIG_REQUIRED' }))
    expect(() => levelDepthOf(missing)).toThrow(ConfigKeyError)
  })
})

describe('getProjectConfig — 달력(SP5 A 과제 13)', () => {
  it('휴일을 키셋으로 읽어 holidays·calendar 에 싣는다(work 는 근무)', async () => {
    const holidays = keysetTable([
      { project_id: PID, date: '2026-10-05', name: '휴무', kind: 'off' },
      { project_id: PID, date: '2026-10-10', name: null, kind: 'work' },
    ])
    const { client } = fakeClient({ settings: row({ 'calendar.week_start': [{ day: 'monday', from: null }] }), areas: ok([]), teams: ok([]), holidays })
    const cfg = await getProjectConfig(PID, { client })
    expect(cfg.holidays).toEqual([{ date: '2026-10-05', name: '휴무', kind: 'off' }, { date: '2026-10-10', name: '', kind: 'work' }])
    expect(cfg.calendarError).toBeNull()
    expect(cfg.calendar?.weekStart).toEqual([{ day: 'monday', from: null }])
    expect([...(cfg.calendar?.offDates ?? [])]).toEqual(['2026-10-05'])
    expect([...(cfg.calendar?.workDates ?? [])]).toEqual(['2026-10-10'])
    expect(holidays.log).toHaveLength(1)
  })
  it('휴일 조회 실패는 ConfigUnavailableError — 부분 기본값 없음', async () => {
    const { client } = fakeClient({ settings: row({}), areas: ok([]), teams: ok([]), holidays: keysetTable([], { error: { message: 'boom' } }) })
    await expect(getProjectConfig(PID, { client })).rejects.toBeInstanceOf(ConfigUnavailableError)
  })
  it('[RF4] tz 손상은 로드를 멈추지 않는다 — calendar=null·calendarError, 다른 키는 그대로', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { client } = fakeClient({ settings: row({ 'calendar.timezone': '+09:00', 'core.milestone_keywords': ['오픈'] }), areas: ok([]), teams: ok([]) })
    const cfg = await getProjectConfig(PID, { client })
    err.mockRestore()
    expect(cfg.calendar).toBeNull()
    expect(cfg.calendarError).toMatchObject({ code: 'CONFIG_INVALID', key: 'calendar.timezone' })
    expect(valueOf(cfg, 'core.milestone_keywords')).toEqual(['오픈'])
  })
})
