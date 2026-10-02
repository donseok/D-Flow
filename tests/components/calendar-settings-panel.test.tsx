// @vitest-environment jsdom
// 프로젝트 설정 달력 절(스펙 §5.1 A 첫 행) — 주 시작 요일을 바꾸면 서버 미리보기('변경 내용 검토')를 받고, 막는 주차가 있으면 저장하지 않는다.
// 저장은 설정 액션 한 길(요일 하나 입력 — 목록은 서버가 만든다), 필드 오류(CONFIG_IN_USE 의 calendar.week_start — [RF3])는 그 자리에.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const m = vi.hoisted(() => ({
  updateProjectSettings: vi.fn(), updateWorkspaceSettings: vi.fn(), getSettingsCommandOutcome: vi.fn(),
  previewWeekStartChange: vi.fn(), refresh: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: m.refresh }) }))
vi.mock('@/app/actions/settings', () => ({
  updateProjectSettings: m.updateProjectSettings, updateWorkspaceSettings: m.updateWorkspaceSettings,
  getSettingsCommandOutcome: m.getSettingsCommandOutcome,
}))
vi.mock('@/app/actions/settingsPreview', () => ({ previewWeekStartChange: m.previewWeekStartChange }))

import { CalendarSettingsPanel } from '@/components/settings/CalendarSettingsPanel'
import { calendarFieldOf } from '@/lib/settings/calendarField'

const PID = '00000000-0000-0000-7e57-0000000019a2'
let container: HTMLDivElement
let root: Root
beforeEach(() => {
  vi.clearAllMocks()
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
  m.updateProjectSettings.mockResolvedValue({ ok: true, kind: 'applied', commandId: 'c', revision: 8, rebased: false })
  m.previewWeekStartChange.mockResolvedValue({ ok: true, preview: { effectiveFrom: '2026-10-04', transitionDays: 6, keptDocs: 3, blockingWeeks: [] } })
})
afterEach(() => { act(() => root.unmount()); container.remove() })

