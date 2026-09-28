// 공유 링크 관문(스펙 §4.2 3행·§7.1) — 모듈이 꺼진 워크스페이스의 공유 링크는 404 이고 본문 조회가 일어나지 않는다.
// 켜지면 본문을 그린다. 세션 클라이언트를 만들지 않는다(익명 경로 — { client: admin } 필수).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({
  selects: [] as string[],
  rows: { head: null as unknown, body: null as unknown },
  notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }),
}))
const admin = vi.hoisted(() => ({
  from: vi.fn((table: string) => {
    if (table !== 'minutes') throw new Error(`예상 밖 표: ${table}`)
    const b: Record<string, unknown> = {}
    let sel = ''
    b.select = (s: string) => { sel = s; m.selects.push(s); return b }
    b.eq = () => b; b.is = () => b
    b.maybeSingle = async () => ({ data: sel === 'workspace_id' ? m.rows.head : m.rows.body, error: null })
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
const render = () => SharedMinutePage({ params: Promise.resolve({ token: TOKEN }) })
beforeEach(() => {
  vi.clearAllMocks(); m.selects.length = 0
  m.rows.head = { workspace_id: WID }; m.rows.body = BODY
})
// 관문 mock 값을 바꾸는 파일 — 남은 Once 값이 뒤 케이스로 새지 않게 통과 구현으로 되돌린다(공통 규칙 '전역 mock')
afterEach(() => { for (const f of [requireModule, requireSessionModule, moduleState, projectsWithModule, workspacesWithModule]) vi.mocked(f).mockReset() })

describe('공유 링크 — minutes 모듈 관문', () => {
  it('꺼진 워크스페이스는 404 이고 본문 열을 읽지 않는다', async () => {
    vi.mocked(requireModule).mockResolvedValueOnce({ ok: false, error: ERR_MODULE_DISABLED })
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(m.selects).toEqual(['workspace_id'])
    expect(requireModule).toHaveBeenCalledWith({ workspaceId: WID }, 'minutes', { client: admin })
  })
  it('켜지면 본문을 그린다 — 워크스페이스 한 번, 본문 한 번', async () => {
    const el = (await render()) as unknown as { props: Record<string, unknown> }
    expect(m.selects).toEqual(['workspace_id', 'minute_date, team_code, title, body_md'])
    expect(el.props).toMatchObject({ minuteDate: '2026-09-01', teamCode: 'PMO', title: 'Acme 주간', bodyMd: '# 본문' })
  })
  it('토큰에 맞는 행이 없으면 관문을 부르지 않고 404', async () => {
    m.rows.head = null
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(requireModule).not.toHaveBeenCalled()
  })
})
