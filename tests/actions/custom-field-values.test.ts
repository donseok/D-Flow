import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeAdminActor, makeMemberActor } from '../fixtures/actor'
import type { FieldDef, FieldEntity } from '@/lib/domain/customFields'
const h = vi.hoisted(() => ({ guard: vi.fn(), mod: vi.fn(), config: vi.fn(), server: vi.fn(), from: vi.fn(), update: vi.fn(), eq: vi.fn(), select: vi.fn(), single: vi.fn(), insert: vi.fn(), revalidate: vi.fn() }))
vi.mock('@/lib/authz', () => ({ requireProjectMember: h.guard }))
vi.mock('@/lib/modules/gate', () => ({ requireModule: h.mod }))
vi.mock('@/lib/settings/projectConfig', () => ({ getProjectConfig: h.config }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: h.server }))
vi.mock('next/cache', () => ({ revalidatePath: h.revalidate }))
import { saveCustomFieldValues } from '@/app/actions/customFieldValues'
const P = '00000000-0000-0000-7e57-000000001432', R = '00000000-0000-0000-7e57-000000001431'
const def: FieldDef = { key: 'quantity', label: 'Quantity', description: '', type: 'number', required: false, active: true, editable_by: 'member', show_in_list: false, searchable: false, sort: 0 }
beforeEach(() => {
  vi.resetAllMocks(); h.guard.mockResolvedValue({ ok: true, actor: makeMemberActor(P) }); h.mod.mockResolvedValue({ ok: true })
  h.config.mockResolvedValue({ keys: Object.fromEntries(['wbs_item', 'issue', 'weekly_row'].map(e => [`fields.${e}`, { status: 'set', value: [def] }])) })
  const q = { update: h.update, eq: h.eq, select: h.select, maybeSingle: h.single, insert: h.insert }
  h.insert.mockResolvedValue({ error: null })
  for (const fn of [h.from, h.update, h.eq, h.select]) fn.mockReturnValue(q)
  h.server.mockResolvedValue({ from: h.from }); h.single.mockResolvedValue({ data: { custom: { quantity: 2 } }, error: null })
})
describe('JWT field value saves', () => {
  it.each([['wbs_item', 'wbs', 'wbs_items'], ['issue', 'issues', 'issues'], ['weekly_row', 'weekly', 'weekly_report_rows']] as const)('%s is owner-gated and scoped by project/id/JSONB CAS', async (entity, module, table) => {
    expect(await saveCustomFieldValues(P, entity, R, { quantity: 1 }, { quantity: 2 })).toEqual({ ok: true, values: { quantity: 2 } })
    expect(h.mod).toHaveBeenCalledWith({ projectId: P }, module); expect(h.config).toHaveBeenCalledWith(P)
    expect(h.from).toHaveBeenCalledWith(table); expect(h.update).toHaveBeenCalledWith(entity === 'issue' ? { custom: { quantity: 2 }, updated_at: expect.any(String) } : { custom: { quantity: 2 } })
    expect(h.eq.mock.calls).toEqual([['project_id', P], ['id', R], ['custom', '{"quantity":1}']]); expect(h.revalidate).toHaveBeenCalledWith(`/p/${P}`, 'layout')
  })
  it('issue value writes advance updated_at for index freshness; grant-limited weekly writes do not send it', async () => {
    const before = Date.now()
    await saveCustomFieldValues(P, 'issue', R, { quantity: 1 }, { quantity: 2 })
    const timestamp = Date.parse(h.update.mock.calls[0][0].updated_at)
    expect(timestamp).toBeGreaterThanOrEqual(before); expect(timestamp).toBeLessThanOrEqual(Date.now())
  })
  it('guard rejection precedes module, config and session access', async () => {
    h.guard.mockResolvedValue({ ok: false, error: 'denied' }); expect(await saveCustomFieldValues(P, 'issue', R, {}, {})).toMatchObject({ ok: false, code: 'ERR_DENIED' })
    expect(h.mod).not.toHaveBeenCalled(); expect(h.config).not.toHaveBeenCalled(); expect(h.server).not.toHaveBeenCalled()
  })
  it.each(['wbs_item', 'issue', 'weekly_row'] as FieldEntity[])('%s module denial precedes input and data access', async entity => {
    h.mod.mockResolvedValue({ ok: false, error: 'off' }); expect(await saveCustomFieldValues(P, entity, R, {}, {})).toMatchObject({ ok: false, code: 'ERR_MODULE_DISABLED' })
    expect(h.config).not.toHaveBeenCalled(); expect(h.server).not.toHaveBeenCalled()
  })
  it('invalid IDs/entities/expected shape cannot access data', async () => {
    for (const [entity, row, prev] of [['constructor', R, {}], ['issue', 'x', {}], ['issue', R, null]]) expect((await saveCustomFieldValues(P, entity as FieldEntity, row as string, prev, {})).ok).toBe(false)
    expect(h.config).not.toHaveBeenCalled(); expect(h.server).not.toHaveBeenCalled()
  })
  it('missing/corrupt definitions fail closed before writing', async () => {
    for (const config of [{ keys: {} }, { keys: { 'fields.issue': { status: 'invalid' } } }]) {
      h.config.mockResolvedValue(config); expect((await saveCustomFieldValues(P, 'issue', R, {}, {})).ok).toBe(false)
    }
    h.config.mockRejectedValue(new Error('private')); expect((await saveCustomFieldValues(P, 'issue', R, {}, {})).ok).toBe(false)
    expect(h.server).not.toHaveBeenCalled()
  })
  it('definition constraints reject before session mutation, including admin field removal', async () => {
    h.config.mockResolvedValue({ keys: { 'fields.issue': { status: 'set', value: [{ ...def, editable_by: 'admin' }] } } })
    expect(await saveCustomFieldValues(P, 'issue', R, { quantity: 1 }, {})).toMatchObject({ ok: false, fieldErrors: { quantity: 'admin_only' } })
    expect(h.server).not.toHaveBeenCalled()
    h.guard.mockResolvedValue({ ok: true, actor: makeAdminActor(P) }); expect((await saveCustomFieldValues(P, 'issue', R, { quantity: 1 }, { quantity: 2 })).ok).toBe(true)
  })
  it('an invisible/stale row is a conflict, never a successful empty update', async () => {
    h.single.mockResolvedValue({ data: null, error: null }); expect(await saveCustomFieldValues(P, 'issue', R, { quantity: 1 }, { quantity: 2 })).toMatchObject({ ok: false, code: 'FIELD_CONFLICT' }); expect(h.revalidate).not.toHaveBeenCalled()
  })
  it.each([['CUSTOM_FIELD_ADMIN_ONLY:quantity', '42501', 'ERR_DENIED'], ['CUSTOM_FIELD_SIZE', '23514', 'FIELD_INVALID'], ['CUSTOM_FIELD_INACTIVE:quantity', '23514', 'FIELD_INVALID']])('fresh DB constraint %s stays visible without details', async (message, code, expected) => {
    h.single.mockResolvedValue({ data: null, error: { message, code, details: 'private' } }); const r = await saveCustomFieldValues(P, 'issue', R, { quantity: 1 }, { quantity: 2 })
    expect(r).toMatchObject({ ok: false, code: expected }); expect(JSON.stringify(r)).not.toContain('private')
    if (message.startsWith('CUSTOM_FIELD_ADMIN_ONLY:')) expect(r).toMatchObject({ fieldErrors: { quantity: 'admin_only' } })
  })
  it('a malformed successful reply is not adopted; transport failure never logs a false save', async () => {
    h.single.mockResolvedValueOnce({ data: { custom: null }, error: null }); expect((await saveCustomFieldValues(P, 'issue', R, { quantity: 1 }, { quantity: 2 })).ok).toBe(false)
    h.single.mockRejectedValue(new Error('private')); expect(JSON.stringify(await saveCustomFieldValues(P, 'issue', R, { quantity: 1 }, { quantity: 2 }))).not.toContain('private'); expect(h.revalidate).not.toHaveBeenCalled()
  })
})
