import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeActor, makeAdminActor, makeMemberActor } from '../fixtures/actor'

const getSession = vi.fn()
const getActor = vi.fn()
const adminMocks = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/auth', () => ({
  getSession: (...a: unknown[]) => getSession(...(a as [])),
}))
vi.mock('@/lib/authz', async () => ({
  getActor: (...a: unknown[]) => getActor(...(a as [])),
  resolveScope: (await import('../helpers/resolve-scope-mock')).resolveScopeVia(() => createServerClient()),
}))

// 권한 3단 이행 — 역할 픽스처는 Actor 로 표현한다
const memberActor = makeMemberActor('p1', [])
const viewerActor = makeActor()
const superuserActor = { ...memberActor, isSuperuser: true }
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
// 녹취 보정의 범위 tz 해석(설정 조회)은 이 파일의 관심 밖 — 옛 기대값(서울 +9)을 그대로 두려고 서울로 고정한다(SP5 과제 20)
vi.mock('@/lib/minutes/timeFix.server', async () => {
  const { correctMinuteBodyTime } = await import('@/lib/minutes/timeFix')
  return { applyScopeTimeFix: vi.fn(async (body: string, _scope: unknown, fallbackDate: string) => ({ fix: correctMinuteBodyTime(body, { timeZone: 'Asia/Seoul', fallbackDate }) })) }
})
vi.mock('next/server', () => ({ after: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: adminMocks.createAdminClient,
}))
// 회의록 범위 팀(teamScope → 요청 범위 원천)은 실 DB 접근이 필요하다(이 테스트는 admin client 를 세부 목하지 않는다).
// 팀 검증만 공유 목(tests/fixtures/teams 의 FIXTURE_TEAMS 고정값)으로 대체해 실 DB 무관하게 만든다.
vi.mock('@/lib/minutes/teamScope', async () => (await import('../helpers/team-scope-mock')).teamScopeMock())
vi.mock('@/lib/ai/minutes-ingest', () => ({ ingestMinute: vi.fn() }))
vi.mock('@/lib/ai/minutes-insights', () => ({ ensureMinuteInsights: vi.fn(), generateMinuteInsights: vi.fn() }))
vi.mock('@/lib/data/meetings', () => ({ getProjectMeetingData: vi.fn() }))
vi.mock('@/lib/data/minutes', () => ({
  getMinuteDetail: vi.fn(), getMinutesPage: vi.fn(), searchMinutes: vi.fn(),
  getMinuteFavorites: vi.fn(), getMinutesExplorer: vi.fn(),
}))
const getHiddenProjectIds = vi.fn(async () => new Set<string>())
vi.mock('@/lib/authz/visibility', () => ({
  getHiddenProjectIds: (...a: unknown[]) => getHiddenProjectIds(...(a as [])),
}))

// 테이블별 결과를 주입하는 thenable 가짜 빌더 — insert/update/delete/select 체인 지원
type TableResult = { data?: unknown; error: { message: string; code?: string } | null }
function fakeClient(results: Record<string, TableResult>) {
  const calls: Record<string, { method: string; args: unknown[] }[]> = {}
  const from = vi.fn((table: string) => {
    const log = (calls[table] ??= [])
    const result = results[table] ?? { data: [], error: null }
    const builder: Record<string, unknown> = {}
    for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'is', 'order', 'maybeSingle', 'single']) {
      builder[m] = vi.fn((...a: unknown[]) => { log.push({ method: m, args: a }); return builder })
    }
    ;(builder as { then: (r: (v: TableResult) => void) => void }).then = resolve => resolve(result)
    return builder
  })
  return { client: { from }, calls, from }
}

function fakeMetadataAdmin(
  data: {
    old_project_id: string | null
    new_project_id: string | null
    wiki_rebuild_required: boolean
  } = {
    old_project_id: null,
    new_project_id: null,
    wiki_rebuild_required: false,
  },
) {
  const rpc = vi.fn((fn: string, args: Record<string, unknown>) => {
    void fn
    void args
    const result: TableResult = { data, error: null }
    const builder: Record<string, unknown> = {
      single: vi.fn(() => builder),
    }
    ;(builder as { then: (resolve: (value: TableResult) => void) => void }).then =
      resolve => resolve(result)
    return builder
  })
  return { client: { rpc, from: vi.fn() }, rpc }
}

const createServerClient = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: (...a: unknown[]) => createServerClient(...(a as [])),
}))

import {
  createMinute, createMinuteFolder, deleteMinuteFolder, fetchMinuteFoldersLite, moveMinuteFolder,
  moveMinuteToFolder, renameMinuteFolder, resetMinuteExternalId, updateMinuteMeta,
} from '@/app/actions/minutes'

const seedFolders = [
  { id: 'f1', name: 'PMO', parent_id: null, sort: 0, created_by: null, kind: 'team_root', team_id: 't-PMO', team: { code: 'PMO', project_id: null }, workspace_id: 'ws-1' },
  { id: 'f2', name: '하위', parent_id: 'f1', sort: 100, created_by: 'u1', workspace_id: 'ws-1' },
]

beforeEach(() => {
  getSession.mockReset(); createServerClient.mockReset(); getActor.mockReset()
  adminMocks.createAdminClient.mockReset()
  getHiddenProjectIds.mockReset(); getHiddenProjectIds.mockResolvedValue(new Set<string>())
  getSession.mockResolvedValue({ id: 'u1' })
  // 이 파일의 기존 케이스들은 권한 가드를 겨냥하지 않으므로 통과 기본값(멤버)을 깔아준다 —
  // 개별 케이스(조회 전용·미로그인)만 아래서 오버라이드.
  getActor.mockResolvedValue(memberActor)
})

describe('createMinuteFolder', () => {
  it('미로그인은 실패 + 클라이언트 미생성', async () => {
    getSession.mockResolvedValue(null)
    getActor.mockResolvedValue(null)
    const r = await createMinuteFolder('ws-1', '새폴더', null)
    expect(r.ok).toBe(false)
    expect(createServerClient).not.toHaveBeenCalled()
  })
  it('조회 전용(프로젝트 역할 없음)은 실패 + DB insert 미도달', async () => {
    getActor.mockResolvedValue(viewerActor)
    const r = await createMinuteFolder('ws-1', '새폴더', null)
    expect(r.ok).toBe(false)
    expect(createServerClient).not.toHaveBeenCalled()
  })
  it('이름 검증 실패(공백)는 DB 접근 없이 에러', async () => {
    const r = await createMinuteFolder('ws-1', '   ', null)
    expect(r.ok).toBe(false)
    expect(createServerClient).not.toHaveBeenCalled()
  })
  it('깊이 5단 초과는 거부', async () => {
    const chain = [
      { id: 'd1', name: '1', parent_id: null, sort: 0, created_by: null, kind: 'team_root', team_id: 't-1', team: { code: '1', project_id: null }, workspace_id: 'ws-1' },
      { id: 'd2', name: '2', parent_id: 'd1', sort: 0, created_by: null, workspace_id: 'ws-1' },
      { id: 'd3', name: '3', parent_id: 'd2', sort: 0, created_by: null, workspace_id: 'ws-1' },
      { id: 'd4', name: '4', parent_id: 'd3', sort: 0, created_by: null, workspace_id: 'ws-1' },
      { id: 'd5', name: '5', parent_id: 'd4', sort: 0, created_by: null, workspace_id: 'ws-1' },
    ]
    const { client } = fakeClient({ minute_folders: { data: chain, error: null } })
    createServerClient.mockResolvedValue(client)
    const r = await createMinuteFolder('ws-1', '6단', 'd5')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('5')
  })
  it('유니크 위반(23505)은 중복 안내 문구로 매핑', async () => {
    const { client, from } = fakeClient({ minute_folders: { data: seedFolders, error: null } })
    // 두 번째 from('minute_folders') 호출(insert)만 에러를 내도록 교체
    let call = 0
    from.mockImplementation(() => {
      call += 1
      const result = call === 1
        ? { data: seedFolders, error: null }
        : { data: null, error: { message: 'duplicate key value', code: '23505' } }
      const builder: Record<string, unknown> = {}
      for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'is', 'order', 'maybeSingle', 'single']) {
        builder[m] = vi.fn(() => builder)
      }
      ;(builder as { then: (r: (v: typeof result) => void) => void }).then = resolve => resolve(result)
      return builder
    })
    createServerClient.mockResolvedValue(client)
    // 루트 생성은 W18로 막히므로 팀 폴더 하위에서 중복 경로를 겨냥한다
    const r = await createMinuteFolder('ws-1', '주간회의', 'f1')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('이미')
  })
  it('W18: 루트 폴더 생성은 이름과 무관하게 거부 — DB 접근 없이 (§6.3 불변식)', async () => {
    // 사용자 루트 폴더가 하나라도 생기면 그 서브트리 회의록의 team 파생이 끊긴다
    for (const name of ['ERP', '주간회의']) {
      const r = await createMinuteFolder('ws-1', name, null)
      expect(r.ok).toBe(false)
      expect(r.error).toContain('담당 팀 폴더 안에만')
    }
    expect(createServerClient).not.toHaveBeenCalled()
  })
  it('하위 레벨의 팀코드 동명은 허용 — 루트 예약어만 차단', async () => {
    const { client } = fakeClient({ minute_folders: { data: seedFolders, error: null } })
    createServerClient.mockResolvedValue(client)
    const r = await createMinuteFolder('ws-1', 'ERP', 'f1')
    expect(r.ok).toBe(true)
  })
  it('프로젝트 폴더 하위 생성 — 비멤버는 권한 없음, DB insert 미도달', async () => {
    const projFolders = [
      { id: 'pf1', name: 'P1루트', parent_id: null, sort: 0, created_by: 'u9', project_id: 'p2', workspace_id: 'ws-1' },
    ]
    const { client, calls } = fakeClient({ minute_folders: { data: projFolders, error: null } })
    createServerClient.mockResolvedValue(client)
    // memberActor 는 p1 멤버일 뿐 p2 멤버가 아니다
    const r = await createMinuteFolder('ws-1', '하위', 'pf1')
    expect(r.ok).toBe(false)
    expect(r.error).toBe('권한 없음')
    expect(calls['minute_folders']!.some(c => c.method === 'insert')).toBe(false)
  })
  it('프로젝트 폴더 하위 생성 — 멤버는 insert payload 에 부모의 project_id 를 상속', async () => {
    const projFolders = [
      { id: 'pf1', name: 'P1루트', parent_id: null, sort: 0, created_by: 'u9', project_id: 'p1', workspace_id: 'ws-1' },
    ]
    const { client, calls } = fakeClient({ minute_folders: { data: projFolders, error: null } })
    createServerClient.mockResolvedValue(client)
    const r = await createMinuteFolder('ws-1', '하위', 'pf1')
    expect(r.ok).toBe(true)
    const ins = calls['minute_folders']!.find(c => c.method === 'insert')!
    expect(ins.args[0]).toMatchObject({ project_id: 'p1' })
  })
  it('상위 폴더 FK 위반(23503)은 삭제 안내 문구로 매핑', async () => {
    const { client, from } = fakeClient({ minute_folders: { data: seedFolders, error: null } })
    // 두 번째 from('minute_folders') 호출(insert)만 에러를 내도록 교체
    let call = 0
    from.mockImplementation(() => {
      call += 1
      const result = call === 1
        ? { data: seedFolders, error: null }
        : { data: null, error: { message: 'insert or update on table violates foreign key constraint', code: '23503' } }
      const builder: Record<string, unknown> = {}
      for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'is', 'order', 'maybeSingle', 'single']) {
        builder[m] = vi.fn(() => builder)
      }
      ;(builder as { then: (r: (v: typeof result) => void) => void }).then = resolve => resolve(result)
      return builder
    })
    createServerClient.mockResolvedValue(client)
    const r = await createMinuteFolder('ws-1', '새폴더', 'f1')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('삭제')
  })
})

