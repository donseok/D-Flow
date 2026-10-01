import { describe, expect, it, vi } from 'vitest'
import { createSupabaseMeetingRepository } from '@/lib/repositories/supabase/meetings'
import { createSupabaseWbsRepository } from '@/lib/repositories/supabase/wbs'

// 봇 WBS 리포지토리는 팀 순서를 요청 범위 원천에서 읽는다(SP4 A2) — 이 파일은 순서와 무관한 단언이라 빈 팀
vi.mock('@/lib/teams/source', () => ({ projectTeams: async () => [] }))

type QueryResponse = { data: unknown; error: unknown }

function queryBuilder(response: QueryResponse) {
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'gte', 'lte', 'in', 'or', 'order', 'gt', 'limit', 'maybeSingle']) {
    builder[method] = vi.fn(() => builder)
  }
  for (const method of ['insert', 'upsert', 'update', 'delete']) {
    builder[method] = vi.fn(() => { throw new Error(`write attempted: ${method}`) })
  }
  builder.then = (
    resolve: (value: QueryResponse) => unknown,
    reject: (reason: unknown) => unknown,
  ) => Promise.resolve({ ...response, count: Array.isArray(response.data) ? response.data.length : null }).then(resolve, reject)
  return builder
}

function meetingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'meeting-1', project_id: 'p1', title: 'ERP 주간회의', meeting_date: '2026-07-20',
    start_time: '10:00', end_time: '11:00', location: 'A 회의실', category: 'routine',
    recurrence: 'none', recurrence_until: null, created_by: 'other-user', created_by_name: '담당자',
    created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-19T00:00:00Z',
    meeting_attendees: [{ member_id: 'member-p1' }], projects: { name: '프로젝트 1' },
    ...overrides,
  }
}

