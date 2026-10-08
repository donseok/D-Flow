import { beforeEach, describe, expect, it, vi } from 'vitest'
// WBS 사용자 정의 값 저장의 변경 이력(개정 §3.6.7 '이력' 행) — change_logs 에 field='custom.<key>'. 이슈·주간 행은 필드 값 이력이 없다(비목표).
import { makeMemberActor } from '../fixtures/actor'
import type { FieldDef, FieldEntity } from '@/lib/domain/customFields'
const h = vi.hoisted(() => ({ guard: vi.fn(), mod: vi.fn(), config: vi.fn(), server: vi.fn(), from: vi.fn(), update: vi.fn(), eq: vi.fn(), select: vi.fn(), single: vi.fn(), insert: vi.fn(), revalidate: vi.fn() }))
vi.mock('@/lib/authz', () => ({ requireProjectMember: h.guard }))
vi.mock('@/lib/modules/gate', () => ({ requireModule: h.mod }))
vi.mock('@/lib/settings/projectConfig', () => ({ getProjectConfig: h.config }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: h.server }))
vi.mock('next/cache', () => ({ revalidatePath: h.revalidate }))
import { saveCustomFieldValues } from '@/app/actions/customFieldValues'

const P = '00000000-0000-0000-7e57-000000001432', R = '00000000-0000-0000-7e57-000000001431'
const base = { description: '', required: false, active: true, editable_by: 'member', show_in_list: false, searchable: false } as const
const DEFS: FieldDef[] = [
  { ...base, key: 'quantity', label: 'Quantity', type: 'number', sort: 0 },
  { ...base, key: 'done', label: 'Done', type: 'boolean', sort: 1 },
  { ...base, key: 'note', label: 'Note', type: 'text', sort: 2 },
]
const actor = makeMemberActor(P)
const saved = (custom: unknown) => h.single.mockResolvedValue({ data: { custom }, error: null })
const logCalls = () => h.from.mock.calls.filter(([table]) => table === 'change_logs').length

beforeEach(() => {
  vi.resetAllMocks(); h.guard.mockResolvedValue({ ok: true, actor }); h.mod.mockResolvedValue({ ok: true })
  h.config.mockResolvedValue({ keys: Object.fromEntries(['wbs_item', 'issue', 'weekly_row'].map(e => [`fields.${e}`, { status: 'set', value: DEFS }])) })
  const q = { update: h.update, eq: h.eq, select: h.select, maybeSingle: h.single, insert: h.insert }
  for (const fn of [h.from, h.update, h.eq, h.select]) fn.mockReturnValue(q)
  h.insert.mockResolvedValue({ error: null }); h.server.mockResolvedValue({ from: h.from })
})

describe('saveCustomFieldValues — WBS 값 변경 이력', () => {
  it('바뀐 키만 custom.<key> 로, 가드 결과의 사용자·그 항목 id 로 남긴다', async () => {
    saved({ quantity: 2, done: false, note: '그대로' })
    expect(await saveCustomFieldValues(P, 'wbs_item', R, { quantity: 1, note: '그대로' }, { quantity: 2, done: false, note: '그대로' })).toMatchObject({ ok: true })
    expect(h.from).toHaveBeenCalledWith('change_logs')
    expect(h.insert).toHaveBeenCalledTimes(1)
    expect(h.insert).toHaveBeenCalledWith([
      { user_id: actor.userId, wbs_item_id: R, field: 'custom.done', old_value: null, new_value: 'false' },
      { user_id: actor.userId, wbs_item_id: R, field: 'custom.quantity', old_value: '1', new_value: '2' },
    ])
  })

  it('0·false 를 값으로 보존한다 — 0 → 값 없음, 값 없음 → false', async () => {
    saved({ done: false })
    await saveCustomFieldValues(P, 'wbs_item', R, { quantity: 0 }, { done: false })
    expect(h.insert).toHaveBeenCalledWith([
      { user_id: actor.userId, wbs_item_id: R, field: 'custom.done', old_value: null, new_value: 'false' },
      { user_id: actor.userId, wbs_item_id: R, field: 'custom.quantity', old_value: '0', new_value: null },
    ])
  })

  it('저장된 값이 변경 전과 같으면 이력을 남기지 않는다', async () => {
    saved({ quantity: 1 })
    expect(await saveCustomFieldValues(P, 'wbs_item', R, { quantity: 1 }, { quantity: 1 })).toMatchObject({ ok: true })
    expect(h.insert).not.toHaveBeenCalled()
    expect(logCalls()).toBe(0)
  })

  it.each(['issue', 'weekly_row'] as FieldEntity[])('%s 는 필드 값 이력이 없다(스펙 비목표)', async entity => {
    saved({ quantity: 2 })
    expect(await saveCustomFieldValues(P, entity, R, { quantity: 1 }, { quantity: 2 })).toMatchObject({ ok: true })
    expect(h.insert).not.toHaveBeenCalled()
    expect(logCalls()).toBe(0)
  })

  it('저장이 실패·충돌이면 이력을 남기지 않는다', async () => {
    h.single.mockResolvedValue({ data: null, error: null })
    expect(await saveCustomFieldValues(P, 'wbs_item', R, { quantity: 1 }, { quantity: 2 })).toMatchObject({ ok: false, code: 'FIELD_CONFLICT' })
    h.single.mockResolvedValue({ data: null, error: { message: 'CUSTOM_FIELD_INACTIVE:quantity', code: '23514' } })
    expect(await saveCustomFieldValues(P, 'wbs_item', R, { quantity: 1 }, { quantity: 2 })).toMatchObject({ ok: false })
    expect(h.insert).not.toHaveBeenCalled()
  })

  it('이력 기록 실패(오류 응답·전송 예외)는 저장 성공을 뒤집지 않되 조용히 삼키지도 않는다', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    saved({ quantity: 2 })
    h.insert.mockResolvedValue({ error: { message: 'rls' } })
    expect(await saveCustomFieldValues(P, 'wbs_item', R, { quantity: 1 }, { quantity: 2 })).toEqual({ ok: true, values: { quantity: 2 } })
    h.insert.mockRejectedValue(new Error('network'))
    expect(await saveCustomFieldValues(P, 'wbs_item', R, { quantity: 1 }, { quantity: 2 })).toEqual({ ok: true, values: { quantity: 2 } })
    expect(err).toHaveBeenCalledTimes(2)
    expect(h.revalidate).toHaveBeenCalledTimes(2)
    err.mockRestore()
  })
})
