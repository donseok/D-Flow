// 프로젝트 관리 액션의 DB 오류 — 결과의 error 에 원문(제약 이름·SQL 문구)을 싣지 않고 고정 문구 + 로그(SP4 B 최종 리뷰 관찰, failWith 규칙 — D21).
// updateProject(현재값 조회·저장)·setProjectPrivacy·setBaseDate. 원문은 console.error 로만 남는다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const RAW = 'duplicate key value violates unique constraint "projects_secret_idx"'
const h = vi.hoisted(() => ({ requireProjectAdmin: vi.fn(), server: vi.fn(), admin: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/server', () => ({ after: vi.fn() }))
vi.mock('@/lib/authz', () => ({ requireProjectAdmin: h.requireProjectAdmin, requireWorkspaceAdmin: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: h.server }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: h.admin }))
vi.mock('@/lib/data/snapshots', () => ({ recordProgressSnapshot: vi.fn() }))

import { setBaseDate, setProjectPrivacy, updateProject } from '@/app/actions/project'

const PID = '00000000-0000-0000-7e57-0000000019d1'
/** projects 표 하나 — select(...).eq().single() 와 update().eq() 의 결과를 정한다 */
function client(opts: { select?: { data: unknown; error: unknown }; update?: { error: unknown } }) {
  return {
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => opts.select ?? { data: { start_date: null, end_date: null }, error: null } }) }),
      update: () => ({ eq: async () => opts.update ?? { error: null } }),
    }),
  }
}
let err: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.clearAllMocks()
  err = vi.spyOn(console, 'error').mockImplementation(() => {})
  h.requireProjectAdmin.mockResolvedValue({ ok: true, actor: { userId: 'u1' } })
})
afterEach(() => err.mockRestore())

const noRaw = (r: { ok: boolean; error?: string }) => {
  expect(r.ok).toBe(false)
  expect(r.error).toBeTruthy()
  expect(r.error).not.toContain('constraint')
  expect(r.error).not.toContain('projects_secret_idx')
  expect(err).toHaveBeenCalled()   // 원문은 로그로
}

describe('프로젝트 액션 — DB 오류 원문 비노출', () => {
  it('updateProject 저장 실패', async () => {
    h.server.mockResolvedValue(client({ update: { error: { message: RAW, code: '23505' } } }))
    noRaw(await updateProject(PID, { name: '새 이름' }))
  })
  it('updateProject 의 현재값 조회 실패(부분 날짜 패치) — 저장을 멈추고 고정 문구', async () => {
    h.server.mockResolvedValue(client({ select: { data: null, error: { message: RAW } } }))
    noRaw(await updateProject(PID, { start_date: '2026-10-01' }))
  })
  it('updateProject 의 현재값 없음은 원래 문구(원문이 아니다)', async () => {
    h.server.mockResolvedValue(client({ select: { data: null, error: null } }))
    expect(await updateProject(PID, { start_date: '2026-10-01' })).toEqual({ ok: false, error: '프로젝트를 찾을 수 없습니다.' })
  })
  it('setProjectPrivacy 저장 실패', async () => {
    h.admin.mockReturnValue(client({ update: { error: { message: RAW } } }))
    noRaw(await setProjectPrivacy(PID, true))
  })
  it('setBaseDate 저장 실패', async () => {
    h.server.mockResolvedValue(client({ update: { error: { message: RAW } } }))
    noRaw(await setBaseDate(PID, '2026-10-01'))
  })
})
