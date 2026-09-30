// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const update = vi.fn(), outcome = vi.fn(), refresh = vi.fn()
vi.mock('@/app/actions/settings', () => ({ updateWorkspaceSettings: (...a: unknown[]) => update(...a), getSettingsCommandOutcome: (...a: unknown[]) => outcome(...a) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
import { MenuOrderEditor } from '@/components/settings/MenuOrderEditor'

describe('MenuOrderEditor', () => {
  let host: HTMLDivElement, root: Root
  beforeEach(() => {
    update.mockReset().mockResolvedValue({ ok: true, kind: 'applied', revision: 2, commandId: 'c', rebased: false })
    outcome.mockReset(); refresh.mockReset()
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
    act(() => root.render(<MenuOrderEditor workspaceId="ws-1" revision={1} initialMenu={{ order: [], labels: {} }} />))
  })
  afterEach(() => { act(() => root.unmount()); host.remove() })
  async function click(label: string) {
    const button = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
      ?? [...host.querySelectorAll('button')].find(x => x.textContent?.includes(label))!
    await act(async () => button.click())
  }
  it('그룹 안 순서만 바꾸고 안정 메뉴 id를 저장한다', async () => {
    await click('내 작업 위로')
    await click('메뉴 설정 저장')
    const patch = update.mock.calls[0][1]
    expect(patch.expectedRevision).toBe(1)
    expect(patch.set['navigation.menu'].order.slice(0, 3)).toEqual(['ws.my_work', 'ws.home', 'ws.projects'])
    expect(refresh).toHaveBeenCalledOnce()
  })
  it('이름을 바꿀 때 항목 id를 유지한다', async () => {
    const input = host.querySelector<HTMLInputElement>('input[aria-label="홈 메뉴 이름"]')!
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '시작')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click('메뉴 설정 저장')
    expect(update.mock.calls[0][1].set['navigation.menu'].labels).toEqual({ 'ws.home': '시작' })
  })
})
