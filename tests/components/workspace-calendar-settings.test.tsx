// @vitest-environment jsdom
// 워크스페이스 달력 절(스펙 D36·§5.1 A 둘째 행) — 세 키를 같은 편집기로 저장(설정 RPC 한 길), 주 시작은 요일 하나(미리보기 없음 — 문서가 없다),
// 시간대가 아직 제품 기본값이면 브라우저 시간대를 제안한다(자동 저장 없음, D13 ② — 생성 폼이 앱에 없어 설정 절이 맡는다).
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// 화면 문구는 사전(settingsUi·adminUi)에 있다 — 옮긴 문구만 한국어 글자로 돌려주는 대역(공급자 없는 기본 t 는 키를 돌려준다)
vi.mock('@/components/providers/LocaleProvider', async () => (await import('../helpers/locale-mock')).movedKoLocale())

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const m = vi.hoisted(() => ({ updateWorkspaceSettings: vi.fn(), updateProjectSettings: vi.fn(), getSettingsCommandOutcome: vi.fn(), previewWeekStartChange: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/app/actions/settings', () => ({
  updateProjectSettings: m.updateProjectSettings, updateWorkspaceSettings: m.updateWorkspaceSettings, getSettingsCommandOutcome: m.getSettingsCommandOutcome,
}))
vi.mock('@/app/actions/settingsPreview', () => ({ previewWeekStartChange: m.previewWeekStartChange }))

import { CalendarSettingsPanel } from '@/components/settings/CalendarSettingsPanel'
// 서버 페이지가 부르는 순수 함수 — 'use client' 밖(과제 25 의 calendarField 자리)
import { browserTimezoneSuggestion, workspaceCalendarFieldsOf } from '@/lib/settings/calendarField'

const WS = '00000000-0000-0000-7e57-00000000aa5c'
let container: HTMLDivElement
let root: Root
beforeEach(() => {
  vi.clearAllMocks()
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
  m.updateWorkspaceSettings.mockResolvedValue({ ok: true, kind: 'applied', commandId: 'c', revision: 4, rebased: false })
})
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks() })

const fields = (tz: { status: 'set' | 'default'; value: string }) => workspaceCalendarFieldsOf({
  'calendar.timezone': tz.status === 'set' ? { status: 'set', value: tz.value } : { status: 'default', value: tz.value, from: 'product' },
  'calendar.working_days': { status: 'default', value: [1, 2, 3, 4, 5], from: 'product' },
  'calendar.week_start': { status: 'default', value: 'sunday', from: 'product' },
})
async function render(tz: { status: 'set' | 'default'; value: string }, suggest = true) {
  await act(async () => {
    root.render(<CalendarSettingsPanel scope={{ workspaceId: WS }} revision={3} todayIso="2026-10-02" canEdit suggestBrowserTimezone={suggest} {...fields(tz)} />)
  })
}
const suggestButton = () => [...container.querySelectorAll('button')].find(b => b.textContent?.includes('이 브라우저의 시간대'))
async function click(el: HTMLElement) { await act(async () => { el.click() }) }

describe('workspaceCalendarFieldsOf — 요일을 규칙 하나로 승격', () => {
  it('sunday → [{ sunday, null }], 출처 유지', () => {
    expect(fields({ status: 'default', value: 'UTC' }).weekStart).toEqual({ value: [{ day: 'sunday', from: null }], source: 'default' })
  })
  it('손상 상태는 그대로 손상', () => {
    const f = workspaceCalendarFieldsOf({
      'calendar.timezone': { status: 'invalid', error: 'x' }, 'calendar.working_days': { status: 'invalid', error: 'y' }, 'calendar.week_start': { status: 'invalid', error: 'z' },
    })
    expect([f.timezone.source, f.workingDays.source, f.weekStart.source]).toEqual(['invalid', 'invalid', 'invalid'])
  })
})

describe('browserTimezoneSuggestion', () => {
  it('브라우저 tz 를 정규화해 돌려준다', () => {
    expect(browserTimezoneSuggestion(() => 'America/Los_Angeles')).toBe('America/Los_Angeles')
  })
  it('"/" 없는 허용 밖 이름(EST 등)은 제안하지 않는다(L1 — 저장 규칙과 같다)', () => {
    expect(browserTimezoneSuggestion(() => 'EST')).toBeNull()
    expect(browserTimezoneSuggestion(() => 'UTC')).toBe('UTC')
  })
  it('없거나 이름 꼴이 아니면 null(UTC 로 메우지 않는다 — 제안할 것이 없다)', () => {
    expect(browserTimezoneSuggestion(() => undefined)).toBeNull()
    expect(browserTimezoneSuggestion(() => '+09:00')).toBeNull()
    expect(browserTimezoneSuggestion(() => { throw new Error('no Intl') })).toBeNull()
  })
})

describe('CalendarSettingsPanel — 워크스페이스 범위', () => {
  it('생성 시점 복사 안내 대신 "새 프로젝트의 초기값" 표기, 상속 표현 없음', async () => {
    await render({ status: 'set', value: 'Europe/Berlin' })
    expect(container.textContent).toContain('새 프로젝트의 초기값')
    expect(container.textContent).not.toContain('생성 시점')
    expect(container.textContent).not.toContain('상속')
  })

  it('주 시작은 미리보기 없이 요일 하나로 저장한다', async () => {
    await render({ status: 'set', value: 'Europe/Berlin' })
    await click(container.querySelector<HTMLInputElement>('input[name="calendar-week-start"][value="monday"]')!)
    expect(m.previewWeekStartChange).not.toHaveBeenCalled()
    await click(container.querySelector<HTMLButtonElement>('[data-save-bar] button')!)
    expect(m.updateWorkspaceSettings).toHaveBeenCalledWith(WS, expect.objectContaining({ expectedRevision: 3, set: { 'calendar.week_start': 'monday' } }))
    expect(m.updateProjectSettings).not.toHaveBeenCalled()
  })

  it('시간대가 제품 기본값이면 브라우저 시간대 제안 — 누르면 초안만 채우고 저장은 사용자가', async () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({ timeZone: 'America/Los_Angeles' } as Intl.ResolvedDateTimeFormatOptions)
    await render({ status: 'default', value: 'UTC' })
    const b = suggestButton()!
    expect(b.textContent).toContain('America/Los_Angeles')
    await click(b)
    expect(container.querySelector<HTMLInputElement>('#calendar-timezone')!.value).toBe('America/Los_Angeles')
    expect(m.updateWorkspaceSettings).not.toHaveBeenCalled()
    await click(container.querySelector<HTMLButtonElement>('[data-save-bar] button')!)
    expect(m.updateWorkspaceSettings).toHaveBeenCalledWith(WS, expect.objectContaining({ set: { 'calendar.timezone': 'America/Los_Angeles' } }))
  })

  it('이미 저장된 시간대가 있으면 제안하지 않는다', async () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({ timeZone: 'America/Los_Angeles' } as Intl.ResolvedDateTimeFormatOptions)
    await render({ status: 'set', value: 'Europe/Berlin' })
    expect(suggestButton()).toBeUndefined()
  })
})
