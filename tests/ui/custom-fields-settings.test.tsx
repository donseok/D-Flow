// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FieldDef, FieldEntity } from '@/lib/domain/customFields'
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
const h = vi.hoisted(() => ({ update: vi.fn(), outcome: vi.fn(), usage: vi.fn(), backfill: vi.fn(), purge: vi.fn(), refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh }) }))
vi.mock('@/app/actions/settings', () => ({ updateProjectSettings: h.update, getSettingsCommandOutcome: h.outcome }))
vi.mock('@/app/actions/customFields', () => ({ getCustomFieldUsage: h.usage, backfillCustomField: h.backfill, purgeCustomField: h.purge }))
import { CustomFieldsSettings } from '@/components/settings/CustomFieldsSettings'
import { CustomFieldInput } from '@/components/fields/CustomFieldInput'
import { registerEn } from '@/lib/i18n/dict'
import { EN } from '@/lib/i18n/dict/en'

registerEn(EN)   // 화면 문구는 사전에 있다 — locale="en" 케이스가 영어 사전을 본다(브라우저에서는 LocaleProvider 가 싣는다)
const P = '00000000-0000-0000-7e57-000000001432'
const def = (patch: Partial<FieldDef> = {}): FieldDef => ({ key: 'quantity', label: 'Quantity', description: '', type: 'number', default: 0,
  required: false, active: true, editable_by: 'member', show_in_list: false, searchable: false, sort: 0, ...patch })
let root: Root, c: HTMLDivElement
beforeEach(() => {
  vi.resetAllMocks(); h.usage.mockResolvedValue({ ok: true, usage: { total: 3, counts: { quantity: 1 } } })
  h.update.mockResolvedValue({ ok: true, kind: 'applied', revision: 9 }); h.outcome.mockResolvedValue({ ok: true, outcome: { status: 'absent' } })
  h.backfill.mockResolvedValue({ ok: true, status: 'applied', revision: 9, count: 2 }); h.purge.mockResolvedValue({ ok: true, status: 'applied', revision: 9, count: 1 })
  c = document.createElement('div'); document.body.append(c); root = createRoot(c)
})
afterEach(() => { act(() => root.unmount()); c.remove() })
async function render(defs: FieldDef[] | null = [def()], enabled = true, canEdit = true) {
  const states = Object.fromEntries((['wbs_item', 'issue', 'weekly_row'] as FieldEntity[]).map(e => [e, { value: defs, enabled }])) as Record<FieldEntity, { value: FieldDef[] | null; enabled: boolean }>
  await act(async () => { root.render(<CustomFieldsSettings projectId={P} states={states} revision={8} canEdit={canEdit} locale="en" />) })
}
const button = (text: string) => [...c.querySelectorAll('button')].find(b => b.textContent === text)!
const input = (text: string) => { const label = [...c.querySelectorAll('label')].find(l => l.firstChild?.textContent === text)!; return label.querySelector<HTMLInputElement | HTMLSelectElement>('input,select,textarea')! }
async function change(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
}
async function click(text: string) { await act(async () => button(text).click()) }

