// @vitest-environment jsdom
// 관리자 알림 정책 편집기(notify.policy — 개정 §4.10·§2.8.1). 저장 규약은 PortalWidgetsEditor·LocalDraftsEditor 와 같은 useSettingItemCommand
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '../shell/_dom'
const h = vi.hoisted(() => ({ update: vi.fn(), outcome: vi.fn(), refresh: vi.fn() }))
vi.mock('@/app/actions/settings', () => ({ updateWorkspaceSettings: h.update, updateProjectSettings: vi.fn(), getSettingsCommandOutcome: h.outcome }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh }) }))
vi.mock('@/components/providers/LocaleProvider', async () => {
  const { KO } = await import('@/lib/i18n/dict/ko')
  return { useLocale: () => ({ t: (k: string) => (KO as Record<string, string>)[k] ?? k, locale: 'ko' }) }
})
import { NotifyPolicyEditor } from '@/components/settings/NotifyPolicyEditor'
import { NOTIFICATION_CATALOG, type NotificationType } from '@/lib/domain/inbox'
import { KO } from '@/lib/i18n/dict/ko'

const WS = '00000000-0000-0000-7e57-000000001920'
const TYPES = Object.keys(NOTIFICATION_CATALOG) as NotificationType[]
const REQUIRED = TYPES.filter((t) => NOTIFICATION_CATALOG[t].required)
const sw = (type: string) => document.querySelector<HTMLButtonElement>(`[role="switch"][data-notify-type="${type}"]`)!
const saveBtn = () => document.querySelector<HTMLButtonElement>('[data-notify-save]')!
beforeEach(() => { h.update.mockReset(); h.outcome.mockReset(); h.refresh.mockReset() })

