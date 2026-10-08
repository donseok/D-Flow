// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/',
}))

const searchCalls: Array<Record<string, unknown>> = []
vi.mock('@/app/actions/globalSearch', () => ({
  searchTitles: vi.fn(async (params: { query: string; scope: string }) => {
    searchCalls.push(params)
    const { query, scope } = params
    if (query === 'error') return { ok: false, reason: 'failed', error: '검색하지 못했습니다. 잠시 후 다시 시도하세요.' }
    if (query === 'denied') return { ok: false, reason: 'denied', error: '대상을 찾을 수 없습니다.' }
    if (query === 'throw') throw new Error('network')
    if (query === 'Alpha') {
      return scope === 'project'
        ? { ok: true, projects: [], wbsItems: [{ type: 'wbs', id: 'w-1', code: '1.1', title: 'Alpha Item', projectId: 'p-1', href: '/p/p-1/wbs?focus=w-1' }] }
        : { ok: true, projects: [{ type: 'project', id: 'p-1', name: 'Alpha Project', href: '/p/p-1/dashboard' }], wbsItems: [] }
    }
    return { ok: true, projects: [], wbsItems: [] }
  }),
}))

import { GlobalSearchDialog } from '@/components/search/GlobalSearchDialog'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.clearAllMocks()
  searchCalls.length = 0
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

async function type(value: string) {
  const input = document.querySelector('input[type="text"]') as HTMLInputElement
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => { await vi.advanceTimersByTimeAsync(300) })
}