describe('field settings contracts', () => {
  it('entity tabs read only the selected owner; disabled and corrupt settings stay explicit', async () => {
    await render(); expect(h.usage).toHaveBeenCalledWith(P, 'wbs_item')
    await click('Issues'); expect(h.usage).toHaveBeenCalledWith(P, 'issue')
    await click('Weekly report'); expect(c.textContent).toContain('Carry over to next week')
    await render(null); expect(c.querySelector('[role="alert"]')?.textContent).toContain('corrupted')
    await render([], false); expect(c.textContent).toContain('Enable this module')
  })
  it('key identity is immutable after save, label is editable, and zero defaults survive', async () => {
    await render(); expect(input('Field key').disabled).toBe(true)
    expect(c.querySelector('select[aria-label="Type"]')).not.toBeNull()
    expect(c.querySelector('select[aria-label="Editable by"]')).not.toBeNull()
    await change(input('Label'), 'Count'); await click('Save field settings')
    expect(h.update.mock.calls[0][1]).toMatchObject({ expectedRevision: 8, set: { 'fields.wbs_item': [def({ label: 'Count' })] }, unset: [] })
  })
  it('new keys can be corrected after a collision without renaming stored identities', async () => {
    await render(); await click('Add field'); await change(input('Field key'), 'quantity')
    expect(input('Field key').disabled).toBe(false); expect(button('Save field settings').disabled).toBe(true)
    await change(input('Field key'), 'extra'); expect(button('Save field settings').disabled).toBe(false)
  })
  it('used fields cannot become required before a default backfill; one command fills and makes required', async () => {
    await render(); const required = [...c.querySelectorAll('label')].find(l => l.textContent === 'Required')!.querySelector<HTMLInputElement>('input')!
    expect(required.disabled).toBe(true); await click('Fill missing values and make required')
    expect(h.backfill.mock.calls[0]).toEqual([P, 'wbs_item', expect.objectContaining({ expectedRevision: 8, key: 'quantity', value: 0 })])
    expect(c.textContent).toContain('Filled 2 rows'); expect(c.querySelector<HTMLInputElement>('input[type="checkbox"][checked]')).toBeDefined()
  })
  it('a failed usage read is never a zero-count purge preview', async () => {
    h.usage.mockResolvedValue({ ok: false, error: 'Usage failed' }); await render()
    expect(c.textContent).toContain('Usage failed'); expect(c.textContent).toContain('Usage unavailable')
    expect(button('Delete field and values…').disabled).toBe(true); expect(button('Fill missing values and make required').disabled).toBe(true)
  })
  it('deletion requires an exact count and sends revision/key/count atomically', async () => {
    await render(); await click('Delete field and values…'); expect(button('Permanently delete field').disabled).toBe(true)
    await change(input('Number of values to delete'), '0'); expect(button('Permanently delete field').disabled).toBe(true)
    await change(input('Number of values to delete'), '1'); await click('Permanently delete field')
    expect(h.purge.mock.calls[0]).toEqual([P, 'wbs_item', expect.objectContaining({ expectedRevision: 8, key: 'quantity', expectedCount: 1 })])
    expect(c.textContent).toContain('Field deleted.'); expect(c.textContent).toContain('No custom fields.')
  })
  it('stale deletion closes confirmation and reloads counts instead of assuming success', async () => {
    h.purge.mockResolvedValue({ ok: false, code: 'CONFIG_STALE', retryable: false, error: 'Count changed' })
    await render(); await click('Delete field and values…'); await change(input('Number of values to delete'), '1'); await click('Permanently delete field')
    expect(c.textContent).toContain('Count changed'); expect(button('Permanently delete field')).toBeUndefined(); expect(h.usage).toHaveBeenCalledTimes(2); expect(h.refresh).toHaveBeenCalled()
  })
  it('unknown bulk outcomes lock editing and retry the identical command', async () => {
    h.backfill.mockRejectedValueOnce(new Error('network')); await render(); await click('Fill missing values and make required')
    expect(input('Label').disabled).toBe(true); expect(button('Issues').disabled).toBe(true)
    await click('Check the bulk change result and retry'); expect(h.backfill.mock.calls[1][2]).toEqual(h.backfill.mock.calls[0][2])
    expect(c.textContent).toContain('Filled 2 rows')
  })
  it('unknown setting outcomes hold the exact patch; receipt recovery prevents a second save', async () => {
    h.update.mockRejectedValueOnce(new Error('network')); await render(); await change(input('Label'), 'Count'); await click('Save field settings')
    expect(input('Label').disabled).toBe(true); await click('Check the save result and retry')
    expect(h.update.mock.calls[1][1]).toEqual(h.update.mock.calls[0][1])
    h.update.mockRejectedValueOnce(new Error('network')); h.outcome.mockResolvedValue({ ok: true, outcome: { status: 'applied', revision: 10 } })
    await change(input('Label'), 'More'); await click('Save field settings'); expect(c.textContent).toContain('Confirmed saved field settings')
  })
  it('pending saves cannot generate two requests and tabs remain locked', async () => {
    let resolve!: (v: unknown) => void
    h.update.mockImplementation(() => new Promise(r => { resolve = r }))
    await render(); await change(input('Label'), 'Count'); await click('Save field settings')
    expect(button('Save field settings').disabled).toBe(true); expect(button('Issues').disabled).toBe(true)
    await click('Save field settings'); expect(h.update).toHaveBeenCalledTimes(1)
    await act(async () => resolve({ ok: true, kind: 'applied', revision: 9 }))
  })
  it('keyboard reorder preserves keys and saves sort order, not new identities', async () => {
    await render([def(), def({ key: 'other', label: 'Other', sort: 1 })]); const up = c.querySelector<HTMLButtonElement>('button[aria-label="Other up"]')!
    await act(async () => up.click()); await click('Save field settings')
    expect(h.update.mock.calls[0][1].set['fields.wbs_item'].map((d: FieldDef) => [d.key, d.sort])).toEqual([['other', 0], ['quantity', 1]])
  })
  it('read-only settings do not offer enabled mutations', async () => {
    await render([def()], true, false); expect(input('Label').disabled).toBe(true); expect(button('Save field settings').disabled).toBe(true)
  })
})

describe('typed shared value controls', () => {
  it.each(['text', 'multiline', 'number', 'date', 'boolean', 'select', 'multiselect'] as const)('%s renders a native typed control', async type => {
    await act(async () => root.render(<CustomFieldInput def={def({ type, options: [{ code: 'a', label: 'A', active: true, sort: 0 }] })} value={undefined} onChange={vi.fn()} locale="en" />))
    expect(c.querySelector('input,select,textarea')).not.toBeNull()
    if (type !== 'multiselect') expect(c.querySelector('input,select,textarea')!.getAttribute('aria-label')).toBe('Quantity')
  })
  it('false is a value, and clearing it means absence rather than false', async () => {
    const onChange = vi.fn(); await act(async () => root.render(<CustomFieldInput def={def({ type: 'boolean' })} value={false} onChange={onChange} locale="en" />))
    const select = c.querySelector('select')!; expect(select.value).toBe('false'); await change(select, ''); expect(onChange).toHaveBeenCalledWith(undefined)
    await change(select, 'true'); expect(onChange).toHaveBeenCalledWith(true)
  })
  it('inactive selected options stay readable; new selections are disabled', async () => {
    await act(async () => root.render(<CustomFieldInput def={def({ type: 'select', options: [{ code: 'old', label: 'Old', active: false, sort: 0 }] })} value="old" onChange={vi.fn()} locale="en" />))
    expect(c.querySelector('select')!.value).toBe('old'); expect(c.querySelector<HTMLOptionElement>('option[value="old"]')!.disabled).toBe(true); expect(c.textContent).toContain('inactive')
  })
})
