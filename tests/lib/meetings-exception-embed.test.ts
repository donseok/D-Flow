import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }))

import { createServerClient } from '@/lib/supabase/server'
import { ERR_MEETINGS_LOAD, getProjectMeetingData, getMyMeetings } from '@/lib/data/meetings'

type Reply = { data: unknown[] | null; error: { message: string } | null }
const OK = (rows: unknown[]): Reply => ({ data: rows, error: null })
const ERR = (message: string): Reply => ({ data: null, error: { message } })

const EMBED_ERR = ERR("Could not find a relationship between 'meetings' and 'meeting_exceptions'")

/**
 * 최소 supabase 스텁. meetings 는 select 문자열을 그대로 넘겨받아(임베드 포함 여부로 분기)
 * 응답을 정한다 — selectMeetings 의 "임베드 → 실패 시 임베드 없이 재시도" 경로를 실제로 태운다.
 */
function makeSb(opts: {
  user?: { id: string; email?: string | null } | null
  meetings: (select: string) => Reply | Promise<Reply>
  exceptions?: Reply
  members?: Reply | Promise<Reply>
}) {
  const selects: string[] = []
  const tables: string[] = []
  const chain = (resolve: () => Reply | Promise<Reply>) => {
    const o: Record<string, unknown> = {}
    for (const k of ['eq', 'or', 'order', 'in', 'limit', 'maybeSingle']) o[k] = () => o
    o.then = (res: unknown, rej: unknown) =>
      Promise.resolve(resolve()).then(res as never, rej as never)
    return o
  }
  const sb = {
    auth: {
      getUser: async () => ({ data: { user: opts.user ?? null } }),
      // getActor 는 getClaims 로 세션을 본다(2026-09-14) — getUser 는 getSession 경로용으로 남긴다.
      getClaims: async () => ({ data: opts.user ? { claims: { sub: opts.user.id, email: opts.user.email } } : null }),
    },
    from: (table: string) => {
      tables.push(table)
      return {
        select: (sel: string) => {
          if (table === 'meetings') { selects.push(sel); return chain(() => opts.meetings(sel)) }
          if (table === 'meeting_exceptions') return chain(() => opts.exceptions ?? OK([]))
          if (table === 'project_members') return chain(() => opts.members ?? OK([]))
          return chain(() => OK([]))
        },
      }
    },
  }
  ;(createServerClient as unknown as { mockResolvedValue: (v: unknown) => void })
    .mockResolvedValue(sb)
  return { selects, tables }
}

const meetingRow = (id: string, extra: Record<string, unknown> = {}) => ({
  id, project_id: 'p1', title: `회의 ${id}`, meeting_date: '2026-07-20',
  start_time: null, end_time: null, location: null, category: 'weekly',
  recurrence: 'none', recurrence_until: null, created_by: null, created_by_name: null,
  created_at: '2026-07-20T00:00:00Z', updated_at: '2026-07-20T00:00:00Z',
  meeting_attendees: [], ...extra,
})
const exRow = (meetingId: string, date: string) =>
  ({ meeting_id: meetingId, occurrence_date: date, kind: 'cancelled' })

beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}) })
afterEach(() => { vi.restoreAllMocks() })

/** 성공 결과만 — 실패면 사유로 던져 테스트를 깬다. */
async function projectMeetings(projectId: string) {
  const res = await getProjectMeetingData(projectId)
  if (!res.ok) throw new Error(res.error)
  return res
}

/** 내 회의의 성공 결과만 — 실패면 테스트를 깬다. */
async function myMeetings(gridStartIso: string, gridEndIso: string) {
  const res = await getMyMeetings(gridStartIso, gridEndIso)
  if (!res.ok) throw new Error('ok 여야 한다')
  return res
}

