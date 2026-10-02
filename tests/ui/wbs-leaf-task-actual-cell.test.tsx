// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ComputedItem } from '@/lib/domain/types'
import type { ProjectActorView } from '@/lib/domain/authz'
import { makeProjectActorView } from '../fixtures/actor'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

type SaveResult = { ok: boolean; error?: string; conflict?: boolean; code?: 'actual_locked' }
const updateActual = vi.fn(async (): Promise<SaveResult> => ({ ok: true }))
const updateWeight = vi.fn(async (): Promise<SaveResult> => ({ ok: true }))
vi.mock('@/app/actions/wbs', () => ({
  updateActual: (...a: unknown[]) => updateActual(...(a as [])),
  updateWeight: (...a: unknown[]) => updateWeight(...(a as [])),
  addWbsItem: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ locale: 'ko', t: (k: string) => k }) }))
vi.mock('@/components/wbs/RowDetailPanel', () => ({ RowDetailPanel: () => null }))
vi.mock('@/lib/prefs/debouncedSave', () => ({ queueWbsCollapse: vi.fn() }))

import { WbsGanttSheet } from '@/components/wbs/WbsGanttSheet'
import { calInputUtcMon } from '../helpers/calendarFixture'

// SP1: 팀은 프로젝트 명단에만 산다(계정 전역 팀 폐지) — 옛 계정 팀을 명단 팀으로 옮겼다.
const pmo: ProjectActorView = makeProjectActorView({ userId: 'u-pmo', projectRole: 'admin', memberId: 'm-pmo', rosterTeamIds: ['tp'], rosterTeamCodes: ['PMO'], primaryTeamCode: 'PMO' })
const dtEditor: ProjectActorView = makeProjectActorView({ userId: 'u-dt', projectRole: 'member', memberId: 'm-dt', rosterTeamIds: ['td'], rosterTeamCodes: ['가공'], primaryTeamCode: '가공' })

function item(over: Partial<ComputedItem>): ComputedItem {
  return {
    id: 'x', parentId: null, code: '1', sortOrder: 0, name: '항목', biz: null,
    deliverable: null, plannedStart: '2026-07-01', plannedEnd: '2026-07-10', weight: null, actualPct: 0,
    owners: [], isOwnerSplit: false, plannedPct: 0, rolledActualPct: 0, achievement: null, status: 'not_started', children: [], depth: 0, ...over,
  }
}

/* 실데이터 모양: Phase '1. 준비' 아래에
 *   - '1-3. 프로젝트 착수 보고회' = 자식 없는 Task(PMO 주관) ← 지금까지 실적 입력 불가였던 항목
 *   - '1-1. 작업' = activity 자식을 가진 Task(롤업 부모) */
function fixture(): ComputedItem[] {
  const loneTask = item({
    id: 't-lone', code: '1-3', name: '1-3. 프로젝트 착수 보고회',
    owners: [{ team: 'PMO', kind: 'primary' }], sortOrder: 0,
  })
  const rollupTask = item({
    id: 't-parent', code: '1-1', name: '1-1. 작업', sortOrder: 1,
    children: [item({ id: 'a1', parentId: 't-parent', name: '활동', owners: [{ team: '가공', kind: 'primary' }] })],
  })
  return [item({ id: 'p1', name: '1. 준비', children: [loneTask, rollupTask] })]
}

/** 실적% 셀은 편집 가능할 때만 role=button + title=wbs.editActualTitle 을 갖는다. */
function actualCells(c: HTMLElement) {
  return [...c.querySelectorAll<HTMLElement>('[title="wbs.editActualTitle"]')]
}
function rowNames(c: HTMLElement) {
  return [...c.querySelectorAll<HTMLElement>('.group.relative.z-10')].map(
    r => r.querySelector('button[type="button"]')?.textContent ?? '',
  )
}

