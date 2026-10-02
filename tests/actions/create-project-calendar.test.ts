// createProject 의 달력 키(SP5 스펙 §4.2 정의·복사 행·D13 ②, 개정 §2.8.7) — 새 프로젝트는 워크스페이스 값을 복사(seedFrom — 상속 아님),
// 복사 프로젝트는 원본 tz·근무 요일과 원본 마지막 규칙의 요일 하나, 워크스페이스 값 손상은 아무것도 만들지 않는다.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeSettingsDb } from '../helpers/fakeSettingsDb'
const h = vi.hoisted(() => ({ requireWorkspaceAdmin: vi.fn(), adminFor: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/server', () => ({ after: (f: () => unknown) => f() }))
vi.mock('@/lib/authz', () => ({ requireWorkspaceAdmin: h.requireWorkspaceAdmin, requireProjectAdmin: vi.fn(), getActorViewState: vi.fn() }))
vi.mock('@/lib/supabase/adminFor', () => ({ adminFor: h.adminFor }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => { throw new Error('adminFor 를 쓴다') }) }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn(async () => { throw new Error('세션 클라이언트를 쓰지 않는다') }) }))
vi.mock('@/lib/data/snapshots', () => ({ recordProgressSnapshot: vi.fn() }))
vi.mock('@/lib/teams/master', () => ({ refreshTeams: vi.fn(async () => true) }))
import { createProject, type CreateProjectInput } from '@/app/actions/project'
import { makeActor } from '../fixtures/actor'

const WID = '00000000-0000-0000-7e57-00000000aa5d', SRC = '00000000-0000-0000-7e57-0000000019b0'
let n = 0
let db: FakeSettingsDb
const input = (over: Partial<CreateProjectInput> = {}): CreateProjectInput =>
  ({ workspaceId: WID, name: `Acme 달력 ${++n}`, startDate: null, endDate: null, description: null, levelLabels: ['Phase', 'Task'], commandId: `00000000-0000-4000-8000-0000000019${String(n).padStart(2, '0')}`, ...over })
const ws = (values: Record<string, unknown>) => db.addWorkspace({ id: WID, values: { 'modules.allowed': ['weekly'], ...values } })

beforeEach(() => {
  vi.clearAllMocks()
  db = new FakeSettingsDb()
  h.adminFor.mockImplementation((s: Record<string, string>) => ({ ...s, admin: db.client() }))
  h.requireWorkspaceAdmin.mockResolvedValue({ ok: true, actor: makeActor({ userId: 'u-admin', workspaceRoles: new Map([[WID, 'admin']]) }) })
})

describe('createProject — calendar.* 생성 시 복사', () => {
  it('워크스페이스 값을 복사한다 — 주 시작은 규칙 하나 [{ day, from: null }], 이력 source=create', async () => {
    ws({ 'calendar.timezone': 'Asia/Seoul', 'calendar.working_days': [1, 2, 3, 4, 5, 6], 'calendar.week_start': 'monday' })
    const r = await createProject(input())
    expect(r).toMatchObject({ ok: true })
    if (!r.ok) return
    const v = db.projects.get(r.projectId)!.values
    expect([v['calendar.timezone'], v['calendar.working_days'], v['calendar.week_start']]).toEqual(['Asia/Seoul', [1, 2, 3, 4, 5, 6], [{ day: 'monday', from: null }]])
    expect(db.history.filter((x) => x.project_id === r.projectId && x.key.startsWith('calendar.')).map((x) => x.source)).toEqual(['create', 'create', 'create'])
  })
  it('워크스페이스에 값이 없으면 제품 기본값을 명시 기록한다(UTC·월~금·일요일) — 런타임 상속이 없다', async () => {
    ws({})
    const r = await createProject(input())
    if (!r.ok) throw new Error('생성 실패')
    const v = db.projects.get(r.projectId)!.values
    expect([v['calendar.timezone'], v['calendar.working_days'], v['calendar.week_start']]).toEqual(['UTC', [1, 2, 3, 4, 5], [{ day: 'sunday', from: null }]])
  })
  it('복사 — 원본의 tz·근무 요일은 그대로, 주 시작은 원본 마지막 규칙의 요일 하나(전환 이력은 옮기지 않는다)', async () => {
    ws({ 'calendar.timezone': 'UTC', 'calendar.week_start': 'monday' })
    db.addProject({ id: SRC, workspaceId: WID, values: { 'core.level_labels': ['S'], 'modules.enabled': ['weekly'], 'calendar.timezone': 'Europe/Berlin',
      'calendar.working_days': [1, 2, 3, 4], 'calendar.week_start': [{ day: 'monday', from: null }, { day: 'sunday', from: '2026-09-27' }] } })
    const r = await createProject(input({ copyFromProjectId: SRC }))
    if (!r.ok) throw new Error('복사 실패')
    const v = db.projects.get(r.projectId)!.values
    expect([v['calendar.timezone'], v['calendar.working_days'], v['calendar.week_start']]).toEqual(['Europe/Berlin', [1, 2, 3, 4], [{ day: 'sunday', from: null }]])
  })
  it('복사 — 원본에 달력 키가 없으면 tz·근무 요일은 워크스페이스에서, 주 시작은 원본의 기본(일요일) 하나', async () => {
    ws({ 'calendar.timezone': 'Asia/Tokyo', 'calendar.week_start': 'monday' })
    db.addProject({ id: SRC, workspaceId: WID, values: { 'core.level_labels': ['S'], 'modules.enabled': ['weekly'] } })
    const r = await createProject(input({ copyFromProjectId: SRC }))
    if (!r.ok) throw new Error('복사 실패')
    const v = db.projects.get(r.projectId)!.values
    expect([v['calendar.timezone'], v['calendar.working_days'], v['calendar.week_start']]).toEqual(['Asia/Tokyo', [1, 2, 3, 4, 5], [{ day: 'sunday', from: null }]])
  })
  it('워크스페이스 달력 값이 손상이면 결과(CONFIG_INVALID)로 거부하고 아무것도 만들지 않는다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    ws({ 'calendar.timezone': '+09:00' })
    expect(await createProject(input())).toMatchObject({ ok: false, code: 'CONFIG_INVALID', fieldErrors: [{ key: 'calendar.timezone' }] })
    expect(db.rpcCalls).toHaveLength(0)
  })
})
