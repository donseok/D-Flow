import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { generateCredentialToken } from '@/lib/agent/token'
import type { Actor } from '@/lib/domain/authz'

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  actorFromUser: vi.fn(),
  revalidatePath: vi.fn(),
  ingestMinute: vi.fn(async () => {}),
  generateMinuteInsights: vi.fn(async () => {}),
  enqueueAndProcessMinuteWiki: vi.fn(async () => {}),
  processMinuteWikiJob: vi.fn(async () => ({ created: 0, changed: 0, reaffirmed: 0, conflicted: 0 })),
  rebuildProjectWikiFromActiveMinutes: vi.fn(async () => {}),
  afterCallbacks: [] as Array<() => Promise<void> | void>,
  requireModule: vi.fn(),
  workspacesWithModule: vi.fn(),
  loadRootFolders: vi.fn(async () => ({ ok: true, value: { mode: 'teams' } })),
  activeTeamCodesForMinuteScope: vi.fn(async () => ['PMO', 'ERP', 'DEV']),
}))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/authz', () => ({ actorFromUser: mocks.actorFromUser }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/lib/ai/minutes-ingest', () => ({ ingestMinute: mocks.ingestMinute }))
vi.mock('@/lib/ai/minutes-insights', () => ({ generateMinuteInsights: mocks.generateMinuteInsights }))
vi.mock('@/lib/ai/wiki-ingest', () => ({
  enqueueAndProcessMinuteWiki: mocks.enqueueAndProcessMinuteWiki,
  enqueueMinuteWikiProcessing: vi.fn(async () => 71),
  processMinuteWikiJob: mocks.processMinuteWikiJob,
  rebuildProjectWikiFromActiveMinutes: mocks.rebuildProjectWikiFromActiveMinutes,
}))
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return { ...actual, after: (cb: () => Promise<void> | void) => { mocks.afterCallbacks.push(cb) } }
})
vi.mock('@/lib/modules/gate', () => ({
  requireModule: mocks.requireModule,
  workspacesWithModule: mocks.workspacesWithModule,
}))
vi.mock('@/lib/minutes/rootMode', () => ({ loadRootFolders: mocks.loadRootFolders }))
vi.mock('@/lib/minutes/teamScope', () => ({
  activeTeamCodesForMinuteScope: mocks.activeTeamCodesForMinuteScope,
}))
vi.mock('@/lib/teams/source', () => ({
  projectTeams: vi.fn(async () => [
    { id: '50000000-0000-4000-8000-000000000001', code: 'ERP', name: 'ERP팀', active: true, workspaceId: '10000000-0000-4000-8000-000000000001', projectId: null, color: '#3b82f6', sortOrder: 0, progressVisible: true },
    { id: '50000000-0000-4000-8000-000000000002', code: 'PMO', name: 'PMO팀', active: true, workspaceId: '10000000-0000-4000-8000-000000000001', projectId: null, color: '#10b981', sortOrder: 1, progressVisible: true },
    { id: '50000000-0000-4000-8000-000000000003', code: 'INACTIVE', name: '비활성팀', active: false, workspaceId: '10000000-0000-4000-8000-000000000001', projectId: null, color: '#6b7280', sortOrder: 2, progressVisible: true },
  ]),
  workspaceTeams: vi.fn(async (workspaceId: string) => [
    { id: '50000000-0000-4000-8000-000000000001', code: 'ERP', name: 'ERP팀', active: true, workspaceId, projectId: null, color: '#3b82f6', sortOrder: 0, progressVisible: true },
    { id: '50000000-0000-4000-8000-000000000002', code: 'PMO', name: 'PMO팀', active: true, workspaceId, projectId: null, color: '#10b981', sortOrder: 1, progressVisible: true },
    { id: '50000000-0000-4000-8000-000000000003', code: 'INACTIVE', name: '비활성팀', active: false, workspaceId, projectId: null, color: '#6b7280', sortOrder: 2, progressVisible: true },
  ]),
}))

import { POST } from '@/app/api/v1/minutes/route'
import { GET as META } from '@/app/api/v1/minutes/meta/route'
import { POST as LINK } from '@/app/api/v1/minutes/link/route'
import { POST as FOLDER } from '@/app/api/v1/minutes/folder/route'

