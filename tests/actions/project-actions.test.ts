import { describe, it, expect, vi, beforeEach } from 'vitest'

// createProject 의 단계 라벨 필수 입력(프리셋 없음, SP0 결정 5)과 원자성 보정(리뷰 F1/F2)을 검증한다.
// projects insert 는 일반 클라이언트(su_insert_projects RLS 정책), project_settings insert 와
// 되돌리기용 projects delete 는 쓰기 정책이 없어(0058) admin 클라이언트가 필요하다 — 세 경로를 각각 모의한다.
// TODO(SP3): 이 보정 삭제 자체가 트랜잭션 RPC 로 대체되면 이 목 구조도 단순해진다.
const { db, createServerClient, createAdminClient, requireSuperuser } = vi.hoisted(() => {
  const db = {
    insertedProject: null as Record<string, unknown> | null,
    insertedSettings: null as Record<string, unknown> | null,
    deletedProjectId: null as string | null,
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
        }
      }
      throw new Error(`예상치 못한 테이블(admin client): ${table}`)
    },
  }))
  const requireSuperuser = vi.fn()
  return { db, createServerClient, createAdminClient, requireSuperuser }
})

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/authz', () => ({ requireSuperuser, requireProjectAdmin: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }))
vi.mock('@/lib/data/snapshots', () => ({ recordProgressSnapshot: vi.fn() }))

import { createProject } from '@/app/actions/project'

const SUPERUSER = { ok: true as const, actor: { userId: 'u-super', isSuperuser: true } }

beforeEach(() => {
  db.insertedProject = null
  db.insertedSettings = null
  db.deletedProjectId = null
  db.projectInsertError = null
  db.settingsInsertError = null
  db.projectDeleteError = null
  db.nextId = 1
  createServerClient.mockClear()
  createAdminClient.mockClear()
  requireSuperuser.mockReset()
  requireSuperuser.mockResolvedValue(SUPERUSER)
})

describe('createProject — 단계 라벨 필수(SP0, 프리셋 없음)', () => {
  it('입력 라벨로 projects·project_settings 를 만들고 preset_applied 는 쓰지 않는다', async () => {
    await createProject('신규 프로젝트', '2026-01-01', '2026-12-31', '설명', ['단계', '작업'])
    expect(db.insertedProject).toMatchObject({
      name: '신규 프로젝트',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      description: '설명',
    })
    expect(db.insertedSettings).toMatchObject({ project_id: 'proj-1', level_labels: ['단계', '작업'], max_depth: 2, extra_axis_label: null })
    expect(db.insertedSettings).not.toHaveProperty('preset_applied')
    expect((db.insertedSettings as { milestone_keywords: string[] }).milestone_keywords.length).toBeGreaterThan(0)
  })

  it('라벨이 비면 DB 를 건드리기 전에 거부', async () => {
    await expect(createProject('P', null, null, null, [])).rejects.toThrow(/단계/)
    await expect(createProject('P', null, null, null, ['단계', ' '])).rejects.toThrow(/비어/)
    expect(createServerClient).not.toHaveBeenCalled()
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('라벨 배열이 아니거나 원소가 문자열이 아니면 거부(런타임 방어)', async () => {
    // @ts-expect-error 호출부 타입 우회를 흉내낸다
    await expect(createProject('P', null, null, null, null)).rejects.toThrow('단계 입력이 올바르지 않습니다.')
    // @ts-expect-error 호출부 타입 우회를 흉내낸다
    await expect(createProject('P', null, null, null, [1, 2])).rejects.toThrow('단계 입력이 올바르지 않습니다.')
    expect(createServerClient).not.toHaveBeenCalled()
  })

  it('projects insert 실패 — settings 는 손대지 않는다', async () => {
    db.projectInsertError = { message: '프로젝트 생성 권한 없음' }
    await expect(createProject('P4', null, null, null, ['단계'])).rejects.toThrow(/권한 없음/)
    expect(db.insertedSettings).toBeNull()
    expect(db.deletedProjectId).toBeNull()
  })

  it('admin 클라이언트 생성 실패 — projects insert 전에 막혀 아무것도 쓰지 않는다', async () => {
    createAdminClient.mockImplementationOnce(() => {
      throw new Error('service_role 환경변수 없음')
    })
    await expect(createProject('P5', null, null, null, ['단계'])).rejects.toThrow(/환경변수 없음/)
    expect(db.insertedProject).toBeNull()
  })

  it('설정 저장 실패 — 방금 만든 프로젝트를 되돌리고 재시도 가능한 실패로 던진다', async () => {
    db.settingsInsertError = { message: 'RLS 위반' }
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(createProject('P2', null, null, null, ['단계'])).rejects.toThrow('프로젝트 생성에 실패했습니다. 다시 시도해 주세요.')
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
      await createProject('P3', null, null, null, ['단계'])
    } catch (e) {
      caught = e as Error
    }
    expect(caught?.message).toContain('RLS 위반')
    expect(caught?.message).toContain('삭제 권한 없음')
    expect(caught?.message).toContain('proj-1')
    errSpy.mockRestore()
  })
})
