import JSZip from 'jszip'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  createServerClient: vi.fn(),
  getActor: vi.fn(),
  loadDisplayBranding: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: mocks.createServerClient }))
vi.mock('@/lib/authz', () => ({ getActor: mocks.getActor }))
vi.mock('@/lib/settings/displayBranding', () => ({ loadDisplayBranding: mocks.loadDisplayBranding }))

import { NextRequest } from 'next/server'
import { GET as exportGET } from '@/app/api/minutes/export/route'
import { ERR_MISSING, ERR_MODULE_DISABLED } from '@/lib/authz/errors'
import { ERR_WORKSPACE_REQUIRED } from '@/lib/authz/workspace'
import { makeActor } from '../fixtures/actor'

const W = '00000000-0000-0000-7e57-000000001791', WX = '00000000-0000-0000-7e57-000000001792'
/** 회의록 화면이 싣는 워크스페이스(과제 34) — 기본은 소속 W */
const GET = (q: string = `workspaceId=${W}`) => exportGET(new NextRequest(`http://l/api/minutes/export${q ? `?${q}` : ''}`))
import { moduleState, projectsWithModule, requireModule, requireSessionModule, workspacesWithModule } from '@/lib/modules/gate'

type MinuteRow = {
  id: string
  minute_date: string
  team_code: string
  title: string
  body_md: string
  meeting_id: string | null
  created_by_name: string | null
  created_at: string
  updated_at: string
}

type QueryResult = {
  data: MinuteRow[] | null
  error: { message: string; code?: string } | null
}

type QueryBuilder = Record<string, ReturnType<typeof vi.fn>> & {
  then: (
    resolve: (value: QueryResult) => unknown,
    reject: (reason: unknown) => unknown,
  ) => Promise<unknown>
}

type PageFactory = (input: {
  page: number
  limit: number | undefined
  cursor: string | undefined
}) => QueryResult

/**
 * Supabase의 thenable query builder를 흉내 낸다. 응답 factory가 실제 `.limit(n)`을
 * 읽으므로 라우트의 배치 크기를 테스트에 복제하지 않아도 정확히 한 full page를 만들 수 있다.
 */
function fakeClient(pageFactory: PageFactory) {
  const builders: QueryBuilder[] = []
  const from = vi.fn((table: string) => {
    if (table !== 'minutes') throw new Error(`unexpected table: ${table}`)

    const builder = {} as QueryBuilder
    for (const method of ['select', 'eq', 'is', 'lte', 'gt', 'order', 'limit']) {
      builder[method] = vi.fn(() => builder)
    }
    builder.then = (resolve, reject) => {
      const limit = builder.limit.mock.calls.at(-1)?.[0] as number | undefined
      const cursor = builder.gt.mock.calls.find(call => call[0] === 'id')?.[1] as string | undefined
      return Promise.resolve(pageFactory({ page: builders.indexOf(builder), limit, cursor }))
        .then(resolve, reject)
    }
    builders.push(builder)
    return builder
  })

  return { client: { from }, from, builders }
}

function row(overrides: Partial<MinuteRow> = {}): MinuteRow {
  return {
    id: '10000000-0000-0000-0000-000000000001',
    minute_date: '2026-07-21',
    team_code: 'ERP',
    title: '주간회의_260721',
    body_md: '## 결정\n\n원문 그대로 ✅\r\n마지막 줄',
    meeting_id: null,
    created_by_name: '테스트 작성자',
    created_at: '2026-07-21T01:02:03.000Z',
    updated_at: '2026-07-21T02:03:04.000Z',
    ...overrides,
  }
}

function jsonError(message = 'database unavailable'): QueryResult {
  return { data: null, error: { message } }
}