const W1 = '10000000-0000-4000-8000-000000000001'
const W2 = '10000000-0000-4000-8000-000000000002'
const P1 = '20000000-0000-4000-8000-000000000001'
const P2 = '20000000-0000-4000-8000-000000000002'
const P3 = '20000000-0000-4000-8000-000000000003'
const U1 = '30000000-0000-4000-8000-000000000001'
const CRED_ID = '40000000-0000-4000-8000-000000000001'
const TEAM_ERP_ID = '50000000-0000-4000-8000-000000000001'
const TEAM_PMO_ID = '50000000-0000-4000-8000-000000000002'

const token = generateCredentialToken('minutes_api')

const baseCredRow = {
  id: CRED_ID,
  workspace_id: W1,
  kind: 'minutes_api',
  name: 'minutes-test-token',
  token_prefix: token.prefix,
  token_hash: token.hash,
  scopes: [],
  project_ids: [P1, P3],
  default_project_id: P1,
  default_team_id: TEAM_PMO_ID,
  team_map: { 'ERP_CUSTOM': TEAM_ERP_ID },
  owner_user_id: null,
  enabled: true,
  revoked_at: null,
  expires_at: '2099-01-01T00:00:00Z',
}

const baseActor: Actor = {
  userId: U1,
  isSuperuser: false,
  workspaceRoles: new Map([[W1, 'admin'], [W2, 'member']]),
  projectWorkspace: new Map([[P1, W1], [P2, W2], [P3, W1]]),
  projectRoles: new Map([[P1, 'admin'], [P2, 'member'], [P3, 'member']]),
  memberIds: new Map(),
  rosterTeams: new Map(),
}

function mockSupabase(credRow: unknown = baseCredRow, overrides: {
  isWsMember?: boolean
  profileUser?: { user_id: string; display_name: string | null } | null
  existingMinute?: unknown
  existingMeeting?: unknown
  workspaceRow?: unknown
  teamsRows?: unknown[]
} = {}) {
  const profileUser = overrides.profileUser !== undefined
    ? overrides.profileUser
    : { user_id: U1, display_name: '테스터' }
  const isWsMember = overrides.isWsMember !== undefined ? overrides.isWsMember : true
  const workspaceRow = overrides.workspaceRow !== undefined
    ? overrides.workspaceRow
    : { id: W1, slug: 'test-ws', name: '테스트 워크스페이스' }
  const teamsRows = overrides.teamsRows !== undefined
    ? overrides.teamsRows
    : [
        { id: TEAM_ERP_ID, code: 'ERP', name: 'ERP팀', active: true, workspace_id: W1, project_id: null },
        { id: TEAM_PMO_ID, code: 'PMO', name: 'PMO팀', active: true, workspace_id: W1, project_id: null },
        { id: '50000000-0000-4000-8000-000000000003', code: 'INACTIVE', name: '비활성팀', active: false, workspace_id: W1, project_id: null },
      ]

  const from = vi.fn((table: string) => {
    let updatePayload: unknown = null
    let insertPayload: unknown = null

    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => b,
      in: () => b,
      is: () => b,
      or: () => b,
      order: () => b,
      limit: () => b,
      update: (payload: unknown) => { updatePayload = payload; return b },
      insert: (payload: unknown) => { insertPayload = payload; return b },
      single: () => b,
      maybeSingle: () => b,
    }

    const resolveResult = () => {
      if (table === 'integration_credentials') {
        return { data: updatePayload ? null : credRow, error: null }
      }
      if (table === 'profiles') {
        return { data: profileUser, error: null }
      }
      if (table === 'workspace_members') {
        return { data: isWsMember ? { role: 'admin' } : null, error: null }
      }
      if (table === 'workspaces') {
        return { data: workspaceRow, error: null }
      }
      if (table === 'teams') {
        return { data: teamsRows, error: null }
      }
      if (table === 'meetings') {
        return { data: overrides.existingMeeting ?? null, error: null }
      }
      if (table === 'minutes') {
        if (updatePayload) return { data: [{ id: 'm-1' }], error: null }
        if (insertPayload) return { data: [{ id: 'm-1' }], error: null }
        return { data: overrides.existingMinute ?? null, error: null }
      }
      if (table === 'projects') {
        return {
          data: [
            { id: P1, name: 'Project 1', code: 'P1', workspace_id: W1 },
            { id: P3, name: 'Project 3', code: 'P3', workspace_id: W1 },
          ],
          error: null,
        }
      }
      return { data: [], error: null }
    }

    b.then = (resolve: (v: unknown) => unknown) => Promise.resolve(resolveResult()).then(resolve)
    b.maybeSingle = async () => resolveResult()
    b.single = async () => resolveResult()
    return b
  })

  const rpc = vi.fn((fnName: string) => {
    const res = () => {
      if (fnName === 'commit_minute_body_version') {
        return { data: { version_id: 'v-1', wiki_rebuild_required: false }, error: null }
      }
      if (fnName === 'create_minute_with_version') {
        return { data: { id: 'm-1', version_id: 'v-1', wiki_rebuild_required: false }, error: null }
      }
      return { data: null, error: null }
    }
    return {
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(res()).then(resolve),
      single: async () => res(),
      maybeSingle: async () => res(),
    }
  })

  const admin = { from, rpc }
  mocks.createAdminClient.mockReturnValue(admin)
  return { admin, from, rpc }
}

