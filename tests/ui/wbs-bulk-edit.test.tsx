// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WbsBulkBar } from '@/components/wbs/WbsBulkBar'
import { WbsBulkEditDialog, type WbsItemSummary } from '@/components/wbs/WbsBulkEditDialog'
import * as wbsBulkActions from '@/app/actions/wbsBulk'

vi.mock('@/components/providers/LocaleProvider', async () => {
  const { t } = await import('@/lib/i18n/dict')
  const ko = (k: string) => t(k as Parameters<typeof t>[0])   // 렌더마다 같은 함수(effect 의존성 안정)
  return { useLocale: () => ({ t: ko }) }
})

vi.mock('@/app/actions/wbsBulk', () => ({
  bulkUpdateWbsItems: vi.fn(),
  createWbsBulkSnapshot: vi.fn(),
}))

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.clearAllMocks()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
  document.body.innerHTML = ''
})

function setInputValue(input: HTMLInputElement, value: string) {
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )?.set
  act(() => {
    nativeInputValueSetter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

describe('WbsBulkBar UI', () => {
  it('selectedCount가 0 이하이면 렌더링되지 않는다', () => {
    act(() => {
      root.render(
        <WbsBulkBar
          selectedCount={0}
          totalCount={10}
          onOpenBulkEdit={vi.fn()}
          onClearSelection={vi.fn()}
        />,
      )
    })

    const bar = document.querySelector('[data-testid="wbs-bulk-bar"]')
    expect(bar).toBeNull()
  })

  it('선택된 항목 개수를 표시하고 액션 버튼을 렌더링한다', () => {
    const handleOpen = vi.fn()
    const handleClear = vi.fn()
    const handleSelectAll = vi.fn()

    act(() => {
      root.render(
        <WbsBulkBar
          selectedCount={3}
          totalCount={20}
          onOpenBulkEdit={handleOpen}
          onClearSelection={handleClear}
          onSelectAll={handleSelectAll}
        />,
      )
    })

    const countEl = document.querySelector('[data-testid="wbs-bulk-selected-count"]')
    expect(countEl?.textContent).toBe('3')

    const selectAllBtn = document.querySelector('[data-testid="wbs-bulk-select-all-btn"]') as HTMLButtonElement
    expect(selectAllBtn).toBeTruthy()
    act(() => {
      selectAllBtn.click()
    })
    expect(handleSelectAll).toHaveBeenCalledTimes(1)

    const editBtn = document.querySelector('[data-testid="wbs-bulk-edit-btn"]') as HTMLButtonElement
    act(() => {
      editBtn.click()
    })
    expect(handleOpen).toHaveBeenCalledTimes(1)

    const clearBtn = document.querySelector('[data-testid="wbs-bulk-clear-btn"]') as HTMLButtonElement
    act(() => {
      clearBtn.click()
    })
    expect(handleClear).toHaveBeenCalledTimes(1)
  })
})

describe('WbsBulkEditDialog UI (UX-08, D6-§8-bulk)', () => {
  const mockItems: WbsItemSummary[] = [
    {
      id: 'item-1',
      name: '화면 설계',
      plannedStart: '2026-10-01',
      plannedEnd: '2026-10-10',
      deliverable: '설계서.pdf',
      biz: '기획',
      stage: 'as',
    },
    {
      id: 'item-2',
      name: 'API 구현',
      plannedStart: '2026-10-05',
      plannedEnd: '2026-10-15',
      deliverable: 'API명세.md',
      biz: '개발',
      stage: 'ip',
    },
  ]

  it('서로 다른 필드 값에 대해 (혼합) 배지를 표시한다', () => {
    act(() => {
      root.render(
        <WbsBulkEditDialog
          open={true}
          onClose={vi.fn()}
          projectId="proj-1"
          selectedItems={mockItems}
          totalCount={10}
        />,
      )
    })

    expect(document.querySelector('[data-testid="bulk-mixed-indicator-시작일"]')).toBeTruthy()
    expect(document.querySelector('[data-testid="bulk-mixed-indicator-산출물"]')).toBeTruthy()
    expect(document.querySelector('[data-testid="bulk-mixed-indicator-업무 분류"]')).toBeTruthy()
    expect(document.querySelector('[data-testid="bulk-mixed-indicator-작업 단계"]')).toBeTruthy()
  })

  it('시작일이 종료일보다 늦게 지정되면 에러 메시지를 표시하고 제출을 차단한다', async () => {
    act(() => {
      root.render(
        <WbsBulkEditDialog
          open={true}
          onClose={vi.fn()}
          projectId="proj-1"
          selectedItems={mockItems}
          totalCount={10}
        />,
      )
    })

    // 시작일 새 값 지정 클릭
    const setBtns = Array.from(document.querySelectorAll('button')).filter(
      b => b.textContent?.trim() === '새 값 지정',
    )
    act(() => {
      setBtns[0]?.click() // 시작일
    })

    const startInput = document.querySelector(
      '[data-testid="bulk-input-planned-start"]',
    ) as HTMLInputElement
    setInputValue(startInput, '2026-10-25')

    // 종료일 새 값 지정 클릭
    act(() => {
      setBtns[1]?.click() // 종료일
    })
    const endInput = document.querySelector(
      '[data-testid="bulk-input-planned-end"]',
    ) as HTMLInputElement
    setInputValue(endInput, '2026-10-10')

    // 적용 클릭
    const applyBtn = document.querySelector('[data-testid="wbs-bulk-apply-btn"]') as HTMLButtonElement
    act(() => {
      applyBtn.click()
    })

    const alert = document.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain('시작일이 종료일보다 늦을 수 없습니다.')
    expect(wbsBulkActions.bulkUpdateWbsItems).not.toHaveBeenCalled()
  })

  it('대량 변경 성공 시 완료 메시지를 표시한다', async () => {
    const handleSuccess = vi.fn()
    vi.mocked(wbsBulkActions.bulkUpdateWbsItems).mockResolvedValue({
      ok: true,
      total: 2,
      succeeded: ['item-1', 'item-2'],
      failed: [],
    })

    act(() => {
      root.render(
        <WbsBulkEditDialog
          open={true}
          onClose={vi.fn()}
          projectId="proj-1"
          selectedItems={mockItems}
          totalCount={10}
          onSuccess={handleSuccess}
        />,
      )
    })

    // 산출물 새 값 지정
    const setBtns = Array.from(document.querySelectorAll('button')).filter(
      b => b.textContent?.trim() === '새 값 지정',
    )
    act(() => {
      setBtns[2]?.click() // 산출물
    })

    const delivInput = document.querySelector(
      '[data-testid="bulk-input-deliverable"]',
    ) as HTMLInputElement
    setInputValue(delivInput, '통합산출물.pdf')

    const applyBtn = document.querySelector('[data-testid="wbs-bulk-apply-btn"]') as HTMLButtonElement
    await act(async () => {
      applyBtn.click()
    })

    expect(wbsBulkActions.bulkUpdateWbsItems).toHaveBeenCalledWith('proj-1', ['item-1', 'item-2'], {
      plannedStart: { mode: 'unchanged' },
      plannedEnd: { mode: 'unchanged' },
      deliverable: { mode: 'set', value: '통합산출물.pdf' },
      biz: { mode: 'unchanged' },
      stage: { mode: 'unchanged' },
    }, [])

    const resultPanel = document.querySelector('[data-testid="wbs-bulk-result-panel"]')
    expect(resultPanel?.textContent).toContain('대량 수정 완료')
    expect(handleSuccess).toHaveBeenCalledTimes(1)
  })

  it('부분 실패 발생 시 실패 항목과 원인을 표시하고 실패 건만 재시도 가능하다', async () => {
    vi.mocked(wbsBulkActions.bulkUpdateWbsItems).mockResolvedValue({
      ok: false,
      total: 2,
      succeeded: ['item-1'],
      failed: [
        {
          itemId: 'item-2',
          name: 'API 구현',
          reason: 'validation',
          message: '의존성이 연결된 작업의 계획일은 비울 수 없습니다.',
        },
      ],
    })

    act(() => {
      root.render(
        <WbsBulkEditDialog
          open={true}
          onClose={vi.fn()}
          projectId="proj-1"
          selectedItems={mockItems}
          totalCount={10}
        />,
      )
    })

    // 시작일 값 비우기
    const clearBtns = Array.from(document.querySelectorAll('button')).filter(
      b => b.textContent?.trim() === '값 비우기',
    )
    act(() => {
      clearBtns[0]?.click()
    })

    const applyBtn = document.querySelector('[data-testid="wbs-bulk-apply-btn"]') as HTMLButtonElement
    await act(async () => {
      applyBtn.click()
    })

    const resultPanel = document.querySelector('[data-testid="wbs-bulk-result-panel"]')
    expect(resultPanel?.textContent).toContain('부분 실패 발생')

    const failedItem = document.querySelector('[data-testid="wbs-bulk-failed-item"]')
    expect(failedItem?.textContent).toContain('API 구현')
    expect(failedItem?.textContent).toContain('유효성 오류')

    // '실패한 1건만 다시 시도' 클릭
    const retryBtn = document.querySelector(
      '[data-testid="wbs-bulk-retry-failed-btn"]',
    ) as HTMLButtonElement
    vi.mocked(wbsBulkActions.createWbsBulkSnapshot).mockResolvedValue({ ok: true, rows: [{ id: 'item-2', name: 'API 구현', updatedAt: '2026-10-05T12:00:00Z', plannedStart: null, plannedEnd: null, deliverable: null, biz: null, stage: null, assigneeMemberId: null, teamCode: null }] })
    await act(async () => {
      retryBtn.click()
    })

    expect(document.querySelector('[data-testid="wbs-bulk-result-panel"]')).toBeNull()
    expect(document.body.textContent).toContain('실패한 1개 항목 재시도')
  })
})
