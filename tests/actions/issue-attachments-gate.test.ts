import { describe, it, expect, vi, beforeEach } from 'vitest'

// 게이트 통과 전에는 DB 클라이언트가 만들어지면 안 된다(issues-gate.test.ts 와 같은 강제).
const state = vi.hoisted(() => ({ client: undefined as unknown }))
const { createServerClient } = vi.hoisted(() => ({
  createServerClient: vi.fn(async () => {
    if (state.client === undefined) throw new Error('게이트 통과 전 createServerClient 호출 금지')
    return state.client
  }),
}))
const { requireProjectAdmin, resolveProjectId, getActor } = vi.hoisted(() => ({
  requireProjectAdmin: vi.fn(), resolveProjectId: vi.fn(), getActor: vi.fn(),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/authz', () => ({ requireProjectAdmin, resolveProjectId, getActor }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient }))

import { getSession } from '@/lib/auth'
import {
  listIssueAttachments,
  recordIssueAttachment,
  removeIssueAttachment,
} from '@/app/actions/issueAttachments'
import { ISSUE_ATTACHMENT_MAX_BYTES } from '@/lib/domain/issueAttachments'
import { LIST_SIGNED_URL_TTL_SEC } from '@/lib/domain/signedUrl'
import { makeMemberActor } from '../fixtures/actor'

const USER = { id: 'me', email: 'me@x.com', user_metadata: {} } as const
const PID = 'bbbbbbbb-2222-4222-8222-222222222222'
const WS = 'aaaaaaaa-1111-4111-8111-111111111111'
const OTHER_WS = 'dddddddd-4444-4444-8444-444444444444'
const ACTOR = makeMemberActor(PID, [], { userId: 'me' })
const ISSUE = 'cccccccc-3333-4333-8333-333333333333'
const FILE = {
  fileName: '보고서.pdf', filePath: `ws/${WS}/p/${PID}/issue-attachments/${ISSUE}/1700000000000-_.pdf`,
  size: 1234, mime: 'application/pdf',
}

function asOwner() {
  requireProjectAdmin.mockResolvedValue({ ok: false, error: '권한 없음' })
  getActor.mockResolvedValue(ACTOR)
}
function asOtherMember() {
  requireProjectAdmin.mockResolvedValue({ ok: false, error: '권한 없음' })
  getActor.mockResolvedValue({ ...ACTOR, userId: 'someone-else' })
}
function asProjectAdmin() {
  requireProjectAdmin.mockResolvedValue({ ok: true, actor: ACTOR })
  getActor.mockResolvedValue(ACTOR)
}
function asAnon() {
  requireProjectAdmin.mockResolvedValue({ ok: false, error: '로그인 필요' })
  getActor.mockResolvedValue(null)
}

/** 호출 순서를 기록해 "storage 제거가 메타 삭제보다 먼저"를 검증할 수 있게 한다. */
type Calls = string[]

function makeClient(opts: {
  calls?: Calls
  /** issues 선행 조회 결과(작성자 판정용). */
  issue?: { data: { created_by: string | null } | null; error: { message: string } | null }
  /** 기존 첨부 개수 조회 결과. */
  countRows?: { data: Array<{ id: string }> | null; error: { message: string } | null }
  /** 첨부 단건 조회(삭제용). */
  attachment?: { data: { id: string; file_path: string; issue_id: string } | null; error: { message: string } | null }
  /** 목록 조회. */
  listRows?: { data: Array<Record<string, unknown>> | null; error: { message: string } | null }
  insertError?: { message: string } | null
  deleteError?: { message: string } | null
  /** 메타 delete 가 0행을 지웠을 때를 흉내낸다. */
  deleteResult?: { data: { id: string } | null; error: { message: string } | null }
  signed?: { data: { signedUrl: string } | null; error: { message: string } | null }
  /** 이슈 프로젝트의 워크스페이스 조회(경로 검증 scope). */
  project?: { data: { workspace_id: string } | null; error: { message: string } | null }
  /** Storage remove 결과 — 기본은 객체 1건 삭제. */
  removed?: { data: unknown[] | null; error: { message: string } | null }
  /** 존재 확인 RPC(attachment_object_exists) 결과 — 기본은 객체가 남아 있음(true). */
  exists?: { data: unknown; error: { message: string } | null }
}) {
  const calls = opts.calls ?? []
  /** 삭제 도우미(removeStoredAttachment)에 닿은 값 — 어느 버킷의 어느 경로를 지우고, 어느 행을 묻고 지웠는지. */
  const seen = {
    removed: [] as Array<{ bucket: string; paths: string[] }>,
    rpc: [] as unknown[][],
    deleted: [] as Array<{ table: string; eq: unknown[] }>,
  }
  let bucket = ''
  const insert = vi.fn(async (row: unknown) => { calls.push('meta.insert'); void row; return { error: opts.insertError ?? null } })
  const remove = vi.fn(async (paths: string[]) => {
    calls.push('storage.remove'); seen.removed.push({ bucket, paths })
    return opts.removed ?? { data: [{ name: paths[0] }], error: null }
  })
  const createSignedUrl = vi.fn(async () => opts.signed ?? { data: { signedUrl: 'https://signed' }, error: null })

  const issuesTable = {
    select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => opts.issue ?? { data: { created_by: 'me' }, error: null }) })) })),
  }
  const projectsTable = {
    select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => opts.project ?? { data: { workspace_id: WS }, error: null }) })) })),
  }
  // 실제 PostgrestFilterBuilder 는 thenable 이다 — .eq(...) 를 그대로 await 하면 쿼리가 돈다.
  // 개수 조회가 그 경로를 쓰므로 mock 도 thenable 이어야 한다.
  const attachChain = () => ({
    maybeSingle: vi.fn(async () => opts.attachment ?? { data: null, error: null }),
    order: vi.fn(async () => opts.listRows ?? { data: [], error: null }),
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve(opts.countRows ?? { data: [], error: null }).then(res, rej),
  })
  const attachTable = (table: string) => ({
    select: vi.fn(() => ({ eq: vi.fn(attachChain) })),
    insert,
    delete: vi.fn(() => ({
      eq: vi.fn((...eq: unknown[]) => {
        seen.deleted.push({ table, eq })
        return {
          select: vi.fn(() => ({
            then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
              calls.push('meta.delete')
              const r = opts.deleteResult ?? { data: { id: 'a1' }, error: opts.deleteError ?? null }
              return Promise.resolve({ data: r.data ? [r.data] : [], error: r.error }).then(res, rej)
            },
          })),
        }
      }),
    })),
  })
  return {
    calls,
    seen,
    insert,
    remove,
    createSignedUrl,
    client: {
      from: vi.fn((t: string) => (t === 'issues' ? issuesTable : t === 'projects' ? projectsTable : attachTable(t))),
      storage: { from: vi.fn((b: string) => { bucket = b; return { createSignedUrl, remove } }) },
      rpc: vi.fn(async (...args: unknown[]) => { calls.push('rpc.exists'); seen.rpc.push(args); return opts.exists ?? { data: true, error: null } }),
    },
  }
}