describe('fetchMinuteFoldersLite', () => {
  it('숨김(비공개) 프로젝트 폴더는 목록에서 제외 — 챗 패널로 폴더명 유출 차단(레저 항목 12)', async () => {
    const folders = [
      { id: 'f-pub', name: 'ERP', parent_id: null, sort: 0, created_by: null, kind: 'team_root', team_id: 't-ERP', team: { code: 'ERP', project_id: null }, project_id: 'p-pub', workspace_id: 'ws-1' },
      { id: 'f-priv', name: 'MES', parent_id: null, sort: 1, created_by: null, kind: 'team_root', team_id: 't-MES', team: { code: 'MES', project_id: null }, project_id: 'p-priv', workspace_id: 'ws-1' },
      { id: 'f-none', name: 'PMO', parent_id: null, sort: 2, created_by: null, kind: 'team_root', team_id: 't-PMO', team: { code: 'PMO', project_id: null }, project_id: null, workspace_id: 'ws-1' },
    ]
    const { client } = fakeClient({ minute_folders: { data: folders, error: null } })
    createServerClient.mockResolvedValue(client)
    getHiddenProjectIds.mockResolvedValue(new Set(['p-priv']))
    const r = await fetchMinuteFoldersLite('ws-1')
    expect(r).not.toBeNull()
    expect(r!.map(f => f.id)).toEqual(['f-pub', 'f-none'])
  })
  it('숨김 판정이 실패하면 폴더를 열지 않는다 — null(fail-closed, 비공개 폴더명이 새지 않게)', async () => {
    const { client } = fakeClient({ minute_folders: { data: [{ id: 'f1', name: 'ERP', parent_id: null, sort: 0, created_by: null, kind: 'team_root', team_id: 't-ERP', team: { code: 'ERP', project_id: null }, project_id: 'p1', workspace_id: 'ws-1' }], error: null } })
    createServerClient.mockResolvedValue(client)
    getHiddenProjectIds.mockRejectedValue(new Error('hidden down'))
    expect(await fetchMinuteFoldersLite('ws-1')).toBeNull()
  })
  it('숨김 집합이 비면 전량 반환 — 기존 동작 무변경', async () => {
    const folders = [
      { id: 'f1', name: 'ERP', parent_id: null, sort: 0, created_by: null, kind: 'team_root', team_id: 't-ERP', team: { code: 'ERP', project_id: null }, project_id: 'p1', workspace_id: 'ws-1' },
    ]
    const { client } = fakeClient({ minute_folders: { data: folders, error: null } })
    createServerClient.mockResolvedValue(client)
    const r = await fetchMinuteFoldersLite('ws-1')
    expect(r!.map(f => f.id)).toEqual(['f1'])
  })
})

