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
  readCurrentWorkspace: vi.fn(), viewTimezone: vi.fn(), toast: vi.fn(), refresh: vi.fn(),
  notFound: vi.fn(() => { throw new Error('NEXT_HTTP_ERROR_FALLBACK;404') }),
}))
vi.mock('@/lib/authz', () => ({ getActorForView: mocks.getActorForView }))
vi.mock('@/app/actions/platformAdmins', () => ({ listPlatformAdmins: mocks.listPlatformAdmins, findAccountByEmail: mocks.findAccountByEmail }))
vi.mock('@/app/actions/accounts', () => ({ setPlatformAdmin: mocks.setPlatformAdmin }))
vi.mock('@/lib/workspace/current', () => ({ readCurrentWorkspace: mocks.readCurrentWorkspace }))
vi.mock('@/lib/calendar/viewZone', () => ({ viewTimezone: mocks.viewTimezone }))
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
  mocks.viewTimezone.mockResolvedValue({ ok: true, timeZone: 'Asia/Seoul' })
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
    expect(out).not.toContain('data-platform-admin-row')
    // blocking 표식 = 알림 영역(role="alert") — blocking 이 아닌 partial_error 는 role="status" 다(StatusMessage)
    const notice = new DOMParser().parseFromString(out, 'text/html').querySelector('[data-status-kind="partial_error"]')
    expect(notice).not.toBeNull()
    expect(notice!.getAttribute('role')).toBe('alert')
  })
  describe('지정 일시의 tz — 현재 워크스페이스의 달력에서 온다(코드에 고정 시간대 리터럴을 두지 못한다)', () => {
    beforeEach(() => { mocks.getActorForView.mockResolvedValue(makeSuperuser({ userId: 'u-su' })) })
    it('워크스페이스 달력의 tz 로 읽어 표에 넘긴다', async () => {
      const out = await html()
      expect(mocks.viewTimezone).toHaveBeenCalledWith('w1')
      expect(out).toContain('(Asia/Seoul)')
      expect(out).toContain('2026-10-14 09:00')   // ROWS[0] — UTC 00:00 → 서울 09:00
    })
    it('현재 워크스페이스가 없으면 달력을 읽지 않고 UTC 를 명시한다', async () => {
      mocks.readCurrentWorkspace.mockResolvedValue({ ok: true, ws: null })
      const out = await html()
      expect(mocks.viewTimezone).not.toHaveBeenCalled()
      expect(out).toContain('(UTC)')
      expect(out).toContain('2026-10-14 00:00')
    })
    it.each([
      ['달력 해석 실패(ok:false)', () => mocks.viewTimezone.mockResolvedValue({ ok: false, error: '달력이 손상됐습니다.', key: 'calendar.timezone' })],
      ['설정 조회 예외', () => mocks.viewTimezone.mockRejectedValue(new Error('config unavailable'))],
    ])('%s 여도 화면은 열리고 UTC 를 명시한다 — 로그를 남긴다', async (_n, arrange) => {
      arrange()
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const out = await html()
      expect(spy.mock.calls[0]?.[0]).toContain('[platform-admins]')   // 표시 = 로깅(3원칙 ①)
      spy.mockRestore()
      expect(out).toContain('(UTC)')
      expect(out.match(/data-platform-admin-row=/g)).toHaveLength(3)
    })
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
    return render(<PlatformAdminsManager rows={ROWS} currentUserId="u-su" accountsHref="/w/alpha/admin/accounts" timeZone="Asia/Seoul" />)
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
    // 성공했을 때만 닫는다 — 거부면 확인 창이 남아 다시 누르거나 취소할 수 있다
    expect(document.body.querySelector('[data-platform-admin-confirm]')).not.toBeNull()
  })
  it('해제 요청이 예외로 끝나도(throw) 오류를 토스트하고 refresh — 낡은 표를 남기지 않는다', async () => {
    mocks.setPlatformAdmin.mockRejectedValue(new Error('network'))
    const { container } = mount()
    act(() => { container.querySelector<HTMLButtonElement>('[data-platform-admin-row="u-b"] [data-platform-admin-unset]')!.click() })
    act(() => { document.body.querySelector<HTMLButtonElement>('[data-platform-admin-confirm]')!.click() })
    await flush()
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', description: KO['wsAccounts.requestFailedShort'] }))
    expect(mocks.refresh).toHaveBeenCalled()
    expect(document.body.querySelector('[data-platform-admin-confirm]')).not.toBeNull()
  })
  it('해제 성공은 성공 토스트(제목 = 해제했습니다)를 띄우고 확인 창을 닫는다', async () => {
    const { container } = mount()
    act(() => { container.querySelector<HTMLButtonElement>('[data-platform-admin-row="u-b"] [data-platform-admin-unset]')!.click() })
    act(() => { document.body.querySelector<HTMLButtonElement>('[data-platform-admin-confirm]')!.click() })
    await flush()
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'success', title: KO['wsAccounts.platform.unsetDone'] }))
    expect(document.body.querySelector('[data-platform-admin-confirm]')).toBeNull()
  })
  it('해제 진행 중에는 확인·취소가 잠긴다 — 같은 해제를 두 번 보내지 않는다', async () => {
    let resolveSet!: (v: unknown) => void
    mocks.setPlatformAdmin.mockReturnValueOnce(new Promise((r) => { resolveSet = r }))
    const { container } = mount()
    act(() => { container.querySelector<HTMLButtonElement>('[data-platform-admin-row="u-b"] [data-platform-admin-unset]')!.click() })
    act(() => { document.body.querySelector<HTMLButtonElement>('[data-platform-admin-confirm]')!.click() })
    await flush()
    expect(document.body.querySelector<HTMLButtonElement>('[data-platform-admin-confirm]')!.disabled).toBe(true)
    expect(button(document.body, KO['common.cancel']).disabled).toBe(true)
    await act(async () => { resolveSet({ ok: true }); await Promise.resolve(); await Promise.resolve() })
    expect(document.body.querySelector('[data-platform-admin-confirm]')).toBeNull()
  })
  it('표의 지정 열은 "지정 일시"이고 넘겨받은 tz 의 시각으로 보인다 — UTC 16:30 은 서울 다음 날 01:30', () => {
    const rows: PlatformAdminRow[] = [{ userId: 'u-kst', email: 'k@example.com', name: '케', grantedAt: '2026-10-14T16:30:00Z', grantedBy: null }]
    const { container } = render(<PlatformAdminsManager rows={rows} currentUserId="u-su" accountsHref={null} timeZone="Asia/Seoul" />)
    const heads = Array.from(container.querySelectorAll('th')).map((th) => th.textContent?.trim())
    expect(heads).toContain('지정 일시 (Asia/Seoul)')   // 머리가 어느 시간대의 시각인지 밝힌다
    expect(heads).not.toContain('지정일')
    expect(container.querySelector('[data-platform-admin-row="u-kst"]')!.textContent).toContain('2026-10-15 01:30')
  })
  it('같은 시각도 tz 가 UTC 면 UTC 날짜로 보인다 — 머리의 tz 이름과 값이 함께 움직인다', () => {
    const rows: PlatformAdminRow[] = [{ userId: 'u-utc', email: 'k@example.com', name: '케', grantedAt: '2026-10-14T16:30:00Z', grantedBy: null }]
    const { container } = render(<PlatformAdminsManager rows={rows} currentUserId="u-su" accountsHref={null} timeZone="UTC" />)
    expect(Array.from(container.querySelectorAll('th')).map((th) => th.textContent?.trim())).toContain('지정 일시 (UTC)')
    expect(container.querySelector('[data-platform-admin-row="u-utc"]')!.textContent).toContain('2026-10-14 16:30')
  })
  it('추가 — 찾는 동안 이메일 입력은 잠겨 이전 이메일의 결과가 늦게 뜨지 않는다', async () => {
    let resolveFind!: (v: unknown) => void
    mocks.findAccountByEmail.mockReturnValueOnce(new Promise((r) => { resolveFind = r }))
    const { container } = mount()
    act(() => { button(container, KO['platformAdmins.add']).click() })
    const input = document.body.querySelector<HTMLInputElement>('[data-platform-admin-email]')!
    setValue(input, 'late@example.com')
    expect(input.disabled).toBe(false)
    act(() => { button(document.body, KO['platformAdmins.find']).click() })
    await flush()
    expect(input.disabled).toBe(true)
    await act(async () => { resolveFind({ ok: true, account: null }); await Promise.resolve(); await Promise.resolve() })
    expect(input.disabled).toBe(false)
    expect(document.body.textContent).toContain(KO['platformAdmins.notFound'])
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
  // ── 추가 모달 보강 — 포커스·접근성·실패 시 유지·초기화 ──
  const FOUND = { userId: 'u-c', email: 'c@example.com', name: '씨', isPlatformAdmin: false, workspaces: [{ name: '알파', role: 'admin' as const, archived: false }] }
  const emailInput = () => document.body.querySelector<HTMLInputElement>('[data-platform-admin-email]')!
  function openAdd(acctHref: string | null = '/w/alpha/admin/accounts') {
    const m = render(<PlatformAdminsManager rows={ROWS} currentUserId="u-su" accountsHref={acctHref} timeZone="Asia/Seoul" />)
    act(() => { button(m.container, KO['platformAdmins.add']).click() })
    return m
  }
  const find = async (email: string) => {
    setValue(emailInput(), email)
    act(() => { button(document.body, KO['platformAdmins.find']).click() })
    await flush()
  }

  /**
   * 브라우저는 포커스된 요소가 disabled 가 되면 포커스를 body 로 빼지만 jsdom 은 그러지 않고 disabled 요소의 focus() 도 무시한다 —
   * 그래서 activeElement 만으로는 못 잡는다. focus() 호출 순간의 disabled 값을 기록해 "다시 enabled 된 다음 focus" 를 단언한다.
   */
  function trackFocus(input: HTMLInputElement) {
    const calls: boolean[] = []
    const real = input.focus.bind(input)
    vi.spyOn(input, 'focus').mockImplementation((...a) => { calls.push(input.disabled); real(...a) })
    return calls
  }
  it('추가 — 찾기가 끝나면 입력이 다시 enabled 된 다음 포커스를 되돌린다(Enter 로 찾기 · 결과 있음)', async () => {
    let resolveFind!: (v: unknown) => void
    mocks.findAccountByEmail.mockReturnValueOnce(new Promise((r) => { resolveFind = r }))
    openAdd()
    const input = emailInput()
    setValue(input, 'c@example.com')
    act(() => { input.focus() })
    const focusCalls = trackFocus(input)
    act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    await flush()
    expect(input.disabled).toBe(true)
    expect(focusCalls).toEqual([])   // 찾는 동안에는 되돌리지 않는다
    await act(async () => { resolveFind({ ok: true, account: FOUND }); await Promise.resolve(); await Promise.resolve() })
    expect(input.disabled).toBe(false)
    expect(focusCalls).toEqual([false])
    expect(document.activeElement).toBe(input)
  })
  it.each([
    ['없음', { ok: true, account: null }],
    ['오류', { ok: false, error: '계정을 조회하지 못했습니다. 잠시 뒤 다시 시도하세요.' }],
    ['예외', new Error('network')],
  ])('추가 — 찾기가 %s 로 끝나도 입력이 enabled 된 다음 포커스를 되돌린다', async (_n, outcome) => {
    if (outcome instanceof Error) mocks.findAccountByEmail.mockRejectedValueOnce(outcome)
    else mocks.findAccountByEmail.mockResolvedValueOnce(outcome)
    openAdd()
    const input = emailInput()
    setValue(input, 'x@example.com')
    const focusCalls = trackFocus(input)
    act(() => { button(document.body, KO['platformAdmins.find']).click() })
    await flush()
    expect(input.disabled).toBe(false)
    expect(focusCalls).toEqual([false])
    expect(document.activeElement).toBe(input)
  })
  it('추가 — 이메일 입력의 라벨은 "계정 이메일"뿐이다(찾기 버튼이 접근 이름에 섞이지 않는다)', () => {
    openAdd()
    const input = emailInput()
    expect(input.labels).toHaveLength(1)
    expect(input.labels![0].textContent).toBe(KO['platformAdmins.emailLabel'])
    expect(input.labels![0].textContent).not.toContain(KO['platformAdmins.find'])
    expect(input.labels![0].contains(button(document.body, KO['platformAdmins.find']))).toBe(false)
  })
  it('추가 — 없음·찾음·이미 관리자 결과는 role="status" 안에, 오류는 role="alert"', async () => {
    openAdd()
    mocks.findAccountByEmail.mockResolvedValueOnce({ ok: true, account: null })
    await find('none@example.com')
    expect(document.body.querySelector('[role="status"]')!.textContent).toContain(KO['platformAdmins.notFound'])
    mocks.findAccountByEmail.mockResolvedValueOnce({ ok: true, account: FOUND })
    await find('c@example.com')
    expect(document.body.querySelector('[role="status"]')!.textContent).toContain('씨')
    mocks.findAccountByEmail.mockResolvedValueOnce({ ok: true, account: { ...FOUND, isPlatformAdmin: true } })
    await find('b@example.com')
    expect(document.body.querySelector('[role="status"]')!.textContent).toContain(KO['platformAdmins.already'])
    mocks.findAccountByEmail.mockResolvedValueOnce({ ok: false, error: '계정을 조회하지 못했습니다. 잠시 뒤 다시 시도하세요.' })
    await find('x@example.com')
    expect(document.body.querySelector('[role="alert"]')!.textContent).toContain('계정을 조회하지 못했습니다')
    expect(document.body.querySelector('[role="status"]')!.textContent).not.toContain('계정을 조회하지 못했습니다')
  })
  it('추가 — accountsHref 가 null 이면 없음 결과에 문구만 있고 링크가 없다', async () => {
    mocks.findAccountByEmail.mockResolvedValue({ ok: true, account: null })
    openAdd(null)
    await find('none@example.com')
    expect(document.body.textContent).toContain(KO['platformAdmins.notFound'])
    expect(document.body.querySelector('[role="dialog"] a')).toBeNull()
  })
  it('추가 — 지정이 거부되면 모달과 찾은 결과를 남기고 토스트·refresh 한다', async () => {
    mocks.findAccountByEmail.mockResolvedValue({ ok: true, account: FOUND })
    mocks.setPlatformAdmin.mockResolvedValue({ ok: false, error: '플랫폼 관리자를 지정하지 못했습니다.' })
    openAdd()
    await find('c@example.com')
    act(() => { document.body.querySelector<HTMLButtonElement>('[data-platform-admin-grant]')!.click() })
    await flush()
    expect(mocks.setPlatformAdmin).toHaveBeenCalledWith('u-c', true)
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', description: '플랫폼 관리자를 지정하지 못했습니다.' }))
    expect(mocks.refresh).toHaveBeenCalled()
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull()
    expect(document.body.querySelector('[role="dialog"]')!.textContent).toContain('씨')
    expect(emailInput().value).toBe('c@example.com')
    expect(document.body.querySelector<HTMLButtonElement>('[data-platform-admin-grant]')!.disabled).toBe(false)
  })
  it('추가 — 지정 요청이 예외로 끝나도 모달과 찾은 결과를 남기고 토스트·refresh 한다', async () => {
    mocks.findAccountByEmail.mockResolvedValue({ ok: true, account: FOUND })
    mocks.setPlatformAdmin.mockRejectedValue(new Error('network'))
    openAdd()
    await find('c@example.com')
    act(() => { document.body.querySelector<HTMLButtonElement>('[data-platform-admin-grant]')!.click() })
    await flush()
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', description: KO['wsAccounts.requestFailedShort'] }))
    expect(mocks.refresh).toHaveBeenCalled()
    expect(document.body.querySelector('[role="dialog"]')!.textContent).toContain('씨')
  })
  it('추가 — 지정이 성공하면 성공 토스트를 띄우고 모달을 닫는다', async () => {
    mocks.findAccountByEmail.mockResolvedValue({ ok: true, account: FOUND })
    openAdd()
    await find('c@example.com')
    act(() => { document.body.querySelector<HTMLButtonElement>('[data-platform-admin-grant]')!.click() })
    await flush()
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'success', title: KO['wsAccounts.platform.setDone'] }))
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
  })
  it('추가 — 지정 진행 중에는 지정·취소가 잠긴다', async () => {
    mocks.findAccountByEmail.mockResolvedValue({ ok: true, account: FOUND })
    let resolveSet!: (v: unknown) => void
    mocks.setPlatformAdmin.mockReturnValueOnce(new Promise((r) => { resolveSet = r }))
    openAdd()
    await find('c@example.com')
    act(() => { document.body.querySelector<HTMLButtonElement>('[data-platform-admin-grant]')!.click() })
    await flush()
    expect(document.body.querySelector<HTMLButtonElement>('[data-platform-admin-grant]')!.disabled).toBe(true)
    expect(button(document.body, KO['common.cancel']).disabled).toBe(true)
    await act(async () => { resolveSet({ ok: true }); await Promise.resolve(); await Promise.resolve() })
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
  })
  it('추가 — 모달을 닫았다 다시 열면 입력과 결과가 초기화된다', async () => {
    mocks.findAccountByEmail.mockResolvedValue({ ok: true, account: FOUND })
    const { container } = openAdd()
    await find('c@example.com')
    expect(document.body.textContent).toContain('씨')
    act(() => { button(document.body, KO['common.cancel']).click() })
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
    act(() => { button(container, KO['platformAdmins.add']).click() })
    expect(emailInput().value).toBe('')
    expect(document.body.querySelector('[role="dialog"]')!.textContent).not.toContain('씨')
    expect(document.body.querySelector('[data-platform-admin-grant]')).toBeNull()
  })
})
