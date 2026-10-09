// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// 화면 문구는 사전(settingsUi·adminUi)에 있다 — 사전의 한국어 글자를 돌려주는 대역(공급자 없는 기본 t 는 키를 돌려준다)
vi.mock('@/components/providers/LocaleProvider', async () => (await import('../helpers/locale-mock')).koLocale())
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
const update = vi.fn()
const outcome = vi.fn()
const refresh = vi.fn()
vi.mock('@/app/actions/settings', () => ({
  updateWorkspaceSettings: (...args: unknown[]) => update(...args),
  getSettingsCommandOutcome: (...args: unknown[]) => outcome(...args),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

import { WorkspaceFieldsEditor, type WorkspaceField } from '@/components/settings/WorkspaceFieldsEditor'

const general: WorkspaceField[] = [
  { key: 'branding.product_name', label: '제품 이름', description: '', kind: 'text', value: 'D-Flow', source: 'product' },
  { key: 'branding.mail_from_name', label: '메일 발신 이름', description: '', kind: 'text', value: '', source: 'product' },
]

describe('WorkspaceFieldsEditor', () => {
  let host: HTMLDivElement
  let root: Root
  beforeEach(() => {
    update.mockReset().mockResolvedValue({ ok: true, kind: 'applied', revision: 6, commandId: 'c', rebased: false })
    outcome.mockReset(); refresh.mockReset()
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  })
  afterEach(() => { act(() => root.unmount()); host.remove() })
  function render(fields = general) { act(() => root.render(<WorkspaceFieldsEditor workspaceId="ws" revision={5} fields={fields} />)) }
  function input(key: string): HTMLInputElement { return host.querySelector<HTMLInputElement>(`input[id="workspace-${key}"]`)! }
  function change(key: string, value: string) {
    const el = input(key)
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  async function click(text: string) {
    const b = [...host.querySelectorAll('button')].find(x => x.textContent?.includes(text))!
    await act(async () => { b.click() })
  }

  it('한 범주의 변경된 키만 하나의 패치로 저장한다', async () => {
    render(); change('branding.product_name', 'Flow')
    expect(host.textContent).toContain('변경 1개')
    await click('저장')
    expect(update).toHaveBeenCalledWith('ws', expect.objectContaining({ expectedRevision: 5,
      set: { 'branding.product_name': 'Flow' }, unset: [] }))
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('겹친 변경은 내 값과 최신 값을 보여주고 명시적 선택 뒤에만 다시 저장한다', async () => {
    update.mockResolvedValueOnce({ ok: false, kind: 'conflict', code: 'CONFIG_CONFLICT', commandId: 'c', error: '충돌',
      latest: { revision: 8, values: { 'branding.product_name': 'Other' }, invalidKeys: [] }, changedKeys: ['branding.product_name'], retryable: false })
    render(); change('branding.product_name', 'Mine'); await click('저장')
    expect(host.textContent).toContain('내 값Mine')
    expect(host.textContent).toContain('최신 값Other')
    expect(update).toHaveBeenCalledTimes(1)
    await click('내 값 다시 적용'); await click('저장')
    expect(update).toHaveBeenCalledWith('ws', expect.objectContaining({ expectedRevision: 8, set: { 'branding.product_name': 'Mine' } }))
  })

  it('내 값 다시 적용은 내가 안 고친 키를 그 사이 바뀐 최신 값으로 두고 덮어쓰지 않는다', async () => {
    update.mockResolvedValueOnce({ ok: false, kind: 'conflict', code: 'CONFIG_CONFLICT', commandId: 'c', error: '충돌',
      latest: { revision: 8, values: { 'branding.product_name': 'Other', 'branding.mail_from_name': 'OtherMail' }, invalidKeys: [] },
      changedKeys: ['branding.product_name', 'branding.mail_from_name'], retryable: false })
    render(); change('branding.product_name', 'Mine'); await click('저장')
    await click('내 값 다시 적용')
    expect(host.textContent).toContain('변경 1개')
    expect(input('branding.mail_from_name').value).toBe('OtherMail')
    await click('저장')
    expect(update).toHaveBeenLastCalledWith('ws', expect.objectContaining({ expectedRevision: 8, set: { 'branding.product_name': 'Mine' } }))
  })

  it('최신 값 사용은 내가 안 고친 키도 최신 값으로 맞춘다', async () => {
    update.mockResolvedValueOnce({ ok: false, kind: 'conflict', code: 'CONFIG_CONFLICT', commandId: 'c', error: '충돌',
      latest: { revision: 8, values: { 'branding.product_name': 'Other', 'branding.mail_from_name': 'OtherMail' }, invalidKeys: [] },
      changedKeys: ['branding.product_name', 'branding.mail_from_name'], retryable: false })
    render(); change('branding.product_name', 'Mine'); await click('저장')
    await click('최신 값 사용')
    expect(input('branding.product_name').value).toBe('Other')
    expect(input('branding.mail_from_name').value).toBe('OtherMail')
    expect(host.textContent).toContain('변경 0개')
  })

  it('공백만 넣은 메일 발신 이름은 저장되는 값(null)이 그대로라 변경으로 세지 않는다', () => {
    render(); change('branding.mail_from_name', '   ')
    expect(host.textContent).toContain('변경 0개')
  })

  it('제품 이름을 41자 넘게 넣어도 조용히 자르지 않는다 — 서버 필드 오류가 입력 아래에 보인다', async () => {
    update.mockResolvedValueOnce({ ok: false, kind: 'invalid', code: 'CONFIG_INVALID', commandId: 'c', error: '입력 오류', retryable: false,
      fieldErrors: [{ key: 'branding.product_name', message: '제품 이름은 40자까지입니다.' }] })
    render(); const long = 'x'.repeat(45); change('branding.product_name', long)
    expect(input('branding.product_name').value).toBe(long)
    await click('저장')
    expect(input('branding.product_name').nextElementSibling?.textContent).toContain('제품 이름은 40자까지입니다.')
  })

  it('저장 바 루트에 data-save-bar 를 단다 — 셸의 떠 있는 버튼이 저장 바를 가리지 않게 찾는 표지(SP3b 알림 13·D33)', () => {
    render()
    const bar = host.querySelector('[data-save-bar]')
    expect(bar).not.toBeNull()
    expect(bar?.textContent).toContain('변경 0개')
    expect(bar?.querySelector('button')?.textContent).toContain('저장')
  })

  it('손상된 키는 새 값을 넣으면 복구 패치에 포함한다', async () => {
    render([{ key: 'branding.mail_from_name', label: '메일 발신 이름', description: '', kind: 'text', value: '', source: 'corrupted', error: '제어 문자' }])
    expect(host.querySelector('[data-config-state="invalid"]')?.textContent).toContain('제어 문자')
    change('branding.mail_from_name', 'Team'); await click('저장')
    expect(update).toHaveBeenCalledWith('ws', expect.objectContaining({ set: { 'branding.mail_from_name': 'Team' } }))
  })

  it('서버 필드 오류는 해당 입력 아래, 패치 오류는 저장 바 위에 표시한다', async () => {
    update.mockResolvedValueOnce({ ok: false, kind: 'invalid', code: 'CONFIG_INVALID', commandId: 'c',
      error: '입력 오류', fieldErrors: [{ key: 'branding.mail_from_name', message: '발신 이름을 확인하세요.' }], retryable: false })
      .mockResolvedValueOnce({ ok: false, kind: 'denied', code: 'ERR_DENIED', commandId: 'c', error: '권한이 없습니다.', retryable: false })
    render(); change('branding.mail_from_name', 'Bad'); await click('저장')
    const fieldInput = input('branding.mail_from_name')
    expect(fieldInput.nextElementSibling?.getAttribute('data-config-state')).toBe('field')
    expect(fieldInput.nextElementSibling?.textContent).toContain('발신 이름을 확인하세요.')
    expect(host.querySelector('[data-config-state="patch"]')).toBeNull()
    change('branding.mail_from_name', 'New')
    expect(fieldInput.nextElementSibling?.getAttribute('data-config-state')).not.toBe('field')
    await click('저장')
    expect(host.querySelector('[data-config-state="patch"]')?.textContent).toContain('권한이 없습니다.')
  })

  it('적용 뒤 동기화 실패는 다시 저장하지 않는다', async () => {
    update.mockResolvedValue({ ok: false, kind: 'unavailable', code: 'CONFIG_UNAVAILABLE', commandId: 'c',
      error: 'revision 6으로 저장됐지만 동기화에 실패했습니다.', retryable: false })
    render(); change('branding.product_name', 'Flow'); await click('저장')
    expect(update).toHaveBeenCalledTimes(1)
    expect(outcome).not.toHaveBeenCalled()
    expect(host.textContent).toContain('revision 6으로 저장됐지만 동기화에 실패했습니다.')
  })
})