describe('renameMinuteFolder / deleteMinuteFolder', () => {
  it('rename: 이름 검증 실패는 DB 접근 없이 에러', async () => {
    const r = await renameMinuteFolder('ws-1', 'f2', '')
    expect(r.ok).toBe(false)
    expect(createServerClient).not.toHaveBeenCalled()
  })
  it('rename: 0행 갱신(권한 없음/미존재)은 실패로 판정', async () => {
    const { client } = fakeClient({ minute_folders: { data: [], error: null } })
    createServerClient.mockResolvedValue(client)
    const r = await renameMinuteFolder('ws-1', 'f1', '새이름')
    expect(r.ok).toBe(false)
  })
  it('delete: 0행 삭제는 실패, 1행 삭제는 성공', async () => {
    // 루트+created_by null 은 새 계약(팀 마스터)에서 팀 시드로 보호되므로 사용자 소유로 명시
    const { client } = fakeClient({ minute_folders: { data: [{ id: 'f2', parent_id: 'f1', created_by: 'u1', workspace_id: 'ws-1' }], error: null } })
    createServerClient.mockResolvedValue(client)
    const { client: admin } = fakeClient({
      minute_folders: { data: [], error: null }, minutes: { data: [], error: null },
    })
    adminMocks.createAdminClient.mockReturnValue(admin)
    expect((await deleteMinuteFolder('ws-1', 'f2')).ok).toBe(true)
    const empty = fakeClient({ minute_folders: { data: [], error: null } })
    createServerClient.mockResolvedValue(empty.client)
    expect((await deleteMinuteFolder('ws-1', 'f2')).ok).toBe(false)   // 폴더 목록에 없음
  })

  it('delete: 비우기 우선 — 하위 폴더·소속 회의록을 부모로 승격한 뒤 지운다(§6)', async () => {
    const tree = [
      { id: 'f1', name: 'PMO', parent_id: null, sort: 0, created_by: null, kind: 'team_root', team_id: 't-PMO', team: { code: 'PMO', project_id: null }, workspace_id: 'ws-1' },
      { id: 'f2', name: '대상', parent_id: 'f1', sort: 100, created_by: 'u1', workspace_id: 'ws-1' },
      { id: 'f3', name: '자식', parent_id: 'f2', sort: 100, created_by: 'u9', workspace_id: 'ws-1' },
    ]
    const { client } = fakeClient({ minute_folders: { data: tree, error: null } })
    createServerClient.mockResolvedValue(client)
    const { client: admin, calls: adminCalls } = fakeClient({
      minute_folders: { data: [{ id: 'f3' }], error: null }, minutes: { data: [{ id: 'm1' }], error: null },
    })
    adminMocks.createAdminClient.mockReturnValue(admin)
    expect((await deleteMinuteFolder('ws-1', 'f2')).ok).toBe(true)
    // 자식 폴더 승격
    const folderUpd = adminCalls['minute_folders']!.find(c => c.method === 'update')!
    expect(folderUpd.args[0]).toMatchObject({ parent_id: 'f1' })
    // 회의록 승격 — updated_at 은 건드리지 않는다(조직 정리가 '방금 수정됨'으로 비치면 안 됨)
    const minuteUpd = adminCalls['minutes']!.find(c => c.method === 'update')!
    expect(minuteUpd.args[0]).toEqual({ folder_id: 'f1' })
  })

  it('delete: 승격 시 상위에 동명이 있으면 중단 — cascade 로 조용히 지우지 않는다', async () => {
    const tree = [
      { id: 'f1', name: 'PMO', parent_id: null, sort: 0, created_by: null, kind: 'team_root', team_id: 't-PMO', team: { code: 'PMO', project_id: null }, workspace_id: 'ws-1' },
      { id: 'f2', name: '대상', parent_id: 'f1', sort: 100, created_by: 'u1', workspace_id: 'ws-1' },
      { id: 'f3', name: '겹침', parent_id: 'f2', sort: 100, created_by: 'u1', workspace_id: 'ws-1' },
      { id: 'f4', name: '겹침', parent_id: 'f1', sort: 100, created_by: 'u1', workspace_id: 'ws-1' },
    ]
    const { client, calls } = fakeClient({ minute_folders: { data: tree, error: null } })
    createServerClient.mockResolvedValue(client)
    const r = await deleteMinuteFolder('ws-1', 'f2')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('겹침')
    expect(calls['minute_folders']!.some(c => c.method === 'delete')).toBe(false)
  })

  it('delete: 작성자도 pmo_admin 도 아니면 승격 전에 거절', async () => {
    const tree = [
      { id: 'f1', name: 'PMO', parent_id: null, sort: 0, created_by: null, kind: 'team_root', team_id: 't-PMO', team: { code: 'PMO', project_id: null }, workspace_id: 'ws-1' },
      { id: 'f2', name: '남의폴더', parent_id: 'f1', sort: 100, created_by: 'other', workspace_id: 'ws-1' },
    ]
    const { client } = fakeClient({ minute_folders: { data: tree, error: null } })
    createServerClient.mockResolvedValue(client)
    const r = await deleteMinuteFolder('ws-1', 'f2')
    expect(r.ok).toBe(false)
    expect(adminMocks.createAdminClient).not.toHaveBeenCalled()
  })
  it('rename: 시드 팀 루트(MES)는 개명 금지 — 자동 편철 앵커 보호(0043)', async () => {
    const { client } = fakeClient({
      minute_folders: { data: [{ id: 'f-mes', name: 'MES', parent_id: null, sort: 2, created_by: null, kind: 'team_root', team_id: 't-MES', team: { code: 'MES', project_id: null }, workspace_id: 'ws-1' }], error: null },
    })
    createServerClient.mockResolvedValue(client)
    const r = await renameMinuteFolder('ws-1', 'f-mes', '엠이에스')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('최상위 기본 폴더')
  })
  it('rename/delete: 시드 하위 구분(구매)은 허용 — 하위 구분이 실폴더 동적 유도로 바뀌어 앵커 보호 해제', async () => {
    const seedTree = [
      { id: 'r-erp', name: 'ERP', parent_id: null, sort: 1, created_by: null, kind: 'team_root', team_id: 't-ERP', team: { code: 'ERP', project_id: null }, workspace_id: 'ws-1' },
      { id: 'c-buy', name: '구매', parent_id: 'r-erp', sort: 1, created_by: null, workspace_id: 'ws-1' },
    ]
    const { client } = fakeClient({ minute_folders: { data: seedTree, error: null } })
    createServerClient.mockResolvedValue(client)
    // fakeClient 는 갱신·삭제 결과로 테이블 데이터를 그대로 돌려주므로(비어있지 않음) 성공 경로에 도달
    const r = await renameMinuteFolder('ws-1', 'c-buy', '구매관리')
    expect(r.ok).toBe(true)
    // 삭제는 '비우기 우선'이라 admin 으로 승격 후 지운다. created_by null 이라 관리자 이상이어야 한다.
    getActor.mockResolvedValue(superuserActor)
    const { client: admin } = fakeClient({
      minute_folders: { data: [], error: null }, minutes: { data: [], error: null },
    })
    adminMocks.createAdminClient.mockReturnValue(admin)
    const d = await deleteMinuteFolder('ws-1', 'c-buy')
    expect(d.ok).toBe(true)
  })
  it('rename: 일반 루트를 팀코드 동명(MDM)으로 바꾸는 것도 거부(앵커 사칭 방지)', async () => {
    const { client } = fakeClient({
      minute_folders: { data: [{ id: 'f-mine', name: '내폴더', parent_id: null, sort: 100, created_by: 'u1', workspace_id: 'ws-1' }], error: null },
    })
    createServerClient.mockResolvedValue(client)
    const r = await renameMinuteFolder('ws-1', 'f-mine', 'MDM')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('팀 이름과 같은 이름')
  })
  it('rename: 사용자 폴더의 일반 개명은 허용', async () => {
    const { client } = fakeClient({
      minute_folders: { data: [{ id: 'f-mine', name: '내폴더', parent_id: null, sort: 100, created_by: 'u1', workspace_id: 'ws-1' }], error: null },
    })
    createServerClient.mockResolvedValue(client)
    expect((await renameMinuteFolder('ws-1', 'f-mine', '새이름')).ok).toBe(true)
  })
  it('delete: 시드 팀 루트(ERP)는 삭제 금지 — cascade 소실 방지(0043)', async () => {
    const { client, calls } = fakeClient({
      minute_folders: { data: [{ id: 'f-erp', name: 'ERP', parent_id: null, sort: 1, created_by: null, kind: 'team_root', team_id: 't-ERP', team: { code: 'ERP', project_id: null }, workspace_id: 'ws-1' }], error: null },
    })
    createServerClient.mockResolvedValue(client)
    const r = await deleteMinuteFolder('ws-1', 'f-erp')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('삭제할 수 없습니다')
    expect(calls['minute_folders']!.some(c => c.method === 'delete')).toBe(false)
  })
  it('rename: 대상이 프로젝트 폴더면 비멤버는 거부', async () => {
    const { client } = fakeClient({
      minute_folders: {
        data: [{ id: 'pf2', name: '하위', parent_id: 'pf1', sort: 100, created_by: 'u1', project_id: 'p2', workspace_id: 'ws-1' }],
        error: null,
      },
    })
    createServerClient.mockResolvedValue(client)
    const r = await renameMinuteFolder('ws-1', 'pf2', '새이름')
    expect(r.ok).toBe(false)
    expect(r.error).toBe('권한 없음')
  })
  it('delete: 대상이 프로젝트 폴더면 비멤버는 거부 — 승격 전에 중단', async () => {
    const { client } = fakeClient({
      minute_folders: {
        data: [
          { id: 'pf1', name: 'P1루트', parent_id: null, sort: 0, created_by: null, kind: 'team_root', team_id: 't-P1루트', team: { code: 'P1루트', project_id: null }, project_id: 'p2', workspace_id: 'ws-1' },
          { id: 'pf2', name: '하위', parent_id: 'pf1', sort: 100, created_by: 'u1', project_id: 'p2', workspace_id: 'ws-1' },
        ],
        error: null,
      },
    })
    createServerClient.mockResolvedValue(client)
    const r = await deleteMinuteFolder('ws-1', 'pf2')
    expect(r.ok).toBe(false)
    expect(r.error).toBe('권한 없음')
    expect(adminMocks.createAdminClient).not.toHaveBeenCalled()
  })
  it('rename/delete: 가드 선행조회 실패는 중단(쓰기 선행조회 원칙)', async () => {
    const { client } = fakeClient({
      minute_folders: { data: null, error: { message: 'db down' } },
    })
    createServerClient.mockResolvedValue(client)
    expect((await renameMinuteFolder('ws-1', 'f1', '새이름')).ok).toBe(false)
    expect((await deleteMinuteFolder('ws-1', 'f1')).ok).toBe(false)
  })
})

describe('updateMinuteMeta 폴더 이동(하위 구분, 수정 모달)', () => {
  const patch = { minuteDate: '2026-07-24', teamCode: 'MES' as const, title: '제목', meetingId: null }
  it('folderId 전달 시 folder_id 포함 갱신 + team_code 를 폴더에서 파생(클라이언트 값 불신)', async () => {
    const tree = [
      { id: 'r-erp', name: 'ERP', parent_id: null, sort: 1, created_by: null, kind: 'team_root', team_id: 't-ERP', team: { code: 'ERP', project_id: null }, workspace_id: 'ws-1' },
      { id: 'c-log', name: '물류', parent_id: 'r-erp', sort: 1, created_by: 'u1', workspace_id: 'ws-1' },
    ]
    const { client } = fakeClient({
      minutes: { data: { created_by: 'u1', workspace_id: 'ws-1' }, error: null },
      minute_folders: { data: tree, error: null },
    })
    const { client: admin, rpc } = fakeMetadataAdmin()
    createServerClient.mockResolvedValue(client)
    adminMocks.createAdminClient.mockReturnValue(admin)
    // patch.teamCode 는 'MES' 인데 폴더는 ERP 서브트리다 — 서버가 폴더를 이긴다
    const r = await updateMinuteMeta('m1', { ...patch, teamCode: 'MES' }, 'c-log')
    expect(r.ok).toBe(true)
    expect(rpc).toHaveBeenCalledWith(
      'update_minute_metadata_with_wiki_retraction',
      expect.objectContaining({
        p_minute_id: 'm1',
        p_metadata: expect.objectContaining({ folder_id: 'c-log', team_code: 'ERP' }),
      }),
    )
  })

  it('시드 체인 밖 폴더는 거절 — 팀을 추측하지 않는다(§6.3 서버 강제)', async () => {
    const tree = [{ id: 'orphan', name: '떠돌이', parent_id: null, sort: 100, created_by: 'u1', workspace_id: 'ws-1' }]
    const { client, calls } = fakeClient({
      minutes: { data: { created_by: 'u1', workspace_id: 'ws-1' }, error: null },
      minute_folders: { data: tree, error: null },
    })
    createServerClient.mockResolvedValue(client)
    const r = await updateMinuteMeta('m1', patch, 'orphan')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('담당 팀을 판정할 수 없는')
    expect(calls['minutes']!.some(c => c.method === 'update')).toBe(false)
  })
  it('folderId 미전달이면 folder_id 무접촉 — 수동 편철 존중', async () => {
    const { client } = fakeClient({ minutes: { data: { created_by: 'u1', workspace_id: 'ws-1' }, error: null } })
    const { client: admin, rpc } = fakeMetadataAdmin()
    createServerClient.mockResolvedValue(client)
    adminMocks.createAdminClient.mockReturnValue(admin)
    const r = await updateMinuteMeta('m1', patch)
    expect(r.ok).toBe(true)
    const args = rpc.mock.calls[0][1]
    expect('folder_id' in (args.p_metadata as Record<string, unknown>)).toBe(false)
  })
  it('전달된 폴더 미존재는 거부 — 갱신 미도달', async () => {
    const { client, calls } = fakeClient({
      minutes: { data: { created_by: 'u1', workspace_id: 'ws-1' }, error: null },
      minute_folders: { data: null, error: null },
    })
    createServerClient.mockResolvedValue(client)
    const r = await updateMinuteMeta('m1', patch, 'ghost')
    expect(r.ok).toBe(false)
    expect(calls['minutes']!.some(c => c.method === 'update')).toBe(false)
  })
  it('명시 지정 폴더가 옮겨갈 프로젝트와 다르면 거부 — RPC 미도달(moveMinuteToFolder 와 동일 관용구)', async () => {
    const tree = [
      { id: 'p2-root', name: 'MES', parent_id: null, sort: 1, created_by: null, kind: 'team_root', team_id: 't-MES', team: { code: 'MES', project_id: null }, project_id: 'p2', workspace_id: 'ws-1' },
    ]
    const { client, calls } = fakeClient({
      minutes: { data: { created_by: 'u1', archived_at: null, project_id: 'p1', workspace_id: 'ws-1' }, error: null },
      projects: { data: { id: 'p1' }, error: null },
      minute_folders: { data: tree, error: null },
    })
    createServerClient.mockResolvedValue(client)
    const r = await updateMinuteMeta('m1', { ...patch, projectId: 'p1' }, 'p2-root')
    expect(r.ok).toBe(false)
    expect(r.error).toBe('다른 프로젝트 폴더로는 이동할 수 없습니다.')
    expect(calls['minutes']!.every(c => c.method !== 'update')).toBe(true)
    expect(adminMocks.createAdminClient).not.toHaveBeenCalled()
  })
  it('명시 지정 폴더가 옮겨갈 프로젝트와 일치하면 통과 — team 파생 + RPC 갱신', async () => {
    const tree = [
      { id: 'p1-root', name: 'ERP', parent_id: null, sort: 1, created_by: null, kind: 'team_root', team_id: 't-ERP', team: { code: 'ERP', project_id: null }, project_id: 'p1', workspace_id: 'ws-1' },
    ]
    const { client } = fakeClient({
      minutes: { data: { created_by: 'u1', archived_at: null, project_id: 'p1', workspace_id: 'ws-1' }, error: null },
      projects: { data: { id: 'p1' }, error: null },
      minute_folders: { data: tree, error: null },
    })
    const { client: admin, rpc } = fakeMetadataAdmin({ old_project_id: 'p1', new_project_id: 'p1', wiki_rebuild_required: false })
    createServerClient.mockResolvedValue(client)
    adminMocks.createAdminClient.mockReturnValue(admin)
    const r = await updateMinuteMeta('m1', { ...patch, projectId: 'p1' }, 'p1-root')
    expect(r.ok).toBe(true)
    expect(rpc).toHaveBeenCalledWith(
      'update_minute_metadata_with_wiki_retraction',
      expect.objectContaining({
        p_minute_id: 'm1',
        p_metadata: expect.objectContaining({ folder_id: 'p1-root', team_code: 'ERP', project_id: 'p1' }),
      }),
    )
  })
  it('folderId 를 null 로 전달하면 명시적 미분류로 갱신 — 무접촉(undefined)과 구분', async () => {
    const { client } = fakeClient({ minutes: { data: { created_by: 'u1', workspace_id: 'ws-1' }, error: null } })
    const { client: admin, rpc } = fakeMetadataAdmin()
    createServerClient.mockResolvedValue(client)
    adminMocks.createAdminClient.mockReturnValue(admin)
    const r = await updateMinuteMeta('m1', patch, null)
    expect(r.ok).toBe(true)
    const args = rpc.mock.calls[0][1]
    const metadata = args.p_metadata as Record<string, unknown>
    expect('folder_id' in metadata).toBe(true)
    expect(metadata.folder_id).toBeNull()
  })
})

