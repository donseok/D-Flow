// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
  { key: 'branding.product_name', label: '제품 이름', description: '', kind: 'text', value: 'D-Flow', source: '제품 기본값' },
  { key: 'branding.mail_from_name', label: '메일 발신 이름', description: '', kind: 'text', value: '', source: '제품 기본값' },
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

  it('손상된 키는 새 값을 넣으면 복구 패치에 포함한다', async () => {
    render([{ key: 'branding.mail_from_name', label: '메일 발신 이름', description: '', kind: 'text', value: '', source: '설정 손상', error: '제어 문자' }])
    expect(host.textContent).toContain('설정 손상: 제어 문자')
    change('branding.mail_from_name', 'Team'); await click('저장')
    expect(update).toHaveBeenCalledWith('ws', expect.objectContaining({ set: { 'branding.mail_from_name': 'Team' } }))
  })
})
