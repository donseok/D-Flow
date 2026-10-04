import { beforeEach, describe, expect, it, vi } from 'vitest'

// SP5 B4 묶음4 — 어휘 code 이관 액션. 가드(프로젝트 관리자) → 키의 모듈 관문 → 입력 → service_role RPC(p_actor = 가드 결과).
const h = vi.hoisted(() => ({ rpc: vi.fn(), guard: vi.fn(), mod: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/authz', () => ({ requireProjectAdmin: h.guard }))
vi.mock('@/lib/modules/gate', () => ({ requireModule: h.mod }))
vi.mock('@/lib/supabase/adminFor', () => ({ adminFor: (s: object) => ({ ...s, admin: { rpc: h.rpc } }) }))

import { migrateVocabCode } from '@/app/actions/vocab'

const P = '00000000-0000-0000-7e57-000000001432'
beforeEach(() => {
  vi.clearAllMocks()
  h.guard.mockResolvedValue({ ok: true, actor: { userId: 'u-admin' } })
  h.mod.mockResolvedValue({ ok: true })
  h.rpc.mockResolvedValue({ data: 3, error: null })
})

describe('migrateVocabCode', () => {
  it('가드 결과의 행위자로 RPC 를 부르고 옮긴 건수를 돌려준다', async () => {
    expect(await migrateVocabCode(P, 'meetings.categories', 'review', 'routine')).toEqual({ ok: true, moved: 3 })
    expect(h.mod).toHaveBeenCalledWith({ projectId: P }, 'meetings')
    expect(h.rpc).toHaveBeenCalledWith('migrate_setting_code', { p_actor: 'u-admin', p_project_id: P, p_key: 'meetings.categories', p_from: 'review', p_to: 'routine' })
  })
  it('원인 분류·모르는 키·같은 code·형식 밖 code 는 RPC 전에 거부', async () => {
    for (const args of [['issues.cause_categories', 'it', 'process'], ['x.y', 'a', 'b'], ['issues.severities', 'low', 'low'], ['issues.severities', 'Low', 'high']] as const) {
      expect((await migrateVocabCode(P, ...args)).ok).toBe(false)
    }
    expect(h.rpc).not.toHaveBeenCalled()
  })
  it('가드·모듈 관문이 닫히면 RPC 에 닿지 않는다', async () => {
    h.guard.mockResolvedValueOnce({ ok: false, error: '권한 없음' })
    expect(await migrateVocabCode(P, 'issues.severities', 'low', 'high')).toEqual({ ok: false, error: '권한 없음' })
    h.mod.mockResolvedValueOnce({ ok: false, error: 'off' })
    expect(await migrateVocabCode(P, 'issues.severities', 'low', 'high')).toEqual({ ok: false, error: 'off' })
    expect(h.rpc).not.toHaveBeenCalled()
  })
  it('RPC 토큰을 고정 문구로 — 비활성 대상·교착(재시도)·권한', async () => {
    h.rpc.mockResolvedValueOnce({ data: null, error: { code: '23514', message: 'PROJECT_VOCAB_INACTIVE:issues.severities:low' } })
    expect((await migrateVocabCode(P, 'issues.severities', 'high', 'low')).ok).toBe(false)
    h.rpc.mockResolvedValueOnce({ data: null, error: { code: '40P01', message: 'deadlock detected' } })
    expect(await migrateVocabCode(P, 'issues.severities', 'high', 'low')).toMatchObject({ ok: false, retryable: true })
    h.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'VOCAB_MIGRATE_FORBIDDEN' } })
    const r = await migrateVocabCode(P, 'issues.severities', 'high', 'low')
    expect(r.ok === false && r.error).not.toContain('VOCAB_MIGRATE')
  })
})