describe('getProjectMeetingData — 예외 FK 임베드', () => {
  it('임베드가 성공하면 별도 meeting_exceptions 왕복 없이 예외를 평탄화한다', async () => {
    const { tables } = makeSb({
      meetings: () => OK([
        meetingRow('m1', { meeting_exceptions: [exRow('m1', '2026-07-27')] }),
        meetingRow('m2', { meeting_exceptions: [] }),
      ]),
    })
    const res = await projectMeetings('embed-ok')
    expect(res.meetings.map(m => m.id)).toEqual(['m1', 'm2'])
    expect(res.exceptions).toEqual([
      { meetingId: 'm1', occurrenceDate: '2026-07-27', kind: 'cancelled' },
    ])
    // 왕복 절감이 이 수정의 목적 — 예외 테이블을 따로 치면 안 된다.
    expect(tables).not.toContain('meeting_exceptions')
  })

  it('임베드 실패 시 임베드 없이 재시도하고 예외는 별도 조회한다 — 결과는 동일', async () => {
    const { selects, tables } = makeSb({
      meetings: sel => sel.includes('meeting_exceptions')
        ? EMBED_ERR
        : OK([meetingRow('m1')]),
      exceptions: OK([exRow('m1', '2026-07-27')]),
    })
    const res = await projectMeetings('embed-fail')
    expect(res.meetings.map(m => m.id)).toEqual(['m1'])
    expect(res.exceptions).toEqual([
      { meetingId: 'm1', occurrenceDate: '2026-07-27', kind: 'cancelled' },
    ])
    expect(selects).toHaveLength(2)          // 임베드 시도 → 임베드 없는 재시도
    expect(tables).toContain('meeting_exceptions')
    expect(console.error).toHaveBeenCalled() // 조용히 넘어가지 않는다
  })

  it('재시도까지 실패하면 실패를 결과로 돌려주고 로그를 남긴다 — 회의 0건으로 위장하지 않는다', async () => {
    const { tables } = makeSb({ meetings: () => EMBED_ERR })
    const res = await getProjectMeetingData('embed-fail-twice')
    expect(ERR_MEETINGS_LOAD).toBe('회의 일정을 불러오지 못했습니다.')
    expect(res).toEqual({ ok: false, error: '회의 일정을 불러오지 못했습니다.' })
    expect(console.error).toHaveBeenCalledTimes(2)
    // 회의를 못 읽었으면 예외 폴백 조회도 하지 않는다
    expect(tables).not.toContain('meeting_exceptions')
  })
})

describe('getMyMeetings — 멤버 조회 병렬화 + 임베드', () => {
  it('비로그인이면 조회 없이 빈 결과', async () => {
    const { tables } = makeSb({ user: null, meetings: () => OK([]) })
    expect(await getMyMeetings('2026-07-01', '2026-07-31'))
      .toEqual({ ok: true, meetings: [], exceptions: [] })
    expect(tables).not.toContain('meetings')
  })

  it('멤버 조회를 기다리지 않고 회의 조회를 함께 띄운다', async () => {
    let releaseMembers: (r: Reply) => void = () => {}
    const membersPending = new Promise<Reply>(r => { releaseMembers = r })
    const { selects } = makeSb({
      user: { id: 'u1', email: null },
      members: membersPending,
      meetings: () => OK([]),
    })

    const p = getMyMeetings('2026-07-01', '2026-07-31')
    // 멤버 응답을 아직 주지 않았는데도 회의 select 가 이미 나가 있어야 병렬이다.
    // (직렬이었다면 멤버가 풀릴 때까지 meetings 는 시작조차 못 한다.)
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    expect(selects.length).toBe(1)
    releaseMembers(OK([]))
    await p
  })

  it('isMine 을 작성자·참석자 양쪽으로 계산한다 — 멤버 ID 병렬화 후에도 보존', async () => {
    makeSb({
      user: { id: 'u1', email: null },
      members: OK([{ id: 'member-a' }]),
      meetings: () => OK([
        meetingRow('mine-by-author', { created_by: 'u1' }),
        meetingRow('mine-by-attendee', { meeting_attendees: [{ member_id: 'member-a' }] }),
        meetingRow('not-mine', { meeting_attendees: [{ member_id: 'member-z' }] }),
      ]),
    })
    const res = await myMeetings('2026-07-01', '2026-07-31')
    expect(res.meetings.map(m => [m.id, m.isMine])).toEqual([
      ['mine-by-author', true], ['mine-by-attendee', true], ['not-mine', false],
    ])
  })

  it('임베드된 예외를 평탄화한다', async () => {
    const { tables } = makeSb({
      user: { id: 'u1', email: null },
      meetings: () => OK([
        meetingRow('m1', { meeting_exceptions: [exRow('m1', '2026-07-27'), exRow('m1', '2026-08-03')] }),
      ]),
    })
    const res = await myMeetings('2026-07-01', '2026-07-31')
    expect(res.exceptions).toEqual([
      { meetingId: 'm1', occurrenceDate: '2026-07-27', kind: 'cancelled' },
      { meetingId: 'm1', occurrenceDate: '2026-08-03', kind: 'cancelled' },
    ])
    expect(tables).not.toContain('meeting_exceptions')
  })
})

