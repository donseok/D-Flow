// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ t: (k: string) => k }),
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    <a href={href} {...props}>{children}</a>,
}))

import {
  MinuteVersionPanel, type MinuteVersionListItem, type MinuteVersionPanelProps,
} from '@/components/minutes/MinuteVersionPanel'

// P8-H1-4 — 버전 원본은 화면을 그릴 때 서명하지 않고, 누를 때 onDownload(=getMinuteVersionFileUrl)로 발급한다.
const WITH_FILE: MinuteVersionListItem = {
  id: 'v2', versionNo: 2, createdAt: '2026-08-03T13:05:00+09:00', fileName: '회의록.md', hasFile: true,
}
const NO_FILE: MinuteVersionListItem = {
  id: 'v1', versionNo: 1, createdAt: '2026-07-31T16:09:00+09:00', fileName: null, hasFile: false,
}

type OnDownload = NonNullable<MinuteVersionPanelProps['onDownload']>

describe('MinuteVersionPanel 원본 받기 — 클릭 때 발급', () => {
  let container: HTMLDivElement, root: Root
  let open: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    container = document.createElement('div'); document.body.appendChild(container)
    root = createRoot(container)
    open = vi.spyOn(window, 'open').mockImplementation(() => null)
  })
  afterEach(() => { act(() => root.unmount()); container.remove(); open.mockRestore() })

  // embedded 는 항상 펼친 상태라 항목이 바로 보인다.
  function render(versions: MinuteVersionListItem[], onDownload?: OnDownload) {
    act(() => root.render(
      <MinuteVersionPanel timeZone="Asia/Seoul" versions={versions} currentVersionNo={2} embedded onDownload={onDownload} />,
    ))
  }
  const downloadButton = () =>
    container.querySelector<HTMLButtonElement>('button[aria-label^="min.version.downloadAria"]')

  it('발급에 성공하면 그 URL 을 새 창으로 한 번 연다', async () => {
    const onDownload = vi.fn<OnDownload>(async () => ({ ok: true, url: 'https://signed.example.com/v2' }))
    render([WITH_FILE], onDownload)
    const btn = downloadButton()!
    expect(btn.getAttribute('type')).toBe('button')
    expect(btn.textContent).toContain('회의록.md')
    await act(async () => { btn.click() })
    expect(onDownload).toHaveBeenCalledWith('v2')
    expect(open).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith('https://signed.example.com/v2', '_blank', 'noopener,noreferrer')
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('발급에 실패하면 그 항목 아래 알림으로 — 창은 열지 않는다. 액션의 한국어 사유 대신 사전 문구(영어 화면에 날것 금지)', async () => {
    const onDownload = vi.fn<OnDownload>(async () => ({ ok: false, error: 'URL 발급 실패' }))
    render([WITH_FILE], onDownload)
    await act(async () => { downloadButton()!.click() })
    expect(open).not.toHaveBeenCalled()
    const alert = container.querySelector('li [role="alert"]')!
    expect(alert.textContent).toBe('min.err.download')
  })

  it('액션이 던지면 일반 발급 실패 문구 — 버튼은 다시 풀린다', async () => {
    const onDownload = vi.fn<OnDownload>(async () => { throw new Error('network') })
    render([WITH_FILE], onDownload)
    await act(async () => { downloadButton()!.click() })
    expect(container.querySelector('li [role="alert"]')!.textContent).toBe('min.err.download')
    expect(downloadButton()!.disabled).toBe(false)
  })

  it('발급 중에는 버튼을 잠근다 — 두 번 눌러도 한 번만 발급', async () => {
    let resolve!: (v: { ok: true; url: string }) => void
    const onDownload = vi.fn<OnDownload>(() => new Promise(r => { resolve = r }))
    render([WITH_FILE], onDownload)
    await act(async () => { downloadButton()!.click() })
    expect(downloadButton()!.disabled).toBe(true)
    await act(async () => { downloadButton()!.click() })
    expect(onDownload).toHaveBeenCalledTimes(1)
    await act(async () => { resolve({ ok: true, url: 'https://signed.example.com/v2' }) })
    expect(downloadButton()!.disabled).toBe(false)
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('원본 파일이 없는 버전은 버튼 없이 noFile 문구', () => {
    render([NO_FILE], vi.fn<OnDownload>())
    expect(downloadButton()).toBeNull()
    expect(container.textContent).toContain('min.version.noFile')
  })

  it('onDownload 가 없으면 버튼이 없다', () => {
    render([WITH_FILE])
    expect(downloadButton()).toBeNull()
  })
})
