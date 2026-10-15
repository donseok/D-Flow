// @vitest-environment jsdom
// /admin/platform-admins — 플랫폼 관리자만(나머지·열화 = 404). 목록·해제(본인 잠금)·이메일로 찾아 지정.
import { act, type ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { render } from '../shell/_dom'
import { makeActor, makeSuperuser } from '../fixtures/actor'
import { KO } from '@/lib/i18n/dict/ko'
import type { PlatformAdminRow } from '@/app/actions/platformAdmins'

const mocks = vi.hoisted(() => ({
  getActorForView: vi.fn(), listPlatformAdmins: vi.fn(), findAccountByEmail: vi.fn(), setPlatformAdmin: vi.fn(),
  readCurrentWorkspace: vi.fn(), toast: vi.fn(), refresh: vi.fn(),
  notFound: vi.fn(() => { throw new Error('NEXT_HTTP_ERROR_FALLBACK;404') }),
}))
vi.mock('@/lib/authz', () => ({ getActorForView: mocks.getActorForView }))
vi.mock('@/app/actions/platformAdmins', () => ({ listPlatformAdmins: mocks.listPlatformAdmins, findAccountByEmail: mocks.findAccountByEmail }))
vi.mock('@/app/actions/accounts', () => ({ setPlatformAdmin: mocks.setPlatformAdmin }))
vi.mock('@/lib/workspace/current', () => ({ readCurrentWorkspace: mocks.readCurrentWorkspace }))
vi.mock('next/navigation', () => ({ notFound: mocks.notFound, useRouter: () => ({ refresh: mocks.refresh }) }))
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }))
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ t: (k: keyof typeof KO) => KO[k] ?? k }) }))

import PlatformAdminsPage from '@/app/(app)/(global)/admin/platform-admins/page'
import { PlatformAdminsManager } from '@/components/admin/PlatformAdminsManager'

const ROWS: PlatformAdminRow[] = [
  { userId: 'u-su', email: 'su@example.com', name: '수퍼', grantedAt: '2026-10-14T00:00:00Z', grantedBy: null },
  { userId: 'u-b', email: 'b@example.com', name: '비', grantedAt: '2026-10-15T00:00:00Z', grantedBy: { userId: 'u-su', email: 'su@example.com', name: '수퍼' } },
  { userId: 'u-gone', email: null, name: null, grantedAt: '2026-10-15T01:00:00Z', grantedBy: null },
]
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })
const setValue = (el: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value)
  act(() => { el.dispatchEvent(new Event('input', { bubbles: true })) })
}
const button = (root: ParentNode, text: string) =>
  Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.trim() === text) as HTMLButtonElement

beforeEach(() => {
  vi.clearAllMocks()
  mocks.readCurrentWorkspace.mockResolvedValue({ ok: true, ws: { id: 'w1', slug: 'alpha', name: '알파' } })
  mocks.listPlatformAdmins.mockResolvedValue({ ok: true, rows: ROWS })
  mocks.setPlatformAdmin.mockResolvedValue({ ok: true })
})

describe('/admin/platform-admins 페이지', () => {
  const html = async () => renderToStaticMarkup((await PlatformAdminsPage()) as ReactElement)
  it('플랫폼 관리자가 아니면 404 — 목록 액션을 부르지 않는다', async () => {
    mocks.getActorForView.mockResolvedValue(makeActor())
    await expect(PlatformAdminsPage()).rejects.toThrow('404')
    expect(mocks.listPlatformAdmins).not.toHaveBeenCalled()
  })
  it('권한 조회 열화(actor null)도 404', async () => {
    mocks.getActorForView.mockResolvedValue(null)
    await expect(PlatformAdminsPage()).rejects.toThrow('404')
  })
  it('목록 조회 실패는 표 대신 blocking 오류 — "0명"으로 그리지 않는다', async () => {
    mocks.getActorForView.mockResolvedValue(makeSuperuser({ userId: 'u-su' }))
    mocks.listPlatformAdmins.mockResolvedValue({ ok: false, error: '플랫폼 관리자 목록을 불러오지 못했습니다.' })
    const out = await html()
    expect(out).toContain('data-status-kind="partial_error"')
    expect(out).not.toContain('data-platform-admin-row')
  })
  it('목록 — 행 셋, 프로필 없는 행은 (프로필 없음)', async () => {
    mocks.getActorForView.mockResolvedValue(makeSuperuser({ userId: 'u-su' }))
    const out = await html()
    expect(out.match(/data-platform-admin-row=/g)).toHaveLength(3)
    expect(out).toContain('b@example.com')
    expect(out).toContain(KO['platformAdmins.noProfile'])
  })
})

