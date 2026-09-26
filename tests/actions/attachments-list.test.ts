import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// 산출물 첨부 목록(P7-2-DL) — 조회 실패는 오류로, 다운로드(서명)는 Storage 읽기 정책과 같은 can_attach 가 허락할 때만.
const { getSession, createServerClient } = vi.hoisted(() => ({
  getSession: vi.fn(), createServerClient: vi.fn(),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getSession }))
vi.mock('@/lib/authz', () => ({ requireProjectMember: vi.fn(), resolveProjectId: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient }))

import { listAttachments } from '@/app/actions/attachments'
import { LIST_SIGNED_URL_TTL_SEC } from '@/lib/domain/signedUrl'

const WS = 'aaaaaaaa-1111-4111-8111-111111111111'
const PID = 'bbbbbbbb-2222-4222-8222-222222222222'
const ITEM = 'cccccccc-3333-4333-8333-333333333333'
const PATH_A = `ws/${WS}/p/${PID}/deliverables/${ITEM}/1700000000001-plan.xlsx`
const PATH_B = `ws/${WS}/p/${PID}/deliverables/${ITEM}/1700000000000-spec.pdf`
const row = (id: string, path: string, name: string) => ({
  id, wbs_item_id: ITEM, file_name: name, file_path: path, size: 10, mime: 'application/pdf',
  created_at: '2026-09-27T00:00:00Z',
})
const ROW_A = row('att-a', PATH_A, 'plan.xlsx')
const ROW_B = row('att-b', PATH_B, 'spec.pdf')
const ERR_LIST = '첨부 목록을 불러오지 못했습니다.'

type Signed = { data: { error: string | null; path: string | null; signedUrl: string | null }[] | null; error: unknown }

/** 가짜 서버 클라이언트 — 첨부 select 체인, can_attach rpc, 일괄 서명을 흉내 내고 호출을 기록한다. */
function sb(opts: {
  select?: { data: unknown; error: unknown }
  can?: { data: unknown; error: unknown }
  signed?: Signed
}) {
  const select = opts.select ?? { data: [], error: null }
  const from = vi.fn(() => ({
    select: () => ({ eq: () => ({ order: () => Promise.resolve(select) }) }),
  }))
  const rpc = vi.fn<(fn: string, args: unknown) => Promise<{ data: unknown; error: unknown }>>(
    async () => opts.can ?? { data: true, error: null })
  const createSignedUrls = vi.fn<(paths: string[], ttl: number) => Promise<Signed>>(
    async () => opts.signed ?? { data: [], error: null })
  const storageFrom = vi.fn<(bucket: string) => { createSignedUrls: typeof createSignedUrls }>(() => ({ createSignedUrls }))
  createServerClient.mockResolvedValue({ from, rpc, storage: { from: storageFrom } } as never)
  return { from, rpc, createSignedUrls, storageFrom }
}

let errSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.clearAllMocks()
  getSession.mockResolvedValue({ id: 'u-1' })
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => errSpy.mockRestore())

describe('listAttachments — 결과형과 다운로드 판정', () => {
  it('(a) can_attach false(조회 전용)면 목록은 주되 denied — 서명하지 않는다', async () => {
    const f = sb({ select: { data: [ROW_A], error: null }, can: { data: false, error: null } })
    const res = await listAttachments(ITEM)
    expect(res).toEqual({
      ok: true, download: 'denied',
      rows: [{
        id: 'att-a', wbsItemId: ITEM, fileName: 'plan.xlsx', filePath: PATH_A, size: 10, mime: 'application/pdf',
        createdAt: '2026-09-27T00:00:00Z', url: null,
      }],
    })
    expect(f.rpc).toHaveBeenCalledTimes(1)
    expect(f.rpc).toHaveBeenCalledWith('can_attach', { item: ITEM })
    expect(f.createSignedUrls).not.toHaveBeenCalled()
  })

  it('(b) select 오류는 빈 목록이 아니라 오류다 — 로그 1회, 판정·서명 없음', async () => {
    const f = sb({ select: { data: null, error: { message: 'boom' } } })
    expect(await listAttachments(ITEM)).toEqual({ ok: false, error: ERR_LIST })
    expect(errSpy).toHaveBeenCalledTimes(1)
    expect(f.rpc).not.toHaveBeenCalled()
    expect(f.createSignedUrls).not.toHaveBeenCalled()
  })

  it('(c) can_attach 판정 오류는 unknown — 서명하지 않고(fail-closed) 로그를 남긴다', async () => {
    const f = sb({ select: { data: [ROW_A], error: null }, can: { data: null, error: { message: 'rpc down' } } })
    const res = await listAttachments(ITEM)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.download).toBe('unknown')
    expect(res.rows).toHaveLength(1)
    expect(res.rows[0].url).toBeNull()
    expect(res.rows[0].linkError).toBeUndefined()
    expect(f.createSignedUrls).not.toHaveBeenCalled()
    expect(errSpy).toHaveBeenCalledTimes(1)
  })

  it('(d) 비로그인은 오류다(로그) — DB 를 부르지 않는다', async () => {
    getSession.mockResolvedValue(null)
    const f = sb({})
    expect(await listAttachments(ITEM)).toEqual({ ok: false, error: ERR_LIST })
    expect(errSpy).toHaveBeenCalledTimes(1)
    expect(createServerClient).not.toHaveBeenCalled()
    expect(f.from).not.toHaveBeenCalled()
    expect(f.rpc).not.toHaveBeenCalled()
  })

  it('(e) allowed 에서 한 행만 서명 실패 — 일괄 서명 1회(경로 2개), 실패한 행만 linkError', async () => {
    const f = sb({
      select: { data: [ROW_A, ROW_B], error: null },
      can: { data: true, error: null },
      signed: {
        data: [
          { path: PATH_A, signedUrl: 'https://signed.example.com/a', error: null },
          { path: PATH_B, signedUrl: null, error: 'Either the object does not exist or you do not have access to it' },
        ],
        error: null,
      },
    })
    const res = await listAttachments(ITEM)
    expect(f.storageFrom).toHaveBeenCalledWith('deliverables')
    expect(f.createSignedUrls).toHaveBeenCalledTimes(1)
    expect(f.createSignedUrls).toHaveBeenCalledWith([PATH_A, PATH_B], LIST_SIGNED_URL_TTL_SEC)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.download).toBe('allowed')
    const [a, b] = res.rows
    expect(a.url).toBe('https://signed.example.com/a')
    expect(a.linkError).toBeUndefined()
    expect(b.url).toBeNull()
    expect(b.linkError).toBe(true)
  })

  it('(e2) 일괄 서명 호출 자체가 실패하면 모든 행이 linkError(로그)', async () => {
    sb({
      select: { data: [ROW_A, ROW_B], error: null },
      can: { data: true, error: null },
      signed: { data: null, error: { message: 'storage down' } },
    })
    const res = await listAttachments(ITEM)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.download).toBe('allowed')
    expect(res.rows.map(r => [r.url, r.linkError])).toEqual([[null, true], [null, true]])
    expect(errSpy).toHaveBeenCalledTimes(1)
  })

  it('(f) 행 0개 + allowed 면 서명하지 않는다', async () => {
    const f = sb({ select: { data: [], error: null }, can: { data: true, error: null } })
    expect(await listAttachments(ITEM)).toEqual({ ok: true, rows: [], download: 'allowed' })
    expect(f.createSignedUrls).not.toHaveBeenCalled()
  })
})
