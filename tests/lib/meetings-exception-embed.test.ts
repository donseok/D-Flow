import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }))
// 비공개 프로젝트 거르기(FA1)가 쓰는 보는 사람의 권한 — 기본은 명단이 없는 워크스페이스 멤버
vi.mock('@/lib/authz', () => ({ getActorViewState: vi.fn() }))
// 회의 범주(B4)는 설정 해석기의 여러 프로젝트 읽기 — 이 파일은 회의·예외 조회를 보므로 기본 범주로 채운다
vi.mock('@/lib/settings/projectConfig', async (importOriginal) => {
  const { defaultVocab } = await import('@/lib/settings/vocab')
  return {
    ...(await importOriginal<typeof import('@/lib/settings/projectConfig')>()),
    getProjectVocabs: vi.fn(async (ids: string[]) => new Map(ids.map(id => [id, defaultVocab('meetings.categories')]))),
  }
})

import { createServerClient } from '@/lib/supabase/server'
import { getActorViewState } from '@/lib/authz'
import { makeActor } from '../fixtures/actor'
import { ERR_MEETINGS_LOAD, getProjectMeetingData, getMyMeetings } from '@/lib/data/meetings'
/** 내 회의의 워크스페이스(D26 — 로더 첫 인자). 로그 tag 에 실린다 */
const MWS = '00000000-0000-0000-7e57-000000001693'
import { moduleState, projectsWithModule, requireModule, requireSessionModule, workspacesWithModule } from '@/lib/modules/gate'

type Reply = { data: unknown[] | null; error: { message: string } | null; count?: number | null }
// count 는 예외 폴백(fetchAllPages)이 잘림을 확인할 때 본다 — PostgREST 의 count: 'exact' 응답.
const OK = (rows: unknown[]): Reply => ({ data: rows, error: null, count: rows.length })
const ERR = (message: string): Reply => ({ data: null, error: { message } })

const EMBED_ERR = ERR("Could not find a relationship between 'meetings' and 'meeting_exceptions'")

/**
 * 최소 supabase 스텁. meetings 는 select 문자열을 그대로 넘겨받아(임베드 포함 여부로 분기)
 * 응답을 정한다 — selectMeetings 의 "임베드 → 실패 시 임베드 없이 재시도" 경로를 실제로 태운다.
 */
function makeSb(opts: {
  user?: { id: string; email?: string | null } | null
  meetings: (select: string) => Reply | Promise<Reply>
  /** 예외 폴백 조회의 응답 — 함수면 요청한 범위(range)를 받아 그 페이지를 돌려준다. */
  exceptions?: Reply | ((from: number, to: number) => Reply)
  members?: Reply | Promise<Reply>
  /** auth.getUser 의 오류(SP5 B2 — D39). 없으면 오류 없음 */
  authError?: { name: string; message: string }
}) {
  const selects: string[] = []
  const tables: string[] = []
  /** 예외 폴백 조회가 건 것 — select 옵션·정렬·범위 */
  const exceptionQueries: Array<{ options: unknown; orders: string[]; range: [number, number] | null }> = []
  /** 예외 폴백 조회의 .in 인자 — 어느 회의 id 로 읽었는지 */
  const exceptionIns: unknown[][] = []
  /** 회의 조회의 .eq 인자 — 워크스페이스 한정(D26)을 본다 */
  const meetingEqs: unknown[][] = []
  const chain = (resolve: (q: { range: [number, number] | null }) => Reply | Promise<Reply>, options?: unknown) => {
    const q = { options, orders: [] as string[], range: null as [number, number] | null }
    const o: Record<string, unknown> = {}
    for (const k of ['eq', 'or', 'in', 'limit', 'maybeSingle']) o[k] = () => o
    o.order = (col: string) => { q.orders.push(col); return o }
    o.range = (from: number, to: number) => { q.range = [from, to]; return o }
    o.then = (res: unknown, rej: unknown) =>
      Promise.resolve(resolve(q)).then(res as never, rej as never)
    return { o, q }
  }
  const sb = {
    auth: {
      getUser: async () => ({ data: { user: opts.user ?? null }, error: opts.authError ?? null }),
      // getActor 는 getClaims 로 세션을 본다(2026-09-14) — getUser 는 getSession 경로용으로 남긴다.
      getClaims: async () => ({ data: opts.user ? { claims: { sub: opts.user.id, email: opts.user.email } } : null }),
    },
    from: (table: string) => {
      tables.push(table)
      return {
        select: (sel: string, options?: unknown) => {
          if (table === 'meetings') {
            selects.push(sel)
            const c = chain(() => opts.meetings(sel))
            c.o.eq = (...a: unknown[]) => { meetingEqs.push(a); return c.o }
            return c.o
          }
          if (table === 'meeting_exceptions') {
            const c = chain(({ range }) => {
              const ex = opts.exceptions ?? OK([])
              return typeof ex === 'function' ? ex(range?.[0] ?? 0, range?.[1] ?? Infinity) : ex
            }, options)
            exceptionQueries.push(c.q)
            c.o.in = (...a: unknown[]) => { exceptionIns.push(a); return c.o }
            return c.o
          }
          if (table === 'project_members') return chain(() => opts.members ?? OK([])).o
          return chain(() => OK([])).o
        },
      }
    },
  }
  ;(createServerClient as unknown as { mockResolvedValue: (v: unknown) => void })
    .mockResolvedValue(sb)
  return { selects, tables, exceptionQueries, exceptionIns, meetingEqs }
}