beforeEach(() => {
  state.client = undefined
  createServerClient.mockClear()
  requireProjectAdmin.mockReset()
  resolveProjectId.mockReset()
  getActor.mockReset()
  resolveProjectId.mockResolvedValue({ ok: true, projectId: PID })
  vi.mocked(getSession).mockReset()
  vi.mocked(getSession).mockResolvedValue(USER as never)
})

describe('권한 게이트', () => {
  it('비로그인은 첨부를 기록할 수 없고 DB 에 닿지 않는다', async () => {
    asAnon()
    const res = await recordIssueAttachment(ISSUE, FILE)
    expect(res.ok).toBe(false)
    expect(createServerClient).not.toHaveBeenCalled()
  })

  // 삭제는 "어느 이슈의 첨부인가"를 알아야 권한을 판정할 수 있어 게이트 전에 첨부 행을 읽는다
  // (기존 removeAttachment 도 같은 순서다). 실제로는 RLS 가 비로그인 조회를 막아 빈 결과가 되지만,
  // 여기서는 행이 보이는 최악의 경우에도 삭제가 막히는지를 본다.
  it('비로그인은 첨부를 지울 수 없다 — 행이 보여도 삭제까지 가지 않는다', async () => {
    asAnon()
    const m = makeClient({
      attachment: { data: { id: 'a1', file_path: `${ISSUE}/1-x.pdf`, issue_id: ISSUE }, error: null },
    })
    state.client = m.client
    const res = await removeIssueAttachment('a1')
    expect(res.ok).toBe(false)
    expect(m.remove).not.toHaveBeenCalled()
    expect(m.calls).toEqual([])
  })

  it('작성자도 관리자도 아니면 거부하고 insert 하지 않는다', async () => {
    asOtherMember()
    const m = makeClient({ issue: { data: { created_by: 'me' }, error: null } })
    state.client = m.client
    const res = await recordIssueAttachment(ISSUE, FILE)
    expect(res.ok).toBe(false)
    expect(m.insert).not.toHaveBeenCalled()
  })

  it('작성자는 기록할 수 있다', async () => {
    asOwner()
    const m = makeClient({ issue: { data: { created_by: 'me' }, error: null } })
    state.client = m.client
    expect((await recordIssueAttachment(ISSUE, FILE)).ok).toBe(true)
  })

  it('프로젝트 관리자는 남의 이슈에도 기록할 수 있다', async () => {
    asProjectAdmin()
    const m = makeClient({ issue: { data: { created_by: 'someone-else' }, error: null } })
    state.client = m.client
    expect((await recordIssueAttachment(ISSUE, FILE)).ok).toBe(true)
  })

  it('이슈 조회가 실패하면 권한 없음이 아니라 중단한다', async () => {
    asOwner()
    const m = makeClient({ issue: { data: null, error: { message: 'boom' } } })
    state.client = m.client
    const res = await recordIssueAttachment(ISSUE, FILE)
    expect(res.ok).toBe(false)
    expect(m.insert).not.toHaveBeenCalled()
  })

  it('프로젝트를 확정하지 못하면 중단한다', async () => {
    asOwner()
    resolveProjectId.mockResolvedValue({ ok: true, projectId: null })
    const m = makeClient({})
    state.client = m.client
    expect((await recordIssueAttachment(ISSUE, FILE)).ok).toBe(false)
    expect(m.insert).not.toHaveBeenCalled()
  })
})

