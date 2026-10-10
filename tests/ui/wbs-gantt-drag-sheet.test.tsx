// @vitest-environment jsdom
// 간트 시트에서 선택 의존선과 바 드래그→영향 검토→CAS 저장까지 실제 컴포넌트 트리로 확인한다.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComputedItem, TaskDependency } from '@/lib/domain/types'
import type { ProjectActorView } from '@/lib/domain/authz'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const bulkUpdate = vi.hoisted(() => vi.fn())
const refresh = vi.hoisted(() => vi.fn())

vi.mock('@/app/actions/wbs', () => ({ updateActual: vi.fn(), updateWeight: vi.fn(), addWbsItem: vi.fn() }))
vi.mock('@/app/actions/wbsBulk', () => ({ bulkUpdateWbsItems: bulkUpdate, createWbsBulkSnapshot: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }))
vi.mock('@/components/providers/LocaleProvider', async () => {
  const { t } = await import('@/lib/i18n/dict')
  const ko = (k: string) => t(k as Parameters<typeof t>[0])   // 렌더마다 같은 함수(effect 의존성 안정)
  return { useLocale: () => ({ t: ko }) }
})
vi.mock('@/components/wbs/RowDetailPanel', () => ({ RowDetailPanel: () => null }))
vi.mock('@/lib/prefs/debouncedSave', () => ({ queueWbsCollapse: vi.fn(), queueUiPref: vi.fn() }))

import { WbsGanttSheet } from '@/components/wbs/WbsGanttSheet'
import { calInputUtcMon } from '../helpers/calendarFixture'

const PROJECT = '00000000-0000-4000-8000-0000000000cc'
const LEAF = '00000000-0000-4000-8000-0000000000a1'
const PRED = '00000000-0000-4000-8000-0000000000a0'
const REVISION = '2026-10-06T01:02:03.000Z'

function item(over: Partial<ComputedItem> & Pick<ComputedItem, 'id' | 'name'>): ComputedItem {
  return {
    parentId: null, code: '1', sortOrder: 0, biz: null, deliverable: null,
    plannedStart: '2026-10-10', plannedEnd: '2026-10-20', weight: null, actualPct: 0,
    owners: [], isOwnerSplit: false, plannedPct: 0, rolledActualPct: 0, achievement: null,
    status: 'not_started', children: [], depth: 1, ...over,
  }
}

const admin: ProjectActorView = {
  userId: '00000000-0000-4000-8000-000000000001',
  isSuperuser: false,
  workspaceId: '00000000-0000-4000-8000-0000000000aa',
  workspaceRole: 'member',
  projectRole: 'admin',
  memberId: '00000000-0000-4000-8000-0000000000bb',
  rosterTeamIds: [],
  rosterTeamCodes: [],
  primaryTeamCode: null,
}

const dependency: TaskDependency = {
  id: 'dep-1', projectId: PROJECT, predecessorId: PRED, successorId: LEAF,
  type: 'FS', lagDays: 0, origin: 'manual',
}

function tree() {
  const leaf = item({ id: LEAF, name: '후행 작업', parentId: PRED, code: '1.2', updatedAt: REVISION })
  const pred = item({
    id: PRED, name: '선행 작업', code: '1.1', depth: 0, children: [leaf],
    plannedStart: '2026-10-01', plannedEnd: '2026-10-08',
  })
  return [pred]
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.clearAllMocks()
  bulkUpdate.mockResolvedValue({ ok: true, total: 1, succeeded: [LEAF], failed: [] })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => { root.unmount() })
  container.remove()
  document.body.innerHTML = ''
})

async function render(actorView: ProjectActorView | null) {
  await act(async () => {
    root.render(
      <WbsGanttSheet
        levelLabels={['Phase', 'Task']}
        items={tree()}
        dependencies={[dependency]}
        calendar={calInputUtcMon}
        today="2026-10-06"
        actorView={actorView}
        projectId={PROJECT}
        initialCollapsed={[]}
      />,
    )
  })
}

function pointer(type: 'mousedown' | 'mousemove' | 'mouseup', x: number) {
  return new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: 20 })
}

