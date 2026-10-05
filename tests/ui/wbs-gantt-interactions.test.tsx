// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GanttImpactConfirmDialog } from '@/components/wbs/GanttImpactConfirmDialog'
import type { ComputedItem, TaskDependency } from '@/lib/domain/types'

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

describe('GanttImpactConfirmDialog UI (D6-§8-gantt, Q08)', () => {
  const currentItem: ComputedItem = {
    id: 'item-current',
    code: '1.2',
    name: '본 작업',
    parentId: null, sortOrder: 0, biz: null, deliverable: null,
    actualPct: null, owners: [], isOwnerSplit: false, plannedPct: 0, achievement: null,
    depth: 1,
    children: [],
    weight: 10,
    rolledActualPct: 0,
    status: 'not_started',
    plannedStart: '2026-10-10',
    plannedEnd: '2026-10-20',
  }

  const predItem: ComputedItem = {
    id: 'item-pred',
    code: '1.1',
    name: '선행 설계',
    parentId: null, sortOrder: 0, biz: null, deliverable: null,
    actualPct: null, owners: [], isOwnerSplit: false, plannedPct: 0, achievement: null,
    depth: 1,
    children: [],
    weight: 10,
    rolledActualPct: 100,
    status: 'done',
    plannedStart: '2026-10-01',
    plannedEnd: '2026-10-12', // Notice: ends on 10-12
  }

  const succItem: ComputedItem = {
    id: 'item-succ',
    code: '1.3',
    name: '후행 검증',
    parentId: null, sortOrder: 0, biz: null, deliverable: null,
    actualPct: null, owners: [], isOwnerSplit: false, plannedPct: 0, achievement: null,
    depth: 1,
    children: [],
    weight: 10,
    rolledActualPct: 0,
    status: 'not_started',
    plannedStart: '2026-10-22',
    plannedEnd: '2026-10-30',
  }

  const dependencies: TaskDependency[] = [
    {
      id: 'dep-1',
      predecessorId: 'item-pred',
      successorId: 'item-current',
      type: 'FS', projectId: 'project-1', lagDays: 0, origin: 'manual',
    },
    {
      id: 'dep-2',
      predecessorId: 'item-current',
      successorId: 'item-succ',
      type: 'FS', projectId: 'project-1', lagDays: 0, origin: 'manual',
    },
  ]

  const itemById = new Map<string, ComputedItem>([
    ['item-current', currentItem],
    ['item-pred', predItem],
    ['item-succ', succItem],
  ])

  it('선행 작업과의 충돌(선행 완료일보다 앞서 시작)을 정확히 감지하여 경고를 표시한다', () => {
    act(() => {
      root.render(
        <GanttImpactConfirmDialog
          open={true}
          item={currentItem}
          originalStart="2026-10-10"
          originalEnd="2026-10-20"
          proposedStart="2026-10-08" // 10-08 is earlier than predEnd 10-12!
          proposedEnd="2026-10-18"
          calendar={{ workingDays: new Set([1, 2, 3, 4, 5] as const), offDates: new Set(), workDates: new Set() }}
          dependencies={dependencies}
          itemById={itemById}
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />,
      )
    })

    const dialog = document.querySelector('[data-testid="gantt-impact-dialog"]')
    expect(dialog).toBeTruthy()

    const predImpact = document.querySelector('[data-testid="impact-predecessor"]')
    expect(predImpact?.textContent).toContain('선행 FS 제약의 최소 시작일(2026-10-13)보다 시작일(2026-10-08)이 앞섭니다')
  })

  it('후행 작업과의 충돌(후행 시작일보다 늦게 완료)을 정확히 감지하여 경고를 표시한다', () => {
    act(() => {
      root.render(
        <GanttImpactConfirmDialog
          open={true}
          item={currentItem}
          originalStart="2026-10-10"
          originalEnd="2026-10-20"
          proposedStart="2026-10-15"
          proposedEnd="2026-10-25" // 10-25 is later than succStart 10-22!
          calendar={{ workingDays: new Set([1, 2, 3, 4, 5] as const), offDates: new Set(), workDates: new Set() }}
          dependencies={dependencies}
          itemById={itemById}
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />,
      )
    })

    const succImpact = document.querySelector('[data-testid="impact-successor"]')
    expect(succImpact?.textContent).toContain('후행 작업 시작일(2026-10-22)이 FS 제약의 최소 시작일(2026-10-26)보다 앞섭니다')
  })

  it('적용 클릭 시 onConfirm 콜백을 호출하고 취소 클릭 시 onCancel 콜백을 호출한다', () => {
    const handleConfirm = vi.fn()
    const handleCancel = vi.fn()

    act(() => {
      root.render(
        <GanttImpactConfirmDialog
          open={true}
          item={currentItem}
          originalStart="2026-10-10"
          originalEnd="2026-10-20"
          proposedStart="2026-10-12"
          proposedEnd="2026-10-22"
          calendar={{ workingDays: new Set([1, 2, 3, 4, 5] as const), offDates: new Set(), workDates: new Set() }}
          dependencies={dependencies}
          itemById={itemById}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />,
      )
    })

    const confirmBtn = document.querySelector('[data-testid="gantt-impact-confirm-btn"]') as HTMLButtonElement
    act(() => {
      confirmBtn.click()
    })
    expect(handleConfirm).toHaveBeenCalledTimes(1)

    const cancelBtn = Array.from(document.querySelectorAll('button')).find(
      b => b.textContent?.trim() === '취소',
    )
    act(() => {
      cancelBtn?.click()
    })
    expect(handleCancel).toHaveBeenCalledTimes(1)
  })
  it('SS 의존성은 선행 종료일 대신 시작일과 근무일 지연을 사용한다', () => {
    act(() => root.render(<GanttImpactConfirmDialog open item={currentItem}
      originalStart="2026-10-10" originalEnd="2026-10-20"
      proposedStart="2026-10-05" proposedEnd="2026-10-15"
      calendar={{ workingDays: new Set([1, 2, 3, 4, 5] as const), offDates: new Set(), workDates: new Set() }}
      dependencies={[{ ...dependencies[0], type: 'SS', lagDays: 2 }]}
      itemById={itemById} onConfirm={() => {}} onCancel={() => {}} />))
    const impact = document.querySelector('[data-testid="impact-predecessor"]')
    expect(impact?.textContent).toContain('정상 연결 (SS, 최소 2026-10-05 시작)')
  })

})
