// 작업명 최대 길이(사용자 테스트 BUG-23) — 화면 입력(maxLength)·서버 액션·엑셀 가져오기가 같은 상한(WBS_NAME_MAX)을 쓴다.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = vi.hoisted(() => ({ client: undefined as unknown }))
const { createServerClient } = vi.hoisted(() => ({
  createServerClient: vi.fn(async () => {
    if (state.client === undefined) throw new Error('검증 실패 전 createServerClient 호출 금지')
    return state.client
  }),
}))
const { requireProjectAdmin, resolveProjectId } = vi.hoisted(() => ({ requireProjectAdmin: vi.fn(), resolveProjectId: vi.fn() }))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/server', async (importOriginal) => ({ ...(await importOriginal<typeof import('next/server')>()), after: vi.fn() }))
vi.mock('@/lib/authz', () => ({ requireProjectMember: vi.fn(), requireProjectAdmin, requireWorkspaceAdmin: vi.fn(), resolveProjectId, getActor: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getSession: vi.fn(), getDisplayName: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient }))
vi.mock('@/lib/data/snapshots', () => ({ recordProgressSnapshot: vi.fn() }))

import { addWbsItem, updateWbsFields } from '@/app/actions/wbs'
import { WBS_ACTION_ERRORS, wbsErrorKey } from '@/lib/wbs/actionErrors'
import { WBS_NAME_MAX, wbsNameViolation } from '@/lib/domain/wbsValueRules'
import { linkByDepth, type ParsedRowN } from '@/lib/excel/parseWithProfile'
import { t } from '@/lib/i18n/dict'

const LONG = '가'.repeat(WBS_NAME_MAX + 1)
const MAX = '가'.repeat(WBS_NAME_MAX)

/** updateWbsFields 의 선행 조회(항목 한 행)만 돌려주는 클라이언트 — 그 뒤의 쓰기에 닿으면 실패한다 */
function itemClient(item: Record<string, unknown>) {
  const writes: string[] = []
  return {
    writes,
    from(table: string) {
      const chain: Record<string, unknown> = {
        select: () => chain, eq: () => chain,
        single: async () => ({ data: item, error: null }),
        update: () => { writes.push(table); throw new Error('쓰기에 닿으면 안 된다') },
        insert: () => { writes.push(table); throw new Error('쓰기에 닿으면 안 된다') },
      }
      return chain
    },
  }
}

beforeEach(() => {
  state.client = undefined
  createServerClient.mockClear()
  requireProjectAdmin.mockReset().mockResolvedValue({ ok: true, actor: { userId: 'u1' } })
  resolveProjectId.mockReset().mockResolvedValue({ ok: true, projectId: 'p1' })
})

describe('[BUG-23] 작업명 길이 상한 — 한 규칙', () => {
  it('wbsNameViolation — 앞뒤 공백을 뺀 길이로 본다(200 자는 통과, 201 자는 위반)', () => {
    expect(WBS_NAME_MAX).toBe(200)
    expect([wbsNameViolation(MAX), wbsNameViolation(`  ${MAX}  `), wbsNameViolation(LONG), wbsNameViolation('')]).toEqual([null, null, 'nameTooLong', null])
  })
  it('문구는 사전에 있고 상한의 수를 담는다', () => {
    expect(wbsErrorKey(WBS_ACTION_ERRORS.nameTooLong)).toBe('wbs.err.nameTooLong')
    expect(t('wbs.err.nameTooLong')).toContain(String(WBS_NAME_MAX))
  })
  it('addWbsItem — 상한을 넘는 이름은 거부하고 DB 에 닿지 않는다', async () => {
    expect(await addWbsItem('p1', null, LONG)).toEqual({ ok: false, error: WBS_ACTION_ERRORS.nameTooLong })
    expect(createServerClient).not.toHaveBeenCalled()
  })
  it('updateWbsFields — 이름을 상한 넘게 바꾸면 거부하고 쓰지 않는다', async () => {
    const client = itemClient({ id: 'i1', project_id: 'p1', name: '옛 이름', planned_start: null, planned_end: null, deliverable: null, biz: null })
    state.client = client
    expect(await updateWbsFields('i1', { name: LONG })).toEqual({ ok: false, error: WBS_ACTION_ERRORS.nameTooLong })
    expect(client.writes).toEqual([])
  })
  it('updateWbsFields — 상한보다 긴 옛 이름을 그대로 둔 저장(폼이 이름을 같이 보낸다)은 이름 때문에 막지 않는다', async () => {
    const client = itemClient({ id: 'i1', project_id: 'p1', name: LONG, planned_start: null, planned_end: null, deliverable: null, biz: null })
    state.client = client
    const res = await updateWbsFields('i1', { name: LONG })
    expect(res.error).not.toBe(WBS_ACTION_ERRORS.nameTooLong)
  })
  it('엑셀 가져오기 — 넘는 이름은 그 행의 오류다(자르지 않는다)', () => {
    const row = (name: string, excelRow: number): ParsedRowN => ({
      depth: 0, code: null, name, extraAxis: null, deliverable: null, plannedStart: null, plannedEnd: null, weight: null, actualPct: null, owners: [], excelRow,
    })
    expect(linkByDepth([row(MAX, 2)]).ok).toBe(true)
    const bad = linkByDepth([row('정상', 2), row(LONG, 3)])
    expect(bad.ok ? [] : bad.errors).toEqual([{ excelRow: 3, message: `작업명은 ${WBS_NAME_MAX}자 이하여야 합니다(${WBS_NAME_MAX + 1}자)` }])
  })
})
