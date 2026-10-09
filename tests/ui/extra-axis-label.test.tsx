// @vitest-environment jsdom
// 추가 축 이름(core.extra_axis_label) — 편집기는 값을 한 명령으로 쓰고(비우면 키를 지운다), 화면은 설정 이름을 쓰되 없으면 기본 문구로 그린다.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
const h = vi.hoisted(() => ({ update: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ t: (k: string) => k, locale: 'ko' }) }))
vi.mock('@/app/actions/settings', () => ({ updateProjectSettings: (...a: unknown[]) => h.update(...a), getSettingsCommandOutcome: vi.fn() }))
import { ExtraAxisLabelEditor } from '@/components/settings/ExtraAxisLabelEditor'
import { ChangeHistoryList } from '@/components/wbs/ChangeHistoryList'
import type { ChangeLogEntry } from '@/app/actions/wbs'

const setValue = (el: HTMLInputElement, v: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}
const OK = { ok: true, kind: 'applied', commandId: 'c', revision: 9, rebased: false }

describe('추가 축 이름', () => {
  let root: Root, el: HTMLDivElement
  beforeEach(() => { vi.clearAllMocks(); el = document.createElement('div'); document.body.append(el); root = createRoot(el) })
  afterEach(() => { act(() => root.unmount()); el.remove() })
  const input = () => el.querySelector<HTMLInputElement>('[data-extra-axis-input]')!
  const save = () => el.querySelector<HTMLButtonElement>('[data-extra-axis-save]')!

  it('편집기 — 다듬은 값을 저장하고, 비우면 키를 지운다. 바뀐 게 없으면 저장할 수 없다', async () => {
    h.update.mockResolvedValue(OK)
    await act(async () => { root.render(<ExtraAxisLabelEditor projectId="p" value={null} revision={3} canEdit />) })
    expect(save().disabled).toBe(true)
    await act(async () => setValue(input(), ' 트랙 '))
    await act(async () => save().click())
    expect(h.update.mock.calls[0][1]).toMatchObject({ expectedRevision: 3, set: { 'core.extra_axis_label': '트랙' }, unset: [] })
    await act(async () => setValue(input(), ''))
    await act(async () => save().click())
    expect(h.update.mock.calls[1][1]).toMatchObject({ set: {}, unset: ['core.extra_axis_label'] })
  })

  it('편집기 — 손상 값은 사유를 보이고 빈 칸 그대로 다시 저장할 수 있다(복구). 권한이 없으면 저장 단추가 없다', async () => {
    await act(async () => { root.render(<ExtraAxisLabelEditor projectId="p" value={null} revision={3} canEdit invalid />) })
    expect(el.querySelector('[role="alert"]')?.textContent).toBe('settings.core.extra_axis_label.invalid')
    expect(save().disabled).toBe(false)
    await act(async () => { root.render(<ExtraAxisLabelEditor key="ro" projectId="p" value="트랙" revision={3} canEdit={false} />) })
    expect(el.querySelector('[data-extra-axis-save]')).toBeNull()
    expect(input().disabled).toBe(true)
  })

  it('변경 이력 — 그 칸의 이름은 설정 이름, 없으면 사전 기본 문구', async () => {
    const logs: ChangeLogEntry[] = [{ id: 1, field: 'biz', oldValue: '가', newValue: '나', at: '2031-03-04 09:00:00+00', actorTeam: null, actorRole: 'admin' }]
    await act(async () => { root.render(<ChangeHistoryList timeZone="UTC" logs={logs} extraAxisLabel="트랙" />) })
    expect(el.querySelector('[data-history-row]')?.textContent).toContain('트랙')
    expect(el.querySelector('[data-history-row]')?.textContent).not.toContain('wbs.fieldBiz')
    await act(async () => { root.render(<ChangeHistoryList timeZone="UTC" logs={logs} />) })
    expect(el.querySelector('[data-history-row]')?.textContent).toContain('wbs.fieldBiz')
  })
})
