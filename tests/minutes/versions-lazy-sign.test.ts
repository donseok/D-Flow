import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 버전 목록은 서명하지 않는다(P8-H1-4) — 화면을 그릴 때마다 모든 원본을 서명하면 권한을 회수해도 받은 페이지의 링크가
 * TTL 동안 산다. 원본은 클릭할 때 getMinuteVersionFileUrl 로 발급한다. 가짜 클라이언트에 storage 를 두지 않는다 —
 * getMinuteVersions 가 Storage 에 닿으면 곧 실패한다.
 */

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: mocks.createServerClient,
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

import { getMinuteVersions } from '@/lib/data/minutes'

type QueryResult = { data: unknown; error: { message: string } | null }

/** 체인 어느 지점에서 await 해도 동작하는 thenable 빌더. */
function queryBuilder(result: QueryResult) {
  const source = Promise.resolve(result)
  const builder: Record<string, ReturnType<typeof vi.fn>> & {
    then?: (res: (v: QueryResult) => unknown, rej: (e: unknown) => unknown) => Promise<unknown>
  } = {}
  for (const method of ['select', 'eq', 'in', 'is', 'or', 'not', 'order', 'limit']) {
    builder[method] = vi.fn(() => builder)
  }
  builder.maybeSingle = vi.fn(() => source)
  builder.then = (res, rej) => source.then(res, rej)
  return builder
}

const VERSION_ROWS = [
  {
    id: 'v-2', version_no: 2, title: '설계 회의', minute_date: '2026-08-02', file_name: '회의록.md',
    file_path: 'min-1/v2.md', created_by_name: '홍길동', created_at: '2026-08-02T00:00:00Z',
  },
  {
    id: 'v-1', version_no: 1, title: '설계 회의', minute_date: '2026-08-01', file_name: null,
    file_path: null, created_by_name: '홍길동', created_at: '2026-08-01T00:00:00Z',
  },
]

let consoleError: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  consoleError.mockRestore()
})

describe('getMinuteVersions — 서명하지 않는다', () => {
  it('Storage 에 닿지 않고 hasFile 은 file_path 유무다 — downloadHref 필드가 없다', async () => {
    const from = vi.fn(() => queryBuilder({ data: VERSION_ROWS, error: null }))
    mocks.createServerClient.mockResolvedValue({ from })

    const versions = await getMinuteVersions('min-1')

    expect(from).toHaveBeenCalledTimes(1)
    expect(from).toHaveBeenCalledWith('minute_versions')
    expect(versions.map(v => [v.id, v.hasFile, v.fileName])).toEqual([
      ['v-2', true, '회의록.md'],
      ['v-1', false, null],
    ])
    for (const v of versions) expect(v).not.toHaveProperty('downloadHref')
    expect(versions[0].viewHref).toBe('/minutes/min-1?version=v-2')
    expect(consoleError).not.toHaveBeenCalled()
  })
})
