import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// 산출물 첨부 목록(P7-2-DL) — 조회 실패는 오류로, 다운로드 가능 여부는 Storage 읽기 정책과 같은 can_attach 로 판정한다.
// SP5 B3 과제7: 목록은 서명하지 않는다(서명 호출 0). 내려받기는 클릭 때 getAttachmentUrl 이 항목·첨부 짝과 권한을 다시 보고 60초 링크를 준다.
const { getSession, createServerClient } = vi.hoisted(() => ({
  getSession: vi.fn(), createServerClient: vi.fn(),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getSession }))
vi.mock('@/lib/authz', () => ({ requireProjectMember: vi.fn(), resolveProjectId: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient }))

import { getAttachmentUrl, listAttachments } from '@/app/actions/attachments'
import { SIGNED_URL_TTL_SEC } from '@/lib/domain/signedUrl'

const WS = 'aaaaaaaa-1111-4111-8111-111111111111'
const PID = 'bbbbbbbb-2222-4222-8222-222222222222'
const ITEM = 'cccccccc-3333-4333-8333-333333333333'
const PATH_A = `ws/${WS}/p/${PID}/deliverables/${ITEM}/1700000000001-plan.xlsx`
const row = (id: string, path: string, name: string) => ({
  id, wbs_item_id: ITEM, file_name: name, file_path: path, size: 10, mime: 'application/pdf',
  created_at: '2026-09-27T00:00:00Z',
})
const ROW_A = row('att-a', PATH_A, 'plan.xlsx')
const ERR_LIST = '첨부 목록을 불러오지 못했습니다.'

/** 가짜 서버 클라이언트 — 목록 select·단건 select(eq 인자 기록)·can_attach rpc·단건/일괄 서명. */
function sb(opts: {
  select?: { data: unknown; error: unknown }
  single?: { data: unknown; error: unknown }
  can?: { data: unknown; error: unknown }
  signed?: { data: { signedUrl: string } | null; error: { message: string } | null }
}) {
  const select = opts.select ?? { data: [], error: null }
  const eqs: unknown[][] = []
  const chain: Record<string, unknown> = {}
  chain.eq = vi.fn((...a: unknown[]) => { eqs.push(a); return chain })
  chain.order = () => Promise.resolve(select)
  chain.maybeSingle = async () => opts.single ?? { data: null, error: null }
  const from = vi.fn(() => ({ select: () => chain }))
  const rpc = vi.fn<(fn: string, args: unknown) => Promise<{ data: unknown; error: unknown }>>(
    async () => opts.can ?? { data: true, error: null })
  const createSignedUrls = vi.fn()
  const createSignedUrl = vi.fn(async () => opts.signed ?? { data: { signedUrl: 'https://signed.example.com/a' }, error: null })
  const storageFrom = vi.fn(() => ({ createSignedUrls, createSignedUrl }))
  createServerClient.mockResolvedValue({ from, rpc, storage: { from: storageFrom } } as never)
  return { from, rpc, createSignedUrls, createSignedUrl, storageFrom, eqs }
}

let errSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.clearAllMocks()
  getSession.mockResolvedValue({ id: 'u-1' })
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => errSpy.mockRestore())

const META_A = {
  id: 'att-a', wbsItemId: ITEM, fileName: 'plan.xlsx', filePath: PATH_A, size: 10, mime: 'application/pdf',
  createdAt: '2026-09-27T00:00:00Z',
}