describe('moveMinuteFolder (폴더 드래그앤드롭)', () => {
  // 서버는 클라이언트 판정을 신뢰하지 않는다 — 거부 케이스마다 update 미도달까지 확인
  const tree = [
    { id: 'f-mes', name: 'MES', parent_id: null, sort: 2, created_by: null, kind: 'team_root', team_id: 't-MES', team: { code: 'MES', project_id: null }, workspace_id: 'ws-1' },   // 팀 시드 루트
    { id: 'f-a', name: '가', parent_id: null, sort: 100, created_by: 'u1', workspace_id: 'ws-1' },
    { id: 'f-b', name: '나', parent_id: 'f-a', sort: 100, created_by: 'u1', workspace_id: 'ws-1' },
    { id: 'f-c', name: '다', parent_id: 'f-b', sort: 100, created_by: 'u1', workspace_id: 'ws-1' },
  ]
  const withTree = () => fakeClient({ minute_folders: { data: tree, error: null } })

  it('미로그인은 실패 + 클라이언트 미생성', async () => {
    getSession.mockResolvedValue(null)
    getActor.mockResolvedValue(null)
    const r = await moveMinuteFolder('ws-1', 'f-b', null)
    expect(r.ok).toBe(false)
    expect(createServerClient).not.toHaveBeenCalled()
  })
  it('가드 선행조회 실패는 중단(쓰기 선행조회 원칙)', async () => {
    const { client } = fakeClient({ minute_folders: { data: null, error: { message: 'db down' } } })
    createServerClient.mockResolvedValue(client)
    expect((await moveMinuteFolder('ws-1', 'f-b', null)).ok).toBe(false)
  })
  it('없는 폴더는 실패', async () => {
    const { client, calls } = withTree()
    createServerClient.mockResolvedValue(client)
    const r = await moveMinuteFolder('ws-1', 'ghost', null)
    expect(r.ok).toBe(false)
    expect(calls['minute_folders']!.some(c => c.method === 'update')).toBe(false)
  })
  it('팀 시드 루트는 이동 금지 — update 미도달', async () => {
    const { client, calls } = withTree()
    createServerClient.mockResolvedValue(client)
    const r = await moveMinuteFolder('ws-1', 'f-mes', 'f-a')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('최상위 기본 폴더')
    expect(calls['minute_folders']!.some(c => c.method === 'update')).toBe(false)
  })
  it('자손으로의 이동(순환)은 거부 — update 미도달', async () => {
    const { client, calls } = withTree()
    createServerClient.mockResolvedValue(client)
    const r = await moveMinuteFolder('ws-1', 'f-a', 'f-c')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('하위 폴더')
    expect(calls['minute_folders']!.some(c => c.method === 'update')).toBe(false)
  })
  it('없는 상위 폴더로의 이동은 거부', async () => {
    const { client, calls } = withTree()
    createServerClient.mockResolvedValue(client)
    const r = await moveMinuteFolder('ws-1', 'f-b', 'ghost')
    expect(r.ok).toBe(false)
    expect(calls['minute_folders']!.some(c => c.method === 'update')).toBe(false)
  })
  it('깊이 상한 초과는 거부 — 클라이언트가 통과시켜도 서버가 막는다', async () => {
    const deep = [
      { id: 'd1', name: '1', parent_id: null, sort: 0, created_by: 'u1', workspace_id: 'ws-1' },
      { id: 'd2', name: '2', parent_id: 'd1', sort: 0, created_by: 'u1', workspace_id: 'ws-1' },
      { id: 'd3', name: '3', parent_id: 'd2', sort: 0, created_by: 'u1', workspace_id: 'ws-1' },
      { id: 'd4', name: '4', parent_id: 'd3', sort: 0, created_by: 'u1', workspace_id: 'ws-1' },
      { id: 's', name: '이동', parent_id: null, sort: 0, created_by: 'u1', workspace_id: 'ws-1' },
      { id: 's2', name: '이동자식', parent_id: 's', sort: 0, created_by: 'u1', workspace_id: 'ws-1' },
    ]
    const { client, calls } = fakeClient({ minute_folders: { data: deep, error: null } })
    createServerClient.mockResolvedValue(client)
    const r = await moveMinuteFolder('ws-1', 's', 'd4')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('5')
    expect(calls['minute_folders']!.some(c => c.method === 'update')).toBe(false)
  })
  it('루트로 올릴 때 팀코드 동명(ERP)은 앵커 사칭으로 거부', async () => {
    const squat = [
      { id: 'p', name: '상위', parent_id: null, sort: 100, created_by: 'u1', workspace_id: 'ws-1' },
      { id: 'x', name: 'ERP', parent_id: 'p', sort: 100, created_by: 'u1', workspace_id: 'ws-1' },
    ]
    const { client, calls } = fakeClient({ minute_folders: { data: squat, error: null } })
    createServerClient.mockResolvedValue(client)
    const r = await moveMinuteFolder('ws-1', 'x', null)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('팀 이름과 같은 이름')
    expect(calls['minute_folders']!.some(c => c.method === 'update')).toBe(false)
  })
  it('제자리(현재 부모) 드롭은 쓰기 없이 성공', async () => {
    const { client, calls } = withTree()
    createServerClient.mockResolvedValue(client)
    const r = await moveMinuteFolder('ws-1', 'f-b', 'f-a')
    expect(r.ok).toBe(true)
    expect(calls['minute_folders']!.some(c => c.method === 'update')).toBe(false)
  })
  it('정상 이동은 parent_id 갱신', async () => {
    const { client, calls } = withTree()
    createServerClient.mockResolvedValue(client)
    const r = await moveMinuteFolder('ws-1', 'f-c', null)
    expect(r.ok).toBe(true)
    const upd = calls['minute_folders']!.find(c => c.method === 'update')!
    expect(upd.args[0]).toMatchObject({ parent_id: null })
  })
  it('0행 갱신(RLS 권한 없음)은 실패로 판정', async () => {
    // 선행조회는 트리를, 갱신은 0행을 돌려주도록 호출 순서로 가른다
    const { client, from } = withTree()
    let call = 0
    from.mockImplementation(() => {
      call += 1
      const result = call === 1 ? { data: tree, error: null } : { data: [], error: null }
      const builder: Record<string, unknown> = {}
      for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'is', 'order', 'maybeSingle', 'single']) {
        builder[m] = vi.fn(() => builder)
      }
      ;(builder as { then: (r: (v: typeof result) => void) => void }).then = resolve => resolve(result)
      return builder
    })
    createServerClient.mockResolvedValue(client)
    const r = await moveMinuteFolder('ws-1', 'f-c', null)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('권한')
  })
  it('유니크 위반(23505)은 동명 폴더 안내로 매핑', async () => {
    const { client, from } = withTree()
    let call = 0
    from.mockImplementation(() => {
      call += 1
      const result = call === 1
        ? { data: tree, error: null }
        : { data: null, error: { message: 'duplicate key value', code: '23505' } }
      const builder: Record<string, unknown> = {}
      for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'is', 'order', 'maybeSingle', 'single']) {
        builder[m] = vi.fn(() => builder)
      }
      ;(builder as { then: (r: (v: typeof result) => void) => void }).then = resolve => resolve(result)
      return builder
    })
    createServerClient.mockResolvedValue(client)
    const r = await moveMinuteFolder('ws-1', 'f-c', null)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('이미')
  })
  it('다른 프로젝트 폴더 하위로의 이동은 거부 — update 미도달', async () => {
    const projTree = [
      { id: 'p1-root', name: 'P1', parent_id: null, sort: 0, created_by: 'u1', project_id: 'p1', workspace_id: 'ws-1' },
      { id: 'p1-a', name: 'A', parent_id: 'p1-root', sort: 100, created_by: 'u1', project_id: 'p1', workspace_id: 'ws-1' },
      { id: 'p2-root', name: 'P2', parent_id: null, sort: 0, created_by: 'u1', project_id: 'p2', workspace_id: 'ws-1' },
    ]
    const { client, calls } = fakeClient({ minute_folders: { data: projTree, error: null } })
    createServerClient.mockResolvedValue(client)
    const r = await moveMinuteFolder('ws-1', 'p1-a', 'p2-root')
    expect(r.ok).toBe(false)
    expect(r.error).toBe('다른 프로젝트 폴더로는 이동할 수 없습니다.')
    expect(calls['minute_folders']!.some(c => c.method === 'update')).toBe(false)
  })
})