describe('PlatformAdminsManager', () => {
  function mount() {
    return render(<PlatformAdminsManager rows={ROWS} currentUserId="u-su" accountsHref="/w/alpha/admin/accounts" />)
  }
  it('본인 행의 해제는 잠기고, 다른 행은 확인 뒤 setPlatformAdmin(id, false) → refresh', async () => {
    const { container } = mount()
    const selfBtn = container.querySelector<HTMLButtonElement>('[data-platform-admin-row="u-su"] [data-platform-admin-unset]')!
    expect(selfBtn.disabled).toBe(true)
    act(() => { container.querySelector<HTMLButtonElement>('[data-platform-admin-row="u-b"] [data-platform-admin-unset]')!.click() })
    act(() => { document.body.querySelector<HTMLButtonElement>('[data-platform-admin-confirm]')!.click() })
    await flush()
    expect(mocks.setPlatformAdmin).toHaveBeenCalledWith('u-b', false)
    expect(mocks.refresh).toHaveBeenCalled()
  })
  it('해제 거부(마지막 한 명 등)는 문구를 토스트하고 그래도 refresh — 낡은 표를 남기지 않는다', async () => {
    mocks.setPlatformAdmin.mockResolvedValue({ ok: false, error: '마지막 슈퍼유저(플랫폼 관리자)는 해제할 수 없습니다. 다른 슈퍼유저를 먼저 지정하세요.' })
    const { container } = mount()
    act(() => { container.querySelector<HTMLButtonElement>('[data-platform-admin-row="u-b"] [data-platform-admin-unset]')!.click() })
    act(() => { document.body.querySelector<HTMLButtonElement>('[data-platform-admin-confirm]')!.click() })
    await flush()
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', description: expect.stringContaining('마지막 슈퍼유저') }))
    expect(mocks.refresh).toHaveBeenCalled()
  })
  it('추가 — 찾기: 지정 가능한 계정이면 소속을 보이고 지정 → setPlatformAdmin(id, true)', async () => {
    mocks.findAccountByEmail.mockResolvedValue({ ok: true, account: {
      userId: 'u-c', email: 'c@example.com', name: '씨', isPlatformAdmin: false,
      workspaces: [{ name: '알파', role: 'admin', archived: false }, { name: '베타', role: 'member', archived: true }],
    } })
    const { container } = mount()
    act(() => { button(container, KO['platformAdmins.add']).click() })
    setValue(document.body.querySelector<HTMLInputElement>('[data-platform-admin-email]')!, 'c@example.com')
    act(() => { button(document.body, KO['platformAdmins.find']).click() })
    await flush()
    expect(mocks.findAccountByEmail).toHaveBeenCalledWith('c@example.com')
    expect(document.body.textContent).toContain('알파')
    expect(document.body.textContent).toContain(KO['platformAdmins.archived'])
    act(() => { document.body.querySelector<HTMLButtonElement>('[data-platform-admin-grant]')!.click() })
    await flush()
    expect(mocks.setPlatformAdmin).toHaveBeenCalledWith('u-c', true)
    expect(mocks.refresh).toHaveBeenCalled()
  })
  it('추가 — 이미 관리자면 지정 버튼 없이 안내', async () => {
    mocks.findAccountByEmail.mockResolvedValue({ ok: true, account: { userId: 'u-b', email: 'b@example.com', name: '비', isPlatformAdmin: true, workspaces: [] } })
    const { container } = mount()
    act(() => { button(container, KO['platformAdmins.add']).click() })
    setValue(document.body.querySelector<HTMLInputElement>('[data-platform-admin-email]')!, 'b@example.com')
    act(() => { button(document.body, KO['platformAdmins.find']).click() })
    await flush()
    expect(document.body.textContent).toContain(KO['platformAdmins.already'])
    expect(document.body.querySelector('[data-platform-admin-grant]')).toBeNull()
  })
  it('추가 — 계정이 없으면 멤버·초대 화면 링크', async () => {
    mocks.findAccountByEmail.mockResolvedValue({ ok: true, account: null })
    const { container } = mount()
    act(() => { button(container, KO['platformAdmins.add']).click() })
    setValue(document.body.querySelector<HTMLInputElement>('[data-platform-admin-email]')!, 'none@example.com')
    act(() => { button(document.body, KO['platformAdmins.find']).click() })
    await flush()
    expect(document.body.textContent).toContain(KO['platformAdmins.notFound'])
    expect(document.body.querySelector('a[href="/w/alpha/admin/accounts"]')).not.toBeNull()
  })
  it('추가 — 조회 실패는 오류 문구, 입력은 유지', async () => {
    mocks.findAccountByEmail.mockResolvedValue({ ok: false, error: '계정을 조회하지 못했습니다. 잠시 뒤 다시 시도하세요.' })
    const { container } = mount()
    act(() => { button(container, KO['platformAdmins.add']).click() })
    const input = document.body.querySelector<HTMLInputElement>('[data-platform-admin-email]')!
    setValue(input, 'x@example.com')
    act(() => { button(document.body, KO['platformAdmins.find']).click() })
    await flush()
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain('계정을 조회하지 못했습니다')
    expect(input.value).toBe('x@example.com')
  })
})
