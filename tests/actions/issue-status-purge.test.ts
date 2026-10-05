import { describe, it, expect, vi } from 'vitest'

const state = vi.hoisted(() => ({ client: undefined as unknown }))
const { createServerClient } = vi.hoisted(() => ({
  createServerClient: vi.fn(async () => state.client),
}))
const { requireProjectMember, requireProjectAdmin, resolveProjectId } = vi.hoisted(() => ({
  requireProjectMember: vi.fn(),
  requireProjectAdmin: vi.fn(),
  resolveProjectId: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/authz', () => ({ requireProjectMember, requireProjectAdmin, resolveProjectId }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient }))

import { purgeIssueUpdate } from '@/app/actions/issueUpdates'
import { makeMemberActor } from '../fixtures/actor'

const ACTOR = makeMemberActor('p1', [], { userId: 'admin-user' })
const VALID_UPDATE_ID = '11111111-1111-4111-8111-111111111111'

function setupMocks(rowKind: 'note' | 'status') {
  resolveProjectId.mockResolvedValue({ ok: true, projectId: 'p1' })
  requireProjectMember.mockResolvedValue({ ok: true, actor: ACTOR, userId: 'admin-user', isAdmin: true })
  requireProjectAdmin.mockResolvedValue({ ok: true, actor: ACTOR })

  state.client = {
    from: vi.fn((table: string) => {
      if (table === 'issue_updates') {
        const query: Record<string, unknown> = {}
        Object.assign(query, {
          eq: () => query,
          is: () => query,
          order: () => query,
          limit: async () => ({ data: [], error: null }),
          maybeSingle: async () => ({
            data: {
              id: VALID_UPDATE_ID,
              issue_id: 'i1',
              author_user_id: 'admin-user',
              kind: rowKind,
              category: 'action',
              body: '내용',
              attachments: [],
              mentions: [],
              archived_at: null,
              archived_by: null,
              created_at: new Date().toISOString(),
            },
            error: null,
          }),
          select: () => query,
          delete: () => ({
            eq: () => ({
              eq: () => ({
                select: async () => ({
                  data: [{ id: VALID_UPDATE_ID }],
                  error: null,
                }),
              }),
            }),
          }),
        })
        return query
      }
      if (table === 'issues') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { title: '이슈' }, error: null }) }) }),
          update: () => ({ eq: () => ({ select: async () => ({ data: [{ id: 'i1' }], error: null }) }) }),
        }
      }
      return {}
    }),
  }
}

describe('이슈 상태 이력 감사 로그 삭제 보호 (SPU1, SP5b 이월)', () => {
  it('상태 변경 이력(kind="status")은 관리자여도 완전 삭제할 수 없다', async () => {
    setupMocks('status')

    const res = await purgeIssueUpdate('i1', VALID_UPDATE_ID)
    expect(res.ok).toBe(false)
    expect(res.ok === false && res.error).toContain('감사 로그 보존')
  })

  it('일반 코멘트 이력(kind="note")은 관리자 권한으로 삭제할 수 있다', async () => {
    setupMocks('note')

    const res = await purgeIssueUpdate('i1', VALID_UPDATE_ID)
    expect(res.ok).toBe(true)
  })
})