// 프로젝트 id 는 UUID 꼴이어야 조회가 나간다(getProjectMeetingData)
const PID = '00000000-0000-4000-8000-0000000000b1'
const meetingRow = (id: string, extra: Record<string, unknown> = {}) => ({
  id, project_id: PID, title: `회의 ${id}`, meeting_date: '2026-07-20',
  start_time: null, end_time: null, location: null, category: 'weekly',
  recurrence: 'none', recurrence_until: null, created_by: null, created_by_name: null,
  created_at: '2026-07-20T00:00:00Z', updated_at: '2026-07-20T00:00:00Z',
  meeting_attendees: [], ...extra,
})
const exRow = (meetingId: string, date: string) =>
  ({ meeting_id: meetingId, occurrence_date: date, kind: 'cancelled' })

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.mocked(getActorViewState).mockResolvedValue({ actor: makeActor(), degraded: false })
})
afterEach(() => { vi.restoreAllMocks() })
// 관문 mock 값을 바꾸는 파일 — 남은 Once 값이 뒤 케이스로 새지 않게 통과 구현으로 되돌린다(공통 규칙 '전역 mock')
afterEach(() => { for (const f of [requireModule, requireSessionModule, moduleState, projectsWithModule, workspacesWithModule]) vi.mocked(f).mockReset() })

/** 성공 결과만 — 실패면 사유로 던져 테스트를 깬다. */
async function projectMeetings(projectId: string) {
  const res = await getProjectMeetingData(projectId)
  if (!res.ok) throw new Error(res.error)
  return res
}

/** 내 회의의 성공 결과만 — 실패면 테스트를 깬다. */
async function myMeetings(gridStartIso: string, gridEndIso: string) {
  const res = await getMyMeetings(MWS, gridStartIso, gridEndIso)
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
    const res = await projectMeetings(PID)
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
    const res = await projectMeetings(PID)
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
    const res = await getProjectMeetingData(PID)
    expect(ERR_MEETINGS_LOAD).toBe('회의 일정을 불러오지 못했습니다.')
    expect(res).toEqual({ ok: false, error: '회의 일정을 불러오지 못했습니다.' })
    expect(console.error).toHaveBeenCalledTimes(2)
    // 회의를 못 읽었으면 예외 폴백 조회도 하지 않는다
    expect(tables).not.toContain('meeting_exceptions')
  })
})

describe('getMyMeetings — 그 워크스페이스의 회의만(D26)', () => {
  it('프로젝트 임베드를 inner 로 걸고 projects.workspace_id 로 거른다 — 여러 소속의 회의를 한 달력에 섞지 않는다', async () => {
    const { selects, meetingEqs } = makeSb({ user: { id: 'u1', email: null }, meetings: () => OK([]) })
    await getMyMeetings(MWS, '2026-07-01', '2026-07-31')
    expect(selects.length).toBeGreaterThan(0)
    for (const s of selects) expect(s).toContain('projects!inner(name, workspace_id, is_private)')
    expect(meetingEqs).toContainEqual(['projects.workspace_id', MWS])
  })
})