describe('recordIssueAttachment 검증', () => {
  it('다른 이슈의 경로는 거부한다 — 편집 권한 하나로 남의 객체를 꽂지 못하게', async () => {
    asOwner()
    const m = makeClient({})
    state.client = m.client
    const other = FILE.filePath.replace(ISSUE, '99999999-8888-4777-8666-555555555555')
    const res = await recordIssueAttachment(ISSUE, { ...FILE, filePath: other })
    expect(res.ok).toBe(false)
    expect(m.insert).not.toHaveBeenCalled()
  })

  it('옛 형식 <이슈>/<파일> 경로는 거부한다', async () => {
    asOwner()
    const m = makeClient({})
    state.client = m.client
    const res = await recordIssueAttachment(ISSUE, { ...FILE, filePath: `${ISSUE}/1-x.pdf` })
    expect(res).toEqual({ ok: false, error: '첨부 경로가 올바르지 않습니다.' })
    expect(m.insert).not.toHaveBeenCalled()
  })

  it('scope 는 DB 의 이슈 프로젝트 워크스페이스다 — 다른 워크스페이스 경로는 거부한다', async () => {
    asOwner()
    const m = makeClient({ project: { data: { workspace_id: OTHER_WS }, error: null } })
    state.client = m.client
    const res = await recordIssueAttachment(ISSUE, FILE)
    expect(res).toEqual({ ok: false, error: '첨부 경로가 올바르지 않습니다.' })
    expect(m.insert).not.toHaveBeenCalled()
  })

  it('프로젝트 워크스페이스 조회가 실패하면 쓰기를 중단한다', async () => {
    asOwner()
    const m = makeClient({ project: { data: null, error: { message: 'boom' } } })
    state.client = m.client
    const res = await recordIssueAttachment(ISSUE, FILE)
    expect(res.ok).toBe(false)
    expect(res.error).not.toBe('첨부 경로가 올바르지 않습니다.')
    expect(m.insert).not.toHaveBeenCalled()
  })

  it('상한을 넘는 크기는 거부한다', async () => {
    asOwner()
    const m = makeClient({})
    state.client = m.client
    const res = await recordIssueAttachment(ISSUE, { ...FILE, size: ISSUE_ATTACHMENT_MAX_BYTES + 1 })
    expect(res.ok).toBe(false)
    expect(m.insert).not.toHaveBeenCalled()
  })

  it('이미 10개면 거부한다', async () => {
    asOwner()
    const rows = Array.from({ length: 10 }, (_, i) => ({ id: `a${i}` }))
    const m = makeClient({ countRows: { data: rows, error: null } })
    state.client = m.client
    const res = await recordIssueAttachment(ISSUE, FILE)
    expect(res.ok).toBe(false)
    expect(m.insert).not.toHaveBeenCalled()
  })

  it('개수 조회가 실패하면 통과시키지 않고 중단한다', async () => {
    asOwner()
    const m = makeClient({ countRows: { data: null, error: { message: 'boom' } } })
    state.client = m.client
    const res = await recordIssueAttachment(ISSUE, FILE)
    expect(res.ok).toBe(false)
    expect(m.insert).not.toHaveBeenCalled()
  })

  it('project_id 는 클라이언트가 아니라 서버가 확정한 값을 넣는다', async () => {
    asOwner()
    const m = makeClient({})
    state.client = m.client
    await recordIssueAttachment(ISSUE, FILE)
    expect(m.insert).toHaveBeenCalledWith(expect.objectContaining({ issue_id: ISSUE, project_id: PID }))
  })
})

