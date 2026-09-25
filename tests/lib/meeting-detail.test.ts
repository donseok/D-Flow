import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }))

import { createServerClient } from '@/lib/supabase/server'
import { getMeetingDetail } from '@/lib/data/meetings'
import { ROSTER_SELECT } from '@/lib/data/memberSelect'

const MEETING = {
  id: 'meet-1', project_id: 'p1', title: '주간', meeting_date: '2026-09-24', start_time: null, end_time: null,
  location: null, category: 'routine', body: '', recurrence: 'none', recurrence_until: null,
  created_by: 'u1', created_by_name: '앨리스', created_at: 'x', updated_at: 'x',
  meeting_attendees: [{ member_id: 'b' }, { member_id: 'a2' }, { member_id: 'a1' }],
}
const person = (id: string, name: string, email: string | null, teams: unknown[] = []) => ({
  id, project_id: 'p1', person_id: `pe-${id}`, access_role: null, role_label: null, title: null,
  active: true, sort_order: 0, created_at: 'x',
  people: { display_name: name, email, user_id: null, kind: 'external', active: true },
  project_member_teams: teams,
})

describe('getMeetingDetail — 참석자는 명단 정본(ROSTER_SELECT)으로 읽어 편다', () => {
  it('이름·이메일·팀(대표 팀 먼저)을 people·팀 배열에서 펴고, 가나다순(동명이인은 id 순)으로 고정한다', async () => {
    const selects: Record<string, string> = {}
    const inArgs: unknown[][] = []
    const sb = {
      from: (table: string) => ({
        select: (cols: string) => {
          selects[table] = cols
          const q: Record<string, unknown> = {}
          q.eq = () => q
          q.maybeSingle = async () => ({ data: MEETING, error: null })
          q.in = async (...args: unknown[]) => {
            inArgs.push(args)
            return { data: [
              person('b', '나', null),
              person('a2', '가', 'x2@example.com'),
              person('a1', '가', 'x1@example.com', [
                { team_id: 't2', is_primary: false, teams: { id: 't2', code: 'MES', name: 'MES' } },
                { team_id: 't1', is_primary: true, teams: { id: 't1', code: 'ERP', name: 'ERP' } },
              ]),
            ], error: null }
          }
          return q
        },
      }),
    }
    ;(createServerClient as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue(sb)

    const out = await getMeetingDetail('meet-1')

    expect(selects.project_members).toBe(ROSTER_SELECT)
    expect(inArgs[0]).toEqual(['id', ['b', 'a2', 'a1']])
    expect(out?.attendees).toEqual([
      { id: 'a1', name: '가', email: 'x1@example.com', teamCodes: ['ERP', 'MES'] },
      { id: 'a2', name: '가', email: 'x2@example.com', teamCodes: [] },
      { id: 'b', name: '나', email: null, teamCodes: [] },
    ])
  })
})
