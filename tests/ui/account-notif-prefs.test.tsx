// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
const h = vi.hoisted(() => ({ save: vi.fn() }))
vi.mock('@/app/actions/preferences', () => ({ saveNotifPrefs: h.save }))
vi.mock('@/components/providers/LocaleProvider', async () => {
  const { KO } = await import('@/lib/i18n/dict/ko')
  return { useLocale: () => ({ t: (k: string) => (KO as Record<string, string>)[k] ?? k }) }
})
import { NotifPrefsSection } from '@/components/account/NotifPrefsSection'
import { NOTIFICATION_CATALOG, type NotificationType } from '@/lib/domain/inbox'
import { KO } from '@/lib/i18n/dict/ko'
import type { WorkspaceNotifyOff } from '@/lib/notify/workspaceOff'

const TYPES = Object.keys(NOTIFICATION_CATALOG) as NotificationType[]
let container: HTMLDivElement, root: Root
beforeEach(() => { h.save.mockReset(); h.save.mockResolvedValue({ ok: true }); container = document.createElement('div'); document.body.append(container); root = createRoot(container) })
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks() })
const mount = async (notif: Record<string, boolean> | null = {}, workspaceOff?: WorkspaceNotifyOff) => { await act(async () => root.render(<NotifPrefsSection notif={notif} workspaceOff={workspaceOff} />)) }
const sw = (type: string) => container.querySelector<HTMLButtonElement>(`[role="switch"][data-notif-type="${type}"]`)!

describe('/account 알림 유형 토글(SPU1, 개정 §4.10)', () => {
  it('카탈로그의 모든 유형이 한 번씩 나오고 라벨이 있다', async () => {
    await mount()
    expect([...container.querySelectorAll('[role="switch"]')].map((el) => el.getAttribute('data-notif-type')).sort()).toEqual([...TYPES].sort())
    for (const type of TYPES) {
      const key = `account.notif.type.${type}`
      expect((KO as Record<string, string>)[key], key).toBeTruthy()
      expect(sw(type).getAttribute('aria-label')).toBe((KO as Record<string, string>)[key])
    }
  })
  it('기본값은 카탈로그의 defaultOn, 저장된 값이 그 위에 온다', async () => {
    await mount({ 'work.assigned': false, 'work.progress': true })
    expect(sw('work.assigned').getAttribute('aria-checked')).toBe('false')
    expect(sw('work.progress').getAttribute('aria-checked')).toBe('true')
    expect(sw('issue.assigned').getAttribute('aria-checked')).toBe('true')       // defaultOn
    expect(sw('system.runner_stale').getAttribute('aria-checked')).toBe('false') // defaultOn false
  })
  it('required 유형은 켜진 채 비활성이고 이유를 한 줄로 보인다 — 저장된 false 도 무시한다', async () => {
    await mount({ 'work.reported': false })
    const required = TYPES.filter((type) => NOTIFICATION_CATALOG[type].required)
    expect(required.length).toBeGreaterThan(0)
    for (const type of required) {
      expect(sw(type).disabled, type).toBe(true)
      expect(sw(type).getAttribute('aria-checked'), type).toBe('true')
      await act(async () => sw(type).click())
    }
    for (const type of TYPES.filter((x) => !NOTIFICATION_CATALOG[x].required)) expect(sw(type).disabled, type).toBe(false)
    expect(h.save).not.toHaveBeenCalled()
    expect(container.querySelector('[data-notif-required-reason]')?.textContent).toBe('승인 요청·반려 알림은 놓치면 업무가 멈추므로 끌 수 없습니다.')
  })
  it('누르면 그 유형만 담아 저장하고 화면 값이 바뀐다', async () => {
    await mount()
    await act(async () => sw('work.assigned').click())
    expect(h.save.mock.calls).toEqual([[{ 'work.assigned': false }]])
    expect(sw('work.assigned').getAttribute('aria-checked')).toBe('false')
    await act(async () => sw('work.assigned').click())
    expect(h.save.mock.calls[1]).toEqual([{ 'work.assigned': true }])
    expect(sw('work.assigned').getAttribute('aria-checked')).toBe('true')
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })
  it.each([['ok:false', () => h.save.mockResolvedValue({ ok: false })], ['던짐', () => h.save.mockRejectedValue(new Error('network'))]])('저장 실패(%s)는 값을 되돌리고 알린다', async (_n, arrange) => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    arrange()
    await mount()
    await act(async () => sw('issue.status').click())
    expect(sw('issue.status').getAttribute('aria-checked')).toBe('true')
    const alert = container.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain('알림 설정을 저장하지 못했습니다')
    // 다음 저장이 성공하면 실패 표시가 걷힌다
    h.save.mockReset(); h.save.mockResolvedValue({ ok: true })
    await act(async () => sw('issue.status').click())
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(sw('issue.status').getAttribute('aria-checked')).toBe('false')
  })
  it('저장 중에는 그 스위치를 다시 누를 수 없다', async () => {
    let done!: (v: { ok: boolean }) => void
    h.save.mockReturnValue(new Promise((r) => { done = r }))
    await mount()
    await act(async () => sw('issue.status').click())
    expect(sw('issue.status').disabled).toBe(true)
    expect(sw('issue.assigned').disabled).toBe(false)
    await act(async () => { done({ ok: true }) })
    expect(sw('issue.status').disabled).toBe(false)
  })
  it('워크스페이스가 끈 유형을 토글 옆에 알린다 — 전부 끔은 한 줄, 일부 끔은 이름까지. 토글은 그대로 조작된다', async () => {
    await mount({}, { 'issue.update': { all: true, names: ['Alpha', 'Beta'] }, 'work.claimed': { all: false, names: ['Beta'] } })
    const off = (type: string) => container.querySelector(`[data-notif-ws-off="${type}"]`)
    expect(off('issue.update')?.textContent).toBe('워크스페이스에서 꺼짐')
    expect(off('work.claimed')?.textContent).toBe('일부 워크스페이스에서 꺼짐: Beta')
    expect(container.querySelectorAll('[data-notif-ws-off]').length).toBe(2)
    expect(container.querySelector('[data-notif-ws-off-note]')?.textContent).toBe(KO['account.notif.wsOff.note'])
    expect(sw('issue.update').disabled).toBe(false)
    expect(sw('issue.update').getAttribute('aria-checked')).toBe('true')
    await act(async () => sw('issue.update').click())
    expect(h.save.mock.calls).toEqual([[{ 'issue.update': false }]])
  })
  it('끈 워크스페이스가 없으면 안내를 그리지 않는다', async () => {
    await mount()
    expect(container.querySelector('[data-notif-ws-off]')).toBeNull()
    expect(container.querySelector('[data-notif-ws-off-note]')).toBeNull()
  })
  it('조회 실패(null)면 토글을 열지 않고 상태로 알린다 — 기본값으로 그리지 않는다', async () => {
    await mount(null)
    expect(container.querySelectorAll('[role="switch"]').length).toBe(0)
    expect(container.querySelector('[data-status-kind="partial_error"]')?.textContent).toContain('알림 설정을 불러오지 못했습니다')
  })
})
