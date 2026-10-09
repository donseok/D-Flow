// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TEST_AREAS } from '../fixtures/issue-areas'
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
const h = vi.hoisted(() => ({ update: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/app/actions/settings', () => ({ updateProjectSettings: (...args: unknown[]) => h.update(...args) }))
import { IssuePolicyEditor } from '@/components/settings/IssuePolicyEditor'
import { DEFAULT_ID_POLICY } from '@/lib/issues/idPolicy'
import { registerEn } from '@/lib/i18n/dict'
import { EN } from '@/lib/i18n/dict/en'

registerEn(EN)   // 화면 문구는 사전에 있다 — locale="en" 으로 그리는 이 테스트가 영어 사전을 본다

describe('IssuePolicyEditor', () => {
  let root: Root, container: HTMLDivElement
  beforeEach(() => { vi.clearAllMocks(); container = document.createElement('div'); document.body.append(container); root = createRoot(container) })
  afterEach(() => { act(() => root.unmount()); container.remove() })
  async function render(policy = DEFAULT_ID_POLICY, analysisEnabled = true) { await act(async () => { root.render(<IssuePolicyEditor projectId="p1" policy={policy} revision={8} areas={TEST_AREAS} year={2026} canEdit analysis="optional" analysisEnabled={analysisEnabled} locale="en" />) }) }
  it('previews the first active project area and keeps the immutable existing-code notice', async () => {
    await render({ prefix: 'RS', pattern: '{prefix}-{area}-{seq:3}', counter_scope: 'area', reset: 'never' })
    expect(container.textContent).toContain('RS-00-001')
    expect(container.textContent).toContain('Existing issue codes do not change.')
  })
  it('validates the pattern before saving', async () => {
    await render()
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Pattern"]')!
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '{prefix}-bad'); input.dispatchEvent(new Event('input', { bubbles: true })) })
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/seq/)
    expect(container.querySelector('button')?.disabled).toBe(true)
  })
  it('writes only the ID policy key through the settings command', async () => {
    h.update.mockResolvedValue({ ok: true, kind: 'applied', commandId: 'c', revision: 9, rebased: false })
    await render()
    const prefix = container.querySelector<HTMLInputElement>('input[aria-label="Prefix"]')!
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(prefix, 'RS'); prefix.dispatchEvent(new Event('input', { bubbles: true })) })
    const save = [...container.querySelectorAll('button')].find(b => b.textContent === 'Save')!
    await act(async () => save.click())
    expect(h.update.mock.calls[0][1]).toMatchObject({ expectedRevision: 8, set: { 'issues.id_policy': { ...DEFAULT_ID_POLICY, prefix: 'RS' } }, unset: [] })
  })
  it('explains why analysis policy is not editable while its module is off', async () => {
    await render(DEFAULT_ID_POLICY, false)
    expect(container.textContent).toContain('Issue analysis is off.')
    expect(container.querySelector('select[aria-label="Analysis fields on issue entry"]')).toBeNull()
  })
})