describe('GET /api/minutes/export', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
    mocks.getSession.mockResolvedValue({ id: 'user-1' })
    mocks.getActor.mockResolvedValue(makeActor({ workspaceRoles: new Map([[W, 'member']]) }))
    mocks.loadDisplayBranding.mockResolvedValue({ productName: 'Acme PM', mailFromName: 'Acme PM' })
  })
  // 관문 mock 값을 바꾸는 파일 — 전역 통과 구현으로 되돌린다(공통 규칙)
  afterEach(() => { for (const f of [requireModule, requireSessionModule, moduleState, projectsWithModule, workspacesWithModule]) vi.mocked(f).mockReset() })

  it('minutes 모듈이 꺼지면 404 JSON 이고 DB 에 접근하지 않는다 — 요청의 워크스페이스로 판정(과제 20·34)', async () => {
    vi.mocked(requireModule).mockResolvedValueOnce({ ok: false, error: ERR_MODULE_DISABLED })
    const res = await GET()
    expect(res.status).toBe(404)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(await res.json()).toMatchObject({ error: ERR_MODULE_DISABLED })
    expect(requireModule).toHaveBeenCalledWith({ workspaceId: W }, 'minutes')
    expect(requireSessionModule).not.toHaveBeenCalled()
    expect(mocks.createServerClient).not.toHaveBeenCalled()
  })

  it('로그인하지 않았으면 모듈 판정 전에 401(과제 20)', async () => {
    mocks.getSession.mockResolvedValue(null)
    expect((await GET()).status).toBe(401)
    expect(requireModule).not.toHaveBeenCalled()
  })

  it('워크스페이스가 없으면 400 — 세션 유일 워크스페이스로 추측하지 않는다(과제 34)', async () => {
    for (const q of ['', 'workspaceId=']) {
      const res = await GET(q)
      expect(res.status).toBe(400)
      expect(await res.json()).toMatchObject({ error: ERR_WORKSPACE_REQUIRED })
    }
    expect(requireModule).not.toHaveBeenCalled()
    expect(mocks.createServerClient).not.toHaveBeenCalled()
  })

  it.each([
    ['비소속(존재하는 남의 워크스페이스)', `workspaceId=${WX}`],
    ['형식 밖(대문자 변형)', `workspaceId=${W.toUpperCase()}`],
    ['형식 밖(인코딩된 줄바꿈)', `workspaceId=${W}%0A`],
    ['형식 밖(중복 키 — 첫 값이 남의 것)', `workspaceId=${WX}&workspaceId=${W}`],
  ])('적대 — %s 는 404 이고 브랜딩·DB 에 접근하지 않는다(과제 34)', async (_n, q) => {
    const res = await GET(q)
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ error: ERR_MISSING })
    expect(requireModule).not.toHaveBeenCalled()
    expect(mocks.loadDisplayBranding).not.toHaveBeenCalled()
    expect(mocks.createServerClient).not.toHaveBeenCalled()
  })

  it('행 거르기·브랜딩은 그 워크스페이스로 — 다른 워크스페이스 회의록이 ZIP 에 섞이지 않는다(과제 34)', async () => {
    const fake = fakeClient(() => ({ data: [row()], error: null }))
    mocks.createServerClient.mockResolvedValue(fake.client)
    expect((await GET()).status).toBe(200)
    expect(mocks.loadDisplayBranding).toHaveBeenCalledWith(W)
    for (const b of fake.builders) expect(b.eq).toHaveBeenCalledWith('workspace_id', W)
  })

  it('로그인하지 않은 요청은 JSON 401이며 DB에 접근하지 않는다', async () => {
    mocks.getSession.mockResolvedValue(null)

    const response = await GET()

    expect(response.status).toBe(401)
    expect(response.headers.get('content-type')).toContain('application/json')
    await expect(response.json()).resolves.toMatchObject({ error: expect.any(String) })
    expect(mocks.createServerClient).not.toHaveBeenCalled()
  })

  it('id 오름차순 keyset과 동일 cutoff로 모든 페이지를 조회한다', async () => {
    const firstId = (index: number) =>
      `00000000-0000-0000-0000-${String(index).padStart(12, '0')}`
    let expectedCursor = ''
    const fake = fakeClient(({ page, limit }) => {
      expect(limit).toBe(500)
      if (page === 0) {
        const rows = Array.from({ length: limit! }, (_, index) => row({
          id: firstId(index + 1),
          title: `회의_${String(index + 1).padStart(4, '0')}_260721`,
          body_md: `page-one-${index + 1}`,
        }))
        expectedCursor = rows.at(-1)!.id
        return { data: rows, error: null }
      }
      return { data: [row({
        id: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
        title: '마지막회의_260722',
        body_md: 'last page',
      })], error: null }
    })
    mocks.createServerClient.mockResolvedValue(fake.client)

    const response = await GET()

    expect(response.status).toBe(200)
    expect(fake.from).toHaveBeenCalledTimes(2)
    expect(fake.from).toHaveBeenNthCalledWith(1, 'minutes')
    expect(fake.from).toHaveBeenNthCalledWith(2, 'minutes')
    for (const builder of fake.builders) {
      expect(builder.select).toHaveBeenCalledWith(expect.stringContaining('body_md'))
      expect(builder.is).toHaveBeenCalledWith('archived_at', null)
      expect(builder.order).toHaveBeenCalledWith('id', { ascending: true })
      expect(builder.limit).toHaveBeenCalledWith(500)
      expect(builder.lte).toHaveBeenCalledWith('created_at', expect.any(String))
    }
    expect(fake.builders[0].gt).not.toHaveBeenCalled()
    expect(fake.builders[1].gt).toHaveBeenCalledWith('id', expectedCursor)
    const cutoffs = fake.builders.map(builder =>
      builder.lte.mock.calls.find(call => call[0] === 'created_at')?.[1],
    )
    expect(cutoffs[0]).toBeTruthy()
    expect(cutoffs[1]).toBe(cutoffs[0])
  })

  it('DB 페이지 조회가 실패하면 세부 오류를 노출하지 않고 JSON 500을 반환한다', async () => {
    const fake = fakeClient(() => jsonError('postgres password=do-not-leak'))
    mocks.createServerClient.mockResolvedValue(fake.client)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = await GET()

    expect(response.status).toBe(500)
    expect(response.headers.get('content-type')).toContain('application/json')
    const body = await response.json() as { error: string }
    expect(body.error).toEqual(expect.any(String))
    expect(JSON.stringify(body)).not.toContain('do-not-leak')
    consoleError.mockRestore()
  })

  it('내보낼 회의록이 없으면 JSON 404를 반환한다', async () => {
    const fake = fakeClient(() => ({ data: [], error: null }))
    mocks.createServerClient.mockResolvedValue(fake.client)

    const response = await GET()

    expect(response.status).toBe(404)
    expect(response.headers.get('content-type')).toContain('application/json')
    await expect(response.json()).resolves.toMatchObject({ error: expect.any(String) })
  })

  it('canonical body_md와 계층 경로, manifest, README를 담은 no-store ZIP을 반환한다', async () => {
    const source = row()
    const fake = fakeClient(() => ({ data: [source], error: null }))
    mocks.createServerClient.mockResolvedValue(fake.client)

    const response = await GET()

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/zip')
    expect(response.headers.get('cache-control')).toBe('no-store')
    const disposition = response.headers.get('content-disposition') ?? ''
    expect(disposition).toContain('attachment;')
    expect(disposition).toMatch(/filename\*\s*=\s*UTF-8''[^;]+/i)

    const archive = await JSZip.loadAsync(await response.arrayBuffer())
    const minutePath =
      `minutes/ERP/주간회의/2026-07-21__주간회의_260721__${source.id}.md`
    expect(archive.file(minutePath)).not.toBeNull()
    await expect(archive.file(minutePath)!.async('string')).resolves.toBe(source.body_md)
    expect(archive.file('_manifest.csv')).not.toBeNull()
    expect(archive.file('_README.txt')).not.toBeNull()
    expect(decodeURIComponent(disposition)).toContain('Acme_PM_회의록_전체')
    expect(await archive.file('_README.txt')!.async('string')).toContain('Acme PM 회의록 전체 내보내기')
    expect(mocks.loadDisplayBranding).toHaveBeenCalledWith(W)

    const manifest = await archive.file('_manifest.csv')!.async('string')
    expect(manifest).toContain(source.id)
    expect(manifest).toContain(source.title)
    expect(manifest).toContain(minutePath)
    expect((await archive.file('_README.txt')!.async('string')).trim()).not.toBe('')
  })

  it('canonical 본문의 UTF-8 합계가 100MB를 넘으면 413을 반환한다', async () => {
    const maxBytes = 100 * 1024 * 1024
    // 각 문서는 제한 이하지만, 한글의 UTF-8 바이트 합계는 제한을 넘는다.
    // 문자 수(.length)를 더하는 잘못된 구현도 이 케이스가 잡아낸다.
    const body = '가'.repeat(Math.floor(maxBytes / 6) + 1)
    expect(Buffer.byteLength(body, 'utf8')).toBeLessThan(maxBytes)
    expect(Buffer.byteLength(body, 'utf8') * 2).toBeGreaterThan(maxBytes)
    const fake = fakeClient(() => ({
      data: [
        row({ id: '10000000-0000-0000-0000-000000000001', body_md: body }),
        row({ id: '10000000-0000-0000-0000-000000000002', body_md: body }),
      ],
      error: null,
    }))
    mocks.createServerClient.mockResolvedValue(fake.client)

    const response = await GET()

    expect(response.status).toBe(413)
    expect(response.headers.get('content-type')).toContain('application/json')
    await expect(response.json()).resolves.toMatchObject({ error: expect.any(String) })
  }, 20_000)
})
