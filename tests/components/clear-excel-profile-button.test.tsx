// @vitest-environment jsdom
// 설정 화면의 "저장된 양식 비우기"(Task 1b) — 확인 모달을 거쳐서만 액션을 부르고, 실패 사유는 토스트로 보인다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({ clearExcelProfile: vi.fn(), refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh, push: vi.fn(), replace: vi.fn() }) }))
vi.mock('@/app/actions/project', () => ({ clearExcelProfile: mocks.clearExcelProfile }))

import { LocaleProvider } from '@/components/providers/LocaleProvider'
import { ToastProvider } from '@/components/ui/Toast'
import { ClearExcelProfileButton } from '@/components/settings/ClearExcelProfileButton'

const PID = '11111111-1111-4111-8111-111111111111'

describe('ClearExcelProfileButton', () => {
  let root: Root
  const button = (name: string) =>
    [...document.body.querySelectorAll('button')].find(b => b.textContent?.trim() === name) as HTMLButtonElement | undefined
  const click = (el: HTMLElement) => act(async () => { el.click(); await Promise.resolve() })

  beforeEach(async () => {
    vi.clearAllMocks()
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => root.render(
      <LocaleProvider initialLocale="ko"><ToastProvider><ClearExcelProfileButton projectId={PID} /></ToastProvider></LocaleProvider>,
    ))
  })
  afterEach(() => { act(() => root.unmount()); document.body.innerHTML = '' })

  it('버튼만 눌러서는 비우지 않는다 — 확인 모달의 "비우기"에서만 액션을 부르고 화면을 새로 그린다', async () => {
    mocks.clearExcelProfile.mockResolvedValue({ ok: true })
    await click(button('저장된 양식 비우기')!)
    expect(mocks.clearExcelProfile).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('저장된 엑셀 양식을 비울까요?')
    await click(button('비우기')!)
    expect(mocks.clearExcelProfile).toHaveBeenCalledWith(PID)
    expect(mocks.refresh).toHaveBeenCalled()
    expect(document.body.textContent).toContain('저장된 양식을 비웠습니다')
  })

  it('실패하면 그 사유를 토스트로 보이고 새로 그리지 않는다', async () => {
    mocks.clearExcelProfile.mockResolvedValue({ ok: false, error: '권한 없음' })
    await click(button('저장된 양식 비우기')!)
    await click(button('비우기')!)
    expect(document.body.textContent).toContain('양식을 비우지 못했습니다')
    expect(document.body.textContent).toContain('권한 없음')
    expect(mocks.refresh).not.toHaveBeenCalled()
  })
})