beforeEach(() => {
  vi.stubEnv('MINUTES_API_ENABLED', 'true')
  vi.stubEnv('MINUTES_API_SECRET', 'test-legacy-secret')
  mocks.actorFromUser.mockResolvedValue(baseActor)
  mocks.requireModule.mockResolvedValue({ ok: true })
  mocks.workspacesWithModule.mockResolvedValue([W1])
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  mocks.afterCallbacks = []
})

describe('회의록 v3 API 연동 (SP7 integration_credentials)', () => {
  it('Bearer dflow_int_ 유효 토큰으로 인증 성공', async () => {
    mockSupabase()
    const req = new NextRequest('http://localhost/api/v1/minutes/meta?user_email=lead@example.com', {
      headers: { authorization: `Bearer ${token.token}` },
    })
    const res = await META(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.workspace).toEqual({
      id: W1,
      slug: 'test-ws',
      name: '테스트 워크스페이스',
    })
  })

  it('Bearer 토큰이 만료/비활성화되었으면 401 반환', async () => {
    mockSupabase({ ...baseCredRow, enabled: false })
    const req = new NextRequest('http://localhost/api/v1/minutes/meta?user_email=lead@example.com', {
      headers: { authorization: `Bearer ${token.token}` },
    })
    const res = await META(req)
    expect(res.status).toBe(401)
  })

  it('워크스페이스의 minutes_integration 모듈이 꺼져있으면 409 module_disabled', async () => {
    mockSupabase()
    mocks.requireModule.mockResolvedValueOnce({ ok: false, error: 'module_disabled' })
    const req = new NextRequest('http://localhost/api/v1/minutes', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        user_email: 'lead@example.com',
        date: '2026-10-05',
        team: 'PMO',
        title: '주간 회의',
        body_markdown: '# 회의록 내용',
        external_id: 'ext:test-1',
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.code).toBe('module_disabled')
  })

  it('user_email이 자격증명의 워크스페이스 멤버가 아니면 403 unknown_user', async () => {
    mockSupabase(baseCredRow, { isWsMember: false })
    const req = new NextRequest('http://localhost/api/v1/minutes', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        user_email: 'stranger@example.com',
        date: '2026-10-05',
        team: 'PMO',
        title: '회의',
        body_markdown: '# 회의록',
        external_id: 'ext:test-2',
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.code).toBe('unknown_user')
  })

  it('inline meeting의 project_id가 자격증명의 projectIds 밖이면 403 project_not_allowed', async () => {
    mockSupabase()
    const req = new NextRequest('http://localhost/api/v1/minutes', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        user_email: 'lead@example.com',
        date: '2026-10-05',
        team: 'PMO',
        title: '회의',
        body_markdown: '# 회의록',
        external_id: 'ext:test-3',
        meeting: {
          project_id: P2, // P2는 baseCredRow.project_ids [P1, P3]에 없음
          title: '외부 회의',
          date: '2026-10-05',
        },
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.code).toBe('project_not_allowed')
  })

  it('비활성 팀을 지정하면 400 team_inactive 반환', async () => {
    mockSupabase()
    const req = new NextRequest('http://localhost/api/v1/minutes', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        user_email: 'lead@example.com',
        date: '2026-10-05',
        team: 'INACTIVE',
        title: '회의',
        body_markdown: '# 회의록',
        external_id: 'ext:test-4',
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.code).toBe('team_inactive')
  })

  it('POST /minutes 성공 시 워크스페이스 슬러그가 반영된 URL 반환', async () => {
    mockSupabase()
    const req = new NextRequest('http://localhost/api/v1/minutes', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        user_email: 'lead@example.com',
        date: '2026-10-05',
        team: 'PMO',
        title: '정상 등록 회의록',
        body_markdown: '# 회의록 내용',
        external_id: 'ext:test-5',
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.url).toContain('/w/test-ws/minutes/')
  })

  describe('POST /api/v1/minutes/link', () => {
    it('다른 워크스페이스의 회의록 연결 시도 시 404 not_found', async () => {
      mockSupabase(baseCredRow, {
        existingMinute: {
          id: '3f2b9c4e-8a1d-4c7b-9e2f-1a5d8c3b7e90',
          external_id: null,
          archived_at: null,
          created_by: U1,
          project_id: P2,
          workspace_id: W2, // 다른 워크스페이스
        },
      })
      const req = new NextRequest('http://localhost/api/v1/minutes/link', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token.token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          user_email: 'lead@example.com',
          minute_id: '3f2b9c4e-8a1d-4c7b-9e2f-1a5d8c3b7e90',
          external_id: 'ext:link-1',
        }),
      })
      const res = await LINK(req)
      expect(res.status).toBe(404)
    })

    it('자격증명 범위 밖 프로젝트의 회의록 연결 시도 시 403 project_not_allowed', async () => {
      mockSupabase(baseCredRow, {
        existingMinute: {
          id: '3f2b9c4e-8a1d-4c7b-9e2f-1a5d8c3b7e90',
          external_id: null,
          archived_at: null,
          created_by: U1,
          project_id: P2, // P2는 credential.projectIds [P1, P3] 밖
          workspace_id: W1,
        },
      })
      const req = new NextRequest('http://localhost/api/v1/minutes/link', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token.token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          user_email: 'lead@example.com',
          minute_id: '3f2b9c4e-8a1d-4c7b-9e2f-1a5d8c3b7e90',
          external_id: 'ext:link-2',
        }),
      })
      const res = await LINK(req)
      expect(res.status).toBe(403)
      const json = await res.json()
      expect(json.code).toBe('project_not_allowed')
    })
  })

  describe('POST /api/v1/minutes/folder', () => {
    it('items: [] 프로브: 워크스페이스 관리자면 통과(200)', async () => {
      mockSupabase()
      const req = new NextRequest('http://localhost/api/v1/minutes/folder', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token.token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          user_email: 'lead@example.com',
          items: [],
          dry_run: true,
        }),
      })
      const res = await FOLDER(req)
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.ok).toBe(true)
      expect(json.results).toEqual([])
    })

    it('items: [] 프로브: 워크스페이스 관리자도 아니고 프로젝트 관리자도 아니면 403 forbidden_role', async () => {
      mockSupabase()
      mocks.actorFromUser.mockResolvedValueOnce({
        userId: U1,
        isSuperuser: false,
        workspaceRoles: new Map([[W1, 'member']]),
        projectWorkspace: new Map([[P1, W1]]),
        projectRoles: new Map([[P1, 'member']]),
        memberIds: new Map(),
        rosterTeams: new Map(),
      })
      const req = new NextRequest('http://localhost/api/v1/minutes/folder', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token.token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          user_email: 'lead@example.com',
          items: [],
          dry_run: true,
        }),
      })
      const res = await FOLDER(req)
      expect(res.status).toBe(403)
      const json = await res.json()
      expect(json.code).toBe('forbidden_role')
    })

    it('배치 항목 중 자격증명 범위 밖 프로젝트는 건별 failed(forbidden_project) 처리', async () => {
      const { from } = mockSupabase()
      // project_id가 P2(불허)인 회의록
      from.mockImplementation((table: string) => {
        const b: Record<string, unknown> = {
          select: () => b,
          eq: () => b,
          in: () => b,
          is: () => b,
          maybeSingle: async () => {
            if (table === 'integration_credentials') return { data: baseCredRow, error: null }
            if (table === 'profiles') return { data: { user_id: U1, display_name: '테스터' }, error: null }
            if (table === 'workspace_members') return { data: { role: 'admin' }, error: null }
            return { data: null, error: null }
          },
        }
        b.then = (resolve: (v: unknown) => unknown) => {
          if (table === 'minutes') {
            return Promise.resolve({
              data: [
                {
                  id: 'm-1',
                  external_id: 'ext:forbidden-prj',
                  team_code: 'PMO',
                  project_id: P2, // 불허 프로젝트
                  workspace_id: W1,
                  folder_id: null,
                  archived_at: null,
                },
              ],
              error: null,
            }).then(resolve)
          }
          if (table === 'minute_folders') {
            return Promise.resolve({ data: [], error: null }).then(resolve)
          }
          return Promise.resolve({ data: [], error: null }).then(resolve)
        }
        return b as unknown as ReturnType<typeof from>
      })

      const req = new NextRequest('http://localhost/api/v1/minutes/folder', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token.token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          user_email: 'lead@example.com',
          dry_run: true,
          items: [
            { external_id: 'ext:forbidden-prj', folder_path: ['PMO', '하위'] },
          ],
        }),
      })
      const res = await FOLDER(req)
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.ok).toBe(true)
      expect(json.summary.failed).toBe(1)
      expect(json.results[0].status).toBe('failed')
      expect(json.results[0].reason).toBe('forbidden_project')
    })
  })
})

