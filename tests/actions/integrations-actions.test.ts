import { describe, it, expect, vi, beforeEach } from 'vitest'

const { db, createAdminClient, requireWorkspaceAdmin, requireModule, revalidatePath } = vi.hoisted(() => {
  const db = {
    credentials: [] as Array<Record<string, unknown>>,
    profiles: [] as Array<Record<string, unknown>>,
    inserted: [] as Array<Record<string, unknown>>,
    updated: [] as Array<{ patch: Record<string, unknown>; id: string; workspaceId: string }>,
  }

  const table = (name: string) => {
    const filters: Array<[string, unknown]> = []
    const q: Record<string, unknown> = {}
    const chain = (fn?: (...a: unknown[]) => void) => (...a: unknown[]) => { fn?.(...a); return q }

    Object.assign(q, {
      select: chain(),
      eq: chain((col, v) => filters.push([String(col), v])),
      in: chain((col, vals) => filters.push([String(col), vals])),
      order: chain(),
      insert: (row: Record<string, unknown>) => {
        db.inserted.push(row)
        const id = '00000000-0000-0000-0000-000000000001'
        const insertedRow = { id, ...row }
        db.credentials.push(insertedRow)
        return {
          select: () => Promise.resolve({ data: [{ id }], error: null }),
          then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [{ id }], error: null }).then(resolve),
        }
      },
      update: (patch: Record<string, unknown>) => {
        const where: Array<[string, unknown]> = []
        const upd: Record<string, unknown> = {
          eq: (c: string, v: unknown) => { where.push([c, v]); return upd },
          select: async () => {
            const id = where.find(([c]) => c === 'id')?.[1] as string
            const wsId = where.find(([c]) => c === 'workspace_id')?.[1] as string
            const target = db.credentials.find(r => r.id === id && (!wsId || r.workspace_id === wsId))
            if (target) {
              Object.assign(target, patch)
              db.updated.push({ patch, id, workspaceId: wsId })
              return { data: [{ id }], error: null }
            }
            return { data: [], error: null }
          },
        }
        return upd
      },
      then: (resolve: (v: unknown) => unknown) => {
        const rows = name === 'profiles' ? db.profiles : db.credentials
        const matched = rows.filter(r => {
          return filters.every(([c, v]) => {
            if (Array.isArray(v)) {
              return v.includes(r[c])
            }
            return (r[c] ?? null) === v
          })
        })
        return Promise.resolve({ data: matched, error: null }).then(resolve)
      },
    })
    return q
  }

  const createAdminClient = vi.fn(() => ({
    from: (t: string) => table(t),
  }))

  const requireWorkspaceAdmin = vi.fn()
  const requireModule = vi.fn()
  const revalidatePath = vi.fn()

  return { db, createAdminClient, requireWorkspaceAdmin, requireModule, revalidatePath }
})

vi.mock('next/cache', () => ({ revalidatePath }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }))
vi.mock('@/lib/authz', () => ({ requireWorkspaceAdmin }))
vi.mock('@/lib/modules/gate', () => ({ requireModule }))

import {
  createMinutesApiCredential,
  revokeIntegrationCredential,
  listWorkspaceCredentials,
} from '@/app/actions/integrations'
import { hashToken } from '@/lib/agent/token'

const WS_ID = '00000000-0000-0000-7e57-000000000001'
const USER_ID = '00000000-0000-0000-7e57-000000000002'
const PROJ_A = '00000000-0000-0000-7e57-000000000010'
const PROJ_B = '00000000-0000-0000-7e57-000000000011'
const TEAM_A = '00000000-0000-0000-7e57-000000000020'

