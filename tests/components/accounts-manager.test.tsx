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

const resetPassword = vi.fn<(...a: unknown[]) => Promise<Res>>(async () => ({ ok: true }))
type Preview = { ok: true; preview: { projects: number; invites: number; tokens: number } } | { ok: false; error: string }
const previewWorkspaceMemberRemoval = vi.fn<(...a: unknown[]) => Promise<Preview>>(async () => ({ ok: true, preview: { projects: 2, invites: 1, tokens: 0 } }))
const removeWorkspaceMember = vi.fn<(...a: unknown[]) => Promise<Res>>(async () => ({ ok: true }))

vi.mock('@/app/actions/accounts', () => ({
  createAccount: vi.fn(), bulkCreateAccounts: vi.fn(),
  resetPassword: (...a: unknown[]) => resetPassword(...a),
  previewWorkspaceMemberRemoval: (...a: unknown[]) => previewWorkspaceMemberRemoval(...a),
  removeWorkspaceMember: (...a: unknown[]) => removeWorkspaceMember(...a),
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
// 사전 문구로 확인한다 — 공급자 없는 기본 t 는 키를 그대로 돌려준다
vi.mock('@/components/providers/LocaleProvider', async () => {
  const { t } = await vi.importActual<typeof import('@/lib/i18n/dict')>('@/lib/i18n/dict')
  const api = { locale: 'ko' as const, setLocale: () => {}, t: (k: Parameters<typeof t>[1]) => t('ko', k) }
  return { useLocale: () => api }
})

import { AccountsManager } from '@/components/admin/AccountsManager'

function account(over: Partial<AccountRow> = {}): AccountRow {
  return {
    id: 'u-alice', email: 'alice@example.com', name: 'alice', workspaceRole: 'member',
    isPlatformAdmin: false, accessRole: 'member', createdAt: '2026-09-01T00:00:00Z', passwordReset: 'ok', removal: 'ok', ...over,
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

  function render(rows: AccountRow[] = [account(), BOB, CAROL, DAVE], platformOps = true) {
    act(() => {
      root.render(<AccountsManager accounts={rows} projectId="p-1" workspaceId="ws-1"
        projects={[{ id: 'p-1', name: 'Acme' }]} canPlatformOps={platformOps} currentUserId="u-bob" />)
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

  it('플랫폼 조작(플랫폼 관리자 열)은 플랫폼 관리자에게만 그린다 — 행 작업(비밀번호 재설정·제거)은 워크스페이스 관리자에게도 그린다(D22)', () => {
    render(undefined, false)
    expect(headers()).not.toContain('플랫폼 관리자')
    expect(headers()).toContain('작업')
    expect(container.querySelector('[data-platform-admin-toggle]')).toBeNull()
    expect(row('u-alice').textContent).toContain('비밀번호 재설정')
    expect(row('u-alice').textContent).toContain('워크스페이스에서 제거')
    act(() => root.unmount()); root = createRoot(container)
    render()
    expect(headers()).toContain('플랫폼 관리자')
    expect(row('u-alice').textContent).toContain('비밀번호 재설정')
  })

  describe('행 작업 — 서버가 내린 판정(passwordReset·removal)대로 열고 잠근다', () => {
    const reset = (id: string) => row(id).querySelector<HTMLButtonElement>('[data-reset-password]')!
    const remove = (id: string) => row(id).querySelector<HTMLButtonElement>('[data-remove-member]')!
    const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve() }) }
    const modalButton = (text: string) => Array.from(document.body.querySelectorAll('button')).find(b => b.textContent?.trim() === text)!

    beforeEach(() => {
      resetPassword.mockClear(); resetPassword.mockResolvedValue({ ok: true })
      previewWorkspaceMemberRemoval.mockClear()
      previewWorkspaceMemberRemoval.mockResolvedValue({ ok: true, preview: { projects: 2, invites: 1, tokens: 0 } })
      removeWorkspaceMember.mockClear(); removeWorkspaceMember.mockResolvedValue({ ok: true })
    })

    it.each([
      ['self', '본인의 비밀번호는 계정 화면의 "비밀번호 변경"에서 바꿉니다.'],
      ['target_admin', '관리자 계정의 비밀번호는 플랫폼 관리자만 재설정할 수 있습니다.'],
      ['platform_only', '이 계정의 비밀번호는 플랫폼 관리자만 재설정할 수 있습니다.'],
      ['not_member', '이 워크스페이스 소속이 아닌 계정입니다.'],
    ] as const)('비밀번호 재설정: %s 인 행은 잠기고 사유가 툴팁이다', async (verdict, reason) => {
      render([account({ passwordReset: verdict })], false)
      expect(reset('u-alice').disabled).toBe(true)
      expect(reset('u-alice').title).toBe(reason)
      await click(reset('u-alice'))
      expect(document.body.textContent).not.toContain('임시 비밀번호')
    })

    it('비밀번호 재설정: 열린 행은 resetPassword(workspaceId, userId, 임시값) 을 부르고 값을 한 번 보여 준다', async () => {
      render([account()], false)
      expect(reset('u-alice').disabled).toBe(false)
      await click(reset('u-alice'))
      await click(modalButton('리셋'))
      await flush()
      expect(resetPassword).toHaveBeenCalledTimes(1)
      const [ws, uid, pw] = resetPassword.mock.calls[0] as [string, string, string]
      expect([ws, uid]).toEqual(['ws-1', 'u-alice'])
      expect(pw.length).toBeGreaterThanOrEqual(8)
      expect(document.body.textContent).toContain('이 창을 닫으면 다시 볼 수 없습니다.')
      expect(document.body.textContent).toContain(pw)
    })

    it.each([
      ['self', '본인은 제거할 수 없습니다.'],
      ['target_admin', '관리자는 플랫폼 관리자만 제거할 수 있습니다. 먼저 멤버로 바꾼 뒤 제거하세요.'],
      ['not_member', '이 워크스페이스 소속이 아닌 계정입니다.'],
    ] as const)('제거: %s 인 행은 잠기고 사유가 툴팁이다', async (verdict, reason) => {
      render([account({ removal: verdict })], false)
      expect(remove('u-alice').disabled).toBe(true)
      expect(remove('u-alice').title).toBe(reason)
      await click(remove('u-alice'))
      expect(previewWorkspaceMemberRemoval).not.toHaveBeenCalled()
    })

    it('제거: 확인 창이 영향(프로젝트 수·초대)을 먼저 보이고, 확인하면 removeWorkspaceMember 를 부른 뒤 표를 다시 읽는다', async () => {
      render([account()], false)
      await click(remove('u-alice'))
      await flush()
      expect(previewWorkspaceMemberRemoval).toHaveBeenCalledWith('ws-1', 'u-alice')
      const preview = document.body.querySelector('[data-remove-preview]')!
      expect(preview.textContent).toContain('프로젝트 2개의 권한이 회수됩니다')
      expect(preview.textContent).toContain('수락 전 초대 1건이 회수됩니다.')
      expect(preview.textContent).not.toContain('에이전트 토큰')   // 0건은 줄을 내지 않는다
      expect(removeWorkspaceMember).not.toHaveBeenCalled()
      await click(document.body.querySelector('[data-remove-confirm]')!)
      await flush()
      expect(removeWorkspaceMember).toHaveBeenCalledWith('ws-1', 'u-alice')
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: '워크스페이스에서 제거했습니다.', variant: 'success' }))
      expect(refresh).toHaveBeenCalled()
    })

    it('제거: 회수할 것이 없으면 그렇게 말한다', async () => {
      previewWorkspaceMemberRemoval.mockResolvedValue({ ok: true, preview: { projects: 0, invites: 0, tokens: 0 } })
      render([account()], false)
      await click(remove('u-alice'))
      await flush()
      expect(document.body.querySelector('[data-remove-preview]')!.textContent).toContain('소속만 빠집니다.')
    })

    it('제거: 미리보기를 못 읽으면 확인을 열지 않는다 — "영향 없음"으로 그리지 않는다', async () => {
      previewWorkspaceMemberRemoval.mockResolvedValue({ ok: false, error: '권한을 확인할 수 없어 중단했습니다.' })
      render([account()], false)
      await click(remove('u-alice'))
      await flush()
      expect(document.body.querySelector('[data-remove-preview]')).toBeNull()
      expect(document.body.textContent).toContain('영향 범위를 확인하지 못했습니다')
      expect(document.body.textContent).toContain('권한을 확인할 수 없어 중단했습니다.')
      expect(document.body.querySelector<HTMLButtonElement>('[data-remove-confirm]')!.disabled).toBe(true)
    })

    it('제거: 서버가 거부하면(마지막 관리자 등) 문구를 창에 보이고 닫지 않는다', async () => {
      const msg = '워크스페이스의 마지막 관리자는 제거할 수 없습니다. 다른 관리자를 먼저 지정하세요.'
      removeWorkspaceMember.mockResolvedValue({ ok: false, error: msg })
      render([account()], false)
      await click(remove('u-alice'))
      await flush()
      await click(document.body.querySelector('[data-remove-confirm]')!)
      await flush()
      expect(document.body.textContent).toContain(msg)
      expect(document.body.querySelector('[data-remove-confirm]')).not.toBeNull()
    })
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

  it('계정 추가의 프로젝트 관리자 옵션은 워크스페이스 관리자도 고를 수 있다 — 서버 규칙(requireWorkspaceAdmin)과 같다(U2a-4 T3)', async () => {
    render(undefined, false)
    const btn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('계정 추가'))!
    await click(btn)
    const admin = Array.from(document.body.querySelectorAll('option')).find(o => o.value === 'admin' && o.textContent?.includes('관리자'))!
    expect(admin).toBeTruthy()
    expect(admin.disabled).toBe(false)
    expect(document.body.textContent).not.toContain('슈퍼유저 전용')
  })

  it('일괄 등록 안내는 이메일, 권한, 초기비번[, 이름] 형식이다', async () => {
    render()
    const btn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('일괄 추가'))!
    await click(btn)
    expect(document.body.textContent).toContain('이메일, 권한, 초기비번[, 이름]')
  })
})
