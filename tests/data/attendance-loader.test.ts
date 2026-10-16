import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ createServerClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: mocks.createServerClient }))

import { getAttendanceRecords, ERR_ATTENDANCE_LOAD } from '@/lib/data/attendance'

type Result = { data: unknown; error: { message: string } | null }

function client(result: Result) {
  const q: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'order']) q[m] = vi.fn(() => q)
  q.then = (resolve: (v: Result) => unknown, reject: (r: unknown) => unknown) => Promise.resolve(result).then(resolve, reject)
  mocks.createServerClient.mockResolvedValue({ from: vi.fn(() => q) })
}

beforeEach(() => vi.clearAllMocks())

describe('getAttendanceRecords — 조회 실패를 "근태 없음"으로 위장하지 않는다(3원칙 ①, B5)', () => {
  it('정상 — 행을 근태 기록으로 편다', async () => {
    client({ data: [{ id: 'r1', project_id: 'p1', member_id: 'm1', date: '2026-10-01', type: 'leave', note: null }], error: null })
    expect(await getAttendanceRecords('p1')).toEqual({
      ok: true, records: [{ id: 'r1', projectId: 'p1', memberId: 'm1', date: '2026-10-01', type: 'leave', note: null }],
    })
  })
  it('정상 0건은 빈 목록이다', async () => {
    client({ data: [], error: null })
    expect(await getAttendanceRecords('p1')).toEqual({ ok: true, records: [] })
  })
  it('실패 — 빈 목록이 아니라 오류 결과 + 로그', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    client({ data: null, error: { message: 'boom' } })
    expect(await getAttendanceRecords('p1')).toEqual({ ok: false, error: ERR_ATTENDANCE_LOAD })
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