describe('integrations server actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.credentials = []
    db.profiles = []
    db.inserted = []
    db.updated = []

    requireWorkspaceAdmin.mockResolvedValue({
      ok: true,
      actor: { userId: USER_ID, isSuperuser: false, roles: ['admin'] },
    })
    requireModule.mockResolvedValue({ ok: true })
  })

  describe('createMinutesApiCredential', () => {
    it('워크스페이스 ID 형식이 유효하지 않으면 실패한다', async () => {
      const res = await createMinutesApiCredential({
        workspaceId: 'invalid-uuid',
        name: 'CI 토큰',
        expiresDays: 30,
      })
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.error).toBe('잘못된 워크스페이스입니다.')
    })

    it('관리자 권한이 없으면 거부된다', async () => {
      requireWorkspaceAdmin.mockResolvedValueOnce({
        ok: false,
        error: '워크스페이스 관리자만 접근할 수 있습니다.',
      })
      const res = await createMinutesApiCredential({
        workspaceId: WS_ID,
        name: 'CI 토큰',
        expiresDays: 30,
      })
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.error).toContain('관리자만')
    })

    it('minutes_integration 모듈이 비활성화되어 있으면 거부된다', async () => {
      requireModule.mockResolvedValueOnce({ ok: false, reason: 'disabled' })
      const res = await createMinutesApiCredential({
        workspaceId: WS_ID,
        name: 'CI 토큰',
        expiresDays: 30,
      })
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.error).toContain('회의록 연동이 꺼져 있습니다')
    })

    it('토큰 이름이 유효하지 않으면 거부된다', async () => {
      const res1 = await createMinutesApiCredential({
        workspaceId: WS_ID,
        name: '   ',
        expiresDays: 30,
      })
      expect(res1.ok).toBe(false)

      const res2 = await createMinutesApiCredential({
        workspaceId: WS_ID,
        name: 'a'.repeat(65),
        expiresDays: 30,
      })
      expect(res2.ok).toBe(false)
    })

    it('기본 프로젝트가 허용 프로젝트 목록에 없으면 거부된다', async () => {
      const res = await createMinutesApiCredential({
        workspaceId: WS_ID,
        name: '연동 토큰',
        projectIds: [PROJ_A],
        defaultProjectId: PROJ_B,
        expiresDays: 30,
      })
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.error).toContain('기본 프로젝트는 허용된 프로젝트 목록에 포함되어야 합니다')
    })

    it('만료 기간 범위(1~365)를 벗어나면 거부된다', async () => {
      const res1 = await createMinutesApiCredential({
        workspaceId: WS_ID,
        name: '연동 토큰',
        expiresDays: 0,
      })
      expect(res1.ok).toBe(false)

      const res2 = await createMinutesApiCredential({
        workspaceId: WS_ID,
        name: '연동 토큰',
        expiresDays: 400,
      })
      expect(res2.ok).toBe(false)
    })

    it('정상 발급 시 토큰 평문, prefix를 반환하고 DB에 해시로 저장된다', async () => {
      const res = await createMinutesApiCredential({
        workspaceId: WS_ID,
        name: '또박또박 연동',
        projectIds: [PROJ_A, PROJ_B],
        defaultProjectId: PROJ_A,
        defaultTeamId: TEAM_A,
        teamMap: { DEV: TEAM_A },
        expiresDays: 90,
      })

      expect(res.ok).toBe(true)
      if (!res.ok) return

      expect(res.token.startsWith('dflow_int_')).toBe(true)
      expect(res.prefix).toHaveLength(12)
      expect(res.token.startsWith(`dflow_int_${res.prefix}_`)).toBe(true)
      expect(db.inserted.length).toBe(1)

      const row = db.inserted[0]
      expect(row.workspace_id).toBe(WS_ID)
      expect(row.kind).toBe('minutes_api')
      expect(row.name).toBe('또박또박 연동')
      expect(row.token_prefix).toBe(res.prefix)
      expect(row.token_hash).toBe(hashToken(res.token))
      expect(row.owner_user_id).toBeNull()
      expect(row.scopes).toEqual([])
      expect(row.project_ids).toEqual([PROJ_A, PROJ_B])
      expect(row.default_project_id).toBe(PROJ_A)
      expect(row.default_team_id).toBe(TEAM_A)
      expect(row.team_map).toEqual({ DEV: TEAM_A })
      expect(row.enabled).toBe(true)
      expect(row.created_by).toBe(USER_ID)
      expect(revalidatePath).toHaveBeenCalledWith('/w/[slug]/settings/integrations', 'page')
    })
  })

  describe('revokeIntegrationCredential', () => {
    it('비관리자 요청 시 거부된다', async () => {
      requireWorkspaceAdmin.mockResolvedValueOnce({ ok: false, error: '권한 없음' })
      const res = await revokeIntegrationCredential(
        '00000000-0000-0000-7e57-000000000099',
        WS_ID,
      )
      expect(res.ok).toBe(false)
    })

    it('존재하지 않는 자격증명 회수 시 실패한다', async () => {
      const res = await revokeIntegrationCredential(
        '00000000-0000-0000-7e57-000000000099',
        WS_ID,
      )
      expect(res.ok).toBe(false)
      expect(res.error).toBe('대상 자격증명을 찾을 수 없습니다.')
    })

    it('정상적으로 자격증명을 회수하고 enabled를 false로 바꾼다', async () => {
      const credId = '00000000-0000-0000-7e57-000000000088'
      db.credentials.push({
        id: credId,
        workspace_id: WS_ID,
        kind: 'minutes_api',
        name: '기존 토큰',
        enabled: true,
        revoked_at: null,
      })

      const res = await revokeIntegrationCredential(credId, WS_ID)
      expect(res.ok).toBe(true)
      expect(db.updated.length).toBe(1)
      expect(db.updated[0].patch.enabled).toBe(false)
      expect(db.updated[0].patch.revoked_at).toBeDefined()
      expect(revalidatePath).toHaveBeenCalledWith('/w/[slug]/settings/integrations', 'page')
    })
  })

  describe('listWorkspaceCredentials', () => {
    it('비관리자 요청 시 거부된다', async () => {
      requireWorkspaceAdmin.mockResolvedValueOnce({ ok: false, error: '권한 없음' })
      const res = await listWorkspaceCredentials(WS_ID)
      expect(res.ok).toBe(false)
    })

    it('자격증명 목록과 소유자 프로필을 매핑하여 반환한다', async () => {
      const ownerId = '00000000-0000-0000-7e57-000000000077'
      db.profiles.push({
        user_id: ownerId,
        display_name: '홍길동',
        email: 'hong@example.com',
      })

      db.credentials.push(
        {
          id: '00000000-0000-0000-7e57-000000000081',
          workspace_id: WS_ID,
          kind: 'minutes_api',
          name: '회의록 토큰',
          token_prefix: 'dflow_int_abcd',
          scopes: [],
          project_ids: null,
          default_project_id: null,
          default_team_id: null,
          team_map: {},
          owner_user_id: null,
          enabled: true,
          revoked_at: null,
          expires_at: new Date(Date.now() + 86400000).toISOString(),
          last_used_at: null,
          created_at: new Date().toISOString(),
          created_by: USER_ID,
        },
        {
          id: '00000000-0000-0000-7e57-000000000082',
          workspace_id: WS_ID,
          kind: 'agent_runner',
          name: '에이전트 토큰',
          token_prefix: 'dflow_int_efgh',
          scopes: ['agent:run'],
          project_ids: [PROJ_A],
          default_project_id: null,
          default_team_id: null,
          team_map: {},
          owner_user_id: ownerId,
          enabled: true,
          revoked_at: null,
          expires_at: new Date(Date.now() + 86400000).toISOString(),
          last_used_at: null,
          created_at: new Date().toISOString(),
          created_by: USER_ID,
        },
      )

      const res = await listWorkspaceCredentials(WS_ID)
      expect(res.ok).toBe(true)
      if (!res.ok) return

      expect(res.credentials.length).toBe(2)
      const agentCred = res.credentials.find(c => c.kind === 'agent_runner')
      expect(agentCred?.owner_name).toBe('홍길동')
      expect(agentCred?.owner_email).toBe('hong@example.com')
      expect(agentCred?.scopes).toEqual(['agent:run'])

      const minutesCred = res.credentials.find(c => c.kind === 'minutes_api')
      expect(minutesCred?.owner_name).toBeNull()
      expect(minutesCred?.owner_email).toBeNull()
    })
  })
})