describe('getMyMeetings — 비공개 프로젝트의 회의는 명단 밖에서 숨긴다(FA1 — 포털과 같은 정본 규칙)', () => {
  const PRIV = '00000000-0000-4000-8000-0000000000c1'
  const rows = () => OK([
    meetingRow('pub', { projects: { name: '공개', workspace_id: MWS, is_private: false } }),
    meetingRow('priv', { project_id: PRIV, projects: { name: '비공개 프로젝트', workspace_id: MWS, is_private: true }, meeting_exceptions: [exRow('priv', '2026-07-27')] }),
  ])
  it('명단 밖 멤버 — 비공개 프로젝트의 회의·예외·프로젝트 이름이 없다', async () => {
    makeSb({ user: { id: 'u1' }, meetings: rows })
    const res = await myMeetings('2026-07-01', '2026-07-31')
    expect(res.meetings.map((m) => m.id)).toEqual(['pub'])
    expect(res.exceptions.map((x) => x.meetingId)).toEqual([])
    expect(JSON.stringify(res)).not.toContain('비공개 프로젝트')
  })
  it('비공개 프로젝트의 명단 멤버·워크스페이스 관리자·플랫폼 관리자에게는 보인다', async () => {
    for (const actor of [
      makeActor({ projectWorkspace: new Map([[PRIV, MWS]]), projectRoles: new Map([[PRIV, 'member']]) }),
      makeActor({ workspaceRoles: new Map([[MWS, 'admin']]), projectWorkspace: new Map([[PRIV, MWS]]) }),
      makeActor({ isSuperuser: true, projectWorkspace: new Map([[PRIV, MWS]]) }),
    ]) {
      vi.mocked(getActorViewState).mockResolvedValue({ actor, degraded: false })
      makeSb({ user: { id: 'u1' }, meetings: rows })
      const res = await myMeetings('2026-07-01', '2026-07-31')
      expect(res.meetings.map((m) => m.id).sort()).toEqual(['priv', 'pub'])
    }
  })
  it('권한 조회가 열화면 막는다 — 숨길 것을 못 숨기느니 실패로 돌려준다(빈 달력으로 위장하지 않고 로그를 남긴다)', async () => {
    vi.mocked(getActorViewState).mockResolvedValue({ actor: null, degraded: true })
    makeSb({ user: { id: 'u1' }, meetings: rows })
    expect(await getMyMeetings(MWS, '2026-07-01', '2026-07-31')).toEqual({ ok: false, error: ERR_MEETINGS_LOAD })
    expect((console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls.some((c) => String(c[0]).includes('getMyMeetings'))).toBe(true)
  })
  it('임베드 폴백(예외 별도 조회)에서도 비공개 회의의 예외를 읽지 않는다', async () => {
    const { exceptionIns } = makeSb({
      user: { id: 'u1' },
      meetings: (sel) => (sel.includes('meeting_exceptions') ? EMBED_ERR : rows()),
      exceptions: OK([exRow('pub', '2026-07-27')]),
    })
    const res = await myMeetings('2026-07-01', '2026-07-31')
    expect(res.meetings.map((m) => m.id)).toEqual(['pub'])
    expect(exceptionIns).toEqual([['meeting_id', ['pub']]])
  })
})

describe('getMyMeetings — 멤버 조회 병렬화 + 임베드', () => {
  it('비로그인이면 조회 없이 빈 결과', async () => {
    const { tables } = makeSb({ user: null, meetings: () => OK([]) })
    expect(await getMyMeetings(MWS, '2026-07-01', '2026-07-31'))
      .toEqual({ ok: true, meetings: [], exceptions: [], categories: {} })
    expect(tables).not.toContain('meetings')
  })

  it('세션 없음(AuthSessionMissingError)만 비로그인이다 — 인증 확인 실패는 빈 달력이 아니라 실패(SP5 B2 — D39)', async () => {
    makeSb({ user: null, meetings: () => OK([]), authError: { name: 'AuthSessionMissingError', message: 'Auth session missing!' } })
    expect(await getMyMeetings(MWS, '2026-07-02', '2026-07-31')).toEqual({ ok: true, meetings: [], exceptions: [], categories: {} })
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { tables } = makeSb({ user: null, meetings: () => OK([]), authError: { name: 'AuthRetryableFetchError', message: 'fetch failed' } })
    expect(await getMyMeetings(MWS, '2026-07-03', '2026-07-31')).toMatchObject({ ok: false })
    expect(tables).not.toContain('meetings')
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })

  it('멤버 조회를 기다리지 않고 회의 조회를 함께 띄운다', async () => {
    let releaseMembers: (r: Reply) => void = () => {}
    const membersPending = new Promise<Reply>(r => { releaseMembers = r })
    const { selects } = makeSb({
      user: { id: 'u1', email: null },
      members: membersPending,
      meetings: () => OK([]),
    })

    const p = getMyMeetings(MWS, '2026-07-01', '2026-07-31')
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

describe('getMyMeetings — meetings 모듈이 꺼진 프로젝트의 행을 뺀다(스펙 §4.2)', () => {
  it('꺼진 프로젝트의 회의·예외가 없다', async () => {
    const P2 = '00000000-0000-4000-8000-0000000000b2'
    makeSb({
      user: { id: 'u1' },
      meetings: () => OK([
        meetingRow('on', { meeting_exceptions: [exRow('on', '2026-07-27')] }),
        meetingRow('off', { project_id: P2, meeting_exceptions: [exRow('off', '2026-07-27')] }),
      ]),
    })
    vi.mocked(projectsWithModule).mockResolvedValueOnce([PID])
    const res = await myMeetings('2026-07-01', '2026-07-31')
    expect(res.meetings.map((x) => x.id)).toEqual(['on'])
    expect(res.exceptions.map((x) => x.meetingId)).toEqual(['on'])
    expect(projectsWithModule).toHaveBeenCalledWith([PID, P2], 'meetings')
  })
  it('임베드 실패 폴백도 켜진 프로젝트의 회의 id 로만 예외를 읽는다', async () => {
    const P2 = '00000000-0000-4000-8000-0000000000b2'
    const { exceptionIns } = makeSb({
      user: { id: 'u1' },
      meetings: (sel) => (sel.includes('meeting_exceptions') ? EMBED_ERR : OK([meetingRow('on'), meetingRow('off', { project_id: P2 })])),
      exceptions: OK([exRow('on', '2026-07-27')]),
    })
    vi.mocked(projectsWithModule).mockResolvedValueOnce([PID])
    const res = await myMeetings('2026-07-01', '2026-07-31')
    expect(res.meetings.map((x) => x.id)).toEqual(['on'])
    expect(exceptionIns).toEqual([['meeting_id', ['on']]])
  })
})

describe('조회 실패를 없음으로 위장하지 않는다(M5)', () => {
  /** console.error 에 찍힌 첫 인자들 — 표시한 실패는 로그에도 남아야 한다(표시 = 로깅). */
  const logged = () => (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls.map(c => String(c[0]))

  it('getProjectMeetingData: 임베드 실패 뒤 예외 별도 조회까지 실패하면 ok:false', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    makeSb({ meetings: (sel) => (sel.includes('meeting_exceptions') ? EMBED_ERR : OK([meetingRow('m1')])), exceptions: ERR('boom') })
    expect(await getProjectMeetingData(PID)).toEqual({ ok: false, error: ERR_MEETINGS_LOAD })
    expect(logged().some(m => m.includes('getProjectMeetingData') && m.includes('meeting_exceptions'))).toBe(true)
  })
  it('getMyMeetings: 회의 조회가 재시도까지 실패하면 ok:false — 빈 달력이 아니다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { tables } = makeSb({ user: { id: 'u1', email: null }, meetings: () => ERR('down') })
    expect(await getMyMeetings(MWS, '2026-07-01', '2026-07-31')).toEqual({ ok: false, error: ERR_MEETINGS_LOAD })
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
    expect(await getMyMeetings(MWS, '2026-07-01', '2026-07-31')).toEqual({ ok: false, error: ERR_MEETINGS_LOAD })
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
    expect(await getMyMeetings(MWS, '2026-07-01', '2026-07-31')).toEqual({ ok: false, error: ERR_MEETINGS_LOAD })
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('resolveMemberIds'), 'down')
    // resolveMemberIds 의 로그에는 로더 이름도 범위도 없고 호출부가 둘이다(이슈 화면) — 화면에 띄운 '내 회의' 실패를
    // 로그에서 짚을 수 있게 getMyMeetings 의 tag 로도 한 줄 남긴다.
    const lines = (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls.map(c => String(c[0]))
    expect(lines.filter(m => m.startsWith(`[getMyMeetings ws=${MWS} range=2026-07-01..2026-07-31]`) && m.includes('명단'))).toHaveLength(1)
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
  // 프로젝트 id 는 UUID 꼴일 때만 로그에 실린다
  const P_LOG_1 = '00000000-0000-4000-8000-0000000000a1'
  const P_LOG_2 = '00000000-0000-4000-8000-0000000000a2'

  it('getProjectMeetingData: 회의 조회 실패·임베드 재시도 로그에 프로젝트 id', async () => {
    makeSb({ meetings: () => ERR('down') })
    await getProjectMeetingData(P_LOG_1)
    expect(logged()).toHaveLength(2)
    expect(logged().every(m => m.includes(`[getProjectMeetingData project=${P_LOG_1}]`))).toBe(true)
  })

  it('getProjectMeetingData: 예외 폴백 실패 로그에 프로젝트 id', async () => {
    makeSb({ meetings: (sel) => (sel.includes('meeting_exceptions') ? EMBED_ERR : OK([meetingRow('m1')])), exceptions: ERR('boom') })
    await getProjectMeetingData(P_LOG_2)
    expect(logged().some(m => m.includes(`[getProjectMeetingData project=${P_LOG_2}] meeting_exceptions`))).toBe(true)
  })

  // projectId 는 URL 조각·서버 액션 인자라 형식이 보장되지 않는다. tag 만 가리면 부족하다 — 조회가 나가면 Postgres 가 22P02 문구에
  // 입력을 그대로 인용하고, 그 문구가 console.error 의 둘째 인자로 실려 줄바꿈 뒤의 글자가 새 로그 줄이 된다.
  it.each([
    ['줄바꿈으로 둘째 로그 줄을 지어내려는 값', 'abc\n[auth] login ok user=admin'],
    ['UUID 뒤에 덧붙인 값(앞부분만 맞는 것은 맞는 것이 아니다)', `${P_LOG_1}\n[auth] login ok user=admin`],
    ['CR 만 실은 값', 'abc\r[auth] login ok user=admin'],
    ['빈 값', ''],
  ])('getProjectMeetingData: UUID 꼴이 아닌 프로젝트 id 는 조회하지 않고 ok:false — %s', async (_name, forged) => {
    const { tables } = makeSb({ meetings: () => ERR(`invalid input syntax for type uuid: "${forged}"`) })
    expect(await getProjectMeetingData(forged)).toEqual({ ok: false, error: ERR_MEETINGS_LOAD })
    expect(tables).toEqual([])
    const calls = vi.mocked(console.error).mock.calls
    expect(calls).toHaveLength(1)
    expect(String(calls[0][0])).toBe('[getProjectMeetingData project=(id 아님)] UUID 꼴이 아닌 프로젝트 id — 조회하지 않는다')
    // 첫 인자만이 아니라 모든 인자를 본다
    expect(calls.flat().some(a => /[\r\n]/.test(String(a)) || String(a).includes('login ok'))).toBe(false)
  })

  it('getMyMeetings: 회의 조회 실패·예외 폴백 실패 로그에 달력 범위', async () => {
    makeSb({ user: { id: 'u1', email: null }, meetings: () => ERR('down') })
    await getMyMeetings(MWS, '2026-08-30', '2026-10-10')
    expect(logged()).toHaveLength(2)
    expect(logged().every(m => m.includes(`[getMyMeetings ws=${MWS} range=2026-08-30..2026-10-10]`))).toBe(true)

    makeSb({
      user: { id: 'u1', email: null },
      meetings: (sel) => (sel.includes('meeting_exceptions') ? EMBED_ERR : OK([meetingRow('m1')])),
      exceptions: ERR('boom'),
    })
    await getMyMeetings(MWS, '2026-09-27', '2026-11-07')
    expect(logged().some(m => m.includes(`[getMyMeetings ws=${MWS} range=2026-09-27..2026-11-07] meeting_exceptions`))).toBe(true)
  })

  it('getMyMeetings: 날짜 꼴이 아닌 인자는 로그에 그대로 찍지 않는다 — 액션 인자라 형식이 보장되지 않는다', async () => {
    makeSb({ user: { id: 'u1', email: null }, meetings: () => ERR('down') })
    await getMyMeetings(MWS, '2026-07-01\n[forged] line', '2026-07-31')
    expect(logged().length).toBeGreaterThan(0)
    expect(logged().some(m => m.includes('forged') || m.includes('\n'))).toBe(false)
    expect(logged().every(m => m.includes('..2026-07-31]'))).toBe(true)
  })

  // 두 인자는 PostgREST or() 필터 문자열에 그대로 끼워진다 — 날짜 꼴이 아니면 필터를 만들기 전에 거부한다.
  it.each([
    ['시작', '2026-07-01,project_id.not.is.null', '2026-07-31'],
    ['끝', '2026-07-01', '2026-07-31),or(title.ilike.*'],
    ['빈 값', '', '2026-07-31'],
  ])('getMyMeetings: 날짜 꼴이 아닌 %s 인자는 조회하지 않고 ok:false', async (_name, start, end) => {
    const { tables } = makeSb({ user: { id: 'u1', email: null }, meetings: () => OK([meetingRow('m1')]) })
    expect(await getMyMeetings(MWS, start, end)).toEqual({ ok: false, error: ERR_MEETINGS_LOAD })
    expect(tables).toEqual([])
    expect(logged()).toHaveLength(1)
    expect(logged()[0]).toContain('getMyMeetings')
    expect(logged()[0]).toContain('날짜 꼴이 아닌 인자')
    expect(logged().some(m => m.includes('ilike') || m.includes('not.is.null'))).toBe(false)
  })
})

describe('예외 폴백은 끝까지 읽는다 — 한 응답은 max_rows(1000)에서 오류 없이 잘린다', () => {
  const embedFails = (sel: string) => (sel.includes('meeting_exceptions') ? EMBED_ERR : OK([meetingRow('m1'), meetingRow('m2')]))
  const ALL = [exRow('m1', '2026-07-06'), exRow('m1', '2026-07-13'), exRow('m2', '2026-07-20')]

  it('count 를 받고 유일 키(meeting_id, occurrence_date) 순으로 범위를 걸어 읽는다', async () => {
    const { exceptionQueries } = makeSb({ meetings: embedFails, exceptions: OK(ALL) })
    const res = await projectMeetings(PID)
    expect(res.exceptions).toHaveLength(3)
    expect(exceptionQueries).toEqual([
      { options: { count: 'exact' }, orders: ['meeting_id', 'occurrence_date'], range: [0, 999] },
    ])
  })

  it('응답이 잘려 오면(받은 행 < count) 받은 만큼 전진해 이어 읽는다 — 잘린 회차가 살아 있는 일정으로 보이지 않게', async () => {
    // 서버 상한 2행을 흉내낸다
    const { exceptionQueries } = makeSb({
      meetings: embedFails,
      exceptions: (from) => ({ data: ALL.slice(from, from + 2), error: null, count: ALL.length }),
    })
    const res = await projectMeetings(PID)
    expect(res.exceptions).toEqual([
      { meetingId: 'm1', occurrenceDate: '2026-07-06', kind: 'cancelled' },
      { meetingId: 'm1', occurrenceDate: '2026-07-13', kind: 'cancelled' },
      { meetingId: 'm2', occurrenceDate: '2026-07-20', kind: 'cancelled' },
    ])
    expect(exceptionQueries.map(q => q.range)).toEqual([[0, 999], [2, 1001]])
  })

  it.each([
    ['count 가 없다(잘림을 확인할 수 없다)', (): Reply => ({ data: ALL, error: null })],
    ['끝까지 읽지 못했다(받은 행 < count)', (from: number): Reply => ({ data: from === 0 ? ALL.slice(0, 2) : [], error: null, count: 5 })],
  ])('%s — 회의 일정을 실패로 돌려주고 로그를 남긴다', async (_name, exceptions) => {
    makeSb({ meetings: embedFails, exceptions })
    expect(await getProjectMeetingData(PID)).toEqual({ ok: false, error: ERR_MEETINGS_LOAD })
    const lines = vi.mocked(console.error).mock.calls.map(c => String(c[0]))
    expect(lines.some(m => m.startsWith(`[getProjectMeetingData project=${PID}] meeting_exceptions`))).toBe(true)
  })

  it('getMyMeetings 의 폴백도 같은 조회를 쓴다', async () => {
    const { exceptionQueries } = makeSb({
      user: { id: 'u1', email: null }, meetings: embedFails,
      exceptions: (from) => ({ data: ALL.slice(from, from + 2), error: null, count: ALL.length }),
    })
    const res = await myMeetings('2026-07-01', '2026-07-31')
    expect(res.exceptions).toHaveLength(3)
    expect(exceptionQueries.map(q => q.range)).toEqual([[0, 999], [2, 1001]])
  })
})