describe('NotifyPolicyEditor', () => {
  it('카탈로그의 모든 유형이 한 번씩 나오고(정책용 이름), 기본값 {} 은 전부 켜짐 — 바뀐 것이 없으면 저장하지 않는다', () => {
    render(<NotifyPolicyEditor workspaceId={WS} revision={3} initial={{}} />)
    expect([...document.querySelectorAll('[role="switch"]')].map((el) => el.getAttribute('data-notify-type')).sort()).toEqual([...TYPES].sort())
    for (const type of TYPES) {
      expect(sw(type).getAttribute('aria-checked'), type).toBe('true')
      expect(sw(type).getAttribute('aria-label')).toBe((KO as Record<string, string>)[`settings.notify.policy.type.${type}`])
    }
    expect(saveBtn().disabled).toBe(true)
    expect(saveBtn().textContent).toBe('알림 정책 저장')
  })
  it('필수 유형은 켜진 채 비활성이고 이유를 보인다 — 눌러도 바뀌지 않는다', () => {
    render(<NotifyPolicyEditor workspaceId={WS} revision={3} initial={{}} />)
    expect(REQUIRED.length).toBeGreaterThan(0)
    for (const type of REQUIRED) {
      expect(sw(type).disabled, type).toBe(true)
      expect(sw(type).getAttribute('aria-checked')).toBe('true')
      fireEvent.click(sw(type))
      expect(sw(type).getAttribute('aria-checked')).toBe('true')
    }
    for (const type of REQUIRED) expect(sw(type).closest('li')?.textContent, type).toContain('필수')
    expect(sw('issue.update').closest('li')?.textContent).not.toContain('필수')
    expect(document.querySelector('[data-notify-required-reason]')?.textContent).toBe(KO['settings.notify.policy.requiredReason'])
    expect(sw('issue.update').disabled).toBe(false)
    expect(saveBtn().disabled).toBe(true)
  })
  it('저장값을 그린다 — 끈 유형만 꺼짐. { enabled: true } 가 섞인 저장값은 바뀐 것으로 치지 않는다', () => {
    render(<NotifyPolicyEditor workspaceId={WS} revision={3} initial={{ 'work.assigned': { enabled: true }, 'issue.update': { enabled: false } }} />)
    expect(sw('issue.update').getAttribute('aria-checked')).toBe('false')
    expect(sw('work.assigned').getAttribute('aria-checked')).toBe('true')
    expect(saveBtn().disabled).toBe(true)
  })
  it('두 유형을 끄고 저장 — 패치는 notify.policy 하나(끈 유형만, 카탈로그 순서), expectedRevision, 저장 뒤 새로고침', async () => {
    h.update.mockResolvedValue({ ok: true, revision: 4 })
    render(<NotifyPolicyEditor workspaceId={WS} revision={3} initial={{}} />)
    fireEvent.click(sw('issue.update'))
    fireEvent.click(sw('work.claimed'))
    expect(sw('issue.update').getAttribute('aria-checked')).toBe('false')
    fireEvent.click(saveBtn())
    await waitFor(() => expect(h.update).toHaveBeenCalledTimes(1))
    const [wid, patch] = h.update.mock.calls[0]
    expect(wid).toBe(WS)
    expect(patch.expectedRevision).toBe(3)
    expect(patch.unset).toEqual([])
    expect(patch.set).toEqual({ 'notify.policy': { 'work.claimed': { enabled: false }, 'issue.update': { enabled: false } } })
    expect(Object.keys(patch.set['notify.policy'])).toEqual(['work.claimed', 'issue.update'])
    await waitFor(() => expect(h.refresh).toHaveBeenCalled())
    expect(saveBtn().disabled).toBe(true)
  })
  it('끈 유형을 다시 켜 저장하면 그 유형이 값에서 빠진다({} = 전부 켬)', async () => {
    h.update.mockResolvedValue({ ok: true, revision: 4 })
    render(<NotifyPolicyEditor workspaceId={WS} revision={3} initial={{ 'issue.update': { enabled: false } }} />)
    fireEvent.click(sw('issue.update'))
    fireEvent.click(saveBtn())
    await waitFor(() => expect(h.update).toHaveBeenCalledTimes(1))
    expect(h.update.mock.calls[0][1].set).toEqual({ 'notify.policy': {} })
  })
  it('껐다 다시 켜면 바뀐 것이 없다 — 저장 버튼이 다시 잠긴다', () => {
    render(<NotifyPolicyEditor workspaceId={WS} revision={3} initial={{}} />)
    fireEvent.click(sw('issue.update'))
    expect(saveBtn().disabled).toBe(false)
    fireEvent.click(sw('issue.update'))
    expect(saveBtn().disabled).toBe(true)
  })
  it('409 — 내 값·최신 값 비교를 보이고 저장을 막는다, 최신 값을 고르면 그 값으로', async () => {
    h.update.mockResolvedValue({ ok: false, kind: 'conflict', code: 'CONFIG_CONFLICT', commandId: 'c', error: 'x', retryable: false, changedKeys: ['notify.policy'],
      latest: { revision: 9, invalidKeys: [], values: { 'notify.policy': { 'work.claimed': { enabled: false } } } } })
    render(<NotifyPolicyEditor workspaceId={WS} revision={3} initial={{}} />)
    fireEvent.click(sw('issue.update'))
    fireEvent.click(saveBtn())
    await waitFor(() => expect(screen.getByText('최신 값 사용')).toBeTruthy())
    expect(screen.getByText(`끔: ${KO['settings.notify.policy.type.issue.update']}`)).toBeTruthy()
    expect(screen.getByText(`끔: ${KO['settings.notify.policy.type.work.claimed']}`)).toBeTruthy()
    expect(saveBtn().disabled).toBe(true)
    fireEvent.click(screen.getByText('최신 값 사용'))
    expect(sw('work.claimed').getAttribute('aria-checked')).toBe('false')
    expect(sw('issue.update').getAttribute('aria-checked')).toBe('true')
  })
  it('서버가 거부하면(필드 오류) 그 문구를 보이고 값은 남는다', async () => {
    h.update.mockResolvedValue({ ok: false, kind: 'invalid', code: 'CONFIG_INVALID', commandId: 'c', error: 'x', retryable: false,
      fieldErrors: [{ key: 'notify.policy', message: '필수 알림은 끌 수 없습니다: work.reported' }] })
    render(<NotifyPolicyEditor workspaceId={WS} revision={3} initial={{}} />)
    fireEvent.click(sw('issue.update'))
    fireEvent.click(saveBtn())
    await waitFor(() => expect(screen.getByText('필수 알림은 끌 수 없습니다: work.reported')).toBeTruthy())
    expect(sw('issue.update').getAttribute('aria-checked')).toBe('false')
    expect(h.refresh).not.toHaveBeenCalled()
  })
  it('손상 값(initial null) — 사유를 보이고 기본값({})으로 복구 저장할 수 있다', async () => {
    h.update.mockResolvedValue({ ok: true, revision: 4 })
    render(<NotifyPolicyEditor workspaceId={WS} revision={3} initial={null} invalidReason="모르는 알림 유형입니다: issue.nope" />)
    expect(screen.getByText(/모르는 알림 유형입니다: issue.nope/)).toBeTruthy()
    expect(saveBtn().disabled).toBe(false)
    fireEvent.click(saveBtn())
    await waitFor(() => expect(h.update).toHaveBeenCalledTimes(1))
    expect(h.update.mock.calls[0][1].set).toEqual({ 'notify.policy': {} })
  })
  it('카탈로그의 모든 유형에 정책용 이름이 있고, 받는 사람 시점 문구("나에게")가 아니다', () => {
    for (const type of TYPES) {
      const key = `settings.notify.policy.type.${type}`
      const ko = (KO as Record<string, string>)[key]
      expect(ko, key).toBeTruthy()
      expect(ko, key).not.toMatch(/나에게|나를|내가/)
    }
    // 카탈로그에서 빠진 유형의 문구가 사전에 남지 않는다
    const prefix = 'settings.notify.policy.type.'
    expect(Object.keys(KO).filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length)).sort()).toEqual([...TYPES].sort())
  })
  it('편집기 문구가 사전에 있다', () => {
    for (const k of ['label', 'desc', 'requiredReason', 'personalNote', 'allOn', 'offList', 'corrupted', 'save', 'saveRetry']) {
      const key = `settings.notify.policy.${k}`
      expect((KO as Record<string, string>)[key], key).toBeTruthy()
    }
  })
})
