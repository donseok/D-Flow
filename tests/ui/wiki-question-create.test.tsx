// @vitest-environment jsdom
// 위키 주제의 질문 남기기 — createWikiQuestion 을 부르는 화면(답변 폼만 있고 질문을 만드는 길이 없던 것을 잇는다).
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({ create: vi.fn(), refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh, push: vi.fn() }) }))
vi.mock('@/app/actions/wiki', () => ({ createWikiQuestion: mocks.create }))

import { WikiQuestionCreateForm } from '@/components/wiki/WikiQuestionCreateForm'

describe('WikiQuestionCreateForm', () => {
  let container: HTMLDivElement
  let root: Root
  beforeEach(async () => {
    mocks.create.mockReset()
    mocks.refresh.mockReset()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => { root.render(<WikiQuestionCreateForm projectId="project-1" topicId="topic-1" locale="ko" />) })
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  const q = <T extends HTMLElement>(sel: string) => container.querySelector<T>(sel)
  const openForm = () => act(async () => q<HTMLButtonElement>('[data-testid="wiki-question-open"]')!.click())
  const type = (text: string) => act(async () => {
    const el = q<HTMLTextAreaElement>('textarea')!
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, text)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const submit = () => act(async () => q<HTMLButtonElement>('[data-testid="wiki-question-submit"]')!.click())

  it('처음에는 버튼만 — 누르면 입력란이 열리고, 빈 질문은 보낼 수 없다', async () => {
    expect(q('textarea')).toBeNull()
    expect(q('[data-testid="wiki-question-open"]')?.textContent).toContain('질문으로 남기기')
    await openForm()
    expect(q('textarea')).not.toBeNull()
    expect(q<HTMLButtonElement>('[data-testid="wiki-question-submit"]')!.disabled).toBe(true)
    await type('   ')
    expect(q<HTMLButtonElement>('[data-testid="wiki-question-submit"]')!.disabled).toBe(true)
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('등록은 그 주제를 달아 액션을 한 번 부르고, 성공하면 닫고 새로 읽는다', async () => {
    mocks.create.mockResolvedValue({ ok: true, questionId: 'q1' })
    await openForm()
    await type('  승인 기준은 누가 정하나요?  ')
    await submit()
    expect(mocks.create).toHaveBeenCalledTimes(1)
    expect(mocks.create).toHaveBeenCalledWith({ projectId: 'project-1', topicId: 'topic-1', question: '승인 기준은 누가 정하나요?' })
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
    expect(q('textarea')).toBeNull()
  })

  it('거부(권한·모듈 꺼짐·길이)는 사유를 보이고 입력을 지우지 않는다', async () => {
    mocks.create.mockResolvedValue({ ok: false, error: '프로젝트 구성원만 할 수 있습니다.' })
    await openForm()
    await type('질문')
    await submit()
    expect(q('[role="alert"]')?.textContent).toBe('프로젝트 구성원만 할 수 있습니다.')
    expect(q<HTMLTextAreaElement>('textarea')!.value).toBe('질문')
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it('응답을 받지 못해도 실패로 남기고 다시 보낼 수 있다', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.create.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({ ok: true })
    await openForm()
    await type('질문')
    await submit()
    expect(q('[role="alert"]')?.textContent).toContain('질문을 남기지 못했습니다')
    await submit()
    expect(mocks.create).toHaveBeenCalledTimes(2)
    expect(q('textarea')).toBeNull()
    quiet.mockRestore()
  })
})