describe('WbsGanttSheet — 단독 Task 실적% 입력', () => {
  let container: HTMLDivElement, root: Root
  beforeEach(() => {
    updateActual.mockClear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  const mount = (actorView: ProjectActorView | null, readOnly = false) =>
    act(async () => root.render(
      <WbsGanttSheet levelLabels={['Phase', 'Task', 'Activity']} items={fixture()} calendar={calInputUtcMon} today="2026-07-03" actorView={actorView} projectId="p1" readOnly={readOnly} />,
    ))

  it('PMO에게는 단독 Task 의 실적% 셀만 편집 가능하고, 롤업 Task·Phase 는 아니다', async () => {
    await mount(pmo)
    // 렌더된 행: phase, 단독 task, 롤업 task, 그 activity 자식
    expect(rowNames(container)).toEqual(['1. 준비', '1-3. 프로젝트 착수 보고회', '1-1. 작업', '활동'])
    // 편집 가능한 실적 셀 = 단독 Task + 말단 activity 2개 (phase·롤업 task 는 제외)
    expect(actualCells(container)).toHaveLength(2)
    const rows = [...container.querySelectorAll<HTMLElement>('.group.relative.z-10')]
    expect(rows[1].querySelector('[title="wbs.editActualTitle"]')).not.toBeNull() // 단독 task
    expect(rows[0].querySelector('[title="wbs.editActualTitle"]')).toBeNull()     // phase
    expect(rows[2].querySelector('[title="wbs.editActualTitle"]')).toBeNull()     // 롤업 task
  })

  it('단독 Task 실적% 셀을 클릭하면 입력이 열리고, 저장하면 updateActual 이 호출된다', async () => {
    await mount(pmo)
    const cell = [...container.querySelectorAll<HTMLElement>('.group.relative.z-10')][1]
      .querySelector<HTMLElement>('[title="wbs.editActualTitle"]')!
    expect(cell.getAttribute('role')).toBe('button')

    await act(async () => cell.click())
    const input = container.querySelector<HTMLInputElement>('input[aria-label="wbs.ariaEditActual"]')
    expect(input).not.toBeNull()

    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(input, '60')
      input!.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    // 세 번째 인자는 낙관적 잠금 기준값(편집 시작 시점의 실적%).
    expect(updateActual).toHaveBeenCalledWith('t-lone', 60, 0)
  })

  it('담당이 아닌 팀 편집자에게는 단독 Task 실적% 셀이 열리지 않는다', async () => {
    await mount(dtEditor) // 가공 팀 — 단독 Task 는 PMO 주관
    const rows = [...container.querySelectorAll<HTMLElement>('.group.relative.z-10')]
    expect(rows[1].querySelector('[title="wbs.editActualTitle"]')).toBeNull() // 단독 task(PMO 담당)
    expect(rows[3].querySelector('[title="wbs.editActualTitle"]')).not.toBeNull() // 가공 담당 activity
  })

  it('readOnly 면 PMO 라도 열리지 않는다', async () => {
    await mount(pmo, true)
    expect(actualCells(container)).toHaveLength(0)
  })
})

describe('WbsGanttSheet — 검증·저장 실패에서 입력 보존', () => {
  let container: HTMLDivElement, root: Root
  beforeEach(() => {
    updateActual.mockClear()
    updateWeight.mockClear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  const mount = () =>
    act(async () => root.render(
      <WbsGanttSheet levelLabels={['Phase', 'Task', 'Activity']} items={fixture()} calendar={calInputUtcMon} today="2026-07-03" actorView={pmo} projectId="p1" />,
    ))
  const loneRow = () => [...container.querySelectorAll<HTMLElement>('.group.relative.z-10')][1]
  const actualInput = () => container.querySelector<HTMLInputElement>('input[aria-label="wbs.ariaEditActual"]')
  const weightInput = () => container.querySelector<HTMLInputElement>('input[aria-label="wbs.ariaEditWeight"]')
  const alerts = () => [...document.querySelectorAll<HTMLElement>('[role="alert"]')].map(n => n.textContent)

  async function open(title: 'wbs.editActualTitle' | 'wbs.editWeightTitle') {
    await act(async () => loneRow().querySelector<HTMLElement>(`[title="${title}"]`)!.click())
  }
  async function type(input: HTMLInputElement, value: string) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  async function enter(input: HTMLInputElement) {
    await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
  }
  // React onBlur 는 focusout 을 듣는다.
  async function blur(input: HTMLInputElement) {
    await act(async () => { input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })
  }

  it('범위 밖(101)은 서버를 부르지 않고 입력을 남긴다 — 100 으로 고치면 저장하고 닫힌다', async () => {
    await mount()
    await open('wbs.editActualTitle')
    await type(actualInput()!, '101')
    await enter(actualInput()!)

    expect(updateActual).not.toHaveBeenCalled()
    expect(actualInput()).not.toBeNull()
    expect(actualInput()!.value).toBe('101')
    expect(actualInput()!.getAttribute('aria-invalid')).toBe('true')
    expect(alerts()).toContain('wbs.toastRange')

    await type(actualInput()!, '100')
    expect(actualInput()!.getAttribute('aria-invalid')).toBeNull()
    await enter(actualInput()!)
    expect(updateActual).toHaveBeenCalledTimes(1)
    expect(updateActual).toHaveBeenCalledWith('t-lone', 100, 0)
    expect(actualInput()).toBeNull()
  })

  it('서버가 거부하면(충돌 아님) 입력창과 값이 남는다', async () => {
    updateActual.mockResolvedValueOnce({ ok: false, error: '99%까지' })
    await mount()
    await open('wbs.editActualTitle')
    await type(actualInput()!, '60')
    await enter(actualInput()!)

    expect(updateActual).toHaveBeenCalledTimes(1)
    expect(actualInput()).not.toBeNull()
    expect(actualInput()!.value).toBe('60')
    expect(alerts()).toContain('99%까지')
  })

  // 잠금 거부는 액션의 한국어 문구가 아니라 사전 문구로 — 영어 화면에 한국어 안내가 뜨지 않게(사유는 code 로 고른다).
  it('잠금 거부(code=actual_locked)의 안내는 사전 문구다 — 입력창과 값은 남는다', async () => {
    updateActual.mockResolvedValueOnce({ ok: false, error: '완료는 승인 버튼으로 처리합니다', code: 'actual_locked' })
    await mount()
    await open('wbs.editActualTitle')
    await type(actualInput()!, '100')
    await enter(actualInput()!)

    expect(alerts()).toEqual(['wbs.actualLocked'])
    expect(actualInput()!.value).toBe('100')
  })

  it('충돌이면 현행대로 닫고, 안내에 입력한 값을 남긴다', async () => {
    updateActual.mockResolvedValueOnce({ ok: false, conflict: true })
    await mount()
    await open('wbs.editActualTitle')
    await type(actualInput()!, '60')
    await enter(actualInput()!)

    expect(actualInput()).toBeNull()
    expect(alerts()).toContain('wbs.toastConflict — wbs.toastYourValue: 60')
  })

  it('음수 가중치는 서버를 부르지 않고 입력을 남긴다', async () => {
    await mount()
    await open('wbs.editWeightTitle')
    await type(weightInput()!, '-1')
    await enter(weightInput()!)

    expect(updateWeight).not.toHaveBeenCalled()
    expect(weightInput()).not.toBeNull()
    expect(weightInput()!.value).toBe('-1')
    expect(alerts()).toContain('wbs.toastWeightMin')
  })

  it('같은 잘못된 초안에서 blur 를 두 번 해도 토스트는 한 번이다', async () => {
    await mount()
    await open('wbs.editActualTitle')
    await type(actualInput()!, '101')
    vi.useFakeTimers()
    try {
      await blur(actualInput()!)
      expect(alerts()).toContain('wbs.toastRange')
      await act(async () => { vi.advanceTimersByTime(3000) }) // 토스트 자동 해제
      expect(alerts()).not.toContain('wbs.toastRange')

      await blur(actualInput()!)
      expect(alerts()).not.toContain('wbs.toastRange')
      expect(actualInput()!.value).toBe('101')
      expect(updateActual).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
