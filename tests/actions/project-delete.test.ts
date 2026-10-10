// 프로젝트 삭제 액션(BUG-18) — getProjectDeleteSummary·deleteProject.
// 순서: 범위 확인(resolveScope) → 가드(requireWorkspaceAdmin) → 사전 조회(실패면 중단) → delete_project RPC → 저장소 정리 → 캐시 무효화.
// RPC 의 사유 토큰 → 응답 코드, 회의록 차단, 저장소 정리 실패 시 남은 파일 수를 본다. DB 쪽 규칙은 tests/rls/project-delete.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireWorkspaceAdmin: vi.fn(), resolveScope: vi.fn(), adminFor: vi.fn(), revalidatePath: vi.fn(),
}))
vi.mock('@/lib/authz', () => ({ requireWorkspaceAdmin: mocks.requireWorkspaceAdmin, resolveScope: mocks.resolveScope }))
vi.mock('@/lib/supabase/adminFor', () => ({ adminFor: mocks.adminFor }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))

import { deleteProject, getProjectDeleteSummary } from '@/app/actions/projectDelete'
import { ERR_DENIED, ERR_LOOKUP, ERR_MISSING } from '@/lib/authz/errors'

const P = '00000000-0000-4000-8000-000000000001'
const W = '00000000-0000-4000-8000-0000000000aa'
const ACTOR = 'u-ws-admin'
const PREFIX = `ws/${W}/p/${P}/`
const COUNTS = {
  wbs_items: 3, issues: 2, weekly_reports: 1, meetings: 0, wiki_items: 0, wiki_topics: 0, announcements: 0, attendance_records: 0,
  project_members: 4, teams: 1, form_templates: 0, attachments: 5,
}
const SUMMARY = { minutes: 0, minutes_archived: 0, removed: COUNTS }
const NO_REFS = { deliverables: 0, 'issue-attachments': 0, minutes: 0, 'form-templates': 0 }
const DELETED = { status: 'deleted', project_id: P, workspace_id: W, name: '버릴 프로젝트', removed: COUNTS, credentials: 0, storage_prefix: PREFIX, referenced: NO_REFS }

type RpcResult = { data?: unknown; error?: { message: string; code?: string } | null }
type Entry = { name: string; id: string | null }
/** 가짜 저장소 — 버킷 → 폴더 경로 → 항목. list·remove 호출을 남긴다 */
function fakeStorage(tree: Record<string, Record<string, Entry[]>>, opts: { listFail?: string[]; removeFail?: string[]; removeShort?: string[] } = {}) {
  const lists: string[] = []
  const removes: { bucket: string; paths: string[] }[] = []
  const storage = {
    from: (bucket: string) => ({
      list: (path: string, o: { limit: number; offset: number }) => {
        lists.push(`${bucket}:${path}`)
        if (opts.listFail?.includes(bucket)) return Promise.resolve({ data: null, error: { message: 'storage down' } })
        return Promise.resolve({ data: (tree[bucket]?.[path] ?? []).slice(o.offset, o.offset + o.limit), error: null })
      },
      remove: (paths: string[]) => {
        removes.push({ bucket, paths })
        if (opts.removeFail?.includes(bucket)) return Promise.resolve({ data: null, error: { message: 'remove failed' } })
        // removeShort — 하나를 빼고 지웠다고 답한다(응답 목록에 없는 것은 남은 것이다)
        return Promise.resolve({ data: (opts.removeShort?.includes(bucket) ? paths.slice(1) : paths).map((name) => ({ name })), error: null })
      },
    }),
  }
  return { storage, lists, removes }
}
function fakeAdmin(respond: (name: string, args: Record<string, unknown>) => RpcResult, storage = fakeStorage({}).storage) {
  const calls: { name: string; args: Record<string, unknown> }[] = []
  const admin = {
    rpc: (name: string, args: Record<string, unknown>) => { calls.push({ name, args }); return Promise.resolve({ data: null, error: null, ...respond(name, args) }) },
    storage,
    from: () => { throw new Error('표를 직접 만지지 않는다') },
  }
  mocks.adminFor.mockReturnValue({ workspaceId: W, admin })
  return { calls }
}
const happy = (over: (name: string) => RpcResult | undefined = () => undefined) => (name: string): RpcResult =>
  over(name) ?? (name === 'project_delete_summary' ? { data: SUMMARY } : { data: DELETED })

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})
  mocks.resolveScope.mockResolvedValue({ ok: true, projectId: P, workspaceId: W })
  mocks.requireWorkspaceAdmin.mockResolvedValue({ ok: true, actor: { userId: ACTOR, isSuperuser: false } })
})

