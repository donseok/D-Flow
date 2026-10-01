// @vitest-environment jsdom
// 계정 관리 표의 계약(Task 14). 계정 = profiles + 워크스페이스 등급 + 플랫폼 관리자 — 팀은 계정 축이 아니다(0003).
// 프로젝트 권한은 명단 행의 권한이라 여기서는 표시만 하고 편집은 명단 화면으로 보낸다(Task 12).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { AccountRow } from '@/app/actions/accounts'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

type Res = { ok: boolean; error?: string }
const setWorkspaceRole = vi.fn<(...a: unknown[]) => Promise<Res>>(async () => ({ ok: true }))
const setPlatformAdmin = vi.fn<(...a: unknown[]) => Promise<Res>>(async () => ({ ok: true }))
const refresh = vi.fn()
const toast = vi.fn()

vi.mock('@/app/actions/accounts', () => ({
  createAccount: vi.fn(), bulkCreateAccounts: vi.fn(), resetPassword: vi.fn(),
  setWorkspaceRole: (...a: unknown[]) => setWorkspaceRole(...a),
  setPlatformAdmin: (...a: unknown[]) => setPlatformAdmin(...a),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }))
vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}))
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ toast }) }))

import { AccountsManager } from '@/components/admin/AccountsManager'

function account(over: Partial<AccountRow> = {}): AccountRow {
  return {
    id: 'u-alice', email: 'alice@example.com', name: 'alice', workspaceRole: 'member',
    isPlatformAdmin: false, accessRole: 'member', createdAt: '2026-09-01T00:00:00Z', ...over,
  }
}
const BOB = account({ id: 'u-bob', email: 'bob@example.com', name: 'bob', workspaceRole: 'admin', isPlatformAdmin: true, accessRole: null })
const DAVE = account({ id: 'u-dave', email: 'dave@example.com', name: 'dave', isPlatformAdmin: true })
const CAROL = account({ id: 'u-carol', email: 'carol@example.com', name: 'carol', workspaceRole: null, accessRole: 'admin' })

