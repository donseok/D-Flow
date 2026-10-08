import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ getSession: vi.fn(), createServerClient: vi.fn(), ops: [] as unknown[][], reads: 0 }))
vi.mock('@/lib/auth', () => ({ getSession: h.getSession }))
vi.mock('@/lib/authz', () => ({ getActor: vi.fn() }))
vi.mock('@/lib/authz/visibility', () => ({ getHiddenProjectIds: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: h.createServerClient }))

import { getAccountPrefs, saveNotifPrefs } from '@/app/actions/preferences'
import { NOTIFICATION_CATALOG, isTypeEnabled, type NotificationType } from '@/lib/domain/inbox'

/** account_preferences 자기 행 흉내 — readFailAt 번째(1부터) 선행 조회가 실패한다 */
function db(prefs: Record<string, unknown> | null, opts: { readFailAt?: number; writeFail?: boolean } = {}) {
  return {
    from: (table: string) => {
      const q: Record<string, unknown> = {
        select: () => q, eq: () => q,
        maybeSingle: async () => {
          h.reads += 1
          return opts.readFailAt === h.reads ? { data: null, error: { message: 'down' } } : { data: prefs ? { prefs } : null, error: null }
        },
        upsert: async (row: Record<string, unknown>) => { h.ops.push([table, row.prefs]); return { error: opts.writeFail ? { message: 'write down' } : null } },
      }
      return q
    },
  }
}
beforeEach(() => {
  vi.clearAllMocks(); h.ops.length = 0; h.reads = 0
  h.getSession.mockResolvedValue({ id: 'u1' })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('saveNotifPrefs — 개인 알림 유형 토글(SPU1, 개정 §4.10)', () => {
  it('자기 계정 행의 notif 에 부분 병합한다 — 다른 유형의 토글과 다른 계정 키를 지우지 않는다', async () => {
    h.createServerClient.mockResolvedValue(db({ theme: 'dark', notif: { 'issue.status': false } }))
    expect(await saveNotifPrefs({ 'work.assigned': false })).toEqual({ ok: true })
    expect(h.ops).toEqual([['account_preferences', { theme: 'dark', notif: { 'issue.status': false, 'work.assigned': false } }]])
  })
  it('행이 없으면 그 유형만 담아 만든다', async () => {
    h.createServerClient.mockResolvedValue(db(null))
    expect(await saveNotifPrefs({ 'work.progress': true })).toEqual({ ok: true })
    expect(h.ops).toEqual([['account_preferences', { notif: { 'work.progress': true } }]])
  })
  it('required 유형은 끌 수 없다 — 거부하고 쓰지 않는다', async () => {
    h.createServerClient.mockResolvedValue(db({ notif: {} }))
    const required = (Object.keys(NOTIFICATION_CATALOG) as NotificationType[]).filter((k) => NOTIFICATION_CATALOG[k].required)
    expect(required).toEqual(['work.reported', 'work.approval_step', 'work.rejected'])
    for (const type of required) expect(await saveNotifPrefs({ [type]: false })).toEqual({ ok: false })
    // 다른 유형과 섞어 보내도 통째로 거부한다(부분 저장 없음)
    expect(await saveNotifPrefs({ 'work.assigned': false, 'work.reported': false })).toEqual({ ok: false })
    expect(h.ops).toEqual([])
  })
  it('카탈로그 밖 유형·불리언이 아닌 값·객체가 아닌 입력은 거부한다', async () => {
    h.createServerClient.mockResolvedValue(db({ notif: {} }))
    for (const patch of [{ 'nope.type': false }, { toString: false }, { 'work.assigned': 'off' }, null, [], 'x']) {
      expect(await saveNotifPrefs(patch as unknown as Record<string, boolean>)).toEqual({ ok: false })
    }
    expect(h.ops).toEqual([])
  })
  it('비로그인은 DB 에 닿지 않고 실패', async () => {
    h.getSession.mockResolvedValue(null)
    expect(await saveNotifPrefs({ 'work.assigned': false })).toEqual({ ok: false })
    expect(h.createServerClient).not.toHaveBeenCalled()
  })
  it('선행 조회가 실패하면 저장을 중단한다(옛 토글을 덮지 않는다)', async () => {
    h.createServerClient.mockResolvedValue(db({ notif: { 'issue.status': false } }, { readFailAt: 1 }))
    expect(await saveNotifPrefs({ 'work.assigned': false })).toEqual({ ok: false })
    expect(h.ops).toEqual([])
  })
  it('쓰기 실패는 ok:false', async () => {
    h.createServerClient.mockResolvedValue(db({ notif: {} }, { writeFail: true }))
    expect(await saveNotifPrefs({ 'work.assigned': false })).toEqual({ ok: false })
  })
  it('저장한 opt-out 은 조회 시점 필터에 그대로 먹는다(소급 적용) — required 는 값과 무관하게 켜짐', async () => {
    h.createServerClient.mockResolvedValue(db({ notif: {} }))
    await saveNotifPrefs({ 'work.assigned': false })
    const stored = (h.ops[0][1] as { notif: Record<string, boolean> }).notif
    expect(isTypeEnabled(stored, 'work.assigned')).toBe(false)
    expect(isTypeEnabled(stored, 'issue.assigned')).toBe(true)
    expect(isTypeEnabled({ 'work.reported': false }, 'work.reported')).toBe(true)
  })
})

describe('getAccountPrefs strict — 조회 실패를 기본값으로 위장하지 않는다', () => {
  it('strict 면 던지고, 아니면 로그 + {}', async () => {
    h.createServerClient.mockResolvedValue(db({ notif: {} }, { readFailAt: 1 }))
    await expect(getAccountPrefs({ strict: true })).rejects.toThrow('개인 설정을 불러오지 못했습니다.')
    h.reads = 0
    expect(await getAccountPrefs()).toEqual({})
    expect(console.error).toHaveBeenCalled()
  })
})
