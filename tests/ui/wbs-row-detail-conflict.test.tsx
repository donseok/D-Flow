// @vitest-environment jsdom
// 상세 패널의 이름·일정·산출물 저장 충돌(SPU1 — 개정 §5.8, Q05). 폼을 열 때 본 값을 기대값으로 싣고, 서버가 충돌로 답하면 폼과 입력을 둔 채
// 비교를 띄운다. 편집 중에 그 항목의 값이 바뀌어도(남의 저장·새로고침) 폼을 닫거나 덮지 않는다 — 입력을 조용히 버리지 않는다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ComputedItem } from '@/lib/domain/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const h = vi.hoisted(() => ({ fields: vi.fn(), deliverable: vi.fn(), refresh: vi.fn() }))
vi.mock('@/app/actions/wbs', () => ({
  getChangeLogs: vi.fn().mockResolvedValue([]), updateWbsFields: h.fields, updateDeliverable: h.deliverable, addWbsItem: vi.fn(),
  addSubAct: vi.fn(), deleteWbsItem: vi.fn(), moveWbsItem: vi.fn(), addTaskDependency: vi.fn(), removeTaskDependency: vi.fn(),
}))
vi.mock('@/app/actions/attachments', () => ({
  listAttachments: vi.fn().mockResolvedValue({ ok: true, rows: [], download: 'allowed' }), recordAttachment: vi.fn(), removeAttachment: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh, push: vi.fn() }) }))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ locale: 'ko', t: (k: string) => k }) }))
vi.mock('@/components/app/TeamsProvider', () => ({ useTeamLabel: () => (c: string) => c, useTeamCodes: () => [], useTeamSlot: () => () => ({ fg: 'text-neutral', bar: 'bg-neutral', chip: 'bg-neutral-weak text-neutral' }) }))
vi.mock('@/components/wbs/WbsAssigneeStagePanel', () => ({ WbsAssigneeStagePanel: () => null }))

import { RowDetailPanel } from '@/components/wbs/RowDetailPanel'

const item = (over: Partial<ComputedItem> = {}): ComputedItem => ({
  id: 'item-1', parentId: null, code: 'A-1', sortOrder: 1, name: '설계 검토', biz: null, deliverable: '초안', plannedStart: '2026-08-31', plannedEnd: '2026-09-02',
  weight: null, actualPct: 0, owners: [], isOwnerSplit: false, plannedPct: 0, rolledActualPct: 0, achievement: null, status: 'not_started', children: [], depth: 0, ...over,
})

