// 저장된 엑셀 양식 비우기(Task 1b) — 손상 양식(내보내기 422)·양식보다 깊은 WBS(400)로 막힌 프로젝트를 관리자가 풀어 준다.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireProjectAdmin: vi.fn(), requireWorkspaceAdmin: vi.fn(), getActorViewState: vi.fn(),
  createAdminClient: vi.fn(), createServerClient: vi.fn(), revalidatePath: vi.fn(),
}))
vi.mock('@/lib/authz', () => ({
  requireProjectAdmin: mocks.requireProjectAdmin, requireWorkspaceAdmin: mocks.requireWorkspaceAdmin, getActorViewState: mocks.getActorViewState,
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: mocks.createServerClient }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))

import { clearExcelProfile } from '@/app/actions/project'

const P1 = '11111111-1111-4111-8111-111111111111'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireProjectAdmin.mockResolvedValue({ ok: true, actor: { userId: 'admin-1' } })
})

describe('clearExcelProfile', () => {
  it('프로젝트 멤버(관리자 아님)는 가드 문구로 거부하고 DB 에 닿지 않는다', async () => {
    mocks.requireProjectAdmin.mockResolvedValue({ ok: false, error: '권한 없음' })
    expect(await clearExcelProfile(P1)).toEqual({ ok: false, error: '권한 없음' })
    expect(mocks.requireProjectAdmin).toHaveBeenCalledWith(P1)
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })

  it("관리자면 project_settings.excel_profile 을 '{}' 로 upsert 하고 설정 화면을 다시 그린다", async () => {
    const tables: string[] = []
    const upsert = vi.fn(async () => ({ error: null }))
    mocks.createAdminClient.mockReturnValue({ from: (t: string) => { tables.push(t); return { upsert } } })
    expect(await clearExcelProfile(P1)).toEqual({ ok: true })
    expect(tables).toEqual(['project_settings'])
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ project_id: P1, excel_profile: {}, updated_by: 'admin-1' }))
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/p/${P1}`, 'layout')
  })

  it('저장 오류는 그 문구 그대로 — 성공으로 위장하지 않는다', async () => {
    mocks.createAdminClient.mockReturnValue({ from: () => ({ upsert: async () => ({ error: { message: 'db down' } }) }) })
    expect(await clearExcelProfile(P1)).toEqual({ ok: false, error: 'db down' })
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })
})
