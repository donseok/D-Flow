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

const createAccount = vi.fn<(...a: unknown[]) => Promise<Res>>(async () => ({ ok: true }))

vi.mock('@/app/actions/accounts', () => ({
  createAccount: (...a: unknown[]) => createAccount(...a), bulkCreateAccounts: vi.fn(),
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
  const api = { t: (k: Parameters<typeof t>[0]) => t(k) }
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
    createAccount.mockClear(); createAccount.mockResolvedValue({ ok: true })
    refresh.mockClear(); toast.mockClear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function render(rows: AccountRow[] = [account(), BOB, CAROL, DAVE], platformOps = true, projectId: string | null = 'p-1') {
    act(() => {
      root.render(<AccountsManager accounts={rows} projectId={projectId} workspaceId="ws-1"
        projects={projectId ? [{ id: 'p-1', name: 'Acme' }] : []} canPlatformOps={platformOps} currentUserId="u-bob" />)
    })
  }
  const headers = () => Array.from(container.querySelectorAll('th')).map(th => th.textContent?.trim() ?? '')
  const row = (id: string) => container.querySelector<HTMLTableRowElement>(`tr[data-account-row="${id}"]`)!
  /** 플랫폼 관리자 토글 — 칩을 누르면 확인 모달이 뜨고(2026-10-12 UAT ACC-05), 그 확인을 눌러야 액션이 나간다 */
  async function togglePlatformAdmin(id: string) {
    await click(row(id).querySelector('[data-platform-admin-toggle]')!)
    await click(document.body.querySelector('[data-platform-admin-confirm]')!)
  }
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
    await togglePlatformAdmin('u-alice')
    expect(setPlatformAdmin).toHaveBeenCalledWith('u-alice', true)
    setPlatformAdmin.mockResolvedValue({ ok: false, error: msg })
    await togglePlatformAdmin('u-dave')
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
    await togglePlatformAdmin('u-dave')
    expect(toast).toHaveBeenLastCalledWith(expect.objectContaining({ description: msg, variant: 'error' }))
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('플랫폼 관리자 토글은 확인을 받기 전에는 액션을 부르지 않는다 — 대상 계정을 적어 묻는다', async () => {
    render()
    await click(row('u-alice').querySelector('[data-platform-admin-toggle]')!)
    expect(setPlatformAdmin).not.toHaveBeenCalled()
    expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain('플랫폼 관리자로 지정합니다')
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

  it('프로젝트가 없으면 — 프로젝트 권한 열이 없고 안내 한 줄, 계정 추가 모달에 권한 선택이 없다', async () => {
    render(undefined, true, null)
    expect(headers()).not.toContain('이 프로젝트 권한')
    expect(container.querySelector('[data-access-role]')).toBeNull()
    expect(container.textContent).toContain('아직 프로젝트가 없어 프로젝트 권한은 표시하지 않습니다.')
    const addBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('계정 추가'))!
    await click(addBtn)
    const labels = Array.from(document.body.querySelectorAll('label span')).map(s => s.textContent?.trim())
    expect(labels).not.toContain('이 프로젝트 권한')
    expect(labels).toContain('워크스페이스 역할')
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

  it('일괄 추가 안내 — 프로젝트가 있으면 선택한 프로젝트의 권한 안내와 member 예시를 그대로 보인다', async () => {
    render()
    const btn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('일괄 추가'))!
    await click(btn)
    const text = document.body.textContent ?? ''
    expect(text).toContain('선택한 프로젝트의 권한입니다')
    expect(text).toContain('admin · member · viewer')
    expect(text).toContain('hong@company.com, member, password1, 홍길동')
    expect(text).not.toContain('아직 프로젝트가 없어 권한 칸에는')
    expect(document.body.querySelector('textarea')!.getAttribute('placeholder')).toContain('user1@company.com, member, password1')
  })

  it('일괄 추가 안내 — 프로젝트가 없으면 viewer 만 쓸 수 있다고 알리고 예시·placeholder 도 viewer 로 쓴다', async () => {
    render(undefined, true, null)
    const btn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('일괄 추가'))!
    await click(btn)
    const text = document.body.textContent ?? ''
    expect(text).toContain('아직 프로젝트가 없어 권한 칸에는 viewer 만 쓸 수 있습니다. 프로젝트를 만든 뒤 명단에서 권한을 줍니다.')
    expect(text).not.toContain('선택한 프로젝트의 권한입니다')
    expect(text).not.toContain('admin · member · viewer')
    const example = Array.from(document.body.querySelectorAll('code')).find(c => c.textContent?.includes('hong@company.com'))!
    expect(example.textContent).toBe('hong@company.com, viewer, password1, 홍길동')
    const placeholder = document.body.querySelector('textarea')!.getAttribute('placeholder')!
    expect(placeholder).not.toMatch(/\bmember\b|\badmin\b/)
    expect(placeholder).toContain('viewer')
  })
  it('프로젝트가 있으면 "프로젝트가 없다" 안내(data-no-project-notice)가 없다', () => {
    render()
    expect(container.querySelector('[data-no-project-notice]')).toBeNull()
    act(() => root.unmount()); root = createRoot(container)
    render(undefined, true, null)
    expect(container.querySelector('[data-no-project-notice]')).not.toBeNull()   // 대조 — 프로젝트가 없을 때만 보인다
  })

  // 머리 칸과 본문 칸의 개수가 어긋나면 열이 밀려 보인다 — 프로젝트 권한 열·플랫폼 관리자 열은 조건부로 함께 사라지고 나타난다
  it.each([
    ['프로젝트 있음 · 플랫폼 관리자', 'p-1', true],
    ['프로젝트 있음 · 워크스페이스 관리자', 'p-1', false],
    ['프로젝트 없음 · 플랫폼 관리자', null, true],
    ['프로젝트 없음 · 워크스페이스 관리자', null, false],
  ] as const)('표의 머리 칸 수와 행의 칸 수가 같다 — %s', (_name, projectId, platformOps) => {
    render(undefined, platformOps, projectId)
    const ths = container.querySelectorAll('thead th').length
    const firstRow = container.querySelector<HTMLTableRowElement>('tbody tr')!
    expect(ths).toBeGreaterThan(0)
    expect(firstRow.querySelectorAll('td')).toHaveLength(ths)
  })

  describe('계정 추가 제출 — createAccount 에 넘기는 프로젝트·권한', () => {
    const setInput = (el: HTMLInputElement, value: string) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value)
      act(() => { el.dispatchEvent(new Event('input', { bubbles: true })) })
    }
    const field = (label: string) =>
      Array.from(document.body.querySelectorAll('label')).find(l => l.querySelector('span')?.textContent?.trim() === label)!
    async function openAndFill() {
      const addBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('계정 추가'))!
      await click(addBtn)
      setInput(field('이메일 (로그인 아이디)').querySelector('input')!, 'new@example.com')
      setInput(field('초기 비밀번호 (8자 이상)').querySelector('input')!, 'password1')
    }
    const submit = async () => {
      const btn = Array.from(document.body.querySelectorAll('button')).find(b => b.textContent?.trim() === '계정 만들기')!
      await click(btn)
      await act(async () => { await Promise.resolve(); await Promise.resolve() })
    }

    it('프로젝트가 없으면 projectId: null, accessRole: null 로 부른다', async () => {
      render(undefined, true, null)
      await openAndFill()
      await submit()
      expect(createAccount).toHaveBeenCalledTimes(1)
      expect(createAccount).toHaveBeenCalledWith({
        email: 'new@example.com', password: 'password1', name: null, workspaceRole: 'member',
        projectId: null, accessRole: null, workspaceId: 'ws-1',
      })
    })

    it('프로젝트가 있고 권한을 "관리자"로 고르면 projectId: p-1, accessRole: admin 으로 부른다', async () => {
      render()
      await openAndFill()
      const select = field('이 프로젝트 권한').querySelector('select')!
      act(() => { select.value = 'admin'; select.dispatchEvent(new Event('change', { bubbles: true })) })
      await submit()
      expect(createAccount).toHaveBeenCalledTimes(1)
      expect(createAccount).toHaveBeenCalledWith({
        email: 'new@example.com', password: 'password1', name: null, workspaceRole: 'member',
        projectId: 'p-1', accessRole: 'admin', workspaceId: 'ws-1',
      })
    })
  })
})