describe('RowDetailPanel — 저장 충돌 비교', () => {
  let container: HTMLDivElement, root: Root
  const render = async (it: ComputedItem) => {
    await act(async () => root.render(
      <RowDetailPanel timeZone="Asia/Seoul" levelLabels={['Phase', 'Task']} item={it} allItems={[it]} dependencies={[]} projectId="p1" onClose={() => {}} editable canEditDeliverable />,
    ))
    await act(async () => {})
  }
  beforeEach(async () => {
    vi.clearAllMocks()
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
    await render(item())
  })
  afterEach(async () => { await act(async () => root.unmount()); container.remove() })

  const button = (label: string) => [...container.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === label || b.textContent === label)!
  const inputs = () => [...container.querySelectorAll<HTMLInputElement>('input.app-input')]
  const type = (el: HTMLInputElement, v: string) => act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const dialog = () => document.querySelector<HTMLElement>('[data-testid="conflict-resolver"]')
  const choose = (action: 'mine' | 'latest' | 'continue') => act(async () => dialog()!.querySelector<HTMLButtonElement>(`[data-conflict-action="${action}"]`)!.click())
  const rows = () => [...dialog()!.querySelectorAll('[data-conflict-field]')].map(f => [
    f.getAttribute('data-conflict-field'), ...(['mine', 'latest', 'base'] as const).map(w => f.querySelector(`[data-conflict-value="${w}"]`)?.textContent),
  ])
  const BASE = { name: '설계 검토', plannedStart: '2026-08-31', plannedEnd: '2026-09-02', deliverable: '초안' }
  /** 관리자 폼을 열고 이름을 바꿔 저장 */
  async function rename(to: string) {
    await act(async () => container.querySelector<HTMLButtonElement>('header button[aria-label="common.edit"]')!.click())
    await type(inputs()[0], to)
    await act(async () => button('common.save').click())
  }

  it('저장은 폼을 열 때 본 값을 기대값으로 싣는다', async () => {
    h.fields.mockResolvedValue({ ok: true })
    await rename('설계 검토 v2')
    expect(h.fields).toHaveBeenCalledWith('item-1', { ...BASE, name: '설계 검토 v2' }, BASE)
  })

  it('Q05 — 충돌이면 폼과 입력을 둔 채 어긋난 칸을 비교로 보인다. 내 값으로 저장은 본 값을 기대값으로 한 번 쓴다', async () => {
    h.fields.mockResolvedValueOnce({ ok: false, conflict: true, error: 'x', latest: { name: '남이 바꾼 이름' } })
    await rename('설계 검토 v2')
    expect(rows()).toEqual([['name', '설계 검토 v2', '남이 바꾼 이름', '설계 검토']])
    expect(inputs()[0].value).toBe('설계 검토 v2')
    expect(h.refresh).not.toHaveBeenCalled()
    h.fields.mockResolvedValueOnce({ ok: true })
    await choose('mine')
    expect(h.fields).toHaveBeenCalledTimes(2)
    expect(h.fields).toHaveBeenLastCalledWith('item-1', { ...BASE, name: '설계 검토 v2' }, { ...BASE, name: '남이 바꾼 이름' })
    expect(dialog()).toBeNull()
    expect(inputs()).toHaveLength(0)
  })

  it('Q05 — 서버 값 받기는 쓰지 않고 폼을 닫아 새로 읽는다. 계속 편집은 쓰지 않고 입력을 남긴다', async () => {
    h.fields.mockResolvedValue({ ok: false, conflict: true, error: 'x', latest: { name: '남이 바꾼 이름' } })
    await rename('설계 검토 v2')
    await choose('continue')
    expect(h.fields).toHaveBeenCalledTimes(1)
    expect(inputs()[0].value).toBe('설계 검토 v2')
    await act(async () => button('common.save').click())
    expect(h.fields).toHaveBeenLastCalledWith('item-1', { ...BASE, name: '설계 검토 v2' }, BASE)   // 기준은 그대로 — 다시 비교한다
    await choose('latest')
    expect(h.fields).toHaveBeenCalledTimes(2)
    expect(inputs()).toHaveLength(0)
    expect(h.refresh).toHaveBeenCalledTimes(1)
  })

  it('편집 중에 그 항목의 값이 바뀌어도(남의 저장) 폼을 닫거나 덮지 않는다 — 기대값도 옛 값 그대로라 서버가 가린다', async () => {
    await act(async () => container.querySelector<HTMLButtonElement>('header button[aria-label="common.edit"]')!.click())
    await type(inputs()[0], '설계 검토 v2')
    await render(item({ name: '남이 바꾼 이름', plannedEnd: '2026-09-09' }))
    expect(inputs()[0].value).toBe('설계 검토 v2')
    h.fields.mockResolvedValue({ ok: true })
    await act(async () => button('common.save').click())
    expect(h.fields).toHaveBeenCalledWith('item-1', { ...BASE, name: '설계 검토 v2' }, BASE)
  })

  it('편집 중이 아니면 바뀐 값을 따라가고, 다시 열면 그 값이 기대값이다', async () => {
    await render(item({ name: '남이 바꾼 이름' }))
    h.fields.mockResolvedValue({ ok: true })
    await rename('내 이름')
    expect(h.fields).toHaveBeenCalledWith('item-1', { ...BASE, name: '내 이름' }, { ...BASE, name: '남이 바꾼 이름' })
  })

  it('산출물 인라인 편집도 같다 — 연 때 본 값이 기대값이고 충돌은 비교로 간다', async () => {
    await act(async () => container.querySelector<HTMLButtonElement>('dl button[aria-label="common.edit"]')!.click())
    await type(inputs()[0], '최종본')
    h.deliverable.mockResolvedValueOnce({ ok: false, conflict: true, error: 'x', latest: '남의 산출물' })
    await act(async () => button('common.save').click())
    expect(h.deliverable).toHaveBeenCalledWith('item-1', '최종본', '초안')
    expect(rows()).toEqual([['deliverable', '최종본', '남의 산출물', '초안']])
    h.deliverable.mockResolvedValueOnce({ ok: true })
    await choose('mine')
    expect(h.deliverable).toHaveBeenLastCalledWith('item-1', '최종본', '남의 산출물')
    expect(dialog()).toBeNull()
  })
})
