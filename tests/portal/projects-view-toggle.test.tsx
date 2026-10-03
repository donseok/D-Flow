// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ queue: vi.fn(), flush: vi.fn(), refresh: vi.fn() }))
vi.mock('@/lib/prefs/debouncedSave', () => ({ queueUiPref: h.queue, flushUiPrefs: h.flush }))
vi.mock('@/lib/portal/reload', () => ({ reloadPortalPage: h.refresh }))
import { ProjectsViewToggle } from '@/components/portal/ProjectsViewToggle'
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
let root: Root, host: HTMLDivElement
beforeEach(async () => { h.queue.mockReset(); h.flush.mockReset(); h.refresh.mockReset(); host=document.createElement('div'); document.body.append(host); root=createRoot(host); await act(async () => root.render(<ProjectsViewToggle view="rows" />)) })
afterEach(() => { act(() => root.unmount()); host.remove() })
describe('프로젝트 보기 전환', () => {
  it('계정 키를 저장 완료한 뒤 갱신한다', async () => {
    let finish!: (ok: boolean) => void
    h.flush.mockReturnValue(new Promise(r => { finish = r }))
    await act(async () => (host.querySelectorAll('button')[1] as HTMLButtonElement).click())
    expect(h.queue).toHaveBeenCalledWith({ projectsView: 'cards' }); expect(h.refresh).not.toHaveBeenCalled()
    await act(async () => { finish(true) }); expect(h.refresh).toHaveBeenCalledTimes(1)
  })
  it('저장 실패는 전환을 취소하고 오류를 보인다', async () => {
    h.flush.mockResolvedValue(false)
    await act(async () => (host.querySelectorAll('button')[1] as HTMLButtonElement).click())
    expect(host.querySelector('[role="alert"]')).not.toBeNull(); expect(h.refresh).not.toHaveBeenCalled()
    expect(host.querySelectorAll('button')[0].getAttribute('aria-pressed')).toBe('true')
  })
})