describe('가드 — 워크스페이스 관리자만', () => {
  it('프로젝트의 워크스페이스를 읽어 그 워크스페이스의 관리자 가드에 넘긴다', async () => {
    fakeAdmin(happy())
    await deleteProject(P, '버릴 프로젝트')
    expect(mocks.resolveScope).toHaveBeenCalledWith('projects', P)
    expect(mocks.requireWorkspaceAdmin).toHaveBeenCalledWith(W)
    expect(mocks.adminFor).toHaveBeenCalledWith({ workspaceId: W })
  })
  it('가드가 거부하면 service_role 클라이언트를 만들지 않는다 — 삭제·사전 조회 둘 다', async () => {
    mocks.requireWorkspaceAdmin.mockResolvedValue({ ok: false, error: ERR_DENIED })
    expect(await deleteProject(P, '버릴 프로젝트')).toEqual({ ok: false, code: 'denied', error: ERR_DENIED })
    expect(await getProjectDeleteSummary(P)).toEqual({ ok: false, code: 'denied', error: ERR_DENIED })
    expect(mocks.adminFor).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })
  it('프로젝트를 찾지 못하면(다른 워크스페이스·없는 id) not_found, 범위 조회가 실패하면 lookup_failed — 가드에 닿기 전에 멈춘다', async () => {
    mocks.resolveScope.mockResolvedValue({ ok: false, error: ERR_MISSING })
    expect(await deleteProject(P, 'x')).toMatchObject({ ok: false, code: 'not_found' })
    mocks.resolveScope.mockResolvedValue({ ok: false, error: ERR_LOOKUP })
    expect(await deleteProject(P, 'x')).toMatchObject({ ok: false, code: 'lookup_failed' })
    expect(await getProjectDeleteSummary(P)).toMatchObject({ ok: false, code: 'lookup_failed' })
    expect(mocks.requireWorkspaceAdmin).not.toHaveBeenCalled()
    expect(mocks.adminFor).not.toHaveBeenCalled()
  })
  it('id 가 uuid 가 아니면 DB 에 묻지 않는다', async () => {
    expect(await deleteProject('nope', 'x')).toMatchObject({ ok: false, code: 'not_found' })
    expect(await getProjectDeleteSummary('nope')).toMatchObject({ ok: false, code: 'not_found' })
    expect(mocks.resolveScope).not.toHaveBeenCalled()
  })
})

describe('getProjectDeleteSummary', () => {
  it('건수와 회의록 수를 돌려준다', async () => {
    const { calls } = fakeAdmin(() => ({ data: { minutes: 3, minutes_archived: 1, removed: COUNTS } }))
    expect(await getProjectDeleteSummary(P)).toEqual({ ok: true, minutes: 3, minutesArchived: 1, counts: COUNTS })
    expect(calls).toEqual([{ name: 'project_delete_summary', args: { p_project_id: P } }])
  })
  it('조회 실패·읽지 못한 모양은 실패다 — "0건"으로 위장하지 않는다', async () => {
    fakeAdmin(() => ({ error: { message: 'boom', code: 'XX000' } }))
    expect(await getProjectDeleteSummary(P)).toMatchObject({ ok: false, code: 'lookup_failed' })
    for (const data of [null, {}, { minutes: 0, minutes_archived: 0 }, { minutes: '0', minutes_archived: 0, removed: COUNTS },
      { minutes: 0, minutes_archived: 0, removed: { ...COUNTS, issues: undefined } }, { minutes: 1, minutes_archived: 2, removed: COUNTS }]) {
      fakeAdmin(() => ({ data }))
      expect(await getProjectDeleteSummary(P), JSON.stringify(data)).toMatchObject({ ok: false, code: 'lookup_failed' })
    }
  })
})