describe('WBS 간트 시트 — 선택 의존선과 드래그 저장', () => {
  it('두 체크박스를 연속 선택해도 첫 선택을 보존한다', async () => {
    await render(admin)
    const inputs = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"][aria-label$="대량 수정 선택"]')]
    expect(inputs).toHaveLength(2)
    await act(async () => { inputs[0].click(); inputs[1].click() })
    expect(inputs.every(input => input.checked)).toBe(true)
    expect(document.body.textContent).toContain('2개 선택됨')
  })

  it('행을 선택하면 그 작업의 의존선을 그린다', async () => {
    await render(admin)
    expect(document.querySelector('[data-testid="gantt-dependency-overlay"]')).toBeNull()
    const name = [...container.querySelectorAll('button')].find(button => button.textContent === '후행 작업')
    expect(name).toBeTruthy()
    await act(async () => { name!.click() })
    const line = document.querySelector('[data-dep-id="dep-1"]')
    expect(line).toBeTruthy()
  })

  it('바를 옮기면 점선 원본을 보여주고, 놓으면 검토 뒤 드래그 시작 revision으로 저장한다', async () => {
    await render(admin)
    const bar = container.querySelector(`[data-testid="gantt-bar-${LEAF}"]`)
    expect(bar).toBeTruthy()
    await act(async () => { bar!.dispatchEvent(pointer('mousedown', 100)) })
    await act(async () => { window.dispatchEvent(pointer('mousemove', 148)) })
    expect(container.querySelector('[data-testid="gantt-bar-original-dashed"]')).toBeTruthy()
    await act(async () => { window.dispatchEvent(pointer('mouseup', 148)) })

    const dialog = document.querySelector('[data-testid="gantt-impact-dialog"]')
    expect(dialog?.textContent).toContain('2026-10-10 ~ 2026-10-20')
    expect(dialog?.textContent).toContain('2026-10-12 ~ 2026-10-22')
    expect(dialog?.textContent).toContain('자동 후속 이동')

    const confirm = document.querySelector('[data-testid="gantt-impact-confirm-btn"]') as HTMLButtonElement
    await act(async () => { confirm.click() })
    expect(bulkUpdate).toHaveBeenCalledWith(
      PROJECT,
      [LEAF],
      {
        plannedStart: { mode: 'set', value: '2026-10-12' },
        plannedEnd: { mode: 'set', value: '2026-10-22' },
      },
      [{ id: LEAF, updatedAt: REVISION }],
    )
    expect(document.querySelector('[data-testid="gantt-impact-dialog"]')).toBeNull()
    expect(refresh).toHaveBeenCalled()
  })

  it('같은 자리에서 놓으면 검토를 열지 않고, 저장 실패는 대화상자를 유지한다', async () => {
    await render(admin)
    const bar = container.querySelector(`[data-testid="gantt-bar-${LEAF}"]`)!
    await act(async () => { bar.dispatchEvent(pointer('mousedown', 40)) })
    await act(async () => { window.dispatchEvent(pointer('mouseup', 40)) })
    expect(document.querySelector('[data-testid="gantt-impact-dialog"]')).toBeNull()

    bulkUpdate.mockResolvedValue({
      ok: false, error: '다른 사용자가 수정했습니다.', total: 1, succeeded: [],
      failed: [{ itemId: LEAF, reason: 'conflict', message: '다른 사용자가 수정했습니다. 최신 내용을 검토한 뒤 다시 시도해 주세요.' }],
    })
    await act(async () => { bar.dispatchEvent(pointer('mousedown', 100)) })
    await act(async () => { window.dispatchEvent(pointer('mousemove', 148)) })
    await act(async () => { window.dispatchEvent(pointer('mouseup', 148)) })
    const confirm = document.querySelector('[data-testid="gantt-impact-confirm-btn"]') as HTMLButtonElement
    await act(async () => { confirm.click() })
    expect(document.querySelector('[data-testid="gantt-impact-dialog"]')).toBeTruthy()
    expect(document.body.textContent).toContain('다른 사용자가 수정했습니다.')
  })

  it('관리자가 아니면 바를 끌어도 일정을 제안하지 않는다', async () => {
    await render(null)
    const bar = container.querySelector(`[data-testid="gantt-bar-${LEAF}"]`)
    expect(bar).toBeTruthy()
    await act(async () => { bar!.dispatchEvent(pointer('mousedown', 100)) })
    await act(async () => { window.dispatchEvent(pointer('mousemove', 200)) })
    await act(async () => { window.dispatchEvent(pointer('mouseup', 200)) })
    expect(document.querySelector('[data-testid="gantt-impact-dialog"]')).toBeNull()
    expect(bulkUpdate).not.toHaveBeenCalled()
  })
})
