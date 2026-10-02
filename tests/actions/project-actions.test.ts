import { describe, it, expect, vi, beforeEach } from 'vitest'

// 프로젝트 관리 액션의 가드. createProject 는 tests/settings/create-project.test.ts 가 새 계약(RPC·결과 반환)으로 본다.
// SP2: 비공개 전환 가드는 requireProjectAdmin(대상 프로젝트) — 판정은 순수 계층(isProjectAdmin)에 위임한다.
const { db, createAdminClient, requireWorkspaceAdmin, requireProjectAdmin } = vi.hoisted(() => {
  const db = {
    updatedProject: null as Record<string, unknown> | null,
  }
  const createAdminClient = vi.fn(() => ({
    from: (table: string) => {
      if (table === 'projects') {
        return {
          update: (row: Record<string, unknown>) => ({
            eq: async (_col: string, id: string) => {
              db.updatedProject = { id, ...row }
              return { error: null }
            },
          }),
        }
      }
      throw new Error(`예상치 못한 테이블(admin client): ${table}`)
    },
  }))
  return {
    db, createAdminClient, requireWorkspaceAdmin: vi.fn(), requireProjectAdmin: vi.fn(),
  }
})

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/authz', () => ({ requireWorkspaceAdmin, requireProjectAdmin }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }))
vi.mock('@/lib/data/snapshots', () => ({ recordProgressSnapshot: vi.fn() }))

import { setProjectPrivacy } from '@/app/actions/project'
import { workspaceAdminVerdict, isProjectAdmin, type Actor } from '@/lib/domain/authz'
import { ERR_DENIED, ERR_MISSING } from '@/lib/authz/errors'
import { makeActor, WS } from '../fixtures/actor'

const WS_ADMIN = makeActor({ userId: 'u-wsadmin', workspaceRoles: new Map([[WS, 'admin']]) })

/** 이 액터로 로그인한 상태 — 가드 모킹은 순수 판정(workspaceAdminVerdict·isProjectAdmin)에 그대로 위임한다. */
function signedInAs(a: Actor) {
  requireWorkspaceAdmin.mockImplementation(async (wid: string | null) => {
    const v = workspaceAdminVerdict(a, wid)
    return v === 'ok' ? { ok: true, actor: a } : { ok: false, error: v === 'missing' ? ERR_MISSING : ERR_DENIED }
  })
  requireProjectAdmin.mockImplementation(async (pid: string | null) =>
    (isProjectAdmin(a, pid) ? { ok: true, actor: a } : { ok: false, error: ERR_DENIED }))
}

beforeEach(() => {
  db.updatedProject = null
  createAdminClient.mockClear()
  requireWorkspaceAdmin.mockReset()
  requireProjectAdmin.mockReset()
  signedInAs(WS_ADMIN)
})

describe('setProjectPrivacy — 프로젝트 관리자 가드(SP2)', () => {
  const PID = 'p-1'
  it('그 프로젝트의 관리자(워크스페이스 관리자 승계 포함)는 바꿀 수 있다', async () => {
    signedInAs(makeActor({ workspaceRoles: new Map([[WS, 'admin']]), projectWorkspace: new Map([[PID, WS]]) }))
    expect(await setProjectPrivacy(PID, true)).toEqual({ ok: true })
    expect(requireProjectAdmin).toHaveBeenCalledWith(PID)
    expect(db.updatedProject).toEqual({ id: PID, is_private: true })
  })

  it('멤버는 거부되고 DB 를 건드리지 않는다', async () => {
    signedInAs(makeActor({ projectWorkspace: new Map([[PID, WS]]), projectRoles: new Map([[PID, 'member']]) }))
    expect(await setProjectPrivacy(PID, true)).toEqual({ ok: false, error: ERR_DENIED })
    expect(createAdminClient).not.toHaveBeenCalled()
  })
})
