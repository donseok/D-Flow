// 공유 링크 관문(스펙 §4.2 3행·§7.1) — 모듈이 꺼진 워크스페이스의 공유 링크는 404 이고 본문 조회가 일어나지 않는다.
// 켜지면 본문을 그린다. 세션 클라이언트를 만들지 않는다(익명 경로 — { client: admin } 필수).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
type Filter = [op: 'eq' | 'is', column: string, value: unknown]
const m = vi.hoisted(() => ({
  selects: [] as string[],
  /** 조회마다 건 필터(eq·is) — 두 조회가 같은 토큰·공유·보관 조건을 각자 거는지 본다 */
  filters: [] as Filter[][],
  rows: { head: null as unknown, body: null as unknown },
  errors: { head: null as { message: string } | null, body: null as { message: string } | null },
  notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }),
}))
const admin = vi.hoisted(() => ({
  from: vi.fn((table: string) => {
    if (table !== 'minutes') throw new Error(`예상 밖 표: ${table}`)
    const b: Record<string, unknown> = {}
    let sel = ''
    const f: Filter[] = []
    m.filters.push(f)
    b.select = (s: string) => { sel = s; m.selects.push(s); return b }
    b.eq = (k: string, v: unknown) => { f.push(['eq', k, v]); return b }
    b.is = (k: string, v: unknown) => { f.push(['is', k, v]); return b }
    b.maybeSingle = async () => sel === 'workspace_id'
      ? { data: m.rows.head, error: m.errors.head }
      : { data: m.rows.body, error: m.errors.body }
    return b
  }),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => admin }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn(async () => { throw new Error('공유 페이지는 세션 클라이언트를 쓰지 않는다') }) }))
vi.mock('@/lib/supabase/env', () => ({ serviceRoleConfigured: () => true }))
vi.mock('@/lib/minutes/share', () => ({ isShareToken: () => true }))
vi.mock('@/components/minutes/ShareViewer', () => ({ ShareViewer: (p: Record<string, unknown>) => p }))
vi.mock('next/navigation', () => ({ notFound: m.notFound }))
import SharedMinutePage from '@/app/share/minutes/[token]/page'
import { moduleState, projectsWithModule, requireModule, requireSessionModule, workspacesWithModule } from '@/lib/modules/gate'
import { ERR_MODULE_DISABLED } from '@/lib/authz/errors'

const WID = '00000000-0000-0000-7e57-000000001421'
const TOKEN = 'tok'
const BODY = { minute_date: '2026-09-01', team_code: 'PMO', title: 'Acme 주간', body_md: '# 본문' }
/** 공유 행 하나를 고르는 조건 — 토큰·공유 켜짐·미보관. 두 조회가 각자 다 걸어야 한다(하나라도 빠지면 여러 행이 걸려 maybeSingle 이 실패한다) */
const SHARE_FILTERS: Filter[] = [['eq', 'share_token', TOKEN], ['eq', 'share_enabled', true], ['is', 'archived_at', null]]
const render = () => SharedMinutePage({ params: Promise.resolve({ token: TOKEN }) })
beforeEach(() => {
  vi.clearAllMocks(); m.selects.length = 0; m.filters.length = 0
  m.rows.head = { workspace_id: WID }; m.rows.body = BODY
  m.errors.head = null; m.errors.body = null
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
// 관문 mock 값을 바꾸는 파일 — 남은 Once 값이 뒤 케이스로 새지 않게 통과 구현으로 되돌린다(공통 규칙 '전역 mock')
afterEach(() => {
  for (const f of [requireModule, requireSessionModule, moduleState, projectsWithModule, workspacesWithModule]) vi.mocked(f).mockReset()
  vi.mocked(console.error).mockRestore()
})

describe('공유 링크 — minutes 모듈 관문', () => {
  it('꺼진 워크스페이스는 404 이고 본문 열을 읽지 않는다', async () => {
    vi.mocked(requireModule).mockResolvedValueOnce({ ok: false, error: ERR_MODULE_DISABLED })
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(m.selects).toEqual(['workspace_id'])
    expect(requireModule).toHaveBeenCalledWith({ workspaceId: WID }, 'minutes', { client: admin })
  })
  it('켜지면 본문을 그린다 — 워크스페이스 한 번, 본문 한 번. 두 조회 모두 토큰·공유·보관 조건을 건다', async () => {
    const el = (await render()) as unknown as { props: Record<string, unknown> }
    expect(m.selects).toEqual(['workspace_id', 'minute_date, team_code, title, body_md'])
    expect(m.filters).toHaveLength(2)
    expect(m.filters[0]).toEqual(SHARE_FILTERS)
    expect(m.filters[1]).toEqual(SHARE_FILTERS)
    expect(el.props).toMatchObject({ minuteDate: '2026-09-01', teamCode: 'PMO', title: 'Acme 주간', bodyMd: '# 본문' })
  })
  it('토큰에 맞는 행이 없으면 관문을 부르지 않고 404', async () => {
    m.rows.head = null
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(requireModule).not.toHaveBeenCalled()
  })
})

describe('공유 링크 — 조회 실패는 로그를 남기고 404(표시 = 로깅)', () => {
  it('① 범위 조회 오류 — 로그 뒤 404, 관문을 부르지 않는다', async () => {
    m.rows.head = null; m.errors.head = { message: 'db down' }
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(console.error).toHaveBeenCalledWith('[share] 공유 회의록 범위 조회 실패:', 'db down')
    expect(requireModule).not.toHaveBeenCalled()
  })
  it('③ 본문 조회 오류 — 로그 뒤 404', async () => {
    m.rows.body = null; m.errors.body = { message: 'db down' }
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(console.error).toHaveBeenCalledWith('[share] 공유 회의록 본문 조회 실패:', 'db down')
  })
})
