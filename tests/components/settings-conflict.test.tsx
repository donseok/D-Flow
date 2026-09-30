// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
import { ConflictCompare } from '@/components/settings/ConflictCompare'

describe('ConflictCompare', () => {
  let host: HTMLDivElement, root: Root
  afterEach(() => { act(() => root.unmount()); host.remove() })
  it('내 값과 최신 값을 나란히 보여주고 명시적으로 선택한다', () => {
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
    const mine = vi.fn(), latest = vi.fn()
    act(() => root.render(<ConflictCompare rows={[{ key: 'name', label: '제품 이름', mine: '내 이름', latest: '새 이름' }]} onMine={mine} onLatest={latest} />))
    expect(host.textContent).toContain('내 이름')
    expect(host.textContent).toContain('새 이름')
    const buttons = host.querySelectorAll('button')
    act(() => buttons[0].click())
    act(() => buttons[1].click())
    expect(mine).toHaveBeenCalledOnce()
    expect(latest).toHaveBeenCalledOnce()
  })
})
