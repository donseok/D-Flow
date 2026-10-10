// @vitest-environment jsdom
// WBS 가중치 머리의 "가중치 미지정 N개"(SP4 D20·§5.2·§6.1) — unsetWeightCount 결과를 합계 칸 곁에 보이고, 0 이면 숨긴다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ComputedItem } from '@/lib/domain/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/app/actions/wbs', () => ({
  updateActual: vi.fn(),
  updateWeight: vi.fn(),
  addWbsItem: vi.fn(),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))
vi.mock('@/components/providers/LocaleProvider', async () => {
  const { t } = await import('@/lib/i18n/dict')
  return { useLocale: () => ({ t: (k: Parameters<typeof t>[0]) => t(k) }) }
})
vi.mock('@/components/wbs/RowDetailPanel', () => ({
  RowDetailPanel: () => null,
}))
vi.mock('@/lib/prefs/debouncedSave', () => ({
  queueWbsCollapse: vi.fn(),
}))

import { WbsGanttSheet } from '@/components/wbs/WbsGanttSheet'
import { calInputUtcMon } from '../helpers/calendarFixture'

const item: ComputedItem = {
  id: 'a1',
  parentId: null,
  code: '1',
  sortOrder: 0,
  name: '일정 항목',
  biz: null,
  deliverable: '업무분장표',
  plannedStart: '2026-07-01',
  plannedEnd: '2026-07-10',
  weight: 1,
  actualPct: 52,
  owners: [{ team: 'OPS', kind: 'primary' }], isOwnerSplit: false,
  plannedPct: 60,
  rolledActualPct: 52,
  achievement: 87,
  status: 'in_progress',
  children: [],
  depth: 0,
}
const leaf = (id: string, weight: number | null, children: ComputedItem[] = []): ComputedItem => ({ ...item, id, code: id, weight, children, depth: 0 })

describe('WbsGanttSheet — 가중치 미지정 N개', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  const renderSheet = async (items: ComputedItem[]) => {
    await act(async () => root.render(
      <WbsGanttSheet levelLabels={['Phase', 'Task', 'Activity']}
        items={items}
        calendar={calInputUtcMon}
        today="2026-07-03"
        actorView={null}
        projectId="p1"
        readOnly
      />,
    ))
  }
  const unsetText = () => container.querySelector('[data-unset-weight]')?.textContent ?? null

  it('루트 [0.5, null, null] — 같은 형제 그룹의 null 둘 → "미지정 2개", 설명 title', async () => {
    await renderSheet([leaf('a', 0.5), leaf('b', null), leaf('c', null)])
    expect(unsetText()).toBe('미지정 2개')
    expect(container.querySelector('[data-unset-weight]')!.getAttribute('title')).toContain('같은 몫')
  })
  it('합계 칸 곁 — 미지정 수가 보여도 합계(N%)는 그대로 보인다', async () => {
    await renderSheet([leaf('a', 0.5), leaf('b', null), leaf('c', null)])
    expect(container.querySelector('[data-wbs-head-sub="weight"]')?.textContent).toBe('(50%)')
  })
  it('하위 그룹의 null 도 센다 — [A(1)[x(0.5), y(null)], B(1)] → 1', async () => {
    await renderSheet([leaf('A', 1, [leaf('x', 0.5), leaf('y', null)]), leaf('B', 1)])
    expect(unsetText()).toBe('미지정 1개')
  })
  it('0이면 숨긴다 — 모두 지정, 또는 모두 비움(같은 몫이 뜻이다)', async () => {
    await renderSheet([leaf('a', 0.5), leaf('b', 0.5)])
    expect(unsetText()).toBeNull()
    await renderSheet([leaf('a', null), leaf('b', null)])
    expect(unsetText()).toBeNull()
  })
})