const props = (over: Record<string, unknown> = {}) => ({
  scope: { projectId: PID }, revision: 7, todayIso: '2026-09-30', canEdit: true,
  timezone: calendarFieldOf({ status: 'set', value: 'America/Los_Angeles' }),
  workingDays: calendarFieldOf({ status: 'default', value: [1, 2, 3, 4, 5], from: 'product' }),
  weekStart: calendarFieldOf({ status: 'set', value: [{ day: 'monday', from: null }] }),
  ...over,
}) as Parameters<typeof CalendarSettingsPanel>[0]
async function render(p = props()) { await act(async () => { root.render(<CalendarSettingsPanel {...p} />) }) }
const radio = (day: string) => container.querySelector<HTMLInputElement>(`input[name="calendar-week-start"][value="${day}"]`)!
const saveButton = () => container.querySelector<HTMLButtonElement>('[data-save-bar] button')!
const tzInput = () => container.querySelector<HTMLInputElement>('#calendar-timezone')!
async function click(el: HTMLElement) { await act(async () => { el.click() }) }
async function type(el: HTMLInputElement, v: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('CalendarSettingsPanel — 주 시작', () => {
  it('현재 규칙의 요일이 선택돼 있고, 생성 시 복사 안내가 있으며 "상속" 표현이 없다', async () => {
    await render()
    expect(radio('monday').checked).toBe(true)
    expect(container.textContent).toContain('워크스페이스 기본값에서 복사됨(생성 시점)')
    expect(container.textContent).not.toContain('상속')
  })

  it('요일을 바꾸면 서버 미리보기를 받아 E·과도기·기존 N건을 보인다', async () => {
    await render()
    await click(radio('sunday'))
    expect(m.previewWeekStartChange).toHaveBeenCalledWith(PID, 'sunday')
    expect(container.textContent).toContain('2026-10-04 부터 일요일 시작')
    expect(container.textContent).toContain('6일')
    expect(container.textContent).toContain('기존 주간보고 3건은 그대로')
  })

  it('저장은 요일 하나로 보낸다(목록은 서버가 만든다)', async () => {
    await render()
    await click(radio('sunday'))
    await click(saveButton())
    expect(m.updateProjectSettings).toHaveBeenCalledWith(PID, expect.objectContaining({
      expectedRevision: 7, set: { 'calendar.week_start': 'sunday' }, unset: [],
    }))
    expect(m.refresh).toHaveBeenCalled()
  })

  it('막는 주차가 있으면 목록을 보이고 저장을 막는다', async () => {
    m.previewWeekStartChange.mockResolvedValue({ ok: true, preview: { effectiveFrom: '2026-10-04', transitionDays: 6, keptDocs: 4, blockingWeeks: ['2026-10-05'] } })
    await render()
    await click(radio('sunday'))
    expect(container.textContent).toContain('2026-10-05')
    expect(saveButton().disabled).toBe(true)
  })

  it('미리보기 실패면 사유를 보이고 저장을 막는다', async () => {
    m.previewWeekStartChange.mockResolvedValue({ ok: false, error: '영향을 확인하지 못했습니다. 잠시 뒤 다시 시도하세요.' })
    await render()
    await click(radio('sunday'))
    expect(container.textContent).toContain('영향을 확인하지 못했습니다')
    expect(saveButton().disabled).toBe(true)
  })

  it('[RF3] 저장이 CONFIG_IN_USE(calendar.week_start)로 거부되면 그 필드 아래에 주차 목록 문구를 보인다', async () => {
    m.updateProjectSettings.mockResolvedValue({ ok: false, kind: 'invalid', code: 'CONFIG_IN_USE', commandId: 'c', retryable: false,
      error: '사용 중인 항목은 삭제하거나 의미를 바꿀 수 없습니다. 비활성으로 두세요.',
      fieldErrors: [{ key: 'calendar.week_start', message: '이미 만든 주간보고(2026-10-05)가 새 주 시작 규칙과 맞지 않아 저장할 수 없습니다.' }] })
    await render()
    await click(radio('sunday'))
    await click(saveButton())
    const field = container.querySelector('[data-field="calendar.week_start"]')!
    expect(field.textContent).toContain('2026-10-05')
    expect(container.textContent).not.toContain('비활성으로 두세요')
  })

  it('예정된 전환(아직 적용 전)이 있으면 그 요일이 선택돼 있고, 지금 요일과 예정을 함께 보인다(A-5 리뷰 P2, O1)', async () => {
    await render(props({ weekStart: calendarFieldOf({ status: 'set', value: [{ day: 'monday', from: null }, { day: 'sunday', from: '2026-10-04' }] }) }))
    expect(radio('sunday').checked).toBe(true)
    expect(container.textContent).toContain('지금은 월요일 시작')
    expect(container.textContent).toContain('예정: 2026-10-04 부터 일요일 시작')
    expect(saveButton().disabled).toBe(true)
  })

  it('이관 ⑩ 꼴 [{monday,null},{sunday,E}] — E 전에 월요일을 고르면 "예정 전환 취소" 검토를 보이고, 저장은 월요일 하나(서버가 예정 원소를 지운다)', async () => {
    m.previewWeekStartChange.mockResolvedValue({ ok: true, preview: {
      effectiveFrom: null, transitionDays: null, keptDocs: 2, blockingWeeks: [], error: null, cancelled: { from: '2026-10-04', day: 'sunday' } } })
    await render(props({ weekStart: calendarFieldOf({ status: 'set', value: [{ day: 'monday', from: null }, { day: 'sunday', from: '2026-10-04' }] }) }))
    await click(radio('monday'))
    expect(m.previewWeekStartChange).toHaveBeenCalledWith(PID, 'monday')
    expect(container.textContent).toContain('예정된 2026-10-04 의 일요일 시작 전환을 취소합니다')
    expect(container.textContent).not.toContain('바뀌는 내용이 없습니다')
    expect(saveButton().disabled).toBe(false)
    await click(saveButton())
    expect(m.updateProjectSettings).toHaveBeenCalledWith(PID, expect.objectContaining({ set: { 'calendar.week_start': 'monday' } }))
  })

  it('저장 직후 직전 요일로 되돌리면(예약 취소) 같은 취소 문구다 — "바뀌는 내용이 없습니다" 가 아니다', async () => {
    await render()
    await click(radio('sunday'))
    await click(saveButton())
    m.previewWeekStartChange.mockResolvedValue({ ok: true, preview: {
      effectiveFrom: null, transitionDays: null, keptDocs: 3, blockingWeeks: [], error: null, cancelled: { from: '2026-10-04', day: 'sunday' } } })
    await click(radio('monday'))
    expect(container.textContent).toContain('예정된 2026-10-04 의 일요일 시작 전환을 취소합니다')
    expect(container.textContent).not.toContain('바뀌는 내용이 없습니다')
  })
})

describe('CalendarSettingsPanel — 근무 요일·시간대', () => {
  it('근무 요일을 다 끄면 오류이고 저장하지 않는다', async () => {
    await render()
    for (const iso of [1, 2, 3, 4, 5]) await click(container.querySelector<HTMLInputElement>(`input[name="calendar-working-day"][value="${iso}"]`)!)
    expect(container.textContent).toContain('근무 요일을 하나 이상')
    expect(saveButton().disabled).toBe(true)
  })

  it('근무 요일 저장은 정렬된 ISO 목록', async () => {
    await render()
    await click(container.querySelector<HTMLInputElement>('input[name="calendar-working-day"][value="6"]')!)
    await click(saveButton())
    expect(m.updateProjectSettings).toHaveBeenCalledWith(PID, expect.objectContaining({ set: { 'calendar.working_days': [1, 2, 3, 4, 5, 6] } }))
  })

  it.each(['Asia/Seol', '+09:00', ''])('잘못된 시간대 %j 는 오류이고 저장하지 않는다', async (bad) => {
    await render()
    await type(tzInput(), bad)
    expect(container.textContent).toContain('시간대')
    expect(saveButton().disabled).toBe(true)
  })

  it('UTC 는 받는다', async () => {
    await render()
    await type(tzInput(), 'UTC')
    await click(saveButton())
    expect(m.updateProjectSettings).toHaveBeenCalledWith(PID, expect.objectContaining({ set: { 'calendar.timezone': 'UTC' } }))
  })

  it('손상된 키는 경고를 보이고, 고치지 않아도 저장 대상이다(복구 경로)', async () => {
    await render(props({ timezone: calendarFieldOf({ status: 'invalid', error: '시간대 이름이 아닙니다.' }) }))
    expect(container.textContent).toContain('설정이 손상되었습니다')
    await type(tzInput(), 'America/Los_Angeles')
    await click(saveButton())
    expect(m.updateProjectSettings).toHaveBeenCalledWith(PID, expect.objectContaining({ set: expect.objectContaining({ 'calendar.timezone': 'America/Los_Angeles' }) }))
  })

  it('편집 권한이 없으면 입력과 저장이 잠긴다', async () => {
    await render(props({ canEdit: false }))
    expect(radio('sunday').disabled).toBe(true)
    expect(saveButton().disabled).toBe(true)
  })
})

describe('편집기 셋(J1 — TimezoneSelect·WorkingDaysEditor·WeekStartEditor)', () => {
  it('시간대 선택지는 저장 규칙과 같다 — "/" 없는 이름은 닫힌 허용 목록만(L1)', async () => {
    await render()
    const options = [...container.querySelectorAll('#calendar-timezone-names option')].map((o) => (o as HTMLOptionElement).value)
    expect(options).toEqual(expect.arrayContaining(['UTC', 'GMT', 'EST5EDT', 'PST8PDT']))
    for (const rejected of ['EST', 'GMT0', 'PST', 'CET', 'IST']) expect(options).not.toContain(rejected)
    expect(options.every((n) => n.includes('/') || ['UTC', 'GMT', 'EST5EDT', 'CST6CDT', 'MST7MDT', 'PST8PDT'].includes(n))).toBe(true)
  })

  it.each(['EST', 'GMT0'])('"/" 없는 허용 밖 이름 %s 는 오류이고 저장하지 않는다', async (bad) => {
    await render()
    await type(tzInput(), bad)
    expect(saveButton().disabled).toBe(true)
  })

  it('손상된 저장 규칙(미리보기 error)은 검토 대신 그 문구를 보이고 저장을 막는다', async () => {
    m.previewWeekStartChange.mockResolvedValue({ ok: true, preview: { effectiveFrom: null, transitionDays: null, keptDocs: 2, blockingWeeks: [], error: '과거 전환을 바꿀 수 없습니다.' } })
    await render()
    await click(radio('sunday'))
    expect(container.textContent).toContain('과거 전환을 바꿀 수 없습니다.')
    expect(saveButton().disabled).toBe(true)
  })
})

describe('calendarFieldOf 의 자리 — 서버 페이지가 부른다', () => {
  it("'use client' 모듈이 아니다(클라이언트 참조가 되면 서버가 부를 수 없다 — 과제 25 눈확인 실측)", async () => {
    const { readFileSync } = await import('node:fs')
    expect(readFileSync('src/lib/settings/calendarField.ts', 'utf8')).not.toMatch(/^\s*['"]use client['"]/m)
  })
})
