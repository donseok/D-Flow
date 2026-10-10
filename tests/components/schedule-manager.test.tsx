// @vitest-environment jsdom
// 일정 화면의 날짜 예외 추가 — 실패하면 입력을 지우지 않는다(A-5 리뷰 O9: addHoliday 가 결과형이 되어 입력 오류·RLS 거부가 흔한 경로가 됐다),
// Excel 내보내기에는 휴무만 나간다는 안내(근무 예외는 빠진다 — D7 지원 제한)
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const m = vi.hoisted(() => ({ addHoliday: vi.fn(), removeHoliday: vi.fn(), setBaseDate: vi.fn(), toast: vi.fn(), refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: m.refresh }) }))
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ toast: m.toast }) }))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ t: (k: string) => k, locale: 'ko' }) }))
vi.mock('@/app/actions/project', () => ({ addHoliday: m.addHoliday, removeHoliday: m.removeHoliday, setBaseDate: m.setBaseDate }))

import { ScheduleManager } from '@/components/settings/ScheduleManager'

let container: HTMLDivElement
let root: Root
beforeEach(() => { vi.clearAllMocks(); container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container) })
afterEach(() => { act(() => root.unmount()); container.remove() })

async function render() {
  await act(async () => { root.render(<ScheduleManager projectId="p1" baseDate={null} holidays={[]} canEdit />) })
}
async function type(el: HTMLInputElement, v: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const dateInput = () => container.querySelectorAll<HTMLInputElement>('input[type="date"]')[1]
const nameInput = () => container.querySelector<HTMLInputElement>('input[placeholder="settings.holidayNamePlaceholder"]')!
const addButton = () => [...container.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('common.add'))!

describe('ScheduleManager — 날짜 예외 추가', () => {
  it('실패(ok:false)면 오류 토스트이고 입력은 그대로다', async () => {
    m.addHoliday.mockResolvedValue({ ok: false, error: '날짜 예외를 저장하지 못했습니다.' })
    await render()
    await type(dateInput(), '2026-10-10')
    await type(nameInput(), '토요 근무')
    await act(async () => { addButton().click() })
    expect(m.addHoliday).toHaveBeenCalledWith('p1', '2026-10-10', '토요 근무', 'off')
    expect(m.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error' }))
    expect(dateInput().value).toBe('2026-10-10')
    expect(nameInput().value).toBe('토요 근무')
  })
  it('성공하면 입력을 비운다', async () => {
    m.addHoliday.mockResolvedValue({ ok: true })
    await render()
    await type(dateInput(), '2026-10-10')
    await type(nameInput(), '토요 근무')
    await act(async () => { addButton().click() })
    expect(m.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'success' }))
    expect(dateInput().value).toBe('')
    expect(nameInput().value).toBe('')
  })
  it('throw 해도 입력은 그대로다', async () => {
    m.addHoliday.mockRejectedValue(new Error('network'))
    await render()
    await type(dateInput(), '2026-10-10')
    await act(async () => { addButton().click() })
    expect(dateInput().value).toBe('2026-10-10')
  })
})

describe('ScheduleManager — Excel 내보내기 안내(A-5 리뷰 O9)', () => {
  it('내보내기에는 휴무만 나간다는 문구가 날짜 예외 절에 있다', async () => {
    await render()
    expect(container.textContent).toContain('settings.holidaysExportNote')
  })
})

describe('설정 사전 — 지운 절 이름을 가리키지 않는다(A-5 리뷰 O9)', () => {
  it("baseDatePolicyDesc 는 ‘달력’ 절을 가리키고 옛 ‘일정 기준 및 공휴일’ 이 없다", async () => {
    const { settingsKo } = await import('@/lib/i18n/dict/settings')
    expect(settingsKo['settings.baseDatePolicyDesc']).toContain('‘달력’')
    expect(settingsKo['settings.baseDatePolicyDesc']).not.toContain('일정 기준 및 공휴일')
  })
})
