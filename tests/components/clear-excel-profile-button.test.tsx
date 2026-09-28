// @vitest-environment jsdom
// 설정 화면의 "저장된 양식 비우기"(Task 1b) — 확인 모달을 거쳐서만 액션을 부르고, 실패 사유는 토스트로 보인다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({ updateProjectSettings: vi.fn(), refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh, push: vi.fn(), replace: vi.fn() }) }))
vi.mock('@/app/actions/settings', () => ({ updateProjectSettings: mocks.updateProjectSettings }))

import { LocaleProvider } from '@/components/providers/LocaleProvider'
import { ToastProvider } from '@/components/ui/Toast'
import { ClearExcelProfileButton } from '@/components/settings/ClearExcelProfileButton'
import { ERR_DENIED } from '@/lib/authz/errors'
import { t } from '@/lib/i18n/dict'

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
      <LocaleProvider initialLocale="ko"><ToastProvider><ClearExcelProfileButton projectId={PID} revision={3} /></ToastProvider></LocaleProvider>,
    ))
  })
  afterEach(() => { act(() => root.unmount()); document.body.innerHTML = '' })

  it('버튼만 눌러서는 비우지 않는다 — 확인 모달의 "비우기"에서만 액션을 부르고 화면을 새로 그린다', async () => {
    mocks.updateProjectSettings.mockResolvedValue({ ok: true, kind: 'applied', commandId: 'c', revision: 4, rebased: false })
    await click(button('저장된 양식 비우기')!)
    expect(mocks.updateProjectSettings).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('저장된 엑셀 양식을 비울까요?')
    await click(button('비우기')!)
    expect(mocks.updateProjectSettings).toHaveBeenCalledWith(PID, expect.objectContaining({
      expectedRevision: 3, commandId: expect.stringMatching(/^[0-9a-f-]{36}$/), set: {}, unset: ['wbs.excel_profile'],
    }))
    expect(mocks.refresh).toHaveBeenCalled()
    expect(document.body.textContent).toContain('저장된 양식을 비웠습니다')
  })

  it('실패하면 사유를 사전 문구 토스트로 보이고 새로 그리지 않는다 — 가드 문구는 그에 맞는 문구로', async () => {
    mocks.updateProjectSettings.mockResolvedValue({ ok: false, kind: 'denied', code: ERR_DENIED, commandId: 'c', error: ERR_DENIED, retryable: false })
    await click(button('저장된 양식 비우기')!)
    await click(button('비우기')!)
    expect(document.body.textContent).toContain('양식을 비우지 못했습니다')
    expect(document.body.textContent).toContain(t('ko', 'common.err.denied'))
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it('모르는 사유(DB 문구 등)는 날것으로 싣지 않고 일반 문구', async () => {
    mocks.updateProjectSettings.mockResolvedValue({ ok: false, kind: 'unavailable', code: 'CONFIG_UNAVAILABLE', commandId: 'c',
      error: 'relation "project_settings" boom', retryable: true })
    await click(button('저장된 양식 비우기')!)
    await click(button('비우기')!)
    expect(document.body.textContent).toContain(t('ko', 'common.err.tryAgain'))
    expect(document.body.textContent).not.toContain('boom')
  })
})
