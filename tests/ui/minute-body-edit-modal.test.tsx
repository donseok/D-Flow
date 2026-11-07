// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Minute } from '@/lib/domain/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
const mocks = vi.hoisted(() => ({ save: vi.fn(), toast: vi.fn() }))
vi.mock('@/app/actions/minutes', () => ({ replaceMinuteBody: mocks.save }))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ t: (k: string) => k }) }))
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
import { MinuteBodyEditModal } from '@/components/minutes/MinuteBodyEditModal'

const minute = { id: 'm1', bodyMd: '# 기존 회의록' } as Minute
let root: Root
let container: HTMLDivElement
const onClose = vi.fn()
const onSaved = vi.fn()
const saveButton = () => [...document.querySelectorAll('button')].find(b => b.textContent === 'min.meta.save')!
async function edit(text: string) {
  await act(async () => {
    const input = document.querySelector('textarea')!
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
beforeEach(async () => {
  vi.clearAllMocks()
  mocks.save.mockResolvedValue({ ok: true })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root.render(<MinuteBodyEditModal minute={minute} onClose={onClose} onSaved={onSaved} />))
})
afterEach(() => { act(() => root.unmount()); container.remove() })

describe('회의록 본문 직접 수정', () => {
  it('기존 본문을 불러오고 수정한 내용만 새 버전으로 저장한다', async () => {
    expect(document.querySelector('textarea')!.value).toBe(minute.bodyMd)
    expect(saveButton().disabled).toBe(true)
    await edit('# 수정한 회의록')
    await act(async () => saveButton().click())
    expect(mocks.save).toHaveBeenCalledWith('m1', '# 수정한 회의록')
    expect(onSaved).toHaveBeenCalledOnce()
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'success' }))
  })

  it('저장 실패 시 입력을 유지하고 재시도할 수 있다', async () => {
    mocks.save.mockResolvedValueOnce({ ok: false, error: '권한 없음' })
    await edit('수정 내용')
    await act(async () => saveButton().click())
    expect(document.querySelector('[role="alert"]')!.textContent).toBe('권한 없음')
    expect(document.querySelector('textarea')!.value).toBe('수정 내용')
    expect(onSaved).not.toHaveBeenCalled()
    await act(async () => saveButton().click())
    expect(onSaved).toHaveBeenCalledOnce()
  })

  it('네트워크 예외에도 저장 버튼과 입력을 복구한다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.save.mockRejectedValueOnce(new Error('offline'))
    await edit('수정 내용')
    await act(async () => saveButton().click())
    expect(document.querySelector('[role="alert"]')!.textContent).toBe('min.body.saveFailed')
    expect(saveButton().disabled).toBe(false)
    expect(document.querySelector('textarea')!.disabled).toBe(false)
    spy.mockRestore()
  })

  it('최대 글자 수 초과 시 저장을 막고 사유를 표시한다', async () => {
    await edit('가'.repeat(100_001))
    expect(saveButton().disabled).toBe(true)
    expect(document.querySelector('[role="alert"]')!.textContent).toBe('min.body.tooLong')
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('수정한 채 닫으면 변경 사항을 버릴지 확인한다', async () => {
    await edit('저장 전 내용')
    const close = document.querySelector<HTMLButtonElement>('button[aria-label="common.close"]')!
    await act(async () => close.click())
    expect(onClose).not.toHaveBeenCalled()
    expect(document.querySelectorAll('[role="dialog"], [role="alertdialog"]').length).toBe(2)
  })
})