describe('조회 실패를 없음으로 위장하지 않는다(M5)', () => {
  /** console.error 에 찍힌 첫 인자들 — 표시한 실패는 로그에도 남아야 한다(표시 = 로깅). */
  const logged = () => (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls.map(c => String(c[0]))

  it('getProjectMeetingData: 임베드 실패 뒤 예외 별도 조회까지 실패하면 ok:false', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    makeSb({ meetings: (sel) => (sel.includes('meeting_exceptions') ? EMBED_ERR : OK([meetingRow('m1')])), exceptions: ERR('boom') })
    expect(await getProjectMeetingData('p1')).toEqual({ ok: false, error: ERR_MEETINGS_LOAD })
    expect(logged().some(m => m.includes('getProjectMeetingData') && m.includes('meeting_exceptions'))).toBe(true)
  })
  it('getMyMeetings: 회의 조회가 재시도까지 실패하면 ok:false — 빈 달력이 아니다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { tables } = makeSb({ user: { id: 'u1', email: null }, meetings: () => ERR('down') })
    expect(await getMyMeetings('2026-07-01', '2026-07-31')).toEqual({ ok: false, error: ERR_MEETINGS_LOAD })
    expect(logged().some(m => m.includes('getMyMeetings') && m.includes('meetings 조회 실패'))).toBe(true)
    // 회의를 못 읽었으면 예외 폴백 조회도 하지 않는다
    expect(tables).not.toContain('meeting_exceptions')
  })
  it('getMyMeetings: 임베드 실패 뒤 예외 별도 조회까지 실패하면 ok:false', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    makeSb({
      user: { id: 'u1', email: null },
      meetings: (sel) => (sel.includes('meeting_exceptions') ? EMBED_ERR : OK([meetingRow('m1')])),
      exceptions: ERR('boom'),
    })
    expect(await getMyMeetings('2026-07-01', '2026-07-31')).toEqual({ ok: false, error: ERR_MEETINGS_LOAD })
    expect(logged().some(m => m.includes('getMyMeetings') && m.includes('meeting_exceptions'))).toBe(true)
  })
  it('임베드만 실패하고 예외 별도 조회가 0건이면 종전대로 ok:true — 0건과 실패를 가른다', async () => {
    makeSb({
      user: { id: 'u1', email: null },
      meetings: (sel) => (sel.includes('meeting_exceptions') ? EMBED_ERR : OK([meetingRow('m1')])),
      exceptions: OK([]),
    })
    const res = await myMeetings('2026-07-01', '2026-07-31')
    expect(res.meetings.map(m => m.id)).toEqual(['m1'])
    expect(res.exceptions).toEqual([])
  })
})

