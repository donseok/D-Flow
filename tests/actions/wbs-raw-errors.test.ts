import { beforeEach, describe, expect, it, vi } from 'vitest'

// SP4 D21 — WBS 액션의 DB 오류는 고정 문구로 응답하고 원문은 로그로만. 잠금 토큰은 메시지의 첫 낱말로(dbToken) 판정한다.
const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(), requireProjectMember: vi.fn(), requireProjectAdmin: vi.fn(), resolveProjectId: vi.fn(), revalidatePath: vi.fn(),
}))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: vi.fn() }))
vi.mock('@/lib/authz', () => ({
  requireProjectMember: mocks.requireProjectMember, requireProjectAdmin: mocks.requireProjectAdmin,
  requireSuperuser: vi.fn(), resolveProjectId: mocks.resolveProjectId, getActor: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ getSession: vi.fn(), getDisplayName: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: mocks.createServerClient }))
vi.mock('@/lib/data/snapshots', () => ({ recordProgressSnapshot: vi.fn() }))
vi.mock('@/lib/ai/ingest', () => ({ ingestProject: vi.fn(async () => ({ count: 0 })) }))

import { deleteWbsItem, moveWbsItem, updateActual, updateWeight } from '@/app/actions/wbs'
import { makeAdminActor } from '../fixtures/actor'

type Resp = { data?: unknown; error?: { message: string; code?: string } | null }
const W1 = '00000000-0000-0000-7e57-000000001950'
const RAW = 'relation "wbs_items" boom'
function server(queues: Record<string, Resp[]>) {
  const client = {
    from: (table: string) => {
      const resp = (queues[table] ?? []).shift() ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'eq', 'is', 'in', 'limit', 'order', 'update', 'insert', 'delete']) b[k] = () => b
      b.single = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.maybeSingle = b.single
      b.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null }).then(r)
      return b
    },
  }
  mocks.createServerClient.mockResolvedValue(client)
}
const raw = { message: RAW, code: 'XX000' }
let err: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.clearAllMocks()
  err = vi.spyOn(console, 'error').mockImplementation(() => {})
  mocks.resolveProjectId.mockResolvedValue({ ok: true, projectId: 'p1' })
  mocks.requireProjectMember.mockResolvedValue({ ok: true, actor: makeAdminActor('p1') })
  mocks.requireProjectAdmin.mockResolvedValue({ ok: true, actor: makeAdminActor('p1') })
})
const noRaw = (r: unknown) => {
  expect(JSON.stringify(r)).not.toContain('boom')
  expect(err.mock.calls.some((c: unknown[]) => c.some((x: unknown) => String(JSON.stringify(x) ?? x).includes('boom')))).toBe(true)
}

describe('WBS 액션 — DB 원문 대신 고정 문구(D21), 원문은 로그', () => {
  it('updateActual 의 항목 조회 실패', async () => {
    server({ wbs_items: [{ error: raw }] })
    const r = await updateActual(W1, 50)
    expect(r).toEqual({ ok: false, error: '항목을 불러오지 못했습니다 — 잠시 후 다시 시도하세요.' })
    noRaw(r)
  })
  it('updateWeight 의 저장 실패', async () => {
    server({ wbs_items: [{ data: { id: W1, weight: 1, project_id: 'p1' } }, { error: raw }] })
    const r = await updateWeight(W1, 2)
    expect(r).toEqual({ ok: false, error: '저장하지 못했습니다 — 잠시 후 다시 시도하세요.' })
    noRaw(r)
  })
  it('deleteWbsItem 의 삭제 실패', async () => {
    server({ wbs_items: [{ error: raw }] })
    const r = await deleteWbsItem(W1)
    expect(r).toEqual({ ok: false, error: '삭제하지 못했습니다 — 잠시 후 다시 시도하세요.' })
    noRaw(r)
  })
  it('moveWbsItem — 교환 쓰기 오류는 고정 문구, 0행(RLS 차단)은 지금 문구', async () => {
    const sibs = { data: [{ id: 'a', sort_order: 0 }, { id: W1, sort_order: 1 }] }
    server({ wbs_items: [{ data: { id: W1, project_id: 'p1', parent_id: null, sort_order: 1 } }, sibs, { error: raw }] })
    const r = await moveWbsItem(W1, 'up')
    expect(r).toEqual({ ok: false, error: '순서를 바꾸지 못했습니다 — 잠시 후 다시 시도하세요.' })
    noRaw(r)
    server({ wbs_items: [{ data: { id: W1, project_id: 'p1', parent_id: null, sort_order: 1 } }, sibs, { data: [] }] })
    expect(await moveWbsItem(W1, 'up')).toEqual({ ok: false, error: '순서 변경 실패: 저장 권한이 없습니다(관리자만 가능)' })
  })
})

describe('잠금 토큰은 첫 낱말로(dbToken) — 부분 문자열로 뜻을 뽑지 않는다', () => {
  const item = { data: { id: W1, actual_pct: 40, project_id: 'p1', dev_workflow: false, tags: [] } }
  it('WORKFLOW_ACTUAL_LOCKED(세부 사유가 붙어도) → 잠금 결과', async () => {
    server({ wbs_items: [item, { data: null }, { error: { message: 'WORKFLOW_ACTUAL_LOCKED: claimed' } }] })
    expect(await updateActual(W1, 99)).toMatchObject({ ok: false, code: 'actual_locked' })
  })
  it('토큰이 아닌 자리의 같은 낱말은 잠금이 아니다 — 고정 저장 실패 문구', async () => {
    server({ wbs_items: [item, { data: null }, { error: { message: 'trigger x raised WORKFLOW_ACTUAL_LOCKED' } }] })
    expect(await updateActual(W1, 99)).toEqual({ ok: false, error: '저장하지 못했습니다 — 잠시 후 다시 시도하세요.' })
  })
})

describe('revalidatePath — 라우트 패턴 꼴(SP3b D8)', () => {
  it('updateWeight 성공은 (app)/p/[projectId] 레이아웃을 다시 그린다', async () => {
    server({ wbs_items: [{ data: { id: W1, weight: 1, project_id: 'p1' } }, { data: null }], change_logs: [{ data: null }] })
    expect(await updateWeight(W1, 2)).toEqual({ ok: true })
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/(app)/p/[projectId]', 'layout')
  })
})