describe('removeIssueAttachment', () => {
  it('첨부 조회가 실패하면 중단한다', async () => {
    asOwner()
    const m = makeClient({ attachment: { data: null, error: { message: 'boom' } } })
    state.client = m.client
    const res = await removeIssueAttachment('a1')
    expect(res.ok).toBe(false)
    expect(m.remove).not.toHaveBeenCalled()
  })

  it('없는 첨부는 거부한다', async () => {
    asOwner()
    const m = makeClient({ attachment: { data: null, error: null } })
    state.client = m.client
    expect((await removeIssueAttachment('a1')).ok).toBe(false)
  })

  it('Storage 객체를 메타 행보다 먼저 지운다 — 반대면 메타 잃은 객체를 못 찾는다', async () => {
    asOwner()
    const m = makeClient({
      attachment: { data: { id: 'a1', file_path: `${ISSUE}/1-x.pdf`, issue_id: ISSUE }, error: null },
    })
    state.client = m.client
    const res = await removeIssueAttachment('a1')
    expect(res.ok).toBe(true)
    expect(m.calls).toEqual(['storage.remove', 'meta.delete'])
  })

  // remove 는 RLS 가 막아도 오류 없이 빈 배열을 돌려준다 — 0건을 성공으로 읽고 메타를 지우면 고아 객체가 남는다(T18 리뷰 carry l).
  it('Storage 가 0건을 지웠으면 메타를 남기고 실패 — 로그를 남긴다', async () => {
    asOwner()
    const m = makeClient({
      attachment: { data: { id: 'a1', file_path: `${ISSUE}/1-x.pdf`, issue_id: ISSUE }, error: null },
      removed: { data: [], error: null },
    })
    state.client = m.client
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await removeIssueAttachment('a1')).ok).toBe(false)
    expect(m.calls).toEqual(['storage.remove', 'rpc.exists'])
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('Storage 0건인데 객체가 이미 없으면(존재 확인 RPC false) 메타만 지우고 성공', async () => {
    asOwner()
    const m = makeClient({
      attachment: { data: { id: 'a1', file_path: `${ISSUE}/1-x.pdf`, issue_id: ISSUE }, error: null },
      removed: { data: [], error: null },
      exists: { data: false, error: null },
    })
    state.client = m.client
    expect(await removeIssueAttachment('a1')).toEqual({ ok: true })
    expect(m.calls).toEqual(['storage.remove', 'rpc.exists', 'meta.delete'])
    // 도우미에 넘기는 값 — 이슈 첨부 버킷·표, 그 행의 file_path, 존재 확인과 행 삭제는 첨부 id(이슈 id 가 아니다)로.
    expect(m.seen).toEqual({
      removed: [{ bucket: 'issue-attachments', paths: [`${ISSUE}/1-x.pdf`] }],
      rpc: [['attachment_object_exists', { p_kind: 'issue', p_id: 'a1' }]],
      deleted: [{ table: 'issue_attachments', eq: ['id', 'a1'] }],
    })
  })

  it('Storage 삭제 오류면 메타를 남기고 실패', async () => {
    asOwner()
    const m = makeClient({
      attachment: { data: { id: 'a1', file_path: `${ISSUE}/1-x.pdf`, issue_id: ISSUE }, error: null },
      removed: { data: null, error: { message: 'storage down' } },
    })
    state.client = m.client
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await removeIssueAttachment('a1')).ok).toBe(false)
    expect(m.calls).toEqual(['storage.remove'])
    spy.mockRestore()
  })

  it('메타가 0행 지워지면 성공으로 둔갑시키지 않는다', async () => {
    // Storage 객체는 이미 지웠는데 메타가 남으면 목록에 죽은 링크가 영구히 남는다.
    // supabase-js 는 0행 삭제에 error 를 주지 않으므로 .select() 로 직접 확인해야 한다.
    asOwner()
    const m = makeClient({
      attachment: { data: { id: 'a1', file_path: `${ISSUE}/1-x.pdf`, issue_id: ISSUE }, error: null },
      deleteResult: { data: null, error: null },
    })
    state.client = m.client
    expect((await removeIssueAttachment('a1')).ok).toBe(false)
  })

  it('권한이 없으면 Storage 에 손대지 않는다', async () => {
    asOtherMember()
    const m = makeClient({
      attachment: { data: { id: 'a1', file_path: `${ISSUE}/1-x.pdf`, issue_id: ISSUE }, error: null },
      issue: { data: { created_by: 'me' }, error: null },
    })
    state.client = m.client
    expect((await removeIssueAttachment('a1')).ok).toBe(false)
    expect(m.remove).not.toHaveBeenCalled()
  })
})