describe('GlobalSearchDialog 컴포넌트 (⌘K 검색 & 네비게이션)', () => {
  it('open이 false이면 아무것도 렌더링하지 않는다', async () => {
    await act(async () => {
      root.render(
        <GlobalSearchDialog
          open={false}
          onClose={() => {}}
          workspaceId="ws-1"
          workspaceSlug="workspace-alpha"
        />
      )
    })

    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('open이 true이면 다이얼로그와 기본 이동 바로가기 목록을 렌더링한다', async () => {
    await act(async () => {
      root.render(
        <GlobalSearchDialog
          open={true}
          onClose={() => {}}
          workspaceId="ws-1"
          workspaceSlug="workspace-alpha"
        />
      )
    })

    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog).not.toBeNull()
    expect(dialog?.getAttribute('aria-label')).toContain('전역 ⌘K 제목 검색')

    const input = document.querySelector('input[type="text"]') as HTMLInputElement
    expect(input).not.toBeNull()
    expect(input.placeholder).toContain('제목 검색')

    // 기본 이동 목록에 홈, 내 업무 등이 노출됨
    const options = document.querySelectorAll('[role="option"]')
    expect(options.length).toBeGreaterThan(0)
    expect(dialog?.textContent).toContain('홈')
    expect(dialog?.textContent).toContain('내 업무')
  })

  it('Esc 키 입력 시 onClose 콜백이 호출된다', async () => {
    const handleClose = vi.fn()

    await act(async () => {
      root.render(
        <GlobalSearchDialog
          open={true}
          onClose={handleClose}
          workspaceId="ws-1"
          workspaceSlug="workspace-alpha"
        />
      )
    })

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })

    expect(handleClose).toHaveBeenCalled()
  })

  it('검색어 입력 시 필터된 네비게이션 및 서버 검색 결과를 렌더링한다', async () => {
    vi.useFakeTimers()

    await act(async () => {
      root.render(
        <GlobalSearchDialog
          open={true}
          onClose={() => {}}
          workspaceId="ws-1"
          workspaceSlug="workspace-alpha"
        />
      )
    })

    const input = document.querySelector('input[type="text"]') as HTMLInputElement

    await act(async () => {
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
      nativeSetter?.call(input, 'Alpha')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })

    // 디바운스 대기 및 비동기 작업 flush
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })

    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog?.textContent).toContain('Alpha Project')
    expect(searchCalls.at(-1)).toMatchObject({ workspaceId: 'ws-1', scope: 'workspace', projectId: null })

    vi.useRealTimers()
  })

  it('프로젝트 화면에서는 현재 프로젝트 범위로 WBS 를 찾는다', async () => {
    vi.useFakeTimers()
    await act(async () => {
      root.render(<GlobalSearchDialog open={true} onClose={() => {}} workspaceId="ws-1" workspaceSlug="workspace-alpha" projectId="p-1" projectName="알파" />)
    })
    await type('Alpha')
    expect(searchCalls.at(-1)).toMatchObject({ workspaceId: 'ws-1', scope: 'project', projectId: 'p-1' })
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('1.1 Alpha Item')
    vi.useRealTimers()
  })

  describe('실패와 0건을 다른 문구로 보인다(SPU2 완료 조건)', () => {
    const open = async () => {
      vi.useFakeTimers()
      await act(async () => {
        root.render(<GlobalSearchDialog open={true} onClose={() => {}} workspaceId="ws-1" workspaceSlug="workspace-alpha" />)
      })
    }
    afterEach(() => { vi.useRealTimers() })

    it('0건 — status 영역에 "결과가 없습니다", 실패 문구는 없다', async () => {
      await open()
      await type('Zzzz')
      const empty = document.querySelector('[data-search-state="empty"]')
      expect(empty).not.toBeNull()
      expect(empty?.querySelector('[data-status-kind="empty"]')?.getAttribute('role')).toBe('status')
      expect(empty?.textContent).toContain('‘Zzzz’ 제목과 일치하는 결과가 없습니다')
      expect(document.querySelector('[data-search-state="failed"]')).toBeNull()
      expect(document.body.textContent).not.toContain('검색하지 못했습니다')
    })

    it('실패 — "검색하지 못했습니다"와 다시 시도, 0건 문구는 없다', async () => {
      await open()
      await type('error')
      const failed = document.querySelector('[data-search-state="failed"]')
      expect(failed).not.toBeNull()
      expect(failed?.querySelector('[data-status-kind="partial_error"]')).not.toBeNull()
      expect(failed?.textContent).toContain('검색하지 못했습니다')
      expect(failed?.textContent).toContain('결과가 없는 것이 아닙니다')
      expect(document.querySelector('[data-search-state="empty"]')).toBeNull()
      expect(document.body.textContent).not.toContain('일치하는 결과가 없습니다')

      const before = searchCalls.length
      const retry = [...(failed?.querySelectorAll('button') ?? [])].find((b) => b.textContent === '다시 시도')
      expect(retry).toBeDefined()
      await act(async () => { retry!.click() })
      await act(async () => { await vi.advanceTimersByTimeAsync(300) })
      expect(searchCalls.length).toBe(before + 1)
    })

    it('액션 호출이 던져도 실패로 보인다(빈 결과 아님)', async () => {
      await open()
      await type('throw')
      expect(document.querySelector('[data-search-state="failed"]')?.textContent).toContain('검색 요청을 보내지 못했습니다')
      expect(document.querySelector('[data-search-state="empty"]')).toBeNull()
    })

    it('범위 거부 — 실패·0건과 다른 문구', async () => {
      await open()
      await type('denied')
      const denied = document.querySelector('[data-search-state="denied"]')
      expect(denied?.textContent).toContain('이 범위에서는 검색할 수 없습니다')
      expect(document.querySelector('[data-search-state="empty"]')).toBeNull()
      expect(document.querySelector('[data-search-state="failed"]')).toBeNull()
    })

    it('응답을 기다리는 동안에는 0건이라고 말하지 않는다', async () => {
      await open()
      const input = document.querySelector('input[type="text"]') as HTMLInputElement
      await act(async () => {
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(input, 'Zzzz')
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
      expect(document.querySelector('[data-search-state="empty"]')).toBeNull()
    })
  })

  it('항목 클릭 시 모달이 닫히고 router.push가 호출된다', async () => {
    const handleClose = vi.fn()

    await act(async () => {
      root.render(
        <GlobalSearchDialog
          open={true}
          onClose={handleClose}
          workspaceId="ws-1"
          workspaceSlug="workspace-alpha"
        />
      )
    })

    const firstOption = document.querySelector('[role="option"]') as HTMLElement
    expect(firstOption).not.toBeNull()

    await act(async () => {
      firstOption.click()
    })

    expect(handleClose).toHaveBeenCalled()
    expect(mockPush).toHaveBeenCalled()
  })
})
