// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const update = vi.fn(), outcome = vi.fn(), refresh = vi.fn()
vi.mock('@/app/actions/settings', () => ({ updateWorkspaceSettings: (...a: unknown[]) => update(...a), getSettingsCommandOutcome: (...a: unknown[]) => outcome(...a) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
import { AccentEditor } from '@/components/settings/AccentEditor'

describe('AccentEditor', () => {
  let host: HTMLDivElement, root: Root
  beforeEach(() => {
    update.mockReset().mockResolvedValue({ ok: true, kind: 'applied', revision: 2, commandId: 'c', rebased: false })
    outcome.mockReset(); refresh.mockReset()
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
    act(() => root.render(<AccentEditor workspaceId="ws-1" revision={1} initialAccent={null} />))
  })
  afterEach(() => { act(() => root.unmount()); host.remove() })

  async function click(label: string) {
    const button = [...host.querySelectorAll('button')].find(x => x.textContent?.includes(label))!
    await act(async () => button.click())
  }
  it('기준 색 하나를 보내고 밝은·어두운 미리보기를 그린다', async () => {
    const input = host.querySelector<HTMLInputElement>('#workspace-accent')!
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '#315cdb')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(host.textContent).toContain('밝은 화면')
    expect(host.textContent).toContain('어두운 화면')
    await click('강조색 저장')
    expect(update).toHaveBeenCalledWith('ws-1', expect.objectContaining({ expectedRevision: 1, set: { 'branding.accent': '#315cdb' } }))
    expect(refresh).toHaveBeenCalledOnce()
  })
  it('기본값으로 되돌릴 때 null 을 저장한다', async () => {
    act(() => root.render(<AccentEditor key="existing" workspaceId="ws-1" revision={1}
      initialAccent={{ base: '#315cdb', light: {} as never, dark: {} as never }} />))
    await click('기본값으로')
    await click('강조색 저장')
    expect(update).toHaveBeenCalledWith('ws-1', expect.objectContaining({ set: { 'branding.accent': null } }))
  })
})
