// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FieldDef } from '@/lib/domain/customFields'
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
const h = vi.hoisted(() => ({ save: vi.fn(), refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh }) }))
vi.mock('@/app/actions/customFieldValues', () => ({ saveCustomFieldValues: h.save }))
import { CustomFieldsProvider, CustomFieldValuesEditor } from '@/components/fields/CustomFieldValuesEditor'
const def = (patch: Partial<FieldDef> = {}): FieldDef => ({ key: 'quantity', label: 'Quantity', description: 'Units', type: 'number', active: true, required: false, editable_by: 'member', show_in_list: false, searchable: false, carry_over: false, sort: 0, ...patch })
let c: HTMLDivElement, root: Root
beforeEach(() => { vi.clearAllMocks(); h.save.mockResolvedValue({ ok: true, values: { quantity: 2 } }); c = document.createElement('div'); document.body.append(c); root = createRoot(c) })
afterEach(() => { act(() => root.unmount()); c.remove() })
const button = (text: string) => [...c.querySelectorAll('button')].find(b => b.textContent === text)!
async function render(values: unknown = { quantity: 0 }, defs: FieldDef[] | null = [def()], canEdit = true, canAdmin = false, rowId = 'row-one') {
  await act(async () => { root.render(<CustomFieldsProvider projectId="project-one" entity="wbs_item" defs={defs} canAdmin={canAdmin} locale="en"><CustomFieldValuesEditor rowId={rowId} values={values} canEdit={canEdit} /></CustomFieldsProvider>) })
}
async function change(value: string, name = 'Quantity') {
  await act(async () => { const el = c.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`)!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) })
}
async function click(text: string) { await act(async () => { button(text).click() }) }
describe('custom value form', () => {
  it('uses typed zero and the exact base snapshot for the JWT/CAS action', async () => {
    await render(); expect(c.querySelector<HTMLInputElement>('input')!.value).toBe('0')
    await change('2'); await click('Save custom fields')
    expect(h.save).toHaveBeenCalledWith('project-one', 'wbs_item', 'row-one', { quantity: 0 }, { quantity: 2 })
    expect(h.refresh).toHaveBeenCalledOnce(); expect(c.textContent).toContain('saved')
    await render({ quantity: 0 }); expect(c.querySelector<HTMLInputElement>('input')!.value).toBe('2')
  })
  it('shows false and inactive option labels in read-only fields', async () => {
    await render({ quantity: false }, [def({ type: 'boolean' })], false); expect(c.textContent).toContain('No'); expect(c.querySelector('input')).toBeNull()
    await render({ quantity: 'old' }, [def({ type: 'select', active: false, options: [{ code: 'old', label: 'Historical', color: 'gray', active: false, sort: 0 }] })])
    expect(c.textContent).toContain('Historical'); expect(c.textContent).toContain('(inactive)'); expect(c.querySelector('select')).toBeNull()
  })
  it('never offers admin fields to a member or broadens the row affordance', async () => {
    await render({ quantity: 0 }, [def({ editable_by: 'admin' })]); expect(c.querySelector('input')).toBeNull(); expect(c.textContent).toContain('admin only')
    await render({ quantity: 0 }, [def()], false, true); expect(c.querySelector('input')).toBeNull()
    await render({ quantity: 0 }, [def({ editable_by: 'admin' })], true, true); expect(c.querySelector('input')).not.toBeNull()
  })
  it('distinguishes absent definitions from corrupt definitions and stored values', async () => {
    await render({}, []); expect(c.textContent).toBe('')
    await render({}, null); expect(c.querySelector('[role="alert"]')!.textContent).toContain('settings are invalid')
    await render(null); expect(c.querySelector('[role="alert"]')!.textContent).toContain('could not be read')
    expect(h.save).not.toHaveBeenCalled()
  })
  it('preserves a dirty draft when a fresh server value arrives and cancels to that snapshot', async () => {
    await render(); await change('2'); await render({ quantity: 3 })
    expect(c.querySelector<HTMLInputElement>('input')!.value).toBe('2'); expect(c.textContent).toContain('draft is preserved')
    expect(button('Save custom fields').disabled).toBe(true); await click('Cancel')
    expect(c.querySelector<HTMLInputElement>('input')!.value).toBe('3'); expect(c.textContent).not.toContain('draft is preserved')
  })
  it('adopts a fresh snapshot when pristine and resets drafts on row switch', async () => {
    await render(); await render({ quantity: 3 }); expect(c.querySelector<HTMLInputElement>('input')!.value).toBe('3')
    await change('4'); await render({ quantity: 1 }, [def()], true, false, 'row-two'); expect(c.querySelector<HTMLInputElement>('input')!.value).toBe('1')
  })
  it('clears only an edited optional key and keeps untouched inactive empty text', async () => {
    const defs = [def(), def({ key: 'archive', type: 'multiline', active: false })]
    await render({ quantity: 0, archive: '' }, defs); await change(''); await click('Save custom fields')
    expect(h.save.mock.calls[0][4]).toEqual({ archive: '' })
  })
  it('required removal is rejected with a field label before any write', async () => {
    await render({ quantity: 0 }, [def({ required: true, default: 0 })]); await change('', 'Quantity *'); await click('Save custom fields')
    expect(c.querySelector('[role="alert"]')!.textContent).toContain('Quantity: A value is required'); expect(h.save).not.toHaveBeenCalled()
  })
  it('shows a fresh DB field error and retains the failed draft', async () => {
    h.save.mockResolvedValue({ ok: false, code: 'FIELD_INVALID', error: 'Changed limits', fieldErrors: { quantity: 'range' } })
    await render(); await change('2'); await click('Save custom fields'); expect(c.textContent).toContain('Changed limits')
    expect(c.querySelector('[role="alert"]')!.textContent).toContain('Quantity'); expect(c.querySelector<HTMLInputElement>('input')!.value).toBe('2')
  })
  it('a conflict refreshes and locks save until the latest snapshot is adopted', async () => {
    h.save.mockResolvedValue({ ok: false, code: 'FIELD_CONFLICT', error: 'Conflict' })
    await render(); await change('2'); await click('Save custom fields'); expect(h.refresh).toHaveBeenCalledOnce()
    expect(button('Save custom fields').disabled).toBe(true); await render({ quantity: 5 }); await click('Cancel')
    expect(c.querySelector<HTMLInputElement>('input')!.value).toBe('5')
  })
  it('keeps an unknown outcome visible instead of announcing success', async () => {
    h.save.mockRejectedValue(new Error('transport')); await render(); await change('2'); await click('Save custom fields')
    expect(c.textContent).toContain('response is unknown'); expect(c.textContent).not.toContain('values saved'); expect(h.refresh).toHaveBeenCalledOnce()
  })
  it('holds controls and prevents double submit during an unresolved save', async () => {
    let resolve!: (v: unknown) => void; h.save.mockReturnValue(new Promise(r => { resolve = r }))
    await render(); await change('2'); await click('Save custom fields')
    expect(c.querySelector<HTMLInputElement>('input')!.disabled).toBe(true); expect(button('Saving…').disabled).toBe(true)
    await act(async () => { button('Saving…').click(); resolve({ ok: true, values: { quantity: 2 } }) }); expect(h.save).toHaveBeenCalledOnce()
  })
})
