// @vitest-environment jsdom
// 상세 패널의 순서 이동·의존성 — 비교할 '값'이 없는 조작의 충돌(SPU1 — 개정 §5.8). 이동은 내가 본 자리(부모·sort_order·맞바꿀 이웃)를 싣고,
// 서버가 "그새 바뀜"(conflict)으로 답하면 실패 문구가 아니라 '그새 바뀌었습니다'로 알리고 다시 읽는다. 일반 실패는 다시 읽지 않는다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ComputedItem, TaskDependency } from '@/lib/domain/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const h = vi.hoisted(() => ({ move: vi.fn(), add: vi.fn(), remove: vi.fn(), refresh: vi.fn() }))
vi.mock('@/app/actions/wbs', () => ({
  getChangeLogs: vi.fn().mockResolvedValue([]), updateWbsFields: vi.fn(), updateDeliverable: vi.fn(), addWbsItem: vi.fn(),
  addSubAct: vi.fn(), deleteWbsItem: vi.fn(), moveWbsItem: h.move, addTaskDependency: h.add, removeTaskDependency: h.remove,
}))
vi.mock('@/app/actions/attachments', () => ({
  listAttachments: vi.fn().mockResolvedValue({ ok: true, rows: [], download: 'allowed' }), recordAttachment: vi.fn(), removeAttachment: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh, push: vi.fn() }) }))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ locale: 'ko', t: (k: string) => k }) }))
vi.mock('@/components/app/TeamsProvider', () => ({ useTeamCodes: () => [], useTeamSlot: () => () => ({ fg: 'text-neutral', bar: 'bg-neutral', chip: 'bg-neutral-weak text-neutral' }) }))
vi.mock('@/components/wbs/WbsAssigneeStagePanel', () => ({ WbsAssigneeStagePanel: () => null }))

import { RowDetailPanel } from '@/components/wbs/RowDetailPanel'

const item = (id: string, sortOrder: number, over: Partial<ComputedItem> = {}): ComputedItem => ({
  id, parentId: 'parent', code: id, sortOrder, name: `작업 ${id}`, biz: null, deliverable: null, plannedStart: '2026-08-31', plannedEnd: '2026-09-02',
  weight: null, actualPct: 0, owners: [], isOwnerSplit: false, plannedPct: 0, rolledActualPct: 0, achievement: null, status: 'not_started', children: [], depth: 1, ...over,
})
const A = item('a', 1), B = item('b', 2), C = item('c', 3)
const DEP: TaskDependency = { id: 'dep-1', projectId: 'p1', predecessorId: 'a', successorId: 'b', type: 'FS', lagDays: 0, origin: 'manual' }

describe('RowDetailPanel — 순서 이동·의존성의 "그새 바뀜"', () => {
  let container: HTMLDivElement, root: Root
  const render = async (dependencies: TaskDependency[] = []) => {
    await act(async () => root.render(
      <RowDetailPanel timeZone="Asia/Seoul" levelLabels={['Phase', 'Task']} item={B} allItems={[C, A, B, item('other', 1, { parentId: 'elsewhere' })]}
        dependencies={dependencies} projectId="p1" onClose={() => {}} editable />,
    ))
    await act(async () => {})
  }
  beforeEach(() => {
    vi.clearAllMocks()
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
  })
  afterEach(async () => { await act(async () => root.unmount()); container.remove() })

  const click = (el: Element | null | undefined) => act(async () => { (el as HTMLElement).click() })
  const byLabel = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  const byText = (text: string) => [...container.querySelectorAll('button')].find(b => b.textContent?.includes(text))

  it('이동은 내가 본 자리를 싣는다 — 같은 부모의 sort_order 이웃(화면 순서가 아니다)', async () => {
    h.move.mockResolvedValue({ ok: true })
    await render()
    await click(byLabel('wbs.moveUp'))
    expect(h.move).toHaveBeenLastCalledWith('b', 'up', { parentId: 'parent', sortOrder: 2, neighborId: 'a' })
    await click(byLabel('wbs.moveDown'))
    expect(h.move).toHaveBeenLastCalledWith('b', 'down', { parentId: 'parent', sortOrder: 2, neighborId: 'c' })
    expect(h.refresh).toHaveBeenCalledTimes(2)
  })

  it('그새 남이 순서를 바꿨으면(conflict) 서버 문구 대신 사전 문구로 알리고 다시 읽는다', async () => {
    h.move.mockResolvedValue({ ok: false, conflict: true, error: '서버 문구', latest: { parentId: 'parent', sortOrder: 2, neighborId: 'c' } })
    await render()
    await click(byLabel('wbs.moveUp'))
    expect(container.textContent).toContain('common.changedMeanwhile')
    expect(container.textContent).not.toContain('서버 문구')
    expect(h.refresh).toHaveBeenCalledTimes(1)
  })

  it('일반 실패는 그 문구를 보이고 다시 읽지 않는다', async () => {
    h.move.mockResolvedValue({ ok: false, error: '순서를 바꾸지 못했습니다' })
    await render()
    await click(byLabel('wbs.moveUp'))
    expect(container.textContent).toContain('순서를 바꾸지 못했습니다')
    expect(h.refresh).not.toHaveBeenCalled()
  })

  it('이미 지워진 연결을 지우면(conflict) 알리고 다시 읽는다 — 일반 실패는 문구만', async () => {
    await render([DEP])
    await click(byText('wbs.depViewList'))
    h.remove.mockResolvedValueOnce({ ok: false, conflict: true, error: '이미 삭제된 연결입니다.' })
    await click(byLabel('wbs.removeDependency'))
    expect(h.remove).toHaveBeenCalledWith('dep-1')
    expect(container.textContent).toContain('common.changedMeanwhile')
    expect(h.refresh).toHaveBeenCalledTimes(1)
    h.remove.mockResolvedValueOnce({ ok: false, error: '삭제 권한이 없습니다' })
    await click(byLabel('wbs.removeDependency'))
    expect(container.textContent).toContain('삭제 권한이 없습니다')
    expect(h.refresh).toHaveBeenCalledTimes(1)
  })

  it('그새 남이 같은 연결을 이었으면(conflict) 추가 폼을 닫고 알린 뒤 다시 읽는다', async () => {
    h.add.mockResolvedValue({ ok: false, conflict: true, error: '이미 연결된 선행 작업입니다' })
    await render()
    await click(byText('wbs.addPredecessor'))
    const select = [...container.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === 'a'))!
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!.call(select, 'a')
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await click(byText('wbs.connectTasks'))
    expect(h.add).toHaveBeenCalledWith('p1', 'a', 'b', 'FS', 0)
    expect(container.textContent).toContain('common.changedMeanwhile')
    expect(byText('wbs.connectTasks')).toBeUndefined()
    expect(h.refresh).toHaveBeenCalledTimes(1)
  })
})
