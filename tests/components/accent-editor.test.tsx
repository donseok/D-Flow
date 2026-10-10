// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// 화면 문구는 사전(settingsUi·adminUi)에 있다 — 사전의 한국어 글자를 돌려주는 대역(공급자 없는 기본 t 는 키를 돌려준다)
vi.mock('@/components/providers/LocaleProvider', async () => (await import('../helpers/locale-mock')).koLocale())
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const update = vi.fn(), outcome = vi.fn(), refresh = vi.fn()
vi.mock('@/app/actions/settings', () => ({ updateWorkspaceSettings: (...a: unknown[]) => update(...a), getSettingsCommandOutcome: (...a: unknown[]) => outcome(...a) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
import { AccentEditor } from '@/components/settings/AccentEditor'

describe('AccentEditor', () => {
  let host: HTMLDivElement, root: Root
  beforeEach(() => {
    update.mockReset().mockResolvedValue({ ok: true, kind: 'applied', revision: 2, commandId: 'c', rebased: false })
    outcome.mockReset(); refresh.mockReset()
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
    act(() => root.render(<AccentEditor workspaceId="ws-1" revision={1} initialAccent={null} />))
  })
  afterEach(() => { act(() => root.unmount()); host.remove() })

  async function click(label: string) {
    const button = [...host.querySelectorAll('button')].find(x => x.textContent?.includes(label))!
    await act(async () => button.click())
  }
  it('기준 색 하나를 보내고 미리보기 한 칸을 그린다 — 어두운 화면 미리보기는 없다(라이트 전용 2026-10-10)', async () => {
    const input = host.querySelector<HTMLInputElement>('#workspace-accent')!
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '#315cdb')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(host.textContent).toContain('미리보기')
    expect(host.textContent).not.toContain('어두운 화면')
    await click('강조색 저장')
    expect(update).toHaveBeenCalledWith('ws-1', expect.objectContaining({ expectedRevision: 1, set: { 'branding.accent': '#315cdb' } }))
    expect(refresh).toHaveBeenCalledOnce()
  })
  it('기본값으로 되돌릴 때 null 을 저장한다', async () => {
    act(() => root.render(<AccentEditor key="existing" workspaceId="ws-1" revision={1}
      initialAccent={{ base: '#315cdb', light: {} as never }} />))
    await click('기본값으로')
    await click('강조색 저장')
    expect(update).toHaveBeenCalledWith('ws-1', expect.objectContaining({ set: { 'branding.accent': null } }))
  })

  function setColor(value: string) {
    const input = host.querySelector<HTMLInputElement>('#workspace-accent')!
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  it('서버가 변경 없음(revision 그대로)을 알리면 "바뀐 값이 없습니다"를 보인다', async () => {
    update.mockResolvedValue({ ok: true, kind: 'applied', revision: 1, commandId: 'c', rebased: false })
    setColor('#315cdb'); await click('강조색 저장')
    expect(host.textContent).toContain('바뀐 값이 없습니다.')
    expect(host.textContent).not.toContain('저장했습니다')
  })
  it('필드 오류는 입력 자리(field), 패치 거부는 저장 자리(patch)로 갈라 보인다', async () => {
    update
      .mockResolvedValueOnce({ ok: false, kind: 'invalid', code: 'CONFIG_INVALID', commandId: 'c', error: '입력 오류', retryable: false,
        fieldErrors: [{ key: 'branding.accent', message: '대비가 모자랍니다.' }] })
      .mockResolvedValueOnce({ ok: false, kind: 'denied', code: 'ERR_DENIED', commandId: 'c', error: '권한이 없습니다.', retryable: false })
    setColor('#315cdb'); await click('강조색 저장')
    expect(host.querySelector('[data-config-state="field"]')?.textContent).toContain('대비가 모자랍니다.')
    expect(host.querySelector('[data-config-state="patch"]')).toBeNull()
    await click('강조색 저장')
    expect(host.querySelector('[data-config-state="patch"]')?.textContent).toContain('권한이 없습니다.')
  })
  it('응답이 유실되면 명령 이력으로 확인하고, 적용이면 재전송 없이 저장 기준을 올린다', async () => {
    update.mockRejectedValueOnce(new Error('network'))
    outcome.mockResolvedValue({ ok: true, outcome: { status: 'applied', revision: 2 } })
    setColor('#315cdb'); await click('강조색 저장')
    expect(update).toHaveBeenCalledTimes(1)
    expect(outcome).toHaveBeenCalledWith({ workspaceId: 'ws-1' }, update.mock.calls[0][1].commandId)
    expect(host.textContent).toContain('저장된 명령을 확인했습니다.')
    expect(refresh).toHaveBeenCalledOnce()
  })
  it('결과가 끝내 불명이면 같은 명령을 다시 보내고, 충돌 뒤 저장은 새 commandId 를 쓴다', async () => {
    update.mockRejectedValue(new Error('network'))
    outcome.mockResolvedValue({ ok: true, outcome: { status: 'unknown' } })
    setColor('#315cdb'); await click('강조색 저장')
    expect(update).toHaveBeenCalledTimes(2)
    expect(update.mock.calls[1][1]).toEqual(update.mock.calls[0][1])
    await click('저장 결과 확인 및 재시도')
    expect(update.mock.calls[2][1].commandId).toBe(update.mock.calls[0][1].commandId)
    // 충돌 → 내 값 다시 적용 → 새 id·최신 revision
    update.mockReset().mockResolvedValueOnce({ ok: false, kind: 'conflict', code: 'CONFIG_CONFLICT', commandId: 'c', error: '충돌',
      latest: { revision: 6, values: { 'branding.accent': null }, invalidKeys: [] }, changedKeys: ['branding.accent'], retryable: false })
      .mockResolvedValue({ ok: true, kind: 'applied', revision: 7, commandId: 'c', rebased: false })
    act(() => root.render(<AccentEditor key="fresh" workspaceId="ws-1" revision={1} initialAccent={null} />))
    setColor('#315cdb'); await click('강조색 저장')
    const first = update.mock.calls[0][1].commandId
    expect(host.textContent).toContain('다른 사용자가 강조색을 바꿨습니다.')
    await click('내 값 다시 적용'); await click('강조색 저장')
    expect(update.mock.calls[1][1].commandId).not.toBe(first)
    expect(update.mock.calls[1][1].expectedRevision).toBe(6)
  })
})
