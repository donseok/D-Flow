// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Modal } from '@/components/ui/Modal'
import { escStack, ESC_PRIORITY } from '@/lib/ui/escStack'

vi.mock('@/components/providers/LocaleProvider', async () => {
  const { t } = await import('@/lib/i18n/dict')
  const ko = (k: string) => t('ko', k as Parameters<typeof t>[1])   // 렌더마다 같은 함수(effect 의존성 안정)
  return { useLocale: () => ({ locale: 'ko', t: ko, setLocale: () => {} }) }
})

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  escStack.clear()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  // document.body 포털 정리
  document.body.innerHTML = ''
})

describe('Modal & Dirty Guard (D6-§7-exit)', () => {
  it('dirty=false일 때 Esc를 누르면 즉시 onClose가 호출된다', async () => {
    const onClose = vi.fn()
    await act(async () => {
      root.render(
        <Modal open onClose={onClose} title="테스트 모달">
          내용
        </Modal>
      )
    })

    expect(onClose).not.toHaveBeenCalled()
    await act(async () => {
      escStack.dispatch()
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('dirty=true일 때 Esc를 누르면 즉시 닫히지 않고 DirtyConfirmDialog가 열린다', async () => {
    const onClose = vi.fn()
    await act(async () => {
      root.render(
        <Modal open dirty onClose={onClose} title="테스트 모달">
          수정 중인 내용
        </Modal>
      )
    })

    // Esc 입력
    await act(async () => {
      escStack.dispatch()
    })
    // onClose는 아직 호출되지 않음
    expect(onClose).not.toHaveBeenCalled()

    // alertdialog가 DOM에 렌더링되었는지 확인
    const dialog = document.body.querySelector('[role="alertdialog"]')
    expect(dialog).not.toBeNull()
    expect(dialog?.textContent).toContain('저장되지 않은 변경사항')
  })

  it('DirtyConfirmDialog에서 "계속 편집"을 누르면 확인창만 닫히고 모달은 유지된다', async () => {
    const onClose = vi.fn()
    await act(async () => {
      root.render(
        <Modal open dirty onClose={onClose} title="테스트 모달">
          수정 중인 내용
        </Modal>
      )
    })

    // Esc로 확인창 열기
    await act(async () => {
      escStack.dispatch()
    })

    const continueBtn = Array.from(document.body.querySelectorAll('button')).find(
      (btn) => btn.textContent?.includes('계속 편집')
    )
    expect(continueBtn).toBeDefined()

    await act(async () => {
      continueBtn?.click()
    })

    // 확인창 닫힘, 모달 onClose 미호출
    expect(document.body.querySelector('[role="alertdialog"]')).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('DirtyConfirmDialog에서 "변경사항 버리기"를 누르면 onClose가 호출된다', async () => {
    const onClose = vi.fn()
    await act(async () => {
      root.render(
        <Modal open dirty onClose={onClose} title="테스트 모달">
          수정 중인 내용
        </Modal>
      )
    })

    // Esc로 확인창 열기
    await act(async () => {
      escStack.dispatch()
    })

    const discardBtn = Array.from(document.body.querySelectorAll('button')).find(
      (btn) => btn.textContent?.includes('변경사항 버리기')
    )
    expect(discardBtn).toBeDefined()

    await act(async () => {
      discardBtn?.click()
    })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('모달 내부에 Picker(우선순위 높음)가 열려 있을 때 Esc를 누르면 모달 대신 Picker가 먼저 닫힌다', async () => {
    const onModalClose = vi.fn()
    const onPickerClose = vi.fn()

    await act(async () => {
      root.render(
        <Modal open onClose={onModalClose} title="테스트 모달">
          내용
        </Modal>
      )
    })

    // 하위 피커 등록 (예: 날짜선택기)
    const unregisterPicker = escStack.register({
      priority: ESC_PRIORITY.PICKER,
      handler: onPickerClose,
    })

    // 첫 번째 Esc -> Picker만 닫힘
    await act(async () => {
      escStack.dispatch()
    })
    expect(onPickerClose).toHaveBeenCalledTimes(1)
    expect(onModalClose).not.toHaveBeenCalled()

    unregisterPicker()

    // 두 번째 Esc -> 모달 닫힘
    await act(async () => {
      escStack.dispatch()
    })
    expect(onModalClose).toHaveBeenCalledTimes(1)
  })
})
