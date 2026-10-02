import { describe, it, expect, vi, beforeEach } from 'vitest'

// 회의록 파일 경로 검증(SP2 B1) — scope 는 클라이언트 입력이 아니라 DB 의 회의록 행(생성은 확정된 워크스페이스·프로젝트)이다.
// 회의록 쓰기는 service_role 경로라 이 검증이 스토리지 규약과 메타를 잇는 유일한 관문이다 — 거부는 admin client 에 닿기 전이어야 한다.
const getSession = vi.fn()
const getActor = vi.fn()
const adminMocks = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getSession: (...a: unknown[]) => getSession(...(a as [])) }))
vi.mock('@/lib/authz', async () => ({
  getActor: (...a: unknown[]) => getActor(...(a as [])),
  resolveScope: (await import('../helpers/resolve-scope-mock')).resolveScopeVia(() => createServerClient()),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
// 녹취 보정의 범위 tz 해석(설정 조회)은 이 파일의 관심 밖 — 옛 기대값(서울 +9)을 그대로 두려고 서울로 고정한다(SP5 과제 20)
vi.mock('@/lib/minutes/timeFix.server', async () => {
  const { correctMinuteBodyTime } = await import('@/lib/minutes/timeFix')
  return { applyScopeTimeFix: vi.fn(async (body: string, _scope: unknown, fallbackDate: string) => ({ fix: correctMinuteBodyTime(body, { timeZone: 'Asia/Seoul', fallbackDate }) })) }
})
vi.mock('next/server', () => ({ after: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: adminMocks.createAdminClient }))
vi.mock('@/lib/minutes/teamScope', async () => (await import('../helpers/team-scope-mock')).teamScopeMock())
vi.mock('@/lib/ai/minutes-ingest', () => ({ ingestMinute: vi.fn() }))
vi.mock('@/lib/ai/minutes-insights', () => ({ ensureMinuteInsights: vi.fn(), generateMinuteInsights: vi.fn() }))
vi.mock('@/lib/data/meetings', () => ({ getProjectMeetingData: vi.fn() }))
vi.mock('@/lib/data/minutes', () => ({
  getMinuteDetail: vi.fn(), getMinutesPage: vi.fn(), searchMinutes: vi.fn(),
  getMinuteFavorites: vi.fn(), getMinutesExplorer: vi.fn(),
}))
vi.mock('@/lib/ai/wiki-ingest', () => ({
  enqueueMinuteWikiProcessing: vi.fn(async () => null), processMinuteWikiJob: vi.fn(),
  rebuildProjectWikiFromActiveMinutes: vi.fn(async () => {}),
}))
vi.mock('@/lib/minutes/project', () => ({
  resolveMinuteProject: vi.fn(async (_db: unknown, input: { projectId?: string | null }) =>
    ({ projectId: input.projectId ?? null, error: null })),
}))
vi.mock('@/lib/minutes/folders', () => ({
  resolveTeamRootFolderId: vi.fn(async () => null), refileMinuteAfterProjectChange: vi.fn(), loadFolderSnapshot: vi.fn(),
}))
const createServerClient = vi.fn()
vi.mock('@/lib/supabase/server', () => ({ createServerClient: (...a: unknown[]) => createServerClient(...(a as [])) }))

import { createMinute, recordMinuteFile, replaceMinuteBody } from '@/app/actions/minutes'
import { makeActor } from '../fixtures/actor'

const W = 'aaaaaaaa-1111-4111-8111-111111111111'
const W2 = 'dddddddd-4444-4444-8444-444444444444'
const P = 'bbbbbbbb-2222-4222-8222-222222222222'
const M = 'cccccccc-3333-4333-8333-333333333333'
const member = makeActor({
  workspaceRoles: new Map([[W, 'member']]), projectWorkspace: new Map([[P, W]]),
  projectRoles: new Map([[P, 'member']]),
})
const INPUT = { minuteDate: '2026-07-30', teamCode: 'PMO', title: '제목', bodyMd: '본문', meetingId: null }
const src = (filePath: string) => ({ minuteId: M, file: { fileName: 'a.md', filePath, size: 1, mime: 'text/markdown' } })
const ADMIN_REACHED = 'ADMIN_REACHED'

/** minutes 단건 조회·insert 를 흉내내는 최소 빌더 — 모든 조회가 같은 행을 돌려준다(checkOwner·스코프 조회 공용).
 *  insert 결과는 따로 받는다(기본 성공) — 첨부 확정 가드(0011)의 거부 사유를 흉내낸다. */
function fakeDb(result: { data?: unknown; error?: { message: string } | null },
  insertResult: { error: { message: string } | null } = { error: null }) {
  const b: Record<string, unknown> = {}
  const insert = vi.fn(() => ({
    then: (r: (v: unknown) => void) => r({ data: null, error: insertResult.error }),
  }))
  for (const m of ['select', 'eq', 'maybeSingle', 'single']) b[m] = vi.fn(() => b)
  b.insert = insert
  ;(b as { then: (r: (v: unknown) => void) => void }).then =
    resolve => resolve({ data: result.data ?? null, error: result.error ?? null })
  return { client: { from: vi.fn(() => b) }, insert }
}
const row = (over: Record<string, unknown> = {}) =>
  ({ created_by: 'u1', archived_at: null, project_id: P, workspace_id: W, body_md: '본문', minute_date: '2026-07-30', ...over })

beforeEach(() => {
  getSession.mockReset(); getActor.mockReset(); createServerClient.mockReset()
  adminMocks.createAdminClient.mockReset()
  adminMocks.createAdminClient.mockImplementation(() => { throw new Error(ADMIN_REACHED) })
  getSession.mockResolvedValue({ id: 'u1', user_metadata: {}, email: 'a@example.com' })
  getActor.mockResolvedValue(member)
})

describe('createMinute 원본 경로 — scope 는 확정된 워크스페이스·프로젝트', () => {
  it('프로젝트 회의록: 그 프로젝트 경로는 통과해 RPC 단계로 간다', async () => {
    createServerClient.mockResolvedValue(fakeDb({}).client)
    const res = await createMinute({ ...INPUT, projectId: P } as never, null, src(`ws/${W}/p/${P}/minutes/${M}/1-a.md`))
    expect(res).toMatchObject({ ok: false, error: ADMIN_REACHED })
  })

  it('무프로젝트 회의록: 소속 워크스페이스의 p/_ 경로는 통과한다', async () => {
    createServerClient.mockResolvedValue(fakeDb({}).client)
    const res = await createMinute({ ...INPUT, projectId: null } as never, null, src(`ws/${W}/p/_/minutes/${M}/1-a.md`))
    expect(res).toMatchObject({ ok: false, error: ADMIN_REACHED })
  })

  it.each([
    ['옛 형식', `${M}/1-a.md`],
    ['다른 워크스페이스', `ws/${W2}/p/${P}/minutes/${M}/1-a.md`],
    ['프로젝트 자리에 _', `ws/${W}/p/_/minutes/${M}/1-a.md`],
    ['첨부 entity', `ws/${W}/p/${P}/minute-files/${M}/1-a.md`],
    ['다른 회의록 id', `ws/${W}/p/${P}/minutes/${P}/1-a.md`],
  ])('프로젝트 회의록에 %s 경로는 거부 — admin client 미생성', async (_l, path) => {
    createServerClient.mockResolvedValue(fakeDb({}).client)
    const res = await createMinute({ ...INPUT, projectId: P } as never, null, src(path))
    expect(res).toEqual({ ok: false, error: '잘못된 원본 파일 경로입니다.' })
    expect(adminMocks.createAdminClient).not.toHaveBeenCalled()
  })

  it('무프로젝트 회의록에 프로젝트 경로는 거부', async () => {
    createServerClient.mockResolvedValue(fakeDb({}).client)
    const res = await createMinute({ ...INPUT, projectId: null } as never, null, src(`ws/${W}/p/${P}/minutes/${M}/1-a.md`))
    expect(res).toEqual({ ok: false, error: '잘못된 원본 파일 경로입니다.' })
    expect(adminMocks.createAdminClient).not.toHaveBeenCalled()
  })
})

describe('createMinute — 녹취 보정 경고를 결과에 싣고 업로드는 성공한다(A-4 리뷰 N4, A-5 리뷰 O6)', () => {
  const okAdmin = () => ({
    rpc: vi.fn(() => ({ single: async () => ({ data: { minute_id: M, version_id: 'v1', wiki_rebuild_required: false }, error: null }) })),
  })
  it.each(['calendar_unavailable', 'invalid_time'] as const)('보정 도우미가 %s 경고를 내면 ok:true + timeFixWarning(원문 그대로 저장)', async (warning) => {
    const { applyScopeTimeFix } = await import('@/lib/minutes/timeFix.server')
    vi.mocked(applyScopeTimeFix).mockResolvedValueOnce({ fix: { corrected: false, body: '본문' }, warning } as never)
    createServerClient.mockResolvedValue(fakeDb({}).client)
    const admin = okAdmin()
    adminMocks.createAdminClient.mockImplementation(() => admin)
    const res = await createMinute({ ...INPUT, projectId: P } as never, null, src(`ws/${W}/p/${P}/minutes/${M}/1-a.md`))
    expect(res).toMatchObject({ ok: true, id: M, timeFixWarning: warning })
    expect(admin.rpc).toHaveBeenCalledWith('create_minute_with_version', expect.objectContaining({ p_body_md: '본문' }))
  })
  it('경고가 없으면 timeFixWarning 키가 없다', async () => {
    createServerClient.mockResolvedValue(fakeDb({}).client)
    adminMocks.createAdminClient.mockImplementation(() => okAdmin())
    const res = await createMinute({ ...INPUT, projectId: P } as never, null, src(`ws/${W}/p/${P}/minutes/${M}/1-a.md`))
    expect(res).toMatchObject({ ok: true, id: M })
    expect('timeFixWarning' in res).toBe(false)
  })
})

describe('recordMinuteFile — scope 는 DB 의 회의록 행', () => {
  const att = (filePath: string) => ({ role: 'attachment' as const, fileName: 'x.pdf', filePath, size: 1, mime: 'application/pdf' })

  it('첨부는 minute-files 경로만 기록한다', async () => {
    const db = fakeDb({ data: row() })
    createServerClient.mockResolvedValue(db.client)
    expect(await recordMinuteFile(M, att(`ws/${W}/p/${P}/minute-files/${M}/1-x.pdf`))).toEqual({ ok: true })
    expect(db.insert).toHaveBeenCalled()
  })

  it.each([
    ['본문 entity', `ws/${W}/p/${P}/minutes/${M}/1-x.pdf`],
    ['옛 형식', `${M}/1-x.pdf`],
    ['다른 워크스페이스', `ws/${W2}/p/${P}/minute-files/${M}/1-x.pdf`],
    ['프로젝트 자리에 _', `ws/${W}/p/_/minute-files/${M}/1-x.pdf`],
  ])('첨부에 %s 경로는 거부하고 insert 하지 않는다', async (_l, path) => {
    const db = fakeDb({ data: row() })
    createServerClient.mockResolvedValue(db.client)
    expect(await recordMinuteFile(M, att(path))).toEqual({ ok: false, error: '잘못된 파일 경로입니다.' })
    expect(db.insert).not.toHaveBeenCalled()
  })

  it('무프로젝트 회의록은 p/_ 경로여야 한다 — 행의 project_id 를 따른다', async () => {
    const db = fakeDb({ data: row({ project_id: null }) })
    createServerClient.mockResolvedValue(db.client)
    expect(await recordMinuteFile(M, att(`ws/${W}/p/${P}/minute-files/${M}/1-x.pdf`))).toMatchObject({ ok: false })
    expect(await recordMinuteFile(M, att(`ws/${W}/p/_/minute-files/${M}/1-x.pdf`))).toEqual({ ok: true })
  })

  it.each([
    ['MINUTE_ATTACHMENT_LIMIT', '첨부는 회의록당 10개까지입니다.'],
    ['MINUTE_ATTACHMENT_DUPLICATE', '같은 파일이 이미 첨부돼 있습니다.'],
    ['MINUTE_ATTACHMENT_ARCHIVED', '보관된 회의록에는 첨부할 수 없습니다.'],
    ['MINUTE_ATTACHMENT_PATH', '잘못된 파일 경로입니다.'],
    ['MINUTE_ATTACHMENT_OBJECT', '업로드한 파일을 확인하지 못했습니다 — 다시 올려 주세요.'],
  ])('DB 가드 사유 %s 는 사용자 문구로', async (code, text) => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const db = fakeDb({ data: row() }, { error: { message: code } })
    createServerClient.mockResolvedValue(db.client)
    expect(await recordMinuteFile(M, att(`ws/${W}/p/${P}/minute-files/${M}/1-x.pdf`))).toEqual({ ok: false, error: text })
    spy.mockRestore()
  })
  // PATH·OBJECT 는 앱의 경로 검사를 통과한 뒤에 DB 가 거부한 것이다 — 화면 흐름에서는 앱과 DB 의 경로 검사가 어긋났거나
  // Storage 가 객체 메타(size)를 남기지 않게 됐다는 신호라, 사용자 문구만 띄우고 서버 로그가 비면 장애를 알 길이 없다.
  it.each(['MINUTE_ATTACHMENT_PATH', 'MINUTE_ATTACHMENT_OBJECT'])('DB 가드 사유 %s 는 로그에도 남긴다 — 사유 코드와 회의록 id, 파일 경로는 싣지 않는다', async (code) => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const path = `ws/${W}/p/${P}/minute-files/${M}/1-x.pdf`
    createServerClient.mockResolvedValue(fakeDb({ data: row() }, { error: { message: `${code} (${path})` } }).client)
    expect((await recordMinuteFile(M, att(path))).ok).toBe(false)
    expect(spy.mock.calls).toEqual([[`[recordMinuteFile minute=${M}] 첨부 확정 가드 거부: ${code}`]])
    spy.mockRestore()
  })
  it.each(['MINUTE_ATTACHMENT_LIMIT', 'MINUTE_ATTACHMENT_DUPLICATE', 'MINUTE_ATTACHMENT_ARCHIVED'])('사용자 몫의 거부 %s 는 로그에 남기지 않는다', async (code) => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    createServerClient.mockResolvedValue(fakeDb({ data: row() }, { error: { message: code } }).client)
    expect((await recordMinuteFile(M, att(`ws/${W}/p/${P}/minute-files/${M}/1-x.pdf`))).ok).toBe(false)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
  it('모르는 DB 오류는 원문을 싣지 않는다 — 로그만, 어느 회의록인지와 함께', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const db = fakeDb({ data: row() }, { error: { message: 'db boom' } })
    createServerClient.mockResolvedValue(db.client)
    expect(await recordMinuteFile(M, att(`ws/${W}/p/${P}/minute-files/${M}/1-x.pdf`))).toEqual({ ok: false, error: '첨부 기록에 실패했습니다.' })
    expect(spy.mock.calls).toEqual([[`[recordMinuteFile minute=${M}] 첨부 기록 실패:`, 'db boom']])
    spy.mockRestore()
  })

  it('본문 파일은 minutes entity 경로여야 한다 — 거부는 admin client 이전', async () => {
    createServerClient.mockResolvedValue(fakeDb({ data: row() }).client)
    const res = await recordMinuteFile(M, { role: 'body', fileName: 'a.md', filePath: `ws/${W}/p/${P}/minute-files/${M}/1-a.md`, size: 1, mime: 'text/markdown' })
    expect(res).toEqual({ ok: false, error: '잘못된 파일 경로입니다.' })
    expect(adminMocks.createAdminClient).not.toHaveBeenCalled()
  })
})

describe('replaceMinuteBody — scope 는 DB 의 회의록 행', () => {
  const file = (filePath: string) => ({ fileName: 'a.md', filePath, size: 1, mime: 'text/markdown' })

  it('자기 스코프 경로는 RPC 단계로 간다', async () => {
    createServerClient.mockResolvedValue(fakeDb({ data: row() }).client)
    expect(await replaceMinuteBody(M, '본문', file(`ws/${W}/p/${P}/minutes/${M}/1-a.md`))).toMatchObject({ error: ADMIN_REACHED })
  })

  it('다른 워크스페이스 경로는 거부 — admin client 미생성', async () => {
    createServerClient.mockResolvedValue(fakeDb({ data: row() }).client)
    const res = await replaceMinuteBody(M, '본문', file(`ws/${W2}/p/${P}/minutes/${M}/1-a.md`))
    expect(res).toEqual({ ok: false, error: '잘못된 파일 경로입니다.' })
    expect(adminMocks.createAdminClient).not.toHaveBeenCalled()
  })

  it('회의록 행 조회가 실패하면 쓰기를 중단한다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    createServerClient.mockResolvedValue(fakeDb({ error: { message: 'boom' } }).client)
    const res = await replaceMinuteBody(M, '본문', file(`ws/${W}/p/${P}/minutes/${M}/1-a.md`))
    spy.mockRestore()
    expect(res.ok).toBe(false)
    expect(adminMocks.createAdminClient).not.toHaveBeenCalled()
  })
})