describe('strict supplemental repositories', () => {
  it('reads attachment metadata only and never reaches Storage or private columns', async () => {
    const item = queryBuilder({
      data: { id: 'w1', project_id: 'p1', code: '1.1', name: '설계', updated_at: 'u1' },
      error: null,
    })
    const attachments = queryBuilder({
      data: [{
        id: 'a1', wbs_item_id: 'w1', file_name: '설계서.pdf', size: 1200,
        mime: 'application/pdf', created_at: '2026-07-19T01:00:00Z',
        file_path: 'must/not/leak.pdf', uploaded_by: 'must-not-leak',
      }],
      error: null,
    })
    const from = vi.fn((table: string) => table === 'wbs_items' ? item : attachments)
    const storageGetter = vi.fn(() => { throw new Error('Storage must not be accessed') })
    const client = { from }
    Object.defineProperty(client, 'storage', { get: storageGetter })
    const repository = createSupabaseWbsRepository(client as never)

    const result = await repository.listAttachmentMetadata('p1', 'w1', 20)

    expect(result).toMatchObject({
      ok: true,
      data: {
        itemId: 'w1',
        attachments: [{ id: 'a1', fileName: '설계서.pdf', size: 1200 }],
      },
    })
    expect(JSON.stringify(result)).not.toMatch(/file_path|must\/not|uploaded_by|must-not-leak|signed/i)
    const selected = String((attachments.select as ReturnType<typeof vi.fn>).mock.calls[0][0])
    expect(selected).toBe('id, wbs_item_id, file_name, size, mime, created_at')
    expect(selected).not.toMatch(/file_path|uploaded_by/)
    expect(storageGetter).not.toHaveBeenCalled()
    expect(item.eq).toHaveBeenCalledWith('project_id', 'p1')
    expect(item.eq).toHaveBeenCalledWith('id', 'w1')
  })

  it('keeps an empty change log distinct from a failed change-log query', async () => {
    const scopeRow = { id: 'w1', project_id: 'p1', code: '1.1', name: '설계', updated_at: 'u1' }
    const emptyFrom = vi.fn((table: string) => queryBuilder(
      table === 'wbs_items'
        ? { data: scopeRow, error: null }
        : { data: [], error: null },
    ))
    const emptyRepository = createSupabaseWbsRepository({ from: emptyFrom } as never)
    await expect(emptyRepository.getChangeLog('p1', 'w1', 20)).resolves.toMatchObject({
      ok: true,
      data: { itemId: 'w1', entries: [], truncated: false },
    })

    const failedFrom = vi.fn((table: string) => queryBuilder(
      table === 'wbs_items'
        ? { data: scopeRow, error: null }
        : { data: null, error: { code: '08006' } },
    ))
    const failedRepository = createSupabaseWbsRepository({ from: failedFrom } as never)
    await expect(failedRepository.getChangeLog('p1', 'w1', 20)).resolves.toEqual({
      ok: false,
      errorCode: 'WBS_CHANGE_LOG_READ_FAILED',
      retryable: true,
    })
  })

  it('rejects supplemental rows that do not match the scoped WBS item', async () => {
    const wrongScope = queryBuilder({
      data: { id: 'w2', project_id: 'p2', code: '2.1', name: '다른 작업', updated_at: null },
      error: null,
    })
    const repository = createSupabaseWbsRepository({ from: vi.fn(() => wrongScope) } as never)

    await expect(repository.getChangeLog('p1', 'w1', 20)).resolves.toEqual({
      ok: false,
      errorCode: 'WBS_ITEM_SCOPE_READ_FAILED',
      retryable: false,
    })
    await expect(repository.listAttachmentMetadata('p1', 'w1', 20)).resolves.toEqual({
      ok: false,
      errorCode: 'WBS_ITEM_SCOPE_READ_FAILED',
      retryable: false,
    })
  })

  it('enriches allowed change fields without returning auth user IDs', async () => {
    const responses: Record<string, QueryResponse> = {
      wbs_items: {
        data: { id: 'w1', project_id: 'p1', code: '1.1', name: '설계', updated_at: 'u1' },
        error: null,
      },
      change_logs: {
        data: [{
          id: 7, wbs_item_id: 'w1', field: 'actual_pct', old_value: '10', new_value: '30',
          at: '2026-07-19T02:00:00Z', user_id: 'auth-user-secret',
        }],
        error: null,
      },
      // 작성자 라벨 재료 — 알려진 계정(profiles) + 이 프로젝트의 활성 명단 행(대표 팀, access_role).
      profiles: {
        data: [{ user_id: 'auth-user-secret', display_name: '앨리스' }],
        error: null,
      },
      project_members: {
        data: [{
          access_role: 'member',
          people: { user_id: 'auth-user-secret', active: true },
          project_member_teams: [
            { is_primary: false, teams: { code: 'MES' } },
            { is_primary: true, teams: { code: 'ERP' } },
          ],
        }],
        error: null,
      },
    }
    const builders: Record<string, ReturnType<typeof queryBuilder>> = {}
    const from = vi.fn((table: string) => (builders[table] = queryBuilder(responses[table])))
    const repository = createSupabaseWbsRepository({ from } as never)

    const result = await repository.getChangeLog('p1', 'w1', 20)

    // 대표 팀(is_primary) + 명단 권한 라벨 — '팀 멤버'.
    expect(result).toMatchObject({
      ok: true,
      data: {
        entries: [{ field: 'actual_pct', actorLabel: 'ERP 멤버', actorTeam: 'ERP', actorRole: 'member' }],
      },
    })
    expect(from.mock.calls.map(c => c[0])).not.toContain('memberships')
    const pm = builders.project_members
    expect(pm.eq).toHaveBeenCalledWith('project_id', 'p1')
    expect(pm.eq).toHaveBeenCalledWith('active', true)
    expect(pm.eq).toHaveBeenCalledWith('people.active', true)
    expect(pm.in).toHaveBeenCalledWith('people.user_id', ['auth-user-secret'])
    expect(String((pm.select as ReturnType<typeof vi.fn>).mock.calls[0][0])).not.toContain('email')
    expect(String((builders.profiles.select as ReturnType<typeof vi.fn>).mock.calls[0][0])).not.toContain('email')
    expect(JSON.stringify(result)).not.toContain('auth-user-secret')
  })

  it('labels change-log actors by roster access — admin/member/viewer, and a known account without a roster row is 조회', async () => {
    const at = '2026-07-19T02:00:00Z'
    const responses: Record<string, QueryResponse> = {
      wbs_items: { data: { id: 'w1', project_id: 'p1', code: '1.1', name: '설계', updated_at: 'u1' }, error: null },
      change_logs: {
        data: [
          { id: 4, wbs_item_id: 'w1', field: 'actual_pct', old_value: '0', new_value: '10', at, user_id: 'u-admin' },
          { id: 3, wbs_item_id: 'w1', field: 'actual_pct', old_value: '10', new_value: '20', at, user_id: 'u-admin-noteam' },
          { id: 2, wbs_item_id: 'w1', field: 'actual_pct', old_value: '20', new_value: '30', at, user_id: 'u-viewer-row' },
          { id: 1, wbs_item_id: 'w1', field: 'actual_pct', old_value: '30', new_value: '40', at, user_id: 'u-no-row' },
        ],
        error: null,
      },
      profiles: {
        data: ['u-admin', 'u-admin-noteam', 'u-viewer-row', 'u-no-row'].map(user_id => ({ user_id, display_name: user_id })),
        error: null,
      },
      project_members: {
        data: [
          { access_role: 'admin', people: { user_id: 'u-admin', active: true }, project_member_teams: [{ is_primary: true, teams: { code: 'PMO' } }] },
          { access_role: 'admin', people: { user_id: 'u-admin-noteam', active: true }, project_member_teams: [] },
          // 권한 없는 명단 행(조회 전용) — 팀은 있다
          { access_role: null, people: { user_id: 'u-viewer-row', active: true }, project_member_teams: [{ is_primary: true, teams: { code: 'MES' } }] },
        ],
        error: null,
      },
    }
    const from = vi.fn((table: string) => queryBuilder(responses[table]))
    const result = await createSupabaseWbsRepository({ from } as never).getChangeLog('p1', 'w1', 20)

    expect(result.ok && result.data?.entries.map(e => [e.actorRole, e.actorTeam, e.actorLabel])).toEqual([
      ['admin', 'PMO', 'PMO 관리자'],
      ['admin', null, '관리자'],
      ['viewer', 'MES', 'MES'],
      ['viewer', null, '조회'],
    ])
  })

  it('returns only creator/attendee meetings inside the allowlist and validates attendee project links', async () => {
    const members = queryBuilder({
      data: [{ id: 'member-p1', project_id: 'p1', people: { user_id: 'user-1' } }],
      error: null,
    })
    const meetings = queryBuilder({
      data: [
        meetingRow(),
        meetingRow({ id: 'not-mine', meeting_attendees: [] }),
        meetingRow({
          id: 'cross-project-attendee', project_id: 'p2', projects: { name: '프로젝트 2' },
        }),
        meetingRow({
          id: 'creator-p2', project_id: 'p2', created_by: 'user-1', meeting_attendees: [],
          projects: { name: '프로젝트 2' },
        }),
        meetingRow({ id: 'out-of-scope', project_id: 'p3', created_by: 'user-1' }),
      ],
      error: null,
    })
    const exceptions = queryBuilder({ data: [], error: null })
    const from = vi.fn((table: string) => {
      if (table === 'project_members') return members
      if (table === 'meetings') return meetings
      return exceptions
    })
    const repository = createSupabaseMeetingRepository({ from } as never)

    const result = await repository.listMyMeetings(
      'user-1', ['p1', 'p2'], '2026-07-20', '2026-07-26',
    )

    expect(result.ok && result.data.meetings.map(meeting => [meeting.id, meeting.mineBy])).toEqual([
      ['meeting-1', 'attendee'],
      ['creator-p2', 'creator'],
    ])
    const memberSelect = String((members.select as ReturnType<typeof vi.fn>).mock.calls[0][0])
    expect(memberSelect).toBe('id, project_id, people!inner(user_id, active)')
    expect(memberSelect).not.toContain('email')
    // '나' = people.user_id 하나, 활성 명단 행·활성 인물만.
    expect((members.eq as ReturnType<typeof vi.fn>).mock.calls).toEqual([
      ['people.user_id', 'user-1'], ['active', true], ['people.active', true],
    ])
    expect(meetings.in).toHaveBeenCalledWith('project_id', ['p1', 'p2'])
    expect(exceptions.in).toHaveBeenCalledWith('meeting_id', ['meeting-1', 'creator-p2'])
    expect(JSON.stringify(result)).not.toContain('email')
  })

  it('does not disguise a member-link failure as no personal meetings', async () => {
    const members = queryBuilder({ data: null, error: { code: '08006' } })
    const repository = createSupabaseMeetingRepository({
      from: vi.fn(() => members),
    } as never)

    await expect(repository.listMyMeetings(
      'user-1', ['p1'], '2026-07-20', '2026-07-26',
    )).resolves.toEqual({
      ok: false,
      errorCode: 'MY_MEETING_MEMBER_LINKS_READ_FAILED',
      retryable: true,
    })
  })
})