/* ── team 은 선택(0052) — 3값: 키 부재 / "" / 값 ─────────────────────────────── */
describe('POST /api/v1/minutes — team 은 선택이다(팀 없는 회의록, 0052)', () => {
  const send = (body: Record<string, unknown>) => POST(new NextRequest('http://localhost/api/v1/minutes', {
    method: 'POST',
    headers: { authorization: `Bearer ${token.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ user_email: 'lead@example.com', date: '2026-10-09', title: '팀 없는 회의', body_markdown: '# 본문', external_id: 'ext:no-team', ...body }),
  }))
  const createArgs = (rpc: { mock: { calls: unknown[][] } }) =>
    rpc.mock.calls.find(([fn]) => fn === 'create_minute_with_version')![1] as Record<string, unknown>
  const commitMeta = (rpc: { mock: { calls: unknown[][] } }) =>
    (rpc.mock.calls.find(([fn]) => fn === 'commit_minute_body_version')![1] as { p_metadata: Record<string, unknown> }).p_metadata
  const noDefault = { ...baseCredRow, default_team_id: null }
  const existing = (over: Record<string, unknown> = {}) => ({
    id: 'm-1', minute_date: '2026-10-01', team_code: 'ERP', title: '옛 제목', body_md: '# 옛 본문', meeting_id: null, project_id: P1,
    meeting_occurrence_date: null, archived_at: null, external_id: 'ext:no-team', folder_id: 'f-erp', created_by: U1, created_by_name: '테스터',
    created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', workspace_id: W1, ...over,
  })

  describe('새 회의록 — 해석 순서: 요청의 team → 자격증명의 기본 팀 → 팀 없음', () => {
    it('team 생략 + 기본 팀이 있으면 그 팀으로 등록한다', async () => {
      const { rpc } = mockSupabase()
      const res = await send({})
      expect(res.status).toBe(201)
      expect(createArgs(rpc)).toMatchObject({ p_team_code: 'PMO' })
      expect(await res.json()).toMatchObject({ ok: true, action: 'created', team: 'PMO' })
    })
    it('team 생략 + 기본 팀이 없으면 팀 없이 등록한다 — p_team_code 빈 값·미분류, 응답의 team 은 빈 문자열', async () => {
      const { rpc, from } = mockSupabase(noDefault)
      const res = await send({})
      expect(res.status).toBe(201)
      expect(createArgs(rpc)).toMatchObject({ p_team_code: '', p_folder_id: null })
      expect(await res.json()).toMatchObject({ ok: true, action: 'created', team: '', folder_id: null, folder_path: null, folder_path_status: 'unclassified' })
      expect(from.mock.calls.some(([table]) => table === 'minute_folders')).toBe(false)   // 편철할 팀 루트를 찾지 않는다
    })
    it('team: "" 은 팀 없음을 명시한다 — 기본 팀이 있어도 채우지 않는다(공백뿐인 값도 같다)', async () => {
      for (const team of ['', '   ']) {
        const { rpc } = mockSupabase()
        const res = await send({ team })
        expect(res.status, JSON.stringify(team)).toBe(201)
        expect(createArgs(rpc)).toMatchObject({ p_team_code: '', p_folder_id: null })
        expect((await res.json()).team).toBe('')
      }
    })
    it('team 을 명시했는데 맞는 팀이 없으면 지금처럼 400 — 오타를 팀 없음으로 삼키지 않는다(쓰기 미도달)', async () => {
      const { rpc } = mockSupabase(noDefault)
      const res = await send({ team: 'PMOO' })
      expect(res.status).toBe(400)
      expect(await res.json()).toMatchObject({ code: 'validation_failed', error: '잘못된 담당입니다.' })
      expect(rpc).not.toHaveBeenCalled()
    })
    it('team 을 명시했고 맞는 팀이 없지만 기본 팀이 있으면 그 팀이다(기존 해석 순서 그대로)', async () => {
      const { rpc } = mockSupabase()
      expect((await send({ team: 'PMOO' })).status).toBe(201)
      expect(createArgs(rpc)).toMatchObject({ p_team_code: 'PMO' })
    })
    it('team 이 문자열이 아니면(null·숫자) 400 — 3값 규약 밖의 값을 키 부재로 뭉개지 않는다', async () => {
      for (const team of [null, 3, ['PMO']]) {
        const { rpc } = mockSupabase(noDefault)
        const res = await send({ team })
        expect(res.status, JSON.stringify(team)).toBe(400)
        expect((await res.json()).error).toContain('team은 문자열')
        expect(rpc).not.toHaveBeenCalled()
      }
    })
    it('필수 항목 문구에서 team 이 빠졌다 — date·title·body_markdown 만 필수', async () => {
      mockSupabase(noDefault)
      const res = await send({ title: undefined })
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe('date, title, body_markdown은 필수입니다.')
    })
    it('teams 모드에서 팀 없이 folder_path 를 보내면 미분류로 등록한다(편철할 팀 루트가 없다) — 등록은 201', async () => {
      vi.stubEnv('MINUTES_FOLDER_PATH_ENABLED', 'true')
      const { rpc } = mockSupabase(noDefault)
      const res = await send({ folder_path: ['정례', '주간'] })
      expect(res.status).toBe(201)
      expect(createArgs(rpc)).toMatchObject({ p_team_code: '', p_folder_id: null })
      expect(await res.json()).toMatchObject({ team: '', folder_id: null, folder_path: null, folder_path_status: 'unclassified' })
    })
  })

  describe('재전송(replace)', () => {
    it('team 생략 = 기존 담당 유지 — 기본 팀으로 바꾸지도, 해제하지도 않는다. 폴더도 그대로', async () => {
      const { rpc } = mockSupabase(baseCredRow, { existingMinute: existing() })
      const res = await send({})
      expect(res.status).toBe(200)
      const meta = commitMeta(rpc)
      expect(meta.team_code).toBe('ERP')
      expect(meta).not.toHaveProperty('folder_id')
      expect(await res.json()).toMatchObject({ action: 'replaced', team: 'ERP' })
    })
    it('team 생략 + 팀 없는 기존 회의록 = 팀 없음 유지(기본 팀을 붙이지 않는다)', async () => {
      const { rpc } = mockSupabase(baseCredRow, { existingMinute: existing({ team_code: '', folder_id: null }) })
      const res = await send({})
      expect(res.status).toBe(200)
      expect(commitMeta(rpc).team_code).toBe('')
      expect((await res.json()).team).toBe('')
    })
    it('team: "" = 해제 — teams 모드에서는 옛 팀 폴더에 남기지 않고 미분류로 뺀다(folder_id null)', async () => {
      const { rpc } = mockSupabase(baseCredRow, { existingMinute: existing() })
      const res = await send({ team: '' })
      expect(res.status).toBe(200)
      expect(commitMeta(rpc)).toMatchObject({ team_code: '', folder_id: null })
      expect(await res.json()).toMatchObject({ action: 'replaced', team: '', folder_id: null, folder_path: null, folder_path_status: 'unclassified' })
    })
    it('team: "" + custom 모드 = 팀만 해제하고 폴더는 그대로 둔다(폴더가 팀을 정하지 않는다)', async () => {
      mocks.loadRootFolders.mockResolvedValueOnce({ ok: true, value: { mode: 'custom', names: ['정례'] } } as never)
      const { rpc } = mockSupabase(baseCredRow, { existingMinute: existing() })
      expect((await send({ team: '' })).status).toBe(200)
      const meta = commitMeta(rpc)
      expect(meta.team_code).toBe('')
      expect(meta).not.toHaveProperty('folder_id')
    })
    it('팀 없는 기존 회의록에 team 을 보내면 그 팀으로 지정한다', async () => {
      const { rpc } = mockSupabase(noDefault, { existingMinute: existing({ team_code: '', folder_id: null }) })
      const res = await send({ team: 'ERP' })
      expect(res.status).toBe(200)
      expect(commitMeta(rpc).team_code).toBe('ERP')
      expect((await res.json()).team).toBe('ERP')
    })
    it('on_conflict=skip 응답은 기존 값 그대로 — 팀 없는 회의록이면 team 빈 문자열', async () => {
      mockSupabase(baseCredRow, { existingMinute: existing({ team_code: '', folder_id: null }) })
      const res = await send({ on_conflict: 'skip' })
      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({ action: 'skipped', team: '' })
    })
  })
})