describe('deleteProject — 사전 조회와 회의록 차단', () => {
  it('사전 조회가 실패하면 중단한다 — 삭제 RPC 를 부르지 않는다', async () => {
    const { calls } = fakeAdmin(happy((n) => (n === 'project_delete_summary' ? { error: { message: 'boom' } } : undefined)))
    expect(await deleteProject(P, '버릴 프로젝트')).toMatchObject({ ok: false, code: 'lookup_failed' })
    expect(calls.map((c) => c.name)).toEqual(['project_delete_summary'])
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })
  it('회의록이 있으면 삭제 RPC 를 부르지 않고 건수를 돌려준다(보관된 것 포함)', async () => {
    const { calls } = fakeAdmin(happy((n) => (n === 'project_delete_summary' ? { data: { ...SUMMARY, minutes: 4, minutes_archived: 1 } } : undefined)))
    const r = await deleteProject(P, '버릴 프로젝트')
    expect(r).toMatchObject({ ok: false, code: 'has_minutes', minutes: 4, minutesArchived: 1 })
    expect((r as { error: string }).error).toContain('4')
    expect(calls.map((c) => c.name)).toEqual(['project_delete_summary'])
  })
  it('사전 조회 뒤에 회의록이 생기면 RPC 의 거부(blocked)를 그대로 알린다', async () => {
    fakeAdmin(happy((n) => (n === 'delete_project' ? { data: { status: 'blocked', reason: 'minutes', minutes: 1, minutes_archived: 0, name: 'x' } } : undefined)))
    expect(await deleteProject(P, '버릴 프로젝트')).toMatchObject({ ok: false, code: 'has_minutes', minutes: 1, minutesArchived: 0 })
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })
  it('이름이 비면 DB 에 묻지 않는다', async () => {
    const { calls } = fakeAdmin(happy())
    expect(await deleteProject(P, '   ')).toMatchObject({ ok: false, code: 'name_mismatch' })
    expect(calls).toEqual([])
  })
})

describe('deleteProject — RPC', () => {
  it('정상 — RPC 한 번, 행위자는 가드 결과의 userId, 적은 이름은 그대로 넘긴다. 레이아웃 데이터를 새로 읽게 한다', async () => {
    const { calls } = fakeAdmin(happy())
    expect(await deleteProject(P, ' 버릴 프로젝트 ')).toEqual({ ok: true, name: '버릴 프로젝트', removed: COUNTS, orphanedFiles: 0, filesUnchecked: false })
    expect(calls[1]).toEqual({ name: 'delete_project', args: { p_actor: ACTOR, p_project_id: P, p_expected_name: ' 버릴 프로젝트 ' } })
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/', 'layout')
  })
  it.each([
    ['PROJECT_NAME_MISMATCH', '22023', 'name_mismatch'],
    ['PROJECT_NOT_FOUND', 'P0002', 'not_found'],
    ['AUTHZ_FORBIDDEN', '42501', 'denied'],
    ['PROJECT_DELETE_CREDENTIAL_BLOCKED', '23514', 'credential_blocked'],
    ['PROJECT_DELETE_UNKNOWN_REFERENCE', '0A000', 'delete_failed'],
    ['PROJECT_DELETE_REFERENCED', '23503', 'delete_failed'],
    ['canceling statement due to lock timeout', '55P03', 'delete_failed'],
  ])('RPC 오류 %s(%s) → %s — 원문은 응답에 싣지 않는다', async (message, code, expected) => {
    fakeAdmin(happy((n) => (n === 'delete_project' ? { error: { message, code } } : undefined)))
    const r = await deleteProject(P, '버릴 프로젝트')
    expect(r).toMatchObject({ ok: false, code: expected })
    expect((r as { error: string }).error).not.toContain(message)
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })
  it('성공인데 결과를 읽지 못하면 성공이라 하지 않는다', async () => {
    for (const data of [null, { status: 'deleted' }, { ...DELETED, removed: { wbs_items: 1 } }, { ...DELETED, name: undefined }, { status: 'blocked' }]) {
      fakeAdmin(happy((n) => (n === 'delete_project' ? { data } : undefined)))
      expect(await deleteProject(P, '버릴 프로젝트'), JSON.stringify(data)).toMatchObject({ ok: false, code: 'delete_failed' })
    }
  })
})

