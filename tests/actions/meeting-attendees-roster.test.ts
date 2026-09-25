import { beforeEach, describe, expect, it, vi } from 'vitest'

// replaceAttendees(createMeeting 경유) — 참석자 명단 대조는 활성 명단 행·활성 인물만, insert 는 project_id 필수(0003).
const { createServerClient, requireProjectMember, getSession } = vi.hoisted(() => ({
  createServerClient: vi.fn(), requireProjectMember: vi.fn(), getSession: vi.fn(),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getSession }))
vi.mock('@/lib/authz', () => ({
  requireProjectMember, requireProjectAdmin: vi.fn(), resolveProjectId: vi.fn(), getActor: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({ createServerClient }))
vi.mock('@/lib/data/meetings', () => ({ getMyMeetings: vi.fn(), getMeetingDetail: vi.fn() }))

import { createMeeting } from '@/app/actions/meetings'
import { makeMemberActor } from '../fixtures/actor'

const INPUT = {
  title: '주간 점검', meetingDate: '2026-07-27', startTime: '14:00', endTime: '15:00',
  location: null, category: 'routine' as const, body: '', recurrence: 'none' as const,
  recurrenceUntil: null, attendeeIds: ['m1', 'm2', 'm1'],
}

type Result = { data: unknown; error: { message: string } | null }

/** 테이블별 응답 + 호출 기록. meetings insert→select→single, 명단 대조(await), 참석자 delete·insert. */
function client(roster: Result) {
  const calls: Array<[string, string, unknown[]]> = []
  const from = vi.fn((table: string) => {
    const q: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'in', 'insert', 'delete']) {
      q[m] = vi.fn((...args: unknown[]) => { calls.push([table, m, args]); return q })
    }
    q.single = vi.fn(async () => ({ data: { id: 'meet-1' }, error: null }))
    const res: Result = table === 'project_members' ? roster : { data: null, error: null }
    q.then = (resolve: (v: Result) => unknown, reject: (r: unknown) => unknown) => Promise.resolve(res).then(resolve, reject)
    return q
  })
  createServerClient.mockResolvedValue({ from })
  return { calls }
}
const on = (calls: Array<[string, string, unknown[]]>, table: string, method?: string) =>
  calls.filter(c => c[0] === table && (!method || c[1] === method)).map(c => [c[1], c[2]])

beforeEach(() => {
  vi.clearAllMocks()
  requireProjectMember.mockResolvedValue({ ok: true, actor: makeMemberActor('p1') })
  getSession.mockResolvedValue({ id: 'u1', email: 'alice@example.com', user_metadata: {} })
})

describe('createMeeting — 참석자 명단 대조와 insert', () => {
  it('활성 명단 행·활성 인물만 대조하고, 참석자 행에 project_id 를 싣는다', async () => {
    const { calls } = client({ data: [{ id: 'm1' }, { id: 'm2' }], error: null })

    expect(await createMeeting('p1', { ...INPUT })).toEqual({ ok: true, id: 'meet-1' })

    expect(on(calls, 'project_members')).toEqual([
      ['select', ['id, people!inner(active)']],
      ['eq', ['project_id', 'p1']],
      ['eq', ['active', true]],
      ['eq', ['people.active', true]],
      ['in', ['id', ['m1', 'm2']]],
    ])
    // 대조가 delete 보다 먼저 — 잘못된 목록이 기존 참석자를 지우지 못한다.
    const order = calls.map(c => `${c[0]}.${c[1]}`)
    expect(order.indexOf('project_members.select')).toBeLessThan(order.indexOf('meeting_attendees.delete'))
    expect(on(calls, 'meeting_attendees', 'insert')).toEqual([['insert', [[
      { meeting_id: 'meet-1', member_id: 'm1', project_id: 'p1' },
      { meeting_id: 'meet-1', member_id: 'm2', project_id: 'p1' },
    ]]]])
  })

  it('명단 대조 조회가 실패하면 참석자를 건드리지 않고 회의를 롤백한다', async () => {
    const { calls } = client({ data: null, error: { message: 'db down' } })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const r = await createMeeting('p1', { ...INPUT })

    spy.mockRestore()
    expect(r.ok).toBe(false)
    expect(on(calls, 'meeting_attendees')).toEqual([])
    expect(on(calls, 'meetings', 'delete')).toHaveLength(1)
  })
})