describe('listIssueAttachments', () => {
  it('비로그인은 실패로 알린다 — 빈 목록으로 위장하지 않는다', async () => {
    vi.mocked(getSession).mockResolvedValue(null as never)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await listIssueAttachments(ISSUE)).toMatchObject({ ok: false })
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('조회 실패를 "첨부 없음"으로 위장하지 않는다', async () => {
    // 목록 배지는 getIssues 의 별도 쿼리에서 오므로, 여기서 [] 를 돌려주면
    // 목록은 '첨부 3개'인데 상세는 '없음'이 되어 사용자가 파일 소실로 읽는다.
    const m = makeClient({ listRows: { data: null, error: { message: 'boom' } } })
    state.client = m.client
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await listIssueAttachments(ISSUE)).toMatchObject({ ok: false })
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('서명 URL 실패를 삼키지 않는다 — 표시 = 로깅', async () => {
    const m = makeClient({
      listRows: {
        data: [{ id: 'a1', issue_id: ISSUE, file_name: 'x.pdf', file_path: `${ISSUE}/1-x.pdf`, size: 1, mime: null, created_at: 't' }],
        error: null,
      },
      signed: { data: null, error: { message: 'signing failed' } },
    })
    state.client = m.client
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const out = await listIssueAttachments(ISSUE)
    expect(out.ok).toBe(true)
    const items = (out as { items: Array<{ url: string | null }> }).items
    expect(items).toHaveLength(1)
    expect(items[0]?.url).toBeNull()
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('원본 파일명으로 내려받도록 서명 URL 에 download 를 준다', async () => {
    const m = makeClient({
      listRows: {
        data: [{ id: 'a1', issue_id: ISSUE, file_name: '보고서.pdf', file_path: `${ISSUE}/1-x.pdf`, size: 1, mime: null, created_at: 't' }],
        error: null,
      },
    })
    state.client = m.client
    await listIssueAttachments(ISSUE)
    expect(m.createSignedUrl).toHaveBeenCalledWith(`${ISSUE}/1-x.pdf`, LIST_SIGNED_URL_TTL_SEC, { download: '보고서.pdf' })
  })
})
