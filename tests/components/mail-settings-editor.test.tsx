// @vitest-environment jsdom
// 워크스페이스 메일 발송 편집기(설계 2026-10-15 §4) — 상태 줄 다섯 갈래, 비밀번호 설정자 경고, 방식 전환,
// 비밀번호 칸은 늘 빈 값으로 시작하고 브라우저 자동완성이 로그인 비밀번호를 채우지 못하게(new-password·smtp-* 이름) 한다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { GetMailSettingsResult } from '@/app/actions/mailSettings'
import { t } from '@/lib/i18n/dict'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const saveWorkspaceMailSettings = vi.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({ ok: true }))
const deleteWorkspaceMailSettings = vi.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({ ok: true }))
const sendWorkspaceTestMail = vi.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({ ok: true, to: 'me@example.com' }))
const refresh = vi.fn()
const toast = vi.fn()

vi.mock('@/app/actions/mailSettings', () => ({
  getWorkspaceMailSettings: vi.fn(),
  saveWorkspaceMailSettings: (...a: unknown[]) => saveWorkspaceMailSettings(...a),
  deleteWorkspaceMailSettings: (...a: unknown[]) => deleteWorkspaceMailSettings(...a),
  sendWorkspaceTestMail: (...a: unknown[]) => sendWorkspaceTestMail(...a),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }))
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ toast }) }))
vi.mock('@/components/providers/LocaleProvider', async () => {
  const { t } = await vi.importActual<typeof import('@/lib/i18n/dict')>('@/lib/i18n/dict')
  const api = { t: (k: Parameters<typeof t>[0]) => t(k) }
  return { useLocale: () => api }
})

import { MailSettingsEditor } from '@/components/settings/MailSettingsEditor'

type Initial = Extract<GetMailSettingsResult, { ok: true }>
type Status = Initial['status']

const NONE: Initial = {
  ok: true, settings: null, status: { source: 'none' },
  passwordSetBy: null, passwordSetAt: null, passwordSetterIsAdmin: null,
}
const GMAIL: Initial = {
  ok: true,
  settings: { preset: 'gmail', host: 'smtp.gmail.com', port: 465, secure: true, username: 'ops@gmail.com', fromAddress: null, hasPassword: true },
  status: { source: 'workspace', valid: true, fromAddress: 'ops@gmail.com' },
  passwordSetBy: '김관리', passwordSetAt: '2026-10-15T01:02:00Z', passwordSetterIsAdmin: true,
}
const CUSTOM: Initial = {
  ...GMAIL,
  settings: { preset: 'custom', host: 'smtp.example.com', port: 587, secure: false, username: 'mailer', fromAddress: 'noreply@example.com', hasPassword: true },
  status: { source: 'workspace', valid: true, fromAddress: 'noreply@example.com' },
}

