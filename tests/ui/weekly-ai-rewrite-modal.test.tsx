// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
  WeeklyAiRewriteModal, type WeeklyAiRewriteItem,
} from '@/components/weekly/WeeklyAiRewriteModal'

// 화면 문구는 사전에서 온다 — 진짜 ko 사전으로 풀어 한국어 단언을 그대로 둔다
vi.mock('@/components/providers/LocaleProvider', async () => {
  const { t } = await import('@/lib/i18n/dict')
  const ko = (k: string) => t(k as Parameters<typeof t>[0])   // 렌더마다 같은 함수(effect 의존성 안정)
  return { useLocale: () => ({ t: ko }) }
})

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const items: WeeklyAiRewriteItem[] = [
  {
    rowId: 'r1', cellKey: 'this_content', section: '홍보', label: '금주실적 내용',
    original: '매출 자료 정리함', content: '매출 자료를 정리했습니다.',
  },
  {
    rowId: 'r2', cellKey: 'this_issue', section: '검수', label: '금주 이슈·이벤트',
    original: '검수 지연 없음', content: '검수 지연 없음',
  },
]

function typeText(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!
  setter.call(textarea, value)
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('WeeklyAiRewriteModal', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    document.body.innerHTML = ''
  })

  it('원문과 AI 제안을 비교하고, 선택해 수정한 변경만 적용한다', () => {
    const onApply = vi.fn()
    act(() => root.render(
      <WeeklyAiRewriteModal
        open busy={false} error={null} items={items}
        onClose={vi.fn()} onRetry={vi.fn()} onApply={onApply}
      />,
    ))

    expect(document.body.textContent).toContain('매출 자료 정리함')
    expect(document.body.textContent).toContain('매출 자료를 정리했습니다.')
    expect(document.body.textContent).toContain('변경 없음')
    // 안내 문구는 화면 머리·라벨과 같은 낱말 — '구분' 이 아니라 업무영역(A1-4 리뷰 P6)
    expect(document.body.textContent).toContain('선택한 내용과 업무영역 이름만 AI에 보내')
    expect(document.body.textContent).not.toContain('구분 정보')

    const first = document.querySelector<HTMLInputElement>('[aria-label="홍보 금주실적 내용 제안 선택"]')!
    const second = document.querySelector<HTMLInputElement>('[aria-label="검수 금주 이슈·이벤트 제안 선택"]')!
    expect(first.checked).toBe(true)
    expect(second.checked).toBe(false)

    const secondDraft = document.querySelector<HTMLTextAreaElement>('[aria-label="검수 금주 이슈·이벤트 AI 제안"]')!
    act(() => typeText(secondDraft, '검수 지연은 없습니다.'))
    expect(second.checked).toBe(true)
    act(() => typeText(secondDraft, '검수 지연 없음'))
    expect(second.checked).toBe(false)
    act(() => typeText(secondDraft, '검수 지연은 없습니다.'))
    expect(second.checked).toBe(true)

    act(() => first.click())
    const apply = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.includes('선택한 제안 적용'))!
    act(() => apply.click())

    expect(onApply).toHaveBeenCalledWith([
      { rowId: 'r2', cellKey: 'this_issue', original: '검수 지연 없음', content: '검수 지연은 없습니다.' },
    ])
  })

  it('로딩과 오류를 알리고 다시 생성할 수 있으며 로딩 중 적용하지 않는다', () => {
    const onRetry = vi.fn()
    const onApply = vi.fn()
    const onClose = vi.fn()
    act(() => root.render(
      <WeeklyAiRewriteModal
        open busy error={null} items={[]}
        onClose={onClose} onRetry={onRetry} onApply={onApply}
      />,
    ))
    expect(document.body.textContent).toContain('깔끔하게 다듬고 있습니다')
    const applyWhileBusy = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.includes('선택한 제안 적용'))!
    expect(applyWhileBusy.disabled).toBe(true)
    const cancel = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent === '취소')!
    act(() => cancel.click())
    expect(onClose).toHaveBeenCalledTimes(1)

    act(() => root.render(
      <WeeklyAiRewriteModal
        open busy={false} error="AI 응답 오류" items={[]}
        onClose={vi.fn()} onRetry={onRetry} onApply={onApply}
      />,
    ))
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('AI 응답 오류')
    const retry = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent === '다시 생성')!
    act(() => retry.click())
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(onApply).not.toHaveBeenCalled()
  })
})