describe('내 명단 행 조회 실패를 \'내 회의 없음\'으로 위장하지 않는다', () => {
  it('getMyMeetings: 회의는 읽었어도 내 명단 행 조회가 실패하면 ok:false — 참석자로만 든 회의가 남의 회의로 빠지지 않는다', async () => {
    const { tables } = makeSb({
      user: { id: 'u1', email: null },
      members: ERR('down'),
      meetings: () => OK([meetingRow('m1', { meeting_attendees: [{ member_id: 'member-a' }] })]),
    })
    expect(await getMyMeetings('2026-07-01', '2026-07-31')).toEqual({ ok: false, error: ERR_MEETINGS_LOAD })
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('resolveMemberIds'), 'down')
    // 실패로 돌려줄 것이면 예외 폴백 조회도 하지 않는다
    expect(tables).not.toContain('meeting_exceptions')
  })

  it('getMyMeetings: 내 명단 행이 0건(무매칭)인 것은 실패가 아니다 — 작성자 기준 isMine 은 그대로', async () => {
    makeSb({
      user: { id: 'u1', email: null },
      members: OK([]),
      meetings: () => OK([meetingRow('mine-by-author', { created_by: 'u1' }), meetingRow('not-mine')]),
    })
    const res = await myMeetings('2026-07-01', '2026-07-31')
    expect(res.meetings.map(m => [m.id, m.isMine])).toEqual([['mine-by-author', true], ['not-mine', false]])
    expect(console.error).not.toHaveBeenCalled()
  })
})

describe('실패 로그는 어느 프로젝트·어느 범위의 것인지 싣는다', () => {
  const logged = () => (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls.map(c => String(c[0]))

  it('getProjectMeetingData: 회의 조회 실패·임베드 재시도 로그에 프로젝트 id', async () => {
    makeSb({ meetings: () => ERR('down') })
    await getProjectMeetingData('p-log-1')
    expect(logged()).toHaveLength(2)
    expect(logged().every(m => m.includes('[getProjectMeetingData project=p-log-1]'))).toBe(true)
  })

  it('getProjectMeetingData: 예외 폴백 실패 로그에 프로젝트 id', async () => {
    makeSb({ meetings: (sel) => (sel.includes('meeting_exceptions') ? EMBED_ERR : OK([meetingRow('m1')])), exceptions: ERR('boom') })
    await getProjectMeetingData('p-log-2')
    expect(logged().some(m => m.includes('[getProjectMeetingData project=p-log-2] meeting_exceptions'))).toBe(true)
  })

  it('getMyMeetings: 회의 조회 실패·예외 폴백 실패 로그에 달력 범위', async () => {
    makeSb({ user: { id: 'u1', email: null }, meetings: () => ERR('down') })
    await getMyMeetings('2026-08-30', '2026-10-10')
    expect(logged()).toHaveLength(2)
    expect(logged().every(m => m.includes('[getMyMeetings range=2026-08-30..2026-10-10]'))).toBe(true)

    makeSb({
      user: { id: 'u1', email: null },
      meetings: (sel) => (sel.includes('meeting_exceptions') ? EMBED_ERR : OK([meetingRow('m1')])),
      exceptions: ERR('boom'),
    })
    await getMyMeetings('2026-09-27', '2026-11-07')
    expect(logged().some(m => m.includes('[getMyMeetings range=2026-09-27..2026-11-07] meeting_exceptions'))).toBe(true)
  })

  it('getMyMeetings: 날짜 꼴이 아닌 인자는 로그에 그대로 찍지 않는다 — 액션 인자라 형식이 보장되지 않는다', async () => {
    makeSb({ user: { id: 'u1', email: null }, meetings: () => ERR('down') })
    await getMyMeetings('2026-07-01\n[forged] line', '2026-07-31')
    expect(logged().length).toBeGreaterThan(0)
    expect(logged().some(m => m.includes('forged') || m.includes('\n'))).toBe(false)
    expect(logged().every(m => m.includes('..2026-07-31]'))).toBe(true)
  })
})
