// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ t: (k: string) => k, locale: 'ko' }),
}))

import { ArchiveChatPanel } from '@/components/minutes/ArchiveChatPanel'

describe('ArchiveChatPanel 레이어/닫기', () => {
  let container: HTMLDivElement, root: Root
  const onClose = vi.fn()

  beforeEach(() => {
    container = document.createElement('div'); document.body.appendChild(container)
    root = createRoot(container)
    onClose.mockReset()
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals() })

  function render(open = true) {
    act(() => root.render(
      <ArchiveChatPanel open={open} onClose={onClose} workspaceId="ws-1" team={null} from={null} to={null} />,
    ))
  }

  it('앱 헤더(--z-shell)·AI 어시스턴트 버튼·패널보다 위 레이어(--z-modal)에 뜬다 — 비교 상대는 숫자가 아니라 그 파일의 실제 층', () => {
    render()
    const dialog = container.querySelector('[role="dialog"]')!
    expect(dialog.className).toContain('z-(--z-modal)')
    const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8')
    const token = (name: string) => Number(new RegExp(`--${name}:\\s*(\\d+)`).exec(css)?.[1])
    // AI 패널은 아직 임의 z(B 파일 — UI-2b 레일이 토큰으로 옮긴다). 리터럴 130 을 박아 두면 그때 낡은 값과 비교한 채 초록으로 남는다(U1b 리뷰 R3 P3)
    const chat = readFileSync(join(process.cwd(), 'src/components/chat/AssistantChat.tsx'), 'utf8')
    const layers = [
      ...[...chat.matchAll(/\bz-\[(\d+)\]/g)].map((m) => Number(m[1])),
      ...[...chat.matchAll(/\bz-\(--([\w-]+)\)/g)].map((m) => token(m[1])),
    ]
    expect(layers.length).toBeGreaterThan(0)
    expect(layers.every(Number.isFinite)).toBe(true)
    for (const z of [token('z-shell'), ...layers]) expect(token('z-modal')).toBeGreaterThan(z)
  })

  it('백드롭 클릭으로 닫힌다', () => {
    render()
    const backdrop = container.querySelector<HTMLElement>('[data-backdrop]')!
    act(() => backdrop.click())
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('Escape 키로 닫힌다', () => {
    render()
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('닫힌 상태에서는 Escape 리스너가 없다', () => {
    render(false)
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(onClose).not.toHaveBeenCalled()
  })
})
