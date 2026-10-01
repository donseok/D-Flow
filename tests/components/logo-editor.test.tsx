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
    // 저장 전 경로는 /api/brand 가 주지 않는다 — 미리보기는 선택한 파일의 로컬 주소(blob:)뿐이다
    expect(host.textContent).toContain('저장하면 적용됩니다')
    const preview = host.querySelector('img')
    expect(preview?.getAttribute('src')).toMatch(/^blob:/)
    expect(host.innerHTML).not.toContain('/api/brand/')
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
  it('로컬 미리보기를 못 만드는 환경에서는 저장 뒤 미리보기 안내로 돌아간다', async () => {
    const original = URL.createObjectURL
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: undefined })
    try {
      const file = new File(['png'], 'mark.png', { type: 'image/png' })
      const input = host.querySelector<HTMLInputElement>('input[aria-label="아이콘 마크 파일"]')!
      Object.defineProperty(input, 'files', { configurable: true, value: [file] })
      act(() => input.dispatchEvent(new Event('change', { bubbles: true })))
      const uploadButton = [...host.querySelectorAll<HTMLButtonElement>('button')].find(x => x.textContent === '업로드' && !x.disabled)!
      await act(async () => uploadButton.click())
      expect(host.textContent).toContain('저장 후 미리보기')
      expect(host.querySelector('img')).toBeNull()
    } finally { Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: original }) }
  })
  it('서버가 변경 없음을 알리면 "바뀐 값이 없습니다"를 보인다', async () => {
    act(() => root.render(<LogoEditor key="existing2" workspaceId={WID} revision={1} initialLogo={{ full: null, full_dark: null, mark: PATH }} />))
    update.mockResolvedValueOnce({ ok: true, kind: 'applied', revision: 1, commandId: 'c', rebased: false })
    await click('제거'); await click('로고 설정 저장')
    expect(host.textContent).toContain('바뀐 값이 없습니다.')
    expect(host.textContent).not.toContain('저장했습니다')
  })
  it('거부 사유는 저장 자리(patch)에 보인다', async () => {
    act(() => root.render(<LogoEditor key="existing2b" workspaceId={WID} revision={1} initialLogo={{ full: null, full_dark: null, mark: PATH }} />))
    update.mockResolvedValueOnce({ ok: false, kind: 'denied', code: 'ERR_DENIED', commandId: 'c', error: '권한이 없습니다.', retryable: false })
    await click('제거'); await click('로고 설정 저장')
    expect(host.querySelector('[data-config-state="patch"]')?.textContent).toContain('권한이 없습니다.')
  })
  it('응답이 유실되면 명령 이력으로 확인하고, 불명이면 같은 명령으로 다시 보낸다', async () => {
    act(() => root.render(<LogoEditor key="existing3" workspaceId={WID} revision={1} initialLogo={{ full: null, full_dark: null, mark: PATH }} />))
    update.mockRejectedValue(new Error('network'))
    outcome.mockResolvedValueOnce({ ok: true, outcome: { status: 'applied', revision: 2 } })
    await click('제거'); await click('로고 설정 저장')
    expect(update).toHaveBeenCalledTimes(1)
    expect(host.textContent).toContain('저장된 명령을 확인했습니다.')
    outcome.mockResolvedValue({ ok: true, outcome: { status: 'unknown' } })
    act(() => root.render(<LogoEditor key="existing4" workspaceId={WID} revision={2} initialLogo={{ full: null, full_dark: null, mark: PATH }} />))
    update.mockClear()
    await click('제거'); await click('로고 설정 저장')
    expect(update).toHaveBeenCalledTimes(2)
    expect(update.mock.calls[1][1]).toEqual(update.mock.calls[0][1])
  })
  it('업로드 거부 사유는 저장 실패 알림이 아니라 입력 자리(field)에 보인다', async () => {
    upload.mockResolvedValueOnce({ ok: false, error: '지원하지 않는 형식입니다.' })
    const file = new File(['svg'], 'mark.svg', { type: 'image/svg+xml' })
    const input = host.querySelector<HTMLInputElement>('input[aria-label="아이콘 마크 파일"]')!
    Object.defineProperty(input, 'files', { configurable: true, value: [file] })
    act(() => input.dispatchEvent(new Event('change', { bubbles: true })))
    const uploadButton = [...host.querySelectorAll<HTMLButtonElement>('button')].find(x => x.textContent === '업로드' && !x.disabled)!
    await act(async () => uploadButton.click())
    expect(host.querySelector('[data-config-state="field"]')?.textContent).toContain('지원하지 않는 형식입니다.')
    expect(host.querySelector('[data-config-state="patch"]')).toBeNull()
  })
})
