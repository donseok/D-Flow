// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/',
}))

vi.mock('@/app/actions/globalSearch', () => ({
  searchTitles: vi.fn(async ({ query }) => {
    if (query === 'error') {
      return { ok: false, error: '검색 실패', projects: [], wbsItems: [] }
    }
    if (query === 'Alpha') {
      return {
        ok: true,
        projects: [{ type: 'project', id: 'p-1', name: 'Alpha Project', href: '/p/p-1/dashboard' }],
        wbsItems: [{ type: 'wbs', id: 'w-1', code: '1.1', title: 'Alpha Item', projectId: 'p-1', href: '/p/p-1/wbs?focus=w-1' }],
      }
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
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

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
    expect(dialog?.textContent).toContain('1.1 Alpha Item')

    vi.useRealTimers()
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
