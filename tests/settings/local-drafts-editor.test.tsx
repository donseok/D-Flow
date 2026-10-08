// @vitest-environment jsdom
// 로컬 초안 정책 편집기(security.local_drafts — 개정 §5.8.5·§2.8.1). 저장 규약은 PortalWidgetsEditor 와 같은 useSettingItemCommand
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '../shell/_dom'
const h = vi.hoisted(() => ({ update: vi.fn(), outcome: vi.fn(), refresh: vi.fn() }))
vi.mock('@/app/actions/settings', () => ({ updateWorkspaceSettings: h.update, updateProjectSettings: vi.fn(), getSettingsCommandOutcome: h.outcome }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh }) }))
import { LocalDraftsEditor } from '@/components/settings/LocalDraftsEditor'

const WS = '00000000-0000-0000-7e57-000000001910'
const ON = { allowed: true, retention_days: 7 }
const saveBtn = () => screen.getByRole('button', { name: '로컬 초안 정책 저장' }) as HTMLButtonElement
const sw = () => screen.getByRole('switch', { name: '로컬 초안 허용' }) as HTMLButtonElement
const days = () => document.querySelector('input[aria-label="초안 보존 기간(일)"]') as HTMLInputElement
beforeEach(() => { h.update.mockReset(); h.outcome.mockReset(); h.refresh.mockReset() })

describe('LocalDraftsEditor', () => {
  it('지금 값을 그리고, 바뀐 것이 없으면 저장하지 않는다', () => {
    render(<LocalDraftsEditor workspaceId={WS} revision={3} initial={{ allowed: true, retention_days: 14 }} />)
    expect(sw().getAttribute('aria-checked')).toBe('true')
    expect(days().value).toBe('14')
    expect(saveBtn().disabled).toBe(true)
  })
  it('끄고 저장 — 패치는 security.local_drafts 하나({ allowed, retention_days } 만), expectedRevision, 저장 뒤 새로고침', async () => {
    h.update.mockResolvedValue({ ok: true, revision: 4 })
    render(<LocalDraftsEditor workspaceId={WS} revision={3} initial={ON} />)
    fireEvent.click(sw())
    expect(sw().getAttribute('aria-checked')).toBe('false')
    expect(days().disabled).toBe(true)                                       // 꺼져 있으면 보존기간은 쓰이지 않는다
    fireEvent.click(saveBtn())
    await waitFor(() => expect(h.update).toHaveBeenCalledTimes(1))
    const [wid, patch] = h.update.mock.calls[0]
    expect(wid).toBe(WS)
    expect(patch.expectedRevision).toBe(3)
    expect(patch.unset).toEqual([])
    expect(patch.set).toEqual({ 'security.local_drafts': { allowed: false, retention_days: 7 } })
    await waitFor(() => expect(h.refresh).toHaveBeenCalled())
    expect(saveBtn().disabled).toBe(true)
  })
  it('보존기간을 바꿔 저장한다', async () => {
    h.update.mockResolvedValue({ ok: true, revision: 4 })
    render(<LocalDraftsEditor workspaceId={WS} revision={3} initial={ON} />)
    fireEvent.change(days(), { target: { value: '30' } })
    fireEvent.click(saveBtn())
    await waitFor(() => expect(h.update).toHaveBeenCalledTimes(1))
    expect(h.update.mock.calls[0][1].set).toEqual({ 'security.local_drafts': { allowed: true, retention_days: 30 } })
  })
  it.each(['0', '31', '3.5', ''])('보존기간 %j 는 저장을 막고 이유를 보인다(1~30 정수)', (value) => {
    render(<LocalDraftsEditor workspaceId={WS} revision={3} initial={ON} />)
    fireEvent.change(days(), { target: { value } })
    expect(days().getAttribute('aria-invalid')).toBe('true')
    expect(saveBtn().disabled).toBe(true)
    expect(screen.getByText('1~30 사이의 정수를 넣으세요.')).toBeTruthy()
    fireEvent.click(saveBtn())
    expect(h.update).not.toHaveBeenCalled()
  })
  it('409 — 내 값·최신 값 비교를 보이고 저장을 막는다, 최신 값을 고르면 그 값으로', async () => {
    h.update.mockResolvedValue({ ok: false, kind: 'conflict', code: 'CONFIG_CONFLICT', commandId: 'c', error: 'x', retryable: false, changedKeys: ['security.local_drafts'],
      latest: { revision: 9, invalidKeys: [], values: { 'security.local_drafts': { allowed: true, retention_days: 21 } } } })
    render(<LocalDraftsEditor workspaceId={WS} revision={3} initial={ON} />)
    fireEvent.click(sw())
    fireEvent.click(saveBtn())
    await waitFor(() => expect(screen.getByText('최신 값 사용')).toBeTruthy())
    expect(saveBtn().disabled).toBe(true)
    fireEvent.click(screen.getByText('최신 값 사용'))
    expect(sw().getAttribute('aria-checked')).toBe('true')
    expect(days().value).toBe('21')
  })
  it('서버가 거부하면(필드 오류) 그 문구를 보이고 값은 남는다', async () => {
    h.update.mockResolvedValue({ ok: false, kind: 'invalid', code: 'CONFIG_INVALID', commandId: 'c', error: 'x', retryable: false,
      fieldErrors: [{ key: 'security.local_drafts', message: 'retention_days 는 1~30일 사이여야 합니다.' }] })
    render(<LocalDraftsEditor workspaceId={WS} revision={3} initial={ON} />)
    fireEvent.change(days(), { target: { value: '9' } })
    fireEvent.click(saveBtn())
    await waitFor(() => expect(screen.getByText('retention_days 는 1~30일 사이여야 합니다.')).toBeTruthy())
    expect(days().value).toBe('9')
    expect(h.refresh).not.toHaveBeenCalled()
  })
  it('손상 값(initial null) — 사유를 보이고 기본값으로 복구 저장할 수 있다', async () => {
    h.update.mockResolvedValue({ ok: true, revision: 4 })
    render(<LocalDraftsEditor workspaceId={WS} revision={3} initial={null} invalidReason="allowed 는 불리언이어야 합니다." />)
    expect(screen.getByText(/allowed 는 불리언이어야 합니다/)).toBeTruthy()
    expect(saveBtn().disabled).toBe(false)
    fireEvent.click(saveBtn())
    await waitFor(() => expect(h.update).toHaveBeenCalledTimes(1))
    expect(h.update.mock.calls[0][1].set).toEqual({ 'security.local_drafts': { allowed: true, retention_days: 7 } })
  })
})
