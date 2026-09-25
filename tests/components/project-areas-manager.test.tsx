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
const TEAMS = [{ id: 't-erp', code: 'ERP' }, { id: 't-mes', code: 'MES' }]

describe('ProjectAreasManager', () => {
  let container: HTMLDivElement
  let root: Root
  beforeEach(() => {
    upsertArea.mockClear(); refresh.mockClear()
    container = document.createElement('div'); document.body.appendChild(container)
    root = createRoot(container)
    act(() => root.render(
      <ProjectAreasManager projectId="p1" areas={{ weekly_section: [AREA], issue_area: [] }} teamOptions={TEAMS} />,
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

  it('kind 탭을 바꾸면 그 종류의 목록을 보인다', () => {
    click('[data-area-kind="issue_area"]')
    expect(container.querySelector('tr[data-area-row]')).toBeNull()
    expect(container.textContent).toContain('아직 이슈 영역이 없습니다.')
  })
})
