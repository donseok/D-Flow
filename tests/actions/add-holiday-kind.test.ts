// 날짜 예외의 쓰기(스펙 D7) — kind('off'|'work')를 세션 클라이언트 + RLS 로 쓴다(새 RPC 없음). 결과형·고정 문구(원문 0)·가드 먼저.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  requireProjectAdmin: vi.fn(),
  upsert: vi.fn(),
  del: vi.fn(),
  from: vi.fn(),
  revalidatePath: vi.fn(),
  recordProgressSnapshot: vi.fn(),
}))
vi.mock('@/lib/authz', async (orig) => ({ ...(await orig<Record<string, unknown>>()), requireProjectAdmin: m.requireProjectAdmin }))
vi.mock('next/cache', () => ({ revalidatePath: m.revalidatePath }))
vi.mock('next/server', async (orig) => ({ ...(await orig<Record<string, unknown>>()), after: (fn: () => unknown) => { void fn() } }))
vi.mock('@/lib/data/snapshots', () => ({ recordProgressSnapshot: m.recordProgressSnapshot }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: async () => ({ from: m.from }) }))

import { addHoliday, removeHoliday } from '@/app/actions/project'

const PID = '00000000-0000-0000-7e57-0000000019a0'
beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  m.requireProjectAdmin.mockResolvedValue({ ok: true, actor: { userId: 'u1' } })
  m.upsert.mockResolvedValue({ error: null })
  m.del.mockImplementation(() => ({ eq: () => ({ eq: async () => ({ error: null }) }) }))
  m.from.mockImplementation((table: string) => {
    if (table !== 'holidays') throw new Error(`unexpected table ${table}`)
    return { upsert: m.upsert, delete: m.del }
  })
  m.recordProgressSnapshot.mockResolvedValue(undefined)
})

describe('addHoliday — kind', () => {
  it.each(['off', 'work'] as const)('%s 를 그대로 쓴다(같은 날짜면 갱신 — onConflict project_id,date)', async (kind) => {
    expect(await addHoliday(PID, '2026-10-10', '  대체 근무 ', kind)).toEqual({ ok: true })
    expect(m.upsert).toHaveBeenCalledWith({ project_id: PID, date: '2026-10-10', name: '대체 근무', kind }, { onConflict: 'project_id,date' })
    expect(m.revalidatePath).toHaveBeenCalled()
  })

  it.each([
    ['모르는 kind', '2026-10-10', 'holiday'],
    ['날짜 형식', '2026/10/10', 'off'],
    ['없는 날짜', '2026-02-30', 'off'],
  ])('%s — DB 에 닿기 전에 거부', async (_n, date, kind) => {
    const r = await addHoliday(PID, date, '', kind as 'off')
    expect(r).toMatchObject({ ok: false })
    expect(m.from).not.toHaveBeenCalled()
  })

  it('가드 거부 — 결과로 돌려주고 DB 에 닿지 않는다', async () => {
    m.requireProjectAdmin.mockResolvedValue({ ok: false, error: 'ERR_DENIED' })
    expect(await addHoliday(PID, '2026-10-10', '', 'off')).toEqual({ ok: false, error: 'ERR_DENIED' })
    expect(m.from).not.toHaveBeenCalled()
  })

  it('DB 오류 — 원문을 싣지 않고 고정 문구', async () => {
    m.upsert.mockResolvedValue({ error: { code: '23514', message: 'new row for relation "holidays" violates check constraint "holidays_kind_check"' } })
    const r = await addHoliday(PID, '2026-10-10', '', 'work')
    expect(r).toEqual({ ok: false, error: '날짜 예외를 저장하지 못했습니다. 잠시 뒤 다시 시도하세요.' })
    expect(JSON.stringify(r)).not.toContain('holidays_kind_check')
  })
})

describe('removeHoliday — 결과형', () => {
  it('성공은 { ok: true }', async () => {
    expect(await removeHoliday(PID, '2026-10-10')).toEqual({ ok: true })
  })
  it('DB 오류는 고정 문구', async () => {
    m.del.mockImplementation(() => ({ eq: () => ({ eq: async () => ({ error: { message: 'boom' } }) }) }))
    expect(await removeHoliday(PID, '2026-10-10')).toEqual({ ok: false, error: '날짜 예외를 지우지 못했습니다. 잠시 뒤 다시 시도하세요.' })
  })
})