describe('listAttachments — 결과형과 다운로드 판정, 서명 없음', () => {
  it.each([
    ['allowed', { data: true, error: null }],
    ['denied', { data: false, error: null }],
  ] as const)('can_attach → %s — 메타만 돌려주고 서명하지 않는다', async (download, can) => {
    const f = sb({ select: { data: [ROW_A], error: null }, can })
    expect(await listAttachments(ITEM)).toEqual({ ok: true, download, rows: [META_A] })
    expect(f.rpc).toHaveBeenCalledWith('can_attach', { item: ITEM })
    expect(f.createSignedUrls).not.toHaveBeenCalled()
    expect(f.createSignedUrl).not.toHaveBeenCalled()
  })

  it('select 오류는 빈 목록이 아니라 오류다 — 로그 1회, 판정 없음', async () => {
    const f = sb({ select: { data: null, error: { message: 'boom' } } })
    expect(await listAttachments(ITEM)).toEqual({ ok: false, error: ERR_LIST })
    expect(errSpy).toHaveBeenCalledTimes(1)
    expect(f.rpc).not.toHaveBeenCalled()
  })

  it('can_attach 판정 오류는 unknown(fail-closed) — 로그를 남긴다', async () => {
    sb({ select: { data: [ROW_A], error: null }, can: { data: null, error: { message: 'rpc down' } } })
    expect(await listAttachments(ITEM)).toEqual({ ok: true, download: 'unknown', rows: [META_A] })
    expect(errSpy).toHaveBeenCalledTimes(1)
  })

  it('비로그인은 오류다(로그) — DB 를 부르지 않는다', async () => {
    getSession.mockResolvedValue(null)
    sb({})
    expect(await listAttachments(ITEM)).toEqual({ ok: false, error: ERR_LIST })
    expect(createServerClient).not.toHaveBeenCalled()
  })
})

describe('getAttachmentUrl — 클릭 때 60초 링크(항목·첨부 짝, 그 순간의 can_attach)', () => {
  it('짝이 맞고 권한이 있으면 60초·원본 파일명으로 서명한다', async () => {
    const f = sb({ single: { data: { file_path: PATH_A, file_name: 'plan.xlsx' }, error: null } })
    expect(await getAttachmentUrl(ITEM, 'att-a')).toEqual({ ok: true, url: 'https://signed.example.com/a' })
    expect(f.eqs).toEqual([['id', 'att-a'], ['wbs_item_id', ITEM]])
    expect(f.rpc).toHaveBeenCalledWith('can_attach', { item: ITEM })
    expect(f.storageFrom).toHaveBeenCalledWith('deliverables')
    expect(f.createSignedUrl).toHaveBeenCalledWith(PATH_A, SIGNED_URL_TTL_SEC, { download: 'plan.xlsx' })
    expect(SIGNED_URL_TTL_SEC).toBe(60)
  })

  it('다른 항목의 첨부 id(짝이 안 맞아 0행)는 서명하지 않는다', async () => {
    const f = sb({ single: { data: null, error: null } })
    expect(await getAttachmentUrl(ITEM, 'att-of-other-item')).toEqual({ ok: false, error: '첨부 없음' })
    expect(f.rpc).not.toHaveBeenCalled()
    expect(f.createSignedUrl).not.toHaveBeenCalled()
  })

  it('권한이 회수됐으면(can_attach false) 서명하지 않는다', async () => {
    const f = sb({ single: { data: { file_path: PATH_A, file_name: 'plan.xlsx' }, error: null }, can: { data: false, error: null } })
    expect(await getAttachmentUrl(ITEM, 'att-a')).toEqual({ ok: false, error: '권한 없음' })
    expect(f.createSignedUrl).not.toHaveBeenCalled()
  })

  it('권한 판정 오류는 중단(fail-closed) — 로그', async () => {
    const f = sb({ single: { data: { file_path: PATH_A, file_name: 'plan.xlsx' }, error: null }, can: { data: null, error: { message: 'rpc down' } } })
    expect((await getAttachmentUrl(ITEM, 'att-a')).ok).toBe(false)
    expect(f.createSignedUrl).not.toHaveBeenCalled()
    expect(errSpy).toHaveBeenCalled()
  })

  it('첨부 조회 실패는 "첨부 없음"으로 위장하지 않는다', async () => {
    sb({ single: { data: null, error: { message: 'boom' } } })
    expect(await getAttachmentUrl(ITEM, 'att-a')).toEqual({ ok: false, error: ERR_LIST })
    expect(errSpy).toHaveBeenCalled()
  })

  it('서명 실패는 로그 + 실패', async () => {
    sb({ single: { data: { file_path: PATH_A, file_name: 'plan.xlsx' }, error: null }, signed: { data: null, error: { message: 'storage' } } })
    expect((await getAttachmentUrl(ITEM, 'att-a')).ok).toBe(false)
    expect(errSpy).toHaveBeenCalled()
  })
})
