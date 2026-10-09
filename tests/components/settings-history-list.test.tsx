// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// 화면 문구는 사전(settingsUi·adminUi)에 있다 — 사전의 한국어 글자를 돌려주는 대역(공급자 없는 기본 t 는 키를 돌려준다)
vi.mock('@/components/providers/LocaleProvider', async () => (await import('../helpers/locale-mock')).koLocale())
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const list = vi.fn()
vi.mock('@/app/actions/settings', () => ({ listSettingsHistory: (...a: unknown[]) => list(...a) }))
import { SettingsHistoryList } from '@/components/settings/SettingsHistoryList'

const row = (id: number, key: string) => ({ id, revision: id, key, oldValue: null, newValue: { on: true }, source: 'edit' as const,
  commandId: 'c', changedBy: 'u', changedByName: '관리자', changedAt: '2026-09-30T03:00:00Z', copiedFrom: null })

describe('SettingsHistoryList', () => {
  let host: HTMLDivElement, root: Root
  beforeEach(() => { list.mockReset(); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
  afterEach(() => { act(() => root.unmount()); host.remove() })
  it('작성자·전후 값과 커서 페이지를 표시한다', async () => {
    list.mockResolvedValue({ ok: true, rows: [row(1, 'branding.logo')], nextBefore: null })
    act(() => root.render(<SettingsHistoryList scope={{ workspaceId: 'ws-1' }} initial={{ ok: true, rows: [row(2, 'branding.accent')], nextBefore: 2 }} timeZone="Asia/Seoul" />))
    expect(host.textContent).toContain('관리자')
    expect(host.textContent).toContain('branding.accent')
    const more = [...host.querySelectorAll('button')].find(x => x.textContent?.includes('이전 기록'))!
    await act(async () => more.click())
    expect(list).toHaveBeenCalledWith({ workspaceId: 'ws-1' }, { before: 2 })
    expect(host.textContent).toContain('branding.logo')
    expect(host.querySelectorAll('details')).toHaveLength(2)
  })
})
