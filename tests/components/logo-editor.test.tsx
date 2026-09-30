// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const upload = vi.fn(), update = vi.fn(), outcome = vi.fn(), refresh = vi.fn()
vi.mock('@/app/actions/branding', () => ({ uploadBrandLogo: (...a: unknown[]) => upload(...a) }))
vi.mock('@/app/actions/settings', () => ({ updateWorkspaceSettings: (...a: unknown[]) => update(...a), getSettingsCommandOutcome: (...a: unknown[]) => outcome(...a) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
import { LogoEditor } from '@/components/settings/LogoEditor'

const WID = '00000000-0000-4000-8000-00000000bb01'
const PATH = `ws/${WID}/branding/mark-0123456789abcdef.png`

describe('LogoEditor', () => {
  let host: HTMLDivElement, root: Root
  beforeEach(() => {
    upload.mockReset().mockResolvedValue({ ok: true, path: PATH })
    update.mockReset().mockResolvedValue({ ok: true, kind: 'applied', revision: 2, commandId: 'c', rebased: false })
    outcome.mockReset(); refresh.mockReset()
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
    act(() => root.render(<LogoEditor workspaceId={WID} revision={1} initialLogo={{ full: null, full_dark: null, mark: null }} />))
  })
  afterEach(() => { act(() => root.unmount()); host.remove() })
  async function click(label: string) {
    const button = [...host.querySelectorAll('button')].find(x => x.textContent?.includes(label))!
    await act(async () => button.click())
  }
  it('업로드 경로를 설정 저장 전에는 현재 로고로 요청하지 않는다', async () => {
    const file = new File(['png'], 'mark.png', { type: 'image/png' })
    const input = host.querySelector<HTMLInputElement>('input[aria-label="아이콘 마크 파일"]')!
    Object.defineProperty(input, 'files', { configurable: true, value: [file] })
    act(() => input.dispatchEvent(new Event('change', { bubbles: true })))
    const uploadButton = [...host.querySelectorAll<HTMLButtonElement>('button')].find(x => x.textContent === '업로드' && !x.disabled)!
    await act(async () => uploadButton.click())
    expect(upload).toHaveBeenCalledWith(WID, 'mark', file)
    expect(host.textContent).toContain('저장 후 미리보기')
    expect(host.querySelector('img')).toBeNull()
    await click('로고 설정 저장')
    expect(update).toHaveBeenCalledWith(WID, expect.objectContaining({ expectedRevision: 1,
      set: { 'branding.logo': { full: null, full_dark: null, mark: PATH } } }))
    expect(refresh).toHaveBeenCalledOnce()
  })
  it('현재 로고 제거는 파일 삭제 없이 설정의 슬롯을 비운다', async () => {
    act(() => root.render(<LogoEditor key="existing" workspaceId={WID} revision={1} initialLogo={{ full: null, full_dark: null, mark: PATH }} />))
    expect(host.querySelector('img')?.getAttribute('src')).toBe(`/api/brand/${WID}/mark`)
    await click('제거')
    await click('로고 설정 저장')
    expect(update).toHaveBeenCalledWith(WID, expect.objectContaining({ set: { 'branding.logo': { full: null, full_dark: null, mark: null } } }))
  })
})
