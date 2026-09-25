// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const upsertArea = vi.fn(async (): Promise<{ ok: true; id: string } | { ok: false; error: string }> => ({ ok: true, id: 'a-new' }))
const refresh = vi.fn()
vi.mock('@/app/actions/projectAreas', () => ({ upsertArea: (...a: unknown[]) => upsertArea(...(a as [])) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }))
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))

import { ProjectAreasManager } from '@/components/settings/ProjectAreasManager'
import type { AreaRow } from '@/app/actions/projectAreas'

const AREA: AreaRow = {
  id: 'a1', kind: 'weekly_section', code: 'PLAN', name: '생산계획', sortOrder: 0, active: true,
  teams: [{ teamId: 't-erp', kind: 'primary' }],
}
const TEAMS = [
  { id: 't-erp', code: 'ERP', active: true }, { id: 't-mes', code: 'MES', active: true },
  { id: 't-old', code: 'OLD', active: false }, { id: 't-gone', code: 'GONE', active: false },
]
const LEGACY: AreaRow = {
  id: 'a2', kind: 'weekly_section', code: 'LEGACY', name: '옛 구분', sortOrder: 1, active: true,
  teams: [{ teamId: 't-erp', kind: 'primary' }, { teamId: 't-old', kind: 'support' }, { teamId: 't-unknown', kind: 'support' }],
}

describe('ProjectAreasManager', () => {
  let container: HTMLDivElement
  let root: Root
  beforeEach(() => {
    upsertArea.mockClear(); refresh.mockClear()
    container = document.createElement('div'); document.body.appendChild(container)
    root = createRoot(container)
    act(() => root.render(
      <ProjectAreasManager projectId="p1" areas={{ weekly_section: [AREA, LEGACY], issue_area: [] }} teamOptions={TEAMS} />,
    ))
  })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  const codeInput = () => container.querySelector<HTMLInputElement>('input[data-area-code]')!
  const click = (sel: string) => act(() => container.querySelector<HTMLElement>(sel)!.click())

  it('기존 영역을 편집하면 코드는 읽기 전용, 새 영역은 입력 가능', () => {
    click('[aria-label="PLAN 편집"]')
    expect(codeInput().value).toBe('PLAN')
    expect(codeInput().readOnly).toBe(true)

    act(() => Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('새 영역'))!.click())
    expect(codeInput().value).toBe('')
    expect(codeInput().readOnly).toBe(false)
  })

  it('편집 저장은 id·kind·담당 팀을 액션에 넘긴다(코드는 원래 값 그대로)', async () => {
    click('[aria-label="PLAN 편집"]')
    const sel = container.querySelector<HTMLSelectElement>('select[data-area-team="MES"]')!
    act(() => {
      sel.value = 'support'
      sel.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await act(async () => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    expect(upsertArea).toHaveBeenCalledWith('p1', {
      id: 'a1', kind: 'weekly_section', code: 'PLAN', name: '생산계획', sortOrder: 0, active: true,
      teams: [{ teamId: 't-erp', kind: 'primary' }, { teamId: 't-mes', kind: 'support' }],
    })
    expect(refresh).toHaveBeenCalled()
  })

  it('배정된 비활성 팀은 표·폼에 비활성 표시로 보이고 해제할 수 있다, 배정 안 된 비활성 팀은 폼에 없다', async () => {
    const legacyRow = container.querySelector('tr[data-area-row="LEGACY"]')!
    expect(legacyRow.textContent).toContain('OLD(비활성)')
    expect(legacyRow.textContent).toContain('알 수 없는 팀')
    expect(legacyRow.textContent).not.toContain('?')

    click('[aria-label="LEGACY 편집"]')
    const old = container.querySelector<HTMLSelectElement>('select[data-area-team="OLD"]')!
    expect(old).not.toBeNull()
    expect(old.value).toBe('support')
    expect(old.closest('label')!.textContent).toContain('비활성')
    expect(container.querySelector('select[data-area-team="GONE"]')).toBeNull()
    act(() => { old.value = ''; old.dispatchEvent(new Event('change', { bubbles: true })) })
    await act(async () => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    const sent = (upsertArea.mock.calls[0] as unknown[])[1] as { teams: { teamId: string }[] }
    expect(sent.teams.map(t => t.teamId)).not.toContain('t-old')
  })

  it('순서 칸이 비어 있으면 저장하지 않고 안내한다(0 으로 바꾸지 않는다)', async () => {
    click('[aria-label="PLAN 편집"]')
    const order = container.querySelector<HTMLInputElement>('input[data-area-order]')!
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    act(() => { setter.call(order, ''); order.dispatchEvent(new Event('input', { bubbles: true })) })
    await act(async () => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    expect(upsertArea).not.toHaveBeenCalled()
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('순서를 입력하세요.')
  })

  it('kind 탭을 바꾸면 그 종류의 목록을 보인다', () => {
    click('[data-area-kind="issue_area"]')
    expect(container.querySelector('tr[data-area-row]')).toBeNull()
    expect(container.textContent).toContain('아직 이슈 영역이 없습니다.')
  })
})