describe('AccountsManager', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    setWorkspaceRole.mockClear(); setWorkspaceRole.mockResolvedValue({ ok: true })
    setPlatformAdmin.mockClear(); setPlatformAdmin.mockResolvedValue({ ok: true })
    refresh.mockClear(); toast.mockClear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function render(rows: AccountRow[] = [account(), BOB, CAROL, DAVE], canManageAdmins = true) {
    act(() => {
      root.render(<AccountsManager accounts={rows} projectId="p-1" workspaceId="ws-1"
        projects={[{ id: 'p-1', name: 'Acme' }]} canManageAdmins={canManageAdmins} canPlatformOps={canManageAdmins} currentUserId="u-bob" />)
    })
  }
  const headers = () => Array.from(container.querySelectorAll('th')).map(th => th.textContent?.trim() ?? '')
  const row = (id: string) => container.querySelector<HTMLTableRowElement>(`tr[data-account-row="${id}"]`)!
  async function click(el: Element) {
    await act(async () => { (el as HTMLElement).click() })
  }

  it('열은 이메일·이름·워크스페이스 역할·이 프로젝트 권한·플랫폼 관리자 — 팀 열이 없다', () => {
    render()
    const hs = headers()
    for (const h of ['이메일', '이름', '워크스페이스 역할', '이 프로젝트 권한', '플랫폼 관리자']) expect(hs).toContain(h)
    expect(hs.some(h => h.includes('팀'))).toBe(false)
  })

  it('플랫폼 조작(플랫폼 관리자 열·비번 리셋)은 플랫폼 관리자에게만 그린다 — 워크스페이스 관리자에게는 거부될 버튼을 보이지 않는다(D22)', () => {
    render(undefined, false)
    expect(headers()).not.toContain('플랫폼 관리자')
    expect(headers()).not.toContain('작업')
    expect(container.querySelector('[data-platform-admin-toggle]')).toBeNull()
    expect(container.textContent).not.toContain('비번 리셋')
    act(() => root.unmount()); root = createRoot(container)
    render()
    expect(headers()).toContain('작업')
    expect(row('u-alice').textContent).toContain('비번 리셋')
  })

  it('워크스페이스 역할 토글은 반대 등급으로 setWorkspaceRole(workspaceId, userId, role) 을 부른다', async () => {
    render()
    await click(row('u-alice').querySelector('[data-ws-role-toggle]')!)
    expect(setWorkspaceRole).toHaveBeenCalledWith('ws-1', 'u-alice', 'admin')
    await click(row('u-bob').querySelector('[data-ws-role-toggle]')!)
    expect(setWorkspaceRole).toHaveBeenLastCalledWith('ws-1', 'u-bob', 'member')
    expect(refresh).toHaveBeenCalled()
  })

  it('워크스페이스 소속이 아닌 계정에는 토글이 없다', () => {
    render()
    expect(row('u-carol').querySelector('[data-ws-role-toggle]')).toBeNull()
  })

  it('마지막 관리자 보호 같은 액션 오류는 문구 그대로 보여 준다', async () => {
    const msg = '워크스페이스의 마지막 관리자는 강등할 수 없습니다. 다른 관리자를 먼저 지정하세요.'
    setWorkspaceRole.mockResolvedValue({ ok: false, error: msg })
    render()
    await click(row('u-bob').querySelector('[data-ws-role-toggle]')!)
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ description: msg, variant: 'error' }))
    expect(refresh).not.toHaveBeenCalled()
  })

  it('플랫폼 관리자 토글은 setPlatformAdmin(userId, 반대값) 을 부르고 오류를 그대로 보여 준다', async () => {
    const msg = '마지막 슈퍼유저(플랫폼 관리자)는 해제할 수 없습니다. 다른 슈퍼유저를 먼저 지정하세요.'
    render()
    await click(row('u-alice').querySelector('[data-platform-admin-toggle]')!)
    expect(setPlatformAdmin).toHaveBeenCalledWith('u-alice', true)
    setPlatformAdmin.mockResolvedValue({ ok: false, error: msg })
    await click(row('u-dave').querySelector('[data-platform-admin-toggle]')!)
    expect(setPlatformAdmin).toHaveBeenLastCalledWith('u-dave', false)
    expect(toast).toHaveBeenLastCalledWith(expect.objectContaining({ description: msg, variant: 'error' }))
  })

  // 해제가 거부됐다는 것은 이 표가 낡았다는 뜻이다(다른 슈퍼유저가 먼저 해제했거나 마지막 한 명이 됐다) —
  // 다시 읽지 않으면 칩은 계속 '플랫폼 관리자'이고 누를 때마다 같은 거부가 돌아온다.
  it.each([
    '슈퍼유저가 아닌 계정입니다.',
    '마지막 슈퍼유저(플랫폼 관리자)는 해제할 수 없습니다. 다른 슈퍼유저를 먼저 지정하세요.',
    '슈퍼유저를 해제하지 못했습니다.',
  ])('플랫폼 관리자 변경이 거부되면(%s) 문구를 보이고 표를 다시 읽는다', async (msg) => {
    setPlatformAdmin.mockResolvedValue({ ok: false, error: msg })
    render()
    await click(row('u-dave').querySelector('[data-platform-admin-toggle]')!)
    expect(toast).toHaveBeenLastCalledWith(expect.objectContaining({ description: msg, variant: 'error' }))
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('본인 행의 플랫폼 관리자 토글은 비활성 — 스스로 해제할 수 없다는 안내', async () => {
    render()
    const self = row('u-bob').querySelector<HTMLButtonElement>('[data-platform-admin-toggle]')!
    expect(self.disabled).toBe(true)
    expect(self.title).toBe('본인의 플랫폼 관리자 권한은 스스로 해제할 수 없습니다. 다른 슈퍼유저에게 요청하세요.')
    await click(self)
    expect(setPlatformAdmin).not.toHaveBeenCalled()
    expect(row('u-alice').querySelector<HTMLButtonElement>('[data-platform-admin-toggle]')!.disabled).toBe(false)
  })

  it('이 프로젝트 권한은 읽기 전용 — 편집은 명단 화면 링크로 보낸다', () => {
    render()
    const cell = row('u-carol').querySelector('[data-access-role]')!
    expect(cell.textContent).toContain('관리자')
    expect(cell.closest('a')?.getAttribute('href')).toBe('/p/p-1/members')
    expect(row('u-bob').querySelector('[data-access-role]')!.textContent).toContain('조회')
    expect(row('u-carol').querySelector('select')).toBeNull()
  })

  it('일괄 등록 안내는 이메일, 권한, 초기비번[, 이름] 형식이다', async () => {
    render()
    const btn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('일괄 추가'))!
    await click(btn)
    expect(document.body.textContent).toContain('이메일, 권한, 초기비번[, 이름]')
  })
})
