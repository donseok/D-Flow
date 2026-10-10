// @vitest-environment jsdom
// 대시보드 판정 기준 편집기(dashboard.due_soon_days·dashboard.delayed_red_count — 프로젝트 설정 '일반'). 바뀐 키만 쓰고, 기본값으로 되돌리면 그 키를 지운다.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
const h = vi.hoisted(() => ({ update: vi.fn(), outcome: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ t: (k: string) => k }) }))
vi.mock('@/app/actions/settings', () => ({ updateProjectSettings: (...a: unknown[]) => h.update(...a), getSettingsCommandOutcome: (...a: unknown[]) => h.outcome(...a) }))
import { DashboardThresholdsEditor } from '@/components/settings/DashboardThresholdsEditor'
import { settingsKo } from '@/lib/i18n/dict/settings'

const DAYS = 'dashboard.due_soon_days', RED = 'dashboard.delayed_red_count'
const OK = { ok: true, kind: 'applied', commandId: 'c', revision: 9, rebased: false }

describe('DashboardThresholdsEditor', () => {
  let root: Root, el: HTMLDivElement
  beforeEach(() => { vi.clearAllMocks(); el = document.createElement('div'); document.body.append(el); root = createRoot(el) })
  afterEach(() => { act(() => root.unmount()); el.remove() })
  const days = () => el.querySelector<HTMLInputElement>('[data-due-soon-days]')!
  const red = () => el.querySelector<HTMLInputElement>('[data-delayed-red-count]')!
  const save = () => el.querySelector<HTMLButtonElement>('[data-dashboard-thresholds-save]')!
  /** React 가 제어하는 input 에 값을 넣는다(네이티브 setter + input 이벤트) */
  const type = async (input: HTMLInputElement, value: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  it('지금 값을 그리고, 바뀐 것이 없으면 저장할 수 없다', async () => {
    await act(async () => { root.render(<DashboardThresholdsEditor projectId="p" dueSoonDays={7} delayedRedCount={4} revision={3} canEdit />) })
    expect([days().value, red().value]).toEqual(['7', '4'])
    expect(save().disabled).toBe(true)
  })

  it('임박 일수만 바꾸면 그 키 하나만 쓴다(expectedRevision). 저장 뒤에는 다시 저장할 것이 없다', async () => {
    h.update.mockResolvedValue(OK)
    await act(async () => { root.render(<DashboardThresholdsEditor projectId="p-1" dueSoonDays={7} delayedRedCount={4} revision={3} canEdit />) })
    await type(days(), '14')
    expect(save().disabled).toBe(false)
    await act(async () => save().click())
    expect(h.update).toHaveBeenCalledTimes(1)
    expect(h.update.mock.calls[0][0]).toBe('p-1')
    expect(h.update.mock.calls[0][1]).toMatchObject({ expectedRevision: 3, set: { [DAYS]: 14 }, unset: [] })
    expect(Object.keys(h.update.mock.calls[0][1].set)).toEqual([DAYS])
    expect(el.querySelector('[role="status"]')?.textContent).toBe('settings.workflow.saved')
    expect(save().disabled).toBe(true)
  })

  it('기본값으로 되돌리면 그 키를 지운다(unset) — 다른 칸은 값으로 쓴다', async () => {
    h.update.mockResolvedValue(OK)
    await act(async () => { root.render(<DashboardThresholdsEditor projectId="p" dueSoonDays={14} delayedRedCount={4} revision={5} canEdit />) })
    await type(days(), '7')
    await type(red(), '2')
    await act(async () => save().click())
    expect(h.update.mock.calls[0][1]).toMatchObject({ expectedRevision: 5, set: { [RED]: 2 }, unset: [DAYS] })
  })

  it('범위 밖·숫자가 아닌 값은 저장할 수 없고 사유를 보인다', async () => {
    await act(async () => { root.render(<DashboardThresholdsEditor projectId="p" dueSoonDays={7} delayedRedCount={4} revision={3} canEdit />) })
    for (const bad of ['0', '61', '7.5', '', 'abc']) {
      await type(days(), bad)
      expect(save().disabled, bad).toBe(true)
      expect(el.querySelector('[role="alert"]')?.textContent, bad).toBe('settings.dashboard.thresholds.range')
    }
    await type(days(), '60')
    expect(save().disabled).toBe(false)
    expect(h.update).not.toHaveBeenCalled()
  })

  it('손상 값 — 사유를 보이고 기본값 그대로여도 다시 저장해 고칠 수 있다(두 키를 지운다)', async () => {
    h.update.mockResolvedValue(OK)
    await act(async () => { root.render(<DashboardThresholdsEditor projectId="p" dueSoonDays={null} delayedRedCount={4} revision={3} canEdit invalid />) })
    expect(el.querySelector('[role="alert"]')?.textContent).toBe('settings.dashboard.thresholds.invalid')
    expect(days().value).toBe('7')
    expect(save().disabled).toBe(false)
    await act(async () => save().click())
    expect(h.update.mock.calls[0][1]).toMatchObject({ set: {}, unset: [DAYS, RED] })
  })

  it('서버가 거부하면 그 문구를 보이고 고른 값은 남는다', async () => {
    h.update.mockResolvedValue({ ok: false, kind: 'invalid', code: 'CONFIG_INVALID', commandId: 'c', error: '설정 값이 올바르지 않습니다.', retryable: false,
      fieldErrors: [{ key: DAYS, message: '마감 임박 기준 일수은(는) 1~60 사이의 정수여야 합니다.' }] })
    await act(async () => { root.render(<DashboardThresholdsEditor projectId="p" dueSoonDays={7} delayedRedCount={4} revision={3} canEdit />) })
    await type(days(), '30')
    await act(async () => save().click())
    expect(el.querySelector('[role="alert"]')?.textContent).toBe('마감 임박 기준 일수은(는) 1~60 사이의 정수여야 합니다.')
    expect(days().value).toBe('30')
    expect(save().disabled).toBe(false)
  })

  it('권한이 없으면 입력은 잠기고 저장 단추가 없다', async () => {
    await act(async () => { root.render(<DashboardThresholdsEditor projectId="p" dueSoonDays={10} delayedRedCount={3} revision={3} canEdit={false} />) })
    expect([days().disabled, red().disabled]).toEqual([true, true])
    expect(el.querySelector('[data-dashboard-thresholds-save]')).toBeNull()
  })

  it('문구가 사전에 있다', () => {
    const keys = ['thresholds.title', 'thresholds.intro', 'thresholds.invalid', 'thresholds.range',
      'due_soon_days.label', 'due_soon_days.unit', 'due_soon_days.desc', 'delayed_red_count.label', 'delayed_red_count.unit', 'delayed_red_count.desc']
    for (const k of keys) expect((settingsKo as Record<string, string>)[`settings.dashboard.${k}`], k).toBeTruthy()
  })
})