describe('moveMinuteToFolder', () => {
  it('대상 폴더 미존재면 거부', async () => {
    const { client } = fakeClient({ minute_folders: { data: null, error: null } })
    createServerClient.mockResolvedValue(client)
    const r = await moveMinuteToFolder('m1', 'ghost')
    expect(r.ok).toBe(false)
  })
  it('folderId null(미분류)은 폴더 존재 검증 없이 진행, 0행 갱신은 권한 없음', async () => {
    const { client, calls } = fakeClient({ minutes: { data: [], error: null } })
    createServerClient.mockResolvedValue(client)
    const r = await moveMinuteToFolder('m1', null)
    expect(r.ok).toBe(false)                       // 0행 → 권한 없음
    expect(calls['minute_folders']).toBeUndefined() // 폴더 조회 안 함
  })
  it('같은 팀 안 이동은 1행 갱신으로 성공 — raw update(위키 무영향)', async () => {
    const { client } = fakeClient({
      minute_folders: { data: seedFolders, error: null },
      minutes: { data: { id: 'm1', created_by: 'u1', team_code: 'PMO', workspace_id: 'ws-1' }, error: null },
    })
    const { client: admin } = fakeClient({ minutes: { data: [{ id: 'm1' }], error: null } })
    createServerClient.mockResolvedValue(client)
    adminMocks.createAdminClient.mockReturnValue(admin)
    expect((await moveMinuteToFolder('m1', 'f2')).ok).toBe(true)
    // 같은 팀(PMO)이라 메타 RPC 를 타지 않는다
    expect(adminMocks.createAdminClient).toHaveBeenCalled()
  })

  it('§6.4 팀을 넘어가면 team_code 를 동반 갱신하고 메타 RPC 를 경유한다', async () => {
    const folders = [
      ...seedFolders,
      { id: 'f3', name: 'MES', parent_id: null, sort: 2, created_by: null, kind: 'team_root', team_id: 't-MES', team: { code: 'MES', project_id: null }, workspace_id: 'ws-1' },
      { id: 'f4', name: '품질', parent_id: 'f3', sort: 100, created_by: 'u1', workspace_id: 'ws-1' },
    ]
    const { client } = fakeClient({
      minute_folders: { data: folders, error: null },
      minutes: { data: { id: 'm1', created_by: 'u1', team_code: 'PMO', workspace_id: 'ws-1' }, error: null },
    })
    const { client: admin, rpc } = fakeMetadataAdmin({
      old_project_id: null, new_project_id: null, wiki_rebuild_required: false,
    })
    createServerClient.mockResolvedValue(client)
    adminMocks.createAdminClient.mockReturnValue(admin)
    expect((await moveMinuteToFolder('m1', 'f4')).ok).toBe(true)
    // raw update 로 하면 ai_documents 가 옛 team_code 로 남는다
    expect(rpc).toHaveBeenCalledWith(
      'update_minute_metadata_with_wiki_retraction',
      expect.objectContaining({
        p_minute_id: 'm1',
        p_metadata: expect.objectContaining({ team_code: 'MES', folder_id: 'f4' }),
      }),
    )
  })

  it('시드 체인 밖 폴더로는 이동을 거절한다 — 팀을 추측하지 않는다', async () => {
    const folders = [
      ...seedFolders,
      { id: 'f9', name: '떠돌이', parent_id: null, sort: 100, created_by: 'u1', workspace_id: 'ws-1' },
    ]
    const { client } = fakeClient({
      minute_folders: { data: folders, error: null },
      minutes: { data: { id: 'm1', created_by: 'u1', team_code: 'PMO', workspace_id: 'ws-1' }, error: null },
    })
    createServerClient.mockResolvedValue(client)
    const r = await moveMinuteToFolder('m1', 'f9')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('담당 팀을 판정할 수 없는')
  })

  it('회의록 project_id 와 대상 폴더 project_id 불일치는 거부 — update 미도달', async () => {
    const folders = [
      { id: 'pf1', name: 'P2루트', parent_id: null, sort: 0, created_by: 'u1', project_id: 'p2', workspace_id: 'ws-1' },
    ]
    const { client, calls } = fakeClient({
      minute_folders: { data: folders, error: null },
      minutes: { data: { id: 'm1', created_by: 'u1', team_code: 'PMO', project_id: 'p1', workspace_id: 'ws-1' }, error: null },
    })
    createServerClient.mockResolvedValue(client)
    const r = await moveMinuteToFolder('m1', 'pf1')
    expect(r.ok).toBe(false)
    expect(r.error).toBe('다른 프로젝트 폴더로는 이동할 수 없습니다.')
    expect(calls['minutes']!.some(c => c.method === 'update')).toBe(false)
    expect(adminMocks.createAdminClient).not.toHaveBeenCalled()
  })
})

describe('createMinute 폴더 프로젝트 스코프', () => {
  it('명시 지정 폴더가 회의록이 속할 프로젝트와 다르면 거부 — RPC 미도달', async () => {
    const tree = [
      { id: 'p2-root', name: 'MES', parent_id: null, sort: 1, created_by: null, kind: 'team_root', team_id: 't-MES', team: { code: 'MES', project_id: null }, project_id: 'p2', workspace_id: 'ws-1' },
    ]
    const { client } = fakeClient({
      projects: { data: { id: 'p1' }, error: null },
      minute_folders: { data: tree, error: null },
    })
    createServerClient.mockResolvedValue(client)
    const r = await createMinute({
      minuteDate: '2026-08-12', teamCode: 'PMO', title: '제목', bodyMd: '본문',
      meetingId: null, projectId: 'p1',
    } as never, 'p2-root')
    expect(r.ok).toBe(false)
    expect(r.error).toBe('다른 프로젝트 폴더로는 이동할 수 없습니다.')
    expect(adminMocks.createAdminClient).not.toHaveBeenCalled()
  })
  it('명시 지정 폴더가 회의록이 속할 프로젝트와 일치하면 통과', async () => {
    const tree = [
      { id: 'p1-root', name: 'ERP', parent_id: null, sort: 1, created_by: null, kind: 'team_root', team_id: 't-ERP', team: { code: 'ERP', project_id: null }, project_id: 'p1', workspace_id: 'ws-1' },
    ]
    const { client } = fakeClient({
      projects: { data: { id: 'p1' }, error: null },
      minute_folders: { data: tree, error: null },
    })
    const { client: admin, rpc } = fakeMetadataAdmin()
    // create_minute_with_version RPC 는 별도 shape 를 돌려주므로 admin.rpc 를 직접 재구성한다.
    const rpcCreate = vi.fn(() => ({
      single: () => Promise.resolve({
        data: { minute_id: 'm-new', version_id: 'v1', wiki_rebuild_required: false }, error: null,
      }),
    }))
    void rpc
    createServerClient.mockResolvedValue(client)
    adminMocks.createAdminClient.mockReturnValue({ ...admin, rpc: rpcCreate })
    const r = await createMinute({
      minuteDate: '2026-08-12', teamCode: 'PMO', title: '제목', bodyMd: '본문',
      meetingId: null, projectId: 'p1',
    } as never, 'p1-root')
    expect(r.ok).toBe(true)
    expect(rpcCreate).toHaveBeenCalledWith(
      'create_minute_with_version',
      expect.objectContaining({ p_folder_id: 'p1-root', p_team_code: 'ERP', p_project_id: 'p1' }),
    )
  })
})

/* ── W21 폴더 이동 (§6.5) ──────────────────────────────────────────────────── */

describe('resetMinuteExternalId', () => {
  it('소유자 아니고 pmo_admin 도 아니면 거부 — admin 클라이언트 미생성', async () => {
    const { client } = fakeClient({ minutes: { data: { created_by: 'u2', archived_at: null, workspace_id: 'ws-1' }, error: null } })
    createServerClient.mockResolvedValue(client)
    const r = await resetMinuteExternalId('m1')
    expect(r.ok).toBe(false)
    expect(adminMocks.createAdminClient).not.toHaveBeenCalled()
  })
  it('보관된 회의록은 거부', async () => {
    const { client } = fakeClient({ minutes: { data: { created_by: 'u1', archived_at: 't', workspace_id: 'ws-1' }, error: null } })
    createServerClient.mockResolvedValue(client)
    const r = await resetMinuteExternalId('m1')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('보관')
  })
  it('0행 갱신(권한 없음·회의록 없음)은 명시적 실패 — 조용한 성공 위장 금지', async () => {
    const { client } = fakeClient({ minutes: { data: { created_by: 'u1', archived_at: null, workspace_id: 'ws-1' }, error: null } })
    const { client: admin } = fakeClient({ minutes: { data: [], error: null } })
    createServerClient.mockResolvedValue(client)
    adminMocks.createAdminClient.mockReturnValue(admin)
    const r = await resetMinuteExternalId('m1')
    expect(r.ok).toBe(false)
  })
  it('소유자면 external_id 를 null 로 갱신 성공', async () => {
    const { client } = fakeClient({ minutes: { data: { created_by: 'u1', archived_at: null, workspace_id: 'ws-1' }, error: null } })
    const { client: admin, calls } = fakeClient({ minutes: { data: [{ id: 'm1' }], error: null } })
    createServerClient.mockResolvedValue(client)
    adminMocks.createAdminClient.mockReturnValue(admin)
    const r = await resetMinuteExternalId('m1')
    expect(r.ok).toBe(true)
    const updateCall = calls['minutes']!.find(c => c.method === 'update')
    expect((updateCall!.args[0] as Record<string, unknown>).external_id).toBeNull()
  })
})