describe('deleteProject — 저장소 정리', () => {
  const dir = PREFIX.slice(0, -1)
  const tree = {
    deliverables: {
      [dir]: [{ name: 'deliverables', id: null }],
      [`${dir}/deliverables`]: [{ name: 'item-1', id: null }],
      [`${dir}/deliverables/item-1`]: [{ name: 'a.pdf', id: 'o1' }, { name: 'b.pdf', id: 'o2' }],
    },
    'issue-attachments': {
      [dir]: [{ name: 'issue-attachments', id: null }],
      [`${dir}/issue-attachments`]: [{ name: 'issue-1', id: null }],
      [`${dir}/issue-attachments/issue-1`]: [{ name: 'c.png', id: 'o3' }],
    },
    'form-templates': { [dir]: [{ name: 'wbs_export_xlsx', id: null }], [`${dir}/wbs_export_xlsx`]: [{ name: 'v1.xlsx', id: 'o4' }] },
    minutes: { [dir]: [{ name: 'minute-files', id: null }], [`${dir}/minute-files`]: [{ name: 'm1', id: null }], [`${dir}/minute-files/m1`]: [{ name: 'f.txt', id: 'o5' }] },
  }
  it('네 버킷의 접두 아래 파일을 폴더마다 내려가 지운다', async () => {
    const s = fakeStorage(tree)
    fakeAdmin(happy(), s.storage)
    expect(await deleteProject(P, '버릴 프로젝트')).toMatchObject({ ok: true, orphanedFiles: 0, filesUnchecked: false })
    expect(s.removes).toEqual([
      { bucket: 'deliverables', paths: [`${dir}/deliverables/item-1/a.pdf`, `${dir}/deliverables/item-1/b.pdf`] },
      { bucket: 'issue-attachments', paths: [`${dir}/issue-attachments/issue-1/c.png`] },
      { bucket: 'minutes', paths: [`${dir}/minute-files/m1/f.txt`] },
      { bucket: 'form-templates', paths: [`${dir}/wbs_export_xlsx/v1.xlsx`] },
    ])
    // 접두 밖은 나열하지 않는다
    expect(s.lists.every((l) => l.split(':')[1].startsWith(dir))).toBe(true)
  })
  it('삭제 뒤에도 그 접두를 가리키는 행이 남은 버킷은 건드리지 않는다(다른 프로젝트로 옮긴 회의록의 첨부) — 고아로 세지 않는다', async () => {
    const s = fakeStorage(tree)
    fakeAdmin(happy((n) => (n === 'delete_project' ? { data: { ...DELETED, referenced: { ...NO_REFS, minutes: 2 } } } : undefined)), s.storage)
    expect(await deleteProject(P, '버릴 프로젝트')).toMatchObject({ ok: true, orphanedFiles: 0, filesUnchecked: false })
    expect(s.removes.map((r) => r.bucket)).toEqual(['deliverables', 'issue-attachments', 'form-templates'])
    expect(s.lists.some((l) => l.startsWith('minutes:'))).toBe(false)
  })
  it('지우지 못한 파일은 orphanedFiles 로 — 프로젝트는 이미 지워졌으므로 성공이되 숨기지 않는다', async () => {
    const s = fakeStorage(tree, { removeFail: ['deliverables'], removeShort: ['issue-attachments'] })
    fakeAdmin(happy(), s.storage)
    expect(await deleteProject(P, '버릴 프로젝트')).toMatchObject({ ok: true, orphanedFiles: 3, filesUnchecked: false })
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/', 'layout')
    expect(console.error).toHaveBeenCalledWith('[deleteProject] 저장소에 파일이 남았다', expect.objectContaining({ orphanedFiles: 3 }))
  })
  it('나열하지 못한 버킷은 지우지 않고 filesUnchecked 로 알린다', async () => {
    const s = fakeStorage(tree, { listFail: ['form-templates'] })
    fakeAdmin(happy(), s.storage)
    expect(await deleteProject(P, '버릴 프로젝트')).toMatchObject({ ok: true, orphanedFiles: 0, filesUnchecked: true })
    expect(s.removes.map((r) => r.bucket)).toEqual(['deliverables', 'issue-attachments', 'minutes'])
  })
  it('referenced 를 읽지 못하면 어느 버킷도 지우지 않는다(모르면 지우지 않는다)', async () => {
    const s = fakeStorage(tree)
    fakeAdmin(happy((n) => (n === 'delete_project' ? { data: { ...DELETED, referenced: null } } : undefined)), s.storage)
    expect(await deleteProject(P, '버릴 프로젝트')).toMatchObject({ ok: true, orphanedFiles: 0, filesUnchecked: true })
    expect(s.removes).toEqual([])
    expect(s.lists).toEqual([])
  })
  it('접두 형식이 어긋나면 아무것도 지우지 않는다', async () => {
    const s = fakeStorage(tree)
    fakeAdmin(happy((n) => (n === 'delete_project' ? { data: { ...DELETED, storage_prefix: 'ws/' } } : undefined)), s.storage)
    expect(await deleteProject(P, '버릴 프로젝트')).toMatchObject({ ok: true, filesUnchecked: true })
    expect(s.removes).toEqual([])
  })
  it('한 폴더가 한 페이지(1000)를 넘으면 끝까지 읽어 100개씩 지운다', async () => {
    const many = Array.from({ length: 1001 }, (_, i) => ({ name: `f${String(i).padStart(4, '0')}`, id: `o${i}` }))
    const s = fakeStorage({ deliverables: { [dir]: many } })
    fakeAdmin(happy(), s.storage)
    expect(await deleteProject(P, '버릴 프로젝트')).toMatchObject({ ok: true, orphanedFiles: 0, filesUnchecked: false })
    expect(s.lists.filter((l) => l === `deliverables:${dir}`)).toHaveLength(2)
    expect(s.removes.filter((r) => r.bucket === 'deliverables').map((r) => r.paths.length)).toEqual([...Array(10).fill(100), 1])
  })
})
