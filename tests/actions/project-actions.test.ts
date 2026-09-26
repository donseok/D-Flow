import { describe, it, expect, vi, beforeEach } from 'vitest'

// createProject 의 단계 라벨 필수 입력(프리셋 없음, SP0 결정 5)과 원자성 보정(리뷰 F1/F2)을 검증한다.
// projects insert 는 일반 클라이언트(su_insert_projects RLS 정책), project_settings insert 와
// 되돌리기용 projects delete 는 쓰기 정책이 없어(0058) admin 클라이언트가 필요하다 — 세 경로를 각각 모의한다.
// TODO(SP3): 이 보정 삭제 자체가 트랜잭션 RPC 로 대체되면 이 목 구조도 단순해진다.
// SP2: 생성 가드는 requireWorkspaceAdmin(대상 워크스페이스) — 판정은 순수 계층(workspaceAdminVerdict)에 위임한다.
const { db, createServerClient, createAdminClient, requireWorkspaceAdmin, requireProjectAdmin, refreshTeams } = vi.hoisted(() => {
  const db = {
    insertedProject: null as Record<string, unknown> | null,
    insertedSettings: null as Record<string, unknown> | null,
    deletedProjectId: null as string | null,
    updatedProject: null as Record<string, unknown> | null,
    projectInsertError: null as { message: string } | null,
    settingsInsertError: null as { message: string } | null,
    projectDeleteError: null as { message: string } | null,
    nextId: 1,
  }
  const createServerClient = vi.fn(async () => ({
    from: (table: string) => {
      if (table !== 'projects') throw new Error(`예상치 못한 테이블(server client): ${table}`)
      return {
        insert: (row: Record<string, unknown>) => ({
          select: () => ({
            single: async () => {
              if (db.projectInsertError) return { data: null, error: db.projectInsertError }
              db.insertedProject = row
              return { data: { id: `proj-${db.nextId++}` }, error: null }
            },
          }),
        }),
      }
    },
  }))
  const createAdminClient = vi.fn(() => ({
    from: (table: string) => {
      if (table === 'project_settings') {
        return {
          insert: async (row: Record<string, unknown>) => {
            db.insertedSettings = row
            return { error: db.settingsInsertError }
          },
        }
      }
      if (table === 'projects') {
        return {
          delete: () => ({
            eq: async (_col: string, id: string) => {
              db.deletedProjectId = id
              return { error: db.projectDeleteError }
            },
          }),
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
    db, createServerClient, createAdminClient, requireWorkspaceAdmin: vi.fn(), requireProjectAdmin: vi.fn(),
    refreshTeams: vi.fn(async () => true),
  }
})

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/authz', () => ({ requireWorkspaceAdmin, requireProjectAdmin }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }))
vi.mock('@/lib/data/snapshots', () => ({ recordProgressSnapshot: vi.fn() }))
vi.mock('@/lib/teams/master', () => ({ refreshTeams }))

import { createProject, setProjectPrivacy } from '@/app/actions/project'
import { workspaceAdminVerdict, isProjectAdmin, type Actor } from '@/lib/domain/authz'
import { ERR_DENIED, ERR_MISSING } from '@/lib/authz/errors'
import { makeActor, makeSuperuser, WS } from '../fixtures/actor'

const WS_B = 'ws-b'
const WS_ADMIN = makeActor({ userId: 'u-wsadmin', workspaceRoles: new Map([[WS, 'admin']]) })
const OTHER_WS_ADMIN = makeActor({ userId: 'u-other', workspaceRoles: new Map([[WS_B, 'admin']]) })
const WS_MEMBER = makeActor({ userId: 'u-mem' })   // WS 의 member

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
  db.insertedProject = null
  db.insertedSettings = null
  db.deletedProjectId = null
  db.updatedProject = null
  db.projectInsertError = null
  db.settingsInsertError = null
  db.projectDeleteError = null
  db.nextId = 1
  createServerClient.mockClear()
  createAdminClient.mockClear()
  refreshTeams.mockClear()
  requireWorkspaceAdmin.mockReset()
  requireProjectAdmin.mockReset()
  signedInAs(WS_ADMIN)
})

describe('createProject — 워크스페이스 관리자 가드(SP2)', () => {
  it('그 워크스페이스의 관리자는 통과하고, 입력 워크스페이스에 만든다', async () => {
    await createProject(WS, 'P', null, null, null, ['단계'])
    expect(requireWorkspaceAdmin).toHaveBeenCalledWith(WS)
    expect(db.insertedProject).toMatchObject({ workspace_id: WS })
  })

  it('다른 워크스페이스의 관리자는 존재 은닉(ERR_MISSING) — DB 를 건드리지 않는다', async () => {
    signedInAs(OTHER_WS_ADMIN)
    await expect(createProject(WS, 'P', null, null, null, ['단계'])).rejects.toThrow(ERR_MISSING)
    expect(createServerClient).not.toHaveBeenCalled()
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('워크스페이스 멤버는 거부된다', async () => {
    signedInAs(WS_MEMBER)
    await expect(createProject(WS, 'P', null, null, null, ['단계'])).rejects.toThrow(ERR_DENIED)
    expect(createServerClient).not.toHaveBeenCalled()
  })

  it('생성 뒤 팀 캐시를 갱신한다 — 캐시가 새 프로젝트의 워크스페이스를 몰라 그 프로젝트의 팀이 빈 목록이 되지 않게(SP2 16b)', async () => {
    await createProject(WS, 'P', null, null, null, ['단계'])
    expect(refreshTeams).toHaveBeenCalledOnce()
  })

  it('생성이 실패하면(설정 저장 실패 → 되돌리기) 팀 캐시를 건드리지 않는다', async () => {
    db.settingsInsertError = { message: 'boom' }
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(createProject(WS, 'P', null, null, null, ['단계'])).rejects.toThrow()
    expect(refreshTeams).not.toHaveBeenCalled()
    err.mockRestore()
  })

  it('워크스페이스가 비면 가드 전에 거부한다 — 슈퍼유저도(null 이면 가드가 통과시키므로)', async () => {
    signedInAs(makeSuperuser())
    for (const wid of [null, undefined, '', 42]) {
      // @ts-expect-error 호출부 타입 우회를 흉내낸다
      await expect(createProject(wid, 'P', null, null, null, ['단계'])).rejects.toThrow('워크스페이스를 지정해야 합니다.')
    }
    expect(requireWorkspaceAdmin).not.toHaveBeenCalled()
    expect(createServerClient).not.toHaveBeenCalled()
  })
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

describe('createProject — 단계 라벨 필수(SP0, 프리셋 없음)', () => {
  it('입력 라벨로 projects·project_settings 를 만들고 preset_applied 는 쓰지 않는다', async () => {
    await createProject(WS, '신규 프로젝트', '2026-01-01', '2026-12-31', '설명', ['단계', '작업'])
    expect(db.insertedProject).toMatchObject({
      name: '신규 프로젝트',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      description: '설명',
      workspace_id: 'ws-1',
    })
    expect(db.insertedSettings).toMatchObject({ project_id: 'proj-1', level_labels: ['단계', '작업'], max_depth: 2, extra_axis_label: null })
    expect(db.insertedSettings).not.toHaveProperty('preset_applied')
    expect((db.insertedSettings as { milestone_keywords: string[] }).milestone_keywords.length).toBeGreaterThan(0)
  })

  it('라벨이 비면 DB 를 건드리기 전에 거부', async () => {
    await expect(createProject(WS, 'P', null, null, null, [])).rejects.toThrow(/단계/)
    await expect(createProject(WS, 'P', null, null, null, ['단계', ' '])).rejects.toThrow(/비어/)
    expect(createServerClient).not.toHaveBeenCalled()
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('라벨 배열이 아니거나 원소가 문자열이 아니면 거부(런타임 방어)', async () => {
    // @ts-expect-error 호출부 타입 우회를 흉내낸다
    await expect(createProject(WS, 'P', null, null, null, null)).rejects.toThrow('단계 입력이 올바르지 않습니다.')
    // @ts-expect-error 호출부 타입 우회를 흉내낸다
    await expect(createProject(WS, 'P', null, null, null, [1, 2])).rejects.toThrow('단계 입력이 올바르지 않습니다.')
    expect(createServerClient).not.toHaveBeenCalled()
  })

  it('projects insert 실패 — settings 는 손대지 않는다', async () => {
    db.projectInsertError = { message: '프로젝트 생성 권한 없음' }
    await expect(createProject(WS, 'P4', null, null, null, ['단계'])).rejects.toThrow(/권한 없음/)
    expect(db.insertedSettings).toBeNull()
    expect(db.deletedProjectId).toBeNull()
  })

  it('admin 클라이언트 생성 실패 — projects insert 전에 막혀 아무것도 쓰지 않는다', async () => {
    createAdminClient.mockImplementationOnce(() => {
      throw new Error('service_role 환경변수 없음')
    })
    await expect(createProject(WS, 'P5', null, null, null, ['단계'])).rejects.toThrow(/환경변수 없음/)
    expect(db.insertedProject).toBeNull()
  })

  it('설정 저장 실패 — 방금 만든 프로젝트를 되돌리고 재시도 가능한 실패로 던진다', async () => {
    db.settingsInsertError = { message: 'RLS 위반' }
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(createProject(WS, 'P2', null, null, null, ['단계'])).rejects.toThrow('프로젝트 생성에 실패했습니다. 다시 시도해 주세요.')
    expect(db.deletedProjectId).toBe('proj-1')
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
  })

  it('설정 저장 실패 + 되돌리기도 실패 — 두 에러 모두 담고 행이 남았다고 알린다', async () => {
    db.settingsInsertError = { message: 'RLS 위반' }
    db.projectDeleteError = { message: '삭제 권한 없음' }
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    let caught: Error | null = null
    try {
      await createProject(WS, 'P3', null, null, null, ['단계'])
    } catch (e) {
      caught = e as Error
    }
    expect(caught?.message).toContain('RLS 위반')
    expect(caught?.message).toContain('삭제 권한 없음')
    expect(caught?.message).toContain('proj-1')
    errSpy.mockRestore()
  })
})