/* ── 0006 워크스페이스 — 프로젝트 없는 회의록·폴더 가드가 RLS 와 같은 판정 ─────────────────── */

describe('createMinute 프로젝트 미지정 — 워크스페이스(0006)', () => {
  const input = {
    minuteDate: '2026-09-26', teamCode: 'PMO', title: '제목', bodyMd: '본문', meetingId: null, projectId: null,
  } as never
  const rpcOk = () => vi.fn(() => ({
    single: () => Promise.resolve({ data: { minute_id: 'm-new', version_id: 'v1', wiki_rebuild_required: false }, error: null }),
  }))

  it('화면의 워크스페이스(인자)를 p_workspace_id 로 넘기고, 팀 루트도 그 워크스페이스의 미지정 루트에서 찾는다(D26)', async () => {
    // 팀 루트 조회(SP5 B2): kind = team_root 행들을 읽어 팀 code(조인)로 고른다
    const { client, calls } = fakeClient({ minute_folders: { data: [{ id: 'ws1-pmo', name: 'PMO', parent_id: null, created_by: null, project_id: null, workspace_id: 'ws-1', kind: 'team_root', team_id: 't-PMO', team: { code: 'PMO', project_id: null } }], error: null } })
    createServerClient.mockResolvedValue(client)
    const rpc = rpcOk()
    adminMocks.createAdminClient.mockReturnValue({ rpc, from: vi.fn() })
    const r = await createMinute(input, null, undefined, 'ws-1')
    expect(r.ok).toBe(true)
    expect(rpc).toHaveBeenCalledWith('create_minute_with_version', expect.objectContaining({
      p_project_id: null, p_workspace_id: 'ws-1', p_folder_id: 'ws1-pmo',
    }))
    const eqs = calls['minute_folders']!.filter(c => c.method === 'eq').map(c => c.args)
    expect(eqs).toContainEqual(['workspace_id', 'ws-1'])
  })

  it('프로젝트가 있으면 p_workspace_id 는 null — RPC 가 프로젝트에서 얻는다', async () => {
    const { client } = fakeClient({ projects: { data: { id: 'p1' }, error: null }, minute_folders: { data: null, error: null } })
    createServerClient.mockResolvedValue(client)
    const rpc = rpcOk()
    adminMocks.createAdminClient.mockReturnValue({ rpc, from: vi.fn() })
    const r = await createMinute({ ...(input as object), projectId: 'p1' } as never)
    expect(r.ok).toBe(true)
    expect(rpc).toHaveBeenCalledWith('create_minute_with_version', expect.objectContaining({
      p_project_id: 'p1', p_workspace_id: null,
    }))
  })

  it('워크스페이스 인자가 없으면 소속이 둘이어도 거부 — 어느 쪽인지 추측하지 않는다(RPC 미도달)', async () => {
    getActor.mockResolvedValue(makeMemberActor('p1', [], { workspaceRoles: new Map([['ws-1', 'member'], ['ws-2', 'member']]) }))
    createServerClient.mockResolvedValue(fakeClient({}).client)
    const r = await createMinute(input)
    expect(r.ok).toBe(false)
    expect(r.error).toBe('워크스페이스를 지정해야 합니다.')
    expect(adminMocks.createAdminClient).not.toHaveBeenCalled()
  })

  it('그 워크스페이스에 역할이 없으면(조회 전용) 거부 — RPC 미도달', async () => {
    getActor.mockResolvedValue(viewerActor)
    createServerClient.mockResolvedValue(fakeClient({}).client)
    const r = await createMinute(input, null, undefined, 'ws-1')
    expect(r).toMatchObject({ ok: false, error: '권한 없음' })
    expect(adminMocks.createAdminClient).not.toHaveBeenCalled()
  })

  it('다른 워크스페이스의 미지정 폴더를 명시하면 거부 — RPC 미도달', async () => {
    const tree = [{ id: 'ws2-pmo', name: 'PMO', parent_id: null, sort: 0, created_by: null, kind: 'team_root', team_id: 't-PMO', team: { code: 'PMO', project_id: null }, project_id: null, workspace_id: 'ws-2' }]
    createServerClient.mockResolvedValue(fakeClient({ minute_folders: { data: tree, error: null } }).client)
    const r = await createMinute(input, 'ws2-pmo', undefined, 'ws-1')
    expect(r).toMatchObject({ ok: false, error: '다른 워크스페이스 폴더로는 이동할 수 없습니다.' })
    expect(adminMocks.createAdminClient).not.toHaveBeenCalled()
  })
})

describe('폴더 가드 — RLS(0006)와 같은 워크스페이스 판정', () => {
  const W2_TREE = [
    { id: 'w2-root', name: 'PMO', parent_id: null, sort: 0, created_by: null, kind: 'team_root', team_id: 't-PMO', team: { code: 'PMO', project_id: null }, project_id: null, workspace_id: 'ws-2' },
    { id: 'w2-sub', name: '남의폴더', parent_id: 'w2-root', sort: 100, created_by: 'other', project_id: null, workspace_id: 'ws-2' },
  ]

  it('create: 워크스페이스에 역할이 없으면(조회 전용) 부모가 있어도 거부 — insert 미도달', async () => {
    getActor.mockResolvedValue(viewerActor)
    const { client, calls } = fakeClient({ minute_folders: { data: seedFolders, error: null } })
    createServerClient.mockResolvedValue(client)
    const r = await createMinuteFolder('ws-1', '하위', 'f1')
    expect(r).toMatchObject({ ok: false, error: '권한 없음' })
    expect(calls['minute_folders']!.some(c => c.method === 'insert')).toBe(false)
  })

  it('create: 다른 워크스페이스 프로젝트의 명단 권한으로는 이 워크스페이스 폴더를 못 만든다', async () => {
    // memberActor 는 ws-1 의 p1 멤버 — 부모는 ws-2. 그 화면(ws-2)은 비소속이라 존재 은닉(D26), ws-1 화면이면 부모 행이 다른 워크스페이스
    const { client, calls } = fakeClient({ minute_folders: { data: W2_TREE, error: null } })
    createServerClient.mockResolvedValue(client)
    const r = await createMinuteFolder('ws-2', '하위', 'w2-root')
    expect(r).toMatchObject({ ok: false, error: '대상을 찾을 수 없습니다.' })
    expect(calls['minute_folders']).toBeUndefined()
    expect(await createMinuteFolder('ws-1', '하위', 'w2-root')).toMatchObject({ ok: false, error: '대상을 찾을 수 없습니다.' })
    expect(calls['minute_folders']!.some(c => c.method === 'insert')).toBe(false)
  })

  it('create: 워크스페이스 관리자는 명단 행 없이도 만든다', async () => {
    getActor.mockResolvedValue(makeActor({ workspaceRoles: new Map([['ws-2', 'admin']]) }))
    const { client, calls } = fakeClient({ minute_folders: { data: W2_TREE, error: null } })
    createServerClient.mockResolvedValue(client)
    const r = await createMinuteFolder('ws-2', '하위', 'w2-root')
    expect(r.ok).toBe(true)
    expect(calls['minute_folders']!.some(c => c.method === 'insert')).toBe(true)
  })

  it('delete: 남의 폴더는 그 워크스페이스 관리자만 — 명단 admin 행이나 다른 워크스페이스 관리자는 승격 전에 거절', async () => {
    for (const actor of [
      makeAdminActor('p1'),                                                   // ws-1 의 명단 admin
      makeActor({ workspaceRoles: new Map([['ws-1', 'admin']]) }),            // 다른 워크스페이스 관리자
    ]) {
      getActor.mockResolvedValue(actor)
      createServerClient.mockResolvedValue(fakeClient({ minute_folders: { data: W2_TREE, error: null } }).client)
      const r = await deleteMinuteFolder('ws-2', 'w2-sub')
      expect(r.ok).toBe(false)
      expect(adminMocks.createAdminClient).not.toHaveBeenCalled()
    }
  })

  it('delete: 그 워크스페이스 관리자는 남의 폴더도 지운다', async () => {
    getActor.mockResolvedValue(makeActor({ workspaceRoles: new Map([['ws-2', 'admin']]) }))
    createServerClient.mockResolvedValue(fakeClient({ minute_folders: { data: W2_TREE, error: null } }).client)
    adminMocks.createAdminClient.mockReturnValue(fakeClient({
      minute_folders: { data: [], error: null }, minutes: { data: [], error: null },
    }).client)
    // 마지막 delete 는 세션 클라이언트 — W2_TREE 가 곧 1행 이상 응답이라 성공으로 판정된다
    expect((await deleteMinuteFolder('ws-2', 'w2-sub')).ok).toBe(true)
  })
})

