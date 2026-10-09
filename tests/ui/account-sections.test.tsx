// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
const h = vi.hoisted(() => ({ ui: vi.fn(), ws: vi.fn() }))
vi.mock('@/lib/prefs/debouncedSave', () => ({ queueUiPref: h.ui, queueWorkspacePref: h.ws }))
vi.mock('@/components/account/ThemeRadioGroup', () => ({ ThemeRadioGroup: () => <div data-theme-radios /> }))
vi.mock('@/components/account/MyTokensSection', () => ({ MyTokensSection: () => null }))
vi.mock('@/app/actions/preferences', () => ({ saveNotifPrefs: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/components/account/ChangePasswordModal', () => ({ ChangePasswordModal: () => null }))
vi.mock('@/components/providers/LocaleProvider', async () => (await import('../helpers/locale-mock')).movedKoLocale())
import { AccountView } from '@/components/account/AccountView'

const WS = { id: '00000000-0000-0000-7e57-000000001880', name: 'Acme' }
const base = { email: 'alice@example.com', displayName: 'alice', projects: [], currentWorkspace: WS, currentWorkspaceError: false, startPage: null, projectsView: 'rows' as const }
let container: HTMLDivElement, root: Root
beforeEach(() => { h.ui.mockReset(); h.ws.mockReset(); container = document.createElement('div'); document.body.append(container); root = createRoot(container) })
afterEach(async () => { await act(async () => root.unmount()); container.remove() })
const mount = async (over = {}) => { await act(async () => root.render(<AccountView {...base} {...over} />)) }
const radio = (label: string) => [...container.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(el => el.textContent === label)!

describe('/account 구역과 선호 범위', () => {
  it('h1 하나와 프로필·화면·현재 워크스페이스·목록 보기', async () => {
    await mount()
    expect([...container.querySelectorAll('h1')].map(el => el.textContent)).toEqual(['내 계정'])
    for (const name of ['프로필 정보', 'chrome.display', '현재 워크스페이스', '목록 보기', 'account.notif.title']) expect([...container.querySelectorAll('h2')].map(el => el.textContent)).toContain(name)
  })
  it('시작 화면은 현재 워크스페이스 인자로 저장하고 기본은 홈', async () => {
    await mount()
    expect(container.textContent).toContain('Acme')
    expect(radio('홈').getAttribute('aria-checked')).toBe('true')
    await act(async () => radio('프로젝트 목록').click())
    expect(h.ws).toHaveBeenCalledWith(WS.id, { startPage: 'projects' }); expect(h.ui).not.toHaveBeenCalled()
  })
  it('목록 보기는 계정 키로 저장한다', async () => {
    await mount()
    await act(async () => radio('카드').click())
    expect(h.ui).toHaveBeenCalledWith({ projectsView: 'cards' }); expect(h.ws).not.toHaveBeenCalled()
  })
  it('방향키는 선택·포커스를 옮기고 끝에서 순환한다', async () => {
    await mount()
    radio('홈').focus()
    await act(async () => radio('홈').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })))
    expect(document.activeElement).toBe(radio('마지막 프로젝트'))
    expect(h.ws).toHaveBeenCalledWith(WS.id, { startPage: 'last_project' })
    expect(radio('마지막 프로젝트').tabIndex).toBe(0)
  })
  it('소속 없음과 조회 실패는 시작 화면 선택 없이 상태로 알린다', async () => {
    await mount({ currentWorkspace: null })
    expect(container.querySelector('[role="radiogroup"][aria-label="시작 화면"]')).toBeNull()
    expect(container.textContent).toContain('소속된 워크스페이스가 없습니다')
    await mount({ currentWorkspace: null, currentWorkspaceError: true })
    expect(container.querySelector('[data-status-kind="partial_error"]')).not.toBeNull()
    expect(container.querySelector('[role="radiogroup"][aria-label="시작 화면"]')).toBeNull()
  })
})
