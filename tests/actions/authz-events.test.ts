import { beforeEach, describe, expect, it, vi } from 'vitest'

// 스펙 SP3a §6 / done_when: 권한을 바꾸는 세 액션(플랫폼 관리자 지정·워크스페이스 등급·명단 권한)은 전용 RPC 를 부르고
// 행위자(p_actor)와 명령 id(p_command_id)를 넘긴다 — 표를 직접 쓰지 않는다(직접 쓰면 이력에 행위자가 남지 않는다).
// 각 액션의 자세한 동작은 accounts-gate·roster 테스트가 본다. 여기서는 세 액션이 같은 계약을 지키는지만 한 곳에서 본다.
const h = vi.hoisted(() => ({
  guards: { requireSuperuser: vi.fn(), requireWorkspaceAdmin: vi.fn(), requireProjectAdmin: vi.fn(), requireProjectMember: vi.fn(), resolveProjectId: vi.fn() },
  admin: { rpc: vi.fn(), from: vi.fn() },
}))
vi.mock('@/lib/authz', () => h.guards)
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => h.admin }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: async () => ({ from: () => { throw new Error('세션 클라이언트 접근 금지') } }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { setPlatformAdmin, setWorkspaceRole } from '@/app/actions/accounts'
import { upsertRosterMember } from '@/app/actions/roster'
import { makeAdminActor, makeSuperuser, makeActor } from '../fixtures/actor'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const WS = '0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d'
const TARGET = '00000000-0000-4000-8000-0000000000a2'
const P1 = '00000000-0000-4000-8000-0000000000b1'
const SU = makeSuperuser({ userId: 'u-su' })
const WSA = makeActor({ userId: 'u-wsa', workspaceRoles: new Map([[WS, 'admin']]) })
const PA = makeAdminActor(P1, { userId: 'u-pa' })

beforeEach(() => {
  for (const f of Object.values(h.guards)) f.mockReset()
  h.admin.rpc.mockReset(); h.admin.from.mockReset()
  h.admin.from.mockImplementation((t: string) => { throw new Error('직접 표 접근 금지(권한 쓰기는 RPC 로만): ' + t) })
  h.guards.requireSuperuser.mockResolvedValue({ ok: true, actor: SU })
  h.guards.requireWorkspaceAdmin.mockResolvedValue({ ok: true, actor: WSA })
  h.guards.requireProjectAdmin.mockResolvedValue({ ok: true, actor: PA })
  h.guards.resolveProjectId.mockResolvedValue({ ok: true, projectId: P1 })
})

describe('권한 변경 세 액션 — 전용 RPC·행위자·명령 id', () => {
  const run: Array<[string, string, string, () => Promise<unknown>, unknown]> = [
    ['setPlatformAdmin', 'set_platform_admin', 'u-su', () => setPlatformAdmin(TARGET, true), { status: 'applied', matched: 1 }],
    ['setWorkspaceRole', 'set_workspace_role', 'u-wsa', () => setWorkspaceRole(WS, TARGET, 'admin'), { status: 'applied', matched: 1 }],
    ['upsertRosterMember', 'upsert_project_member_cmd', 'u-pa', () => upsertRosterMember(P1, { name: '홍길동', email: 'hong@example.com', accessRole: 'member', roleLabel: null, title: null, teamIds: [] }), { status: 'applied', member_id: 'm-1' }],
  ]

  it.each(run)('%s 는 %s 를 부르고 행위자(%s)와 새 명령 id 를 넘긴다 — 표 직접 쓰기 없음', async (_n, rpc, actorId, call, result) => {
    h.admin.rpc.mockResolvedValue({ data: result, error: null })
    expect(await call()).toMatchObject({ ok: true })
    expect(h.admin.rpc).toHaveBeenCalledTimes(1)
    const [name, args] = h.admin.rpc.mock.calls[0]!
    expect(name).toBe(rpc)
    expect(args.p_actor).toBe(actorId)
    expect(args.p_command_id).toMatch(UUID)
    expect(h.admin.from).not.toHaveBeenCalled()
  })

  it.each(run)('%s — 호출마다 명령 id 가 새로 만들어진다(권한이 안 바뀐 호출은 이력 행을 남기지 않아 재전송은 멱등 쓰기)', async (_n, _rpc, _a, call, result) => {
    h.admin.rpc.mockResolvedValue({ data: result, error: null })
    await call(); await call()
    expect(h.admin.rpc.mock.calls[0]![1].p_command_id).not.toBe(h.admin.rpc.mock.calls[1]![1].p_command_id)
  })

  it.each(run)('%s — 가드가 거부하면 RPC 를 부르지 않는다', async (_n, _rpc, _a, call) => {
    const denied = { ok: false as const, error: '권한 없음' }
    for (const g of Object.values(h.guards)) g.mockResolvedValue(denied)
    expect(await call()).toMatchObject({ ok: false })
    expect(h.admin.rpc).not.toHaveBeenCalled()
  })
})