describe('프로젝트 없는 회의록의 폴더 이동 — 워크스페이스 경계(0006)', () => {
  // 메타 RPC·raw update·minutes 트리거는 폴더 워크스페이스를 보지 않는다 — 액션 가드가 유일한 관문이다.
  const W2_TREE = [
    { id: 'w2-root', name: 'ERP', parent_id: null, sort: 1, created_by: null, kind: 'team_root', team_id: 't-ERP', team: { code: 'ERP', project_id: null }, project_id: null, workspace_id: 'ws-2' },
    { id: 'w2-sub', name: '물류', parent_id: 'w2-root', sort: 1, created_by: 'u1', project_id: null, workspace_id: 'ws-2' },
  ]
  const patch = { minuteDate: '2026-09-26', teamCode: 'ERP' as const, title: '제목', meetingId: null }
  // W1·W2 양쪽 프로젝트에 명단 역할 — 같은 워크스페이스 폴더로의 이동이 범위 판정(isMinuteMember)을 통과한다.
  const twoWorkspaceActor = makeActor({
    workspaceRoles: new Map([['ws-1', 'member'], ['ws-2', 'member']]),
    projectWorkspace: new Map([['p1', 'ws-1'], ['p2', 'ws-2']]),
    projectRoles: new Map([['p1', 'member'], ['p2', 'member']]),
  })

  it('updateMinuteMeta: W1 회의록을 W2 폴더로 옮기려 하면 거부 — RPC 미도달', async () => {
    createServerClient.mockResolvedValue(fakeClient({
      minutes: { data: { created_by: 'u1', archived_at: null, project_id: null, workspace_id: 'ws-1' }, error: null },
      minute_folders: { data: W2_TREE, error: null },
    }).client)
    const r = await updateMinuteMeta('m1', patch, 'w2-sub')
    expect(r).toMatchObject({ ok: false, error: '다른 워크스페이스 폴더로는 이동할 수 없습니다.' })
    expect(adminMocks.createAdminClient).not.toHaveBeenCalled()
  })

  it('updateMinuteMeta: 같은 워크스페이스 폴더면 통과', async () => {
    getActor.mockResolvedValue(twoWorkspaceActor)
    createServerClient.mockResolvedValue(fakeClient({
      minutes: { data: { created_by: 'u1', archived_at: null, project_id: null, workspace_id: 'ws-2' }, error: null },
      minute_folders: { data: W2_TREE, error: null },
    }).client)
    const { client: admin, rpc } = fakeMetadataAdmin()
    adminMocks.createAdminClient.mockReturnValue(admin)
    const r = await updateMinuteMeta('m1', patch, 'w2-sub')
    expect(r.ok).toBe(true)
    expect(rpc).toHaveBeenCalledWith('update_minute_metadata_with_wiki_retraction',
      expect.objectContaining({ p_metadata: expect.objectContaining({ folder_id: 'w2-sub' }) }))
  })

  it('updateMinuteMeta: 회의록 워크스페이스를 못 읽으면 중단(fail-closed) — RPC 미도달', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    createServerClient.mockResolvedValue(fakeClient({
      minutes: { data: { created_by: 'u1', archived_at: null, project_id: null }, error: null },
      minute_folders: { data: W2_TREE, error: null },
    }).client)
    const r = await updateMinuteMeta('m1', patch, 'w2-sub')
    // 범위는 resolveScope 가 확정한다 — 워크스페이스를 못 얻으면 판정 불가(ERR_LOOKUP)로 중단한다.
    expect(r).toMatchObject({ ok: false, error: '권한을 확인할 수 없어 중단했습니다.' })
    expect(adminMocks.createAdminClient).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('createMinute: RPC 의 MINUTE_FOLDER_WORKSPACE_MISMATCH(0006:606)는 사용자 문구로 매핑 — 영문 상수 노출 금지', async () => {
    createServerClient.mockResolvedValue(fakeClient({ minute_folders: { data: [{ id: 'ws1-pmo', name: 'PMO', parent_id: null, created_by: null, project_id: null, workspace_id: 'ws-1', kind: 'team_root', team_id: 't-PMO', team: { code: 'PMO', project_id: null } }], error: null } }).client)
    const rpc = vi.fn(() => ({
      single: () => Promise.resolve({ data: null, error: { message: 'MINUTE_FOLDER_WORKSPACE_MISMATCH' } }),
    }))
    adminMocks.createAdminClient.mockReturnValue({ rpc, from: vi.fn() })
    const r = await createMinute({
      minuteDate: '2026-09-26', teamCode: 'PMO', title: '제목', bodyMd: '본문', meetingId: null, projectId: null,
    } as never, null, undefined, 'ws-1')
    expect(r).toMatchObject({ ok: false, error: '다른 워크스페이스 폴더로는 이동할 수 없습니다.' })
  })

  it('moveMinuteToFolder: W1 회의록을 W2 폴더로 옮기려 하면 거부 — update·RPC 미도달', async () => {
    const { client, calls } = fakeClient({
      minute_folders: { data: W2_TREE, error: null },
      minutes: { data: { id: 'm1', created_by: 'u1', team_code: 'ERP', project_id: null, workspace_id: 'ws-1' }, error: null },
    })
    createServerClient.mockResolvedValue(client)
    const r = await moveMinuteToFolder('m1', 'w2-sub')
    expect(r).toMatchObject({ ok: false, error: '다른 워크스페이스 폴더로는 이동할 수 없습니다.' })
    expect(calls['minutes']!.some(c => c.method === 'update')).toBe(false)
    expect(adminMocks.createAdminClient).not.toHaveBeenCalled()
  })

  it('moveMinuteToFolder: 같은 워크스페이스 폴더면 통과', async () => {
    getActor.mockResolvedValue(twoWorkspaceActor)
    createServerClient.mockResolvedValue(fakeClient({
      minute_folders: { data: W2_TREE, error: null },
      minutes: { data: { id: 'm1', created_by: 'u1', team_code: 'ERP', project_id: null, workspace_id: 'ws-2' }, error: null },
    }).client)
    adminMocks.createAdminClient.mockReturnValue(fakeClient({ minutes: { data: [{ id: 'm1' }], error: null } }).client)
    expect((await moveMinuteToFolder('m1', 'w2-sub')).ok).toBe(true)
  })
})

/* ── 팀 없는 회의록(0052) — 빈 팀 코드 ─────────────────────────────────────── */
describe('팀 없는 회의록(0052)', () => {
  const noTeamInput = {
    minuteDate: '2026-10-09', teamCode: '', title: '팀 없는 회의', bodyMd: '본문', meetingId: null, projectId: null,
  } as never
  const rpcCreateOk = () => vi.fn(() => ({
    single: () => Promise.resolve({ data: { minute_id: 'm-new', version_id: 'v1', wiki_rebuild_required: false }, error: null }),
  }))
  const TEAM_ROOT = { id: 'r-pmo', name: 'PMO', parent_id: null, sort: 0, created_by: null, kind: 'team_root', team_id: 't-PMO', team: { code: 'PMO', project_id: null }, project_id: null, workspace_id: 'ws-1' }
  const TEAM_SUB = { id: 'r-pmo-sub', name: '하위', parent_id: 'r-pmo', sort: 1, created_by: 'u1', project_id: null, workspace_id: 'ws-1' }
  const CUSTOM_ROOT = { id: 'c-root', name: '정례', parent_id: null, sort: 0, created_by: null, kind: 'custom_root', project_id: null, workspace_id: 'ws-1' }
  const CUSTOM_SUB = { id: 'c-sub', name: '주간', parent_id: 'c-root', sort: 1, created_by: 'u1', project_id: null, workspace_id: 'ws-1' }
  const TREE = [TEAM_ROOT, TEAM_SUB, CUSTOM_ROOT, CUSTOM_SUB]
  const patch = { minuteDate: '2026-10-09', teamCode: '', title: '제목', meetingId: null } as never

  describe('createMinute', () => {
    it('빈 팀 코드로 만든다 — p_team_code 빈 값, 폴더는 미분류(팀 루트 자동 편철을 찾지 않는다)', async () => {
      const { client, calls } = fakeClient({ minute_folders: { data: [TEAM_ROOT], error: null } })
      createServerClient.mockResolvedValue(client)
      const rpc = rpcCreateOk()
      adminMocks.createAdminClient.mockReturnValue({ rpc, from: vi.fn() })
      const r = await createMinute(noTeamInput, null, undefined, 'ws-1')
      expect(r.ok).toBe(true)
      expect(rpc).toHaveBeenCalledWith('create_minute_with_version', expect.objectContaining({
        p_team_code: '', p_folder_id: null, p_workspace_id: 'ws-1',
      }))
      expect(calls['minute_folders']).toBeUndefined()   // 팀 루트를 찾으러 가지 않았다
    })
    it('가드가 먼저다 — 미로그인·조회 전용은 빈 팀 코드여도 거부되고 RPC 에 닿지 않는다', async () => {
      createServerClient.mockResolvedValue(fakeClient({}).client)
      getActor.mockResolvedValue(null)
      expect(await createMinute(noTeamInput, null, undefined, 'ws-1')).toMatchObject({ ok: false, error: '로그인 필요' })
      getActor.mockResolvedValue(viewerActor)
      expect(await createMinute(noTeamInput, null, undefined, 'ws-1')).toMatchObject({ ok: false, error: '권한 없음' })
      expect(adminMocks.createAdminClient).not.toHaveBeenCalled()
    })
    it('값이 있는 틀린 팀 코드·공백뿐인 값은 지금처럼 거부 — 팀 없음으로 삼키지 않는다(RPC 미도달)', async () => {
      createServerClient.mockResolvedValue(fakeClient({}).client)
      for (const teamCode of ['NOPE', ' ']) {
        const r = await createMinute({ ...(noTeamInput as object), teamCode } as never, null, undefined, 'ws-1')
        expect(r, teamCode).toMatchObject({ ok: false, error: '잘못된 담당입니다.' })
      }
      expect(adminMocks.createAdminClient).not.toHaveBeenCalled()
    })
    it('팀 루트 아래 폴더를 고르면 빈 팀 코드를 보냈어도 그 팀이다(폴더가 팀의 출처)', async () => {
      createServerClient.mockResolvedValue(fakeClient({ minute_folders: { data: TREE, error: null } }).client)
      const rpc = rpcCreateOk()
      adminMocks.createAdminClient.mockReturnValue({ rpc, from: vi.fn() })
      expect((await createMinute(noTeamInput, 'r-pmo-sub', undefined, 'ws-1')).ok).toBe(true)
      expect(rpc).toHaveBeenCalledWith('create_minute_with_version', expect.objectContaining({ p_team_code: 'PMO', p_folder_id: 'r-pmo-sub' }))
    })
    it('지정 루트(custom_root) 아래 폴더에는 팀 없이 편철한다 — 팀을 보냈으면 그 팀 그대로(폴더가 팀을 정하지 않는다)', async () => {
      createServerClient.mockResolvedValue(fakeClient({ minute_folders: { data: TREE, error: null } }).client)
      const rpc = rpcCreateOk()
      adminMocks.createAdminClient.mockReturnValue({ rpc, from: vi.fn() })
      expect((await createMinute(noTeamInput, 'c-sub', undefined, 'ws-1')).ok).toBe(true)
      expect(rpc).toHaveBeenLastCalledWith('create_minute_with_version', expect.objectContaining({ p_team_code: '', p_folder_id: 'c-sub' }))
      expect((await createMinute({ ...(noTeamInput as object), teamCode: 'ERP' } as never, 'c-sub', undefined, 'ws-1')).ok).toBe(true)
      expect(rpc).toHaveBeenLastCalledWith('create_minute_with_version', expect.objectContaining({ p_team_code: 'ERP', p_folder_id: 'c-sub' }))
    })
  })

  describe('updateMinuteMeta', () => {
    const OWN = { created_by: 'u1', archived_at: null, project_id: null, workspace_id: 'ws-1', folder_id: 'r-pmo-sub' }
    it('팀 해제 — 빈 팀 코드와 폴더 null 을 메타 RPC 로 보낸다', async () => {
      createServerClient.mockResolvedValue(fakeClient({ minutes: { data: OWN, error: null } }).client)
      const { client: admin, rpc } = fakeMetadataAdmin()
      adminMocks.createAdminClient.mockReturnValue(admin)
      expect((await updateMinuteMeta('m1', patch, null)).ok).toBe(true)
      expect(rpc).toHaveBeenCalledWith('update_minute_metadata_with_wiki_retraction', expect.objectContaining({
        p_minute_id: 'm1', p_metadata: expect.objectContaining({ team_code: '', folder_id: null }),
      }))
    })
    it('팀 없는 회의록의 제목만 고쳐도 통과한다(폴더 무접촉 — folder_id 키 없음)', async () => {
      createServerClient.mockResolvedValue(fakeClient({ minutes: { data: { ...OWN, folder_id: null }, error: null } }).client)
      const { client: admin, rpc } = fakeMetadataAdmin()
      adminMocks.createAdminClient.mockReturnValue(admin)
      expect((await updateMinuteMeta('m1', patch)).ok).toBe(true)
      const meta = (rpc.mock.calls[0][1] as { p_metadata: Record<string, unknown> }).p_metadata
      expect(meta.team_code).toBe('')
      expect('folder_id' in meta).toBe(false)
    })
    it('재지정 — 팀 루트 아래 폴더로 옮기면 그 팀이 된다', async () => {
      createServerClient.mockResolvedValue(fakeClient({
        minutes: { data: { ...OWN, folder_id: null }, error: null }, minute_folders: { data: TREE, error: null },
      }).client)
      const { client: admin, rpc } = fakeMetadataAdmin()
      adminMocks.createAdminClient.mockReturnValue(admin)
      expect((await updateMinuteMeta('m1', patch, 'r-pmo')).ok).toBe(true)
      expect(rpc).toHaveBeenCalledWith('update_minute_metadata_with_wiki_retraction', expect.objectContaining({
        p_metadata: expect.objectContaining({ team_code: 'PMO', folder_id: 'r-pmo' }),
      }))
    })
    it('지정 루트 아래 폴더로 옮기면 팀은 보낸 값 그대로(팀 없음 포함)', async () => {
      createServerClient.mockResolvedValue(fakeClient({
        minutes: { data: OWN, error: null }, minute_folders: { data: TREE, error: null },
      }).client)
      const { client: admin, rpc } = fakeMetadataAdmin()
      adminMocks.createAdminClient.mockReturnValue(admin)
      expect((await updateMinuteMeta('m1', patch, 'c-sub')).ok).toBe(true)
      expect(rpc).toHaveBeenCalledWith('update_minute_metadata_with_wiki_retraction', expect.objectContaining({
        p_metadata: expect.objectContaining({ team_code: '', folder_id: 'c-sub' }),
      }))
    })
    it('소유권 가드가 먼저다 — 남의 회의록은 빈 팀 코드여도 거부(RPC 미도달). 틀린 팀 코드는 지금처럼 거부', async () => {
      createServerClient.mockResolvedValue(fakeClient({ minutes: { data: { ...OWN, created_by: 'someone-else' }, error: null } }).client)
      expect((await updateMinuteMeta('m1', patch, null)).ok).toBe(false)
      createServerClient.mockResolvedValue(fakeClient({ minutes: { data: OWN, error: null } }).client)
      expect(await updateMinuteMeta('m1', { ...(patch as object), teamCode: 'NOPE' } as never)).toMatchObject({ ok: false, error: '잘못된 담당입니다.' })
      expect(adminMocks.createAdminClient).not.toHaveBeenCalled()
    })
  })

  describe('moveMinuteToFolder — 팀 루트 ↔ 미분류', () => {
    const own = (extra: Record<string, unknown>) => ({ id: 'm1', created_by: 'u1', archived_at: null, project_id: null, workspace_id: 'ws-1', ...extra })
    it('팀 루트 아래 → 미분류: 팀을 해제한다(메타 RPC — 색인이 따라온다)', async () => {
      createServerClient.mockResolvedValue(fakeClient({
        minutes: { data: own({ team_code: 'PMO', folder_id: 'r-pmo-sub' }), error: null }, minute_folders: { data: TREE, error: null },
      }).client)
      const { client: admin, rpc } = fakeMetadataAdmin()
      adminMocks.createAdminClient.mockReturnValue(admin)
      expect((await moveMinuteToFolder('m1', null)).ok).toBe(true)
      expect(rpc).toHaveBeenCalledWith('update_minute_metadata_with_wiki_retraction', {
        p_minute_id: 'm1', p_metadata: { team_code: '', folder_id: null },
      })
    })
    it('미분류(팀 없음) → 팀 루트 아래: 그 팀으로 지정한다', async () => {
      createServerClient.mockResolvedValue(fakeClient({
        minutes: { data: own({ team_code: '', folder_id: null }), error: null }, minute_folders: { data: TREE, error: null },
      }).client)
      const { client: admin, rpc } = fakeMetadataAdmin()
      adminMocks.createAdminClient.mockReturnValue(admin)
      expect((await moveMinuteToFolder('m1', 'r-pmo-sub')).ok).toBe(true)
      expect(rpc).toHaveBeenCalledWith('update_minute_metadata_with_wiki_retraction', {
        p_minute_id: 'm1', p_metadata: { team_code: 'PMO', folder_id: 'r-pmo-sub' },
      })
    })
    it('지정 루트 아래 ↔ 미분류·지정 루트로의 이동은 팀을 건드리지 않는다(raw update — 메타 RPC 미경유)', async () => {
      for (const [row, target] of [
        [own({ team_code: 'PMO', folder_id: 'c-sub' }), null],       // 지정 루트 아래 → 미분류: 팀 유지
        [own({ team_code: 'PMO', folder_id: null }), 'c-sub'],       // 미분류 → 지정 루트 아래: 팀 유지
        [own({ team_code: '', folder_id: null }), 'c-sub'],          // 팀 없는 회의록을 지정 루트 아래로
        [own({ team_code: 'PMO', folder_id: null }), null],          // 이미 미분류 — 해제하지 않는다
      ] as const) {
        adminMocks.createAdminClient.mockReset()
        createServerClient.mockResolvedValue(fakeClient({ minutes: { data: row, error: null }, minute_folders: { data: TREE, error: null } }).client)
        const { client: admin, calls } = fakeClient({ minutes: { data: [{ id: 'm1' }], error: null } })
        const rpc = vi.fn()
        adminMocks.createAdminClient.mockReturnValue({ ...admin, rpc })
        expect((await moveMinuteToFolder('m1', target)).ok, JSON.stringify([row, target])).toBe(true)
        expect(rpc).not.toHaveBeenCalled()
        expect(calls['minutes']!.find(c => c.method === 'update')!.args[0]).toMatchObject({ folder_id: target })
      }
    })
    it('미분류로 뺄 때 지금 폴더를 못 읽으면 중단한다 — 해제 여부를 추측하지 않는다(쓰기 미도달)', async () => {
      createServerClient.mockResolvedValue(fakeClient({
        minutes: { data: own({ team_code: 'PMO', folder_id: 'r-pmo-sub' }), error: null },
        minute_folders: { data: null, error: { message: 'boom' } },
      }).client)
      const r = await moveMinuteToFolder('m1', null)
      expect(r).toMatchObject({ ok: false, error: '폴더 목록을 불러오지 못했습니다.' })
      expect(adminMocks.createAdminClient).not.toHaveBeenCalled()
    })
    it('남의 회의록은 팀 해제 이동도 거부된다(소유권 가드 — 쓰기 미도달)', async () => {
      createServerClient.mockResolvedValue(fakeClient({
        minutes: { data: own({ created_by: 'someone-else', team_code: 'PMO', folder_id: 'r-pmo-sub' }), error: null },
        minute_folders: { data: TREE, error: null },
      }).client)
      expect((await moveMinuteToFolder('m1', null)).ok).toBe(false)
      expect(adminMocks.createAdminClient).not.toHaveBeenCalled()
    })
  })
})