describe('MailSettingsEditor', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    saveWorkspaceMailSettings.mockReset(); saveWorkspaceMailSettings.mockResolvedValue({ ok: true })
    deleteWorkspaceMailSettings.mockReset(); deleteWorkspaceMailSettings.mockResolvedValue({ ok: true })
    sendWorkspaceTestMail.mockReset(); sendWorkspaceTestMail.mockResolvedValue({ ok: true, to: 'me@example.com' })
    refresh.mockClear(); toast.mockClear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function render(initial: Initial = NONE) {
    act(() => { root.render(<MailSettingsEditor workspaceId="w-1" initial={initial} timeZone="UTC" />) })
  }
  const $ = <T extends Element>(sel: string) => container.querySelector<T>(sel)
  function typeInto(el: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    act(() => { setter.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) })
  }
  function choose(el: HTMLSelectElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!
    act(() => { setter.call(el, value); el.dispatchEvent(new Event('change', { bubbles: true })) })
  }
  async function click(el: Element | null) {
    await act(async () => { (el as HTMLElement).click() })
  }
  const pickCustom = () => click($('input[type="radio"][value="custom"]'))

  describe('상태 줄 — 다섯 갈래', () => {
    const cases: Array<[string, Status, string, string]> = [
      ['workspace-valid', { source: 'workspace', valid: true, fromAddress: 'ops@gmail.com' }, '이 워크스페이스 설정으로 발송 중', 'ops@gmail.com'],
      ['workspace-invalid', { source: 'workspace', valid: false }, '저장된 설정이 올바르지 않습니다', '지금은 메일이 나가지 않습니다'],
      ['env-valid', { source: 'env', valid: true, fromAddress: 'env@example.com' }, '서버 환경변수 설정으로 발송 중', ''],
      ['env-invalid', { source: 'env', valid: false }, '서버 환경변수의 메일 설정이 올바르지 않습니다', '이 화면에서 저장하면'],
      ['none', { source: 'none' }, '메일 발송이 설정되지 않았습니다', '초대 메일이 나가지 않습니다'],
    ]
    it.each(cases)('%s', (variant, status, head, tail) => {
      render({ ...NONE, status })
      const line = $('[data-mail-status]')!
      expect(line.getAttribute('data-mail-status')).toBe(variant)
      expect(line.getAttribute('role')).toBe('status')
      expect(line.textContent).toContain(head)
      expect(line.textContent).toContain(tail)
    })
  })

  describe('비밀번호 설정자', () => {
    it('저장된 행이 있으면 누가·언제 넣었는지 범위 tz 로 보인다', () => {
      render(GMAIL)
      const line = $('[data-mail-password-set]')!
      expect(line.textContent).toContain('김관리')
      expect(line.textContent).toContain('2026-10-15 01:02')
      expect($('[data-mail-setter-warning]')).toBeNull()
    })
    it('설정자가 지금 관리자가 아니면 경고한다', () => {
      render({ ...GMAIL, passwordSetterIsAdmin: false })
      expect($('[data-mail-setter-warning]')!.textContent).toContain('비밀번호를 넣은 사람이 더 이상 이 워크스페이스 관리자가 아닙니다')
    })
    it("설정자 판정을 못 읽었으면('unknown') 모른다고 보인다 — 경고 없음으로 위장하지 않는다", () => {
      render({ ...GMAIL, passwordSetterIsAdmin: 'unknown' })
      expect($('[data-mail-setter-unknown]')).not.toBeNull()
      expect($('[data-mail-setter-warning]')).toBeNull()
    })
    it('설정자가 지워진 계정(null)이면 이름 대신 알 수 없는 사용자', () => {
      render({ ...GMAIL, passwordSetBy: null, passwordSetterIsAdmin: false })
      expect($('[data-mail-password-set]')!.textContent).toContain('알 수 없는 사용자')
    })
    it('저장된 행이 없으면 설정자 줄이 없다', () => {
      render(NONE)
      expect($('[data-mail-password-set]')).toBeNull()
    })
  })

  describe('방식 전환', () => {
    it('기본은 Gmail — 주소·앱 비밀번호만, 서버 칸은 없다', () => {
      render(NONE)
      expect($<HTMLInputElement>('input[type="radio"][value="gmail"]')!.checked).toBe(true)
      expect($('#smtp-username')).not.toBeNull()
      expect($('#smtp-host')).toBeNull()
      expect(container.textContent).toContain('발송 전용 계정을 권합니다')
    })
    it('직접 입력으로 바꾸면 서버·포트·보안·계정·보내는 주소 칸이 생긴다', async () => {
      render(NONE)
      await pickCustom()
      for (const id of ['smtp-host', 'smtp-port', 'smtp-secure', 'smtp-username', 'smtp-password', 'smtp-from']) expect($(`#${id}`), id).not.toBeNull()
    })
    it('저장된 직접 입력 설정은 그 값으로 시작한다(비밀번호는 빈 칸)', () => {
      render(CUSTOM)
      expect($<HTMLInputElement>('input[type="radio"][value="custom"]')!.checked).toBe(true)
      expect($<HTMLInputElement>('#smtp-host')!.value).toBe('smtp.example.com')
      expect($<HTMLSelectElement>('#smtp-port')!.value).toBe('587')
      expect($<HTMLSelectElement>('#smtp-secure')!.value).toBe('starttls')
      expect($<HTMLInputElement>('#smtp-from')!.value).toBe('noreply@example.com')
      expect($<HTMLInputElement>('#smtp-password')!.value).toBe('')
    })
    it('포트 465 를 고르면 SSL, 587 이면 STARTTLS 로 짝을 맞춘다', async () => {
      render(NONE)
      await pickCustom()
      choose($<HTMLSelectElement>('#smtp-port')!, '465')
      expect($<HTMLSelectElement>('#smtp-secure')!.value).toBe('ssl')
      choose($<HTMLSelectElement>('#smtp-port')!, '587')
      expect($<HTMLSelectElement>('#smtp-secure')!.value).toBe('starttls')
    })
    it('방식을 바꾸면 입력하던 비밀번호를 비운다 — 다른 서버로 새 나가지 않게', async () => {
      render(NONE)
      typeInto($<HTMLInputElement>('#smtp-password')!, 'secret')
      await pickCustom()
      expect($<HTMLInputElement>('#smtp-password')!.value).toBe('')
    })
  })

  describe('자동완성 차단', () => {
    it.each([['gmail', NONE], ['custom', CUSTOM]] as const)('비밀번호 칸(%s) — password·new-password·smtp-password·빈 값', (_name, initial) => {
      render(initial)
      const pw = $<HTMLInputElement>('#smtp-password')!
      expect(pw.type).toBe('password')
      expect(pw.getAttribute('autocomplete')).toBe('new-password')
      expect(pw.name).toBe('smtp-password')
      expect(pw.value).toBe('')
    })
    it('저장돼 있으면 자리표시가 "저장됨", 없으면 자리표시가 없다', () => {
      render(GMAIL)
      expect($<HTMLInputElement>('#smtp-password')!.placeholder).toBe('저장됨 · 바꾸려면 새로 입력')
      act(() => root.unmount()); root = createRoot(container)
      render(NONE)
      expect($<HTMLInputElement>('#smtp-password')!.getAttribute('placeholder')).toBeNull()
    })
    it('주소·계정·서버·보내는 주소 칸은 autocomplete=off 와 smtp-* 이름', async () => {
      render(NONE)
      const addr = $<HTMLInputElement>('#smtp-username')!
      expect(addr.getAttribute('autocomplete')).toBe('off')
      expect(addr.name).toBe('smtp-username')
      await pickCustom()
      expect($<HTMLInputElement>('#smtp-username')!.getAttribute('autocomplete')).toBe('off')
      expect($<HTMLInputElement>('#smtp-host')!.getAttribute('autocomplete')).toBe('off')
      const from = $<HTMLInputElement>('#smtp-from')!
      expect(from.getAttribute('autocomplete')).toBe('off')
      expect(from.name).toBe('smtp-from')
    })
  })

  describe('저장', () => {
    it('Gmail — 주소·앱 비밀번호를 넘기고, 성공하면 비밀번호 칸을 비우고 새로 그린다', async () => {
      render(NONE)
      typeInto($<HTMLInputElement>('#smtp-username')!, 'ops@gmail.com')
      typeInto($<HTMLInputElement>('#smtp-password')!, 'abcd efgh ijkl mnop')
      await click($('[data-mail-save]'))
      expect(saveWorkspaceMailSettings).toHaveBeenCalledWith('w-1', { preset: 'gmail', address: 'ops@gmail.com', password: 'abcd efgh ijkl mnop' })
      expect($<HTMLInputElement>('#smtp-password')!.value).toBe('')
      expect(refresh).toHaveBeenCalled()
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: '메일 발송 설정을 저장했습니다.', variant: 'success' }))
    })
    it('직접 입력 — 서버·포트(숫자)·보안·계정·보내는 주소를 넘긴다', async () => {
      render(NONE)
      await pickCustom()
      typeInto($<HTMLInputElement>('#smtp-host')!, 'smtp.example.com')
      // 보내는 주소를 비우면 계정이 이메일이어야 정규화를 통과한다(Task 2 의 from_invalid) — 그래서 계정을 이메일로 넣는다
      typeInto($<HTMLInputElement>('#smtp-username')!, 'mailer@example.com')
      typeInto($<HTMLInputElement>('#smtp-password')!, 'pw')
      await click($('[data-mail-save]'))
      expect(saveWorkspaceMailSettings).toHaveBeenCalledWith('w-1', {
        preset: 'custom', host: 'smtp.example.com', port: 587, secure: false, username: 'mailer@example.com', password: 'pw', fromAddress: '',
      })
    })
    it('저장된 설정이 없는데 비밀번호가 비면 서버에 가기 전에 사유를 보인다', async () => {
      render(NONE)
      typeInto($<HTMLInputElement>('#smtp-username')!, 'ops@gmail.com')
      await click($('[data-mail-save]'))
      expect(saveWorkspaceMailSettings).not.toHaveBeenCalled()
      expect($('[role="alert"]')!.textContent).toBe(t('mailSettings.reason.password_required'))
    })
    it('주소 형식이 틀리면 사유 코드 문구(공용 사전)를 보인다', async () => {
      render(NONE)
      typeInto($<HTMLInputElement>('#smtp-username')!, 'not-an-email')
      typeInto($<HTMLInputElement>('#smtp-password')!, 'pw')
      await click($('[data-mail-save]'))
      expect(saveWorkspaceMailSettings).not.toHaveBeenCalled()
      expect($('[role="alert"]')!.textContent).toBe(t('mailSettings.reason.address_invalid'))
    })
    it('저장된 같은 Gmail 계정이면 비밀번호 빈칸으로도 저장한다(저장값 재사용)', async () => {
      render(GMAIL)
      expect($<HTMLInputElement>('#smtp-username')!.value).toBe('ops@gmail.com')
      await click($('[data-mail-save]'))
      expect(saveWorkspaceMailSettings).toHaveBeenCalledWith('w-1', { preset: 'gmail', address: 'ops@gmail.com', password: '' })
    })
    it('Gmail 로 저장된 상태에서 직접 입력으로 바꾸면 비밀번호를 다시 요구한다', async () => {
      render(GMAIL)
      await pickCustom()
      typeInto($<HTMLInputElement>('#smtp-host')!, 'smtp.example.com')
      typeInto($<HTMLInputElement>('#smtp-username')!, 'ops@gmail.com')
      await click($('[data-mail-save]'))
      expect(saveWorkspaceMailSettings).not.toHaveBeenCalled()
      expect($('[role="alert"]')!.textContent).toBe(t('mailSettings.reason.password_required'))
    })
    it('액션 오류 문구는 그대로 보이고 새로 그리지 않는다', async () => {
      saveWorkspaceMailSettings.mockResolvedValue({ ok: false, error: '서버 오류 문구' })
      render(GMAIL)
      await click($('[data-mail-save]'))
      expect($('[role="alert"]')!.textContent).toBe('서버 오류 문구')
      expect(refresh).not.toHaveBeenCalled()
    })
    it('액션이 던지면 요청 실패 문구', async () => {
      saveWorkspaceMailSettings.mockRejectedValue(new Error('network'))
      render(GMAIL)
      await click($('[data-mail-save]'))
      expect($('[role="alert"]')!.textContent).toBe(t('wsAccounts.requestFailed'))
    })
  })

  describe('테스트 메일', () => {
    it('저장 전 폼 값으로 보내고 받는 주소(본인)를 알린다 — 수신자는 넘기지 않는다', async () => {
      render(NONE)
      typeInto($<HTMLInputElement>('#smtp-username')!, 'ops@gmail.com')
      typeInto($<HTMLInputElement>('#smtp-password')!, 'pw')
      await click($('[data-mail-test]'))
      expect(sendWorkspaceTestMail).toHaveBeenCalledWith('w-1', { preset: 'gmail', address: 'ops@gmail.com', password: 'pw' })
      expect($('[data-mail-notice]')!.textContent).toBe('me@example.com 주소로 테스트 메일을 보냈습니다.')
      expect(saveWorkspaceMailSettings).not.toHaveBeenCalled()
    })
    it('발송 실패 문구를 그대로 보인다', async () => {
      sendWorkspaceTestMail.mockResolvedValue({ ok: false, error: '인증 실패 문구' })
      render(GMAIL)
      await click($('[data-mail-test]'))
      expect($('[role="alert"]')!.textContent).toBe('인증 실패 문구')
    })
  })

  describe('설정 삭제', () => {
    it('저장된 행이 없으면 삭제 버튼이 없다', () => {
      render(NONE)
      expect($('[data-mail-delete]')).toBeNull()
    })
    it('확인 대화상자를 거쳐 지우고 새로 그린다', async () => {
      render(GMAIL)
      await click($('[data-mail-delete]'))
      expect(deleteWorkspaceMailSettings).not.toHaveBeenCalled()
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
      expect(dialog.textContent).toContain('서버 환경변수 설정이 있으면 그 설정으로 발송하고')
      await click(dialog.querySelector('[data-mail-delete-confirm]'))
      expect(deleteWorkspaceMailSettings).toHaveBeenCalledWith('w-1')
      expect(refresh).toHaveBeenCalled()
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: '메일 발송 설정을 삭제했습니다.' }))
    })
    it('삭제 실패는 대화상자를 닫고 문구를 보인다', async () => {
      deleteWorkspaceMailSettings.mockResolvedValue({ ok: false, error: '지울 설정이 없습니다.' })
      render(GMAIL)
      await click($('[data-mail-delete]'))
      await click(document.querySelector('[data-mail-delete-confirm]'))
      expect(document.querySelector('[role="dialog"]')).toBeNull()
      expect($('[role="alert"]')!.textContent).toBe('지울 설정이 없습니다.')
      expect(refresh).not.toHaveBeenCalled()
    })
  })
})
