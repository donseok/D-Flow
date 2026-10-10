// 사용자 테스트 BUG-11 — 이슈 등록 검증 오류가 모달 맨 아래(첨부 영역 밑)에 숨어 저장 버튼이 먹통처럼 보였다.
// 오류는 그 칸 바로 아래에 보이고, 그 칸으로 스크롤·초점이 간다. 칸을 고치면 그 오류는 사라진다. 필수(제목)가 비면 저장이 비활성이다.
// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TEST_ENTRY_CONTEXT } from '../fixtures/issue-areas'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }), usePathname: () => '/p/p1/issues' }))
vi.mock('@/components/providers/LocaleProvider', async () => (await import('../helpers/locale-mock')).koLocale())
vi.mock('@/app/actions/issues', () => ({
  createIssue: vi.fn(async () => ({ ok: true, id: 'i1' })), updateIssue: vi.fn(async () => ({ ok: true })),
  updateIssueProgress: vi.fn(async () => ({ ok: true })), deleteIssue: vi.fn(async () => ({ ok: true })),
  fetchIssueMajorProcesses: vi.fn(async () => ({ ok: true, majors: [] })),
}))
vi.mock('@/app/actions/issueUpdates', () => ({
  listIssueUpdates: vi.fn(async () => ({ ok: true, items: [] })), addIssueUpdate: vi.fn(async () => ({ ok: true })),
  archiveIssueUpdate: vi.fn(async () => ({ ok: true })), unarchiveIssueUpdate: vi.fn(async () => ({ ok: true })), purgeIssueUpdate: vi.fn(async () => ({ ok: true })),
}))

import { IssueFormModal } from '@/components/issues/IssueModals'

describe('[BUG-11] IssueFormModal — 검증 오류는 그 칸 아래에, 그 칸으로 스크롤·초점', () => {
  let container: HTMLDivElement, root: Root
  const onCreate = vi.fn(async () => ({ ok: true as const, id: 'i1' }))
  const scrolled: Element[] = []
  beforeEach(() => {
    onCreate.mockClear(); scrolled.length = 0
    Element.prototype.scrollIntoView = function scrollIntoView(this: Element) { scrolled.push(this) }
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
  })
  afterEach(() => { act(() => root.unmount()); container.remove(); document.body.querySelectorAll('[role="dialog"]').forEach(n => n.remove()) })

  async function open(draft: Record<string, unknown>) {
    await act(async () => {
      root.render(<IssueFormModal open onClose={() => {}} projectId="p1" workspaceId={null} initial={null} members={[]}
        entryContext={TEST_ENTRY_CONTEXT} draft={draft as never} onCreate={onCreate} />)
    })
  }
  const saveButton = () => [...document.querySelectorAll('button')].find(b => b.textContent === '저장') as HTMLButtonElement
  const field = (name: string) => document.querySelector<HTMLElement>(`[data-issue-field="${name}"]`)!
  const type = (el: HTMLInputElement, value: string) => act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })

  it('제목이 비면 저장 버튼이 비활성이다(다른 모달과 같은 관용구) — 공백만 넣어도 비활성', async () => {
    await open({ title: '' })
    expect(saveButton().disabled).toBe(true)
    type(field('title') as HTMLInputElement, '   ')
    expect(saveButton().disabled).toBe(true)
    type(field('title') as HTMLInputElement, '로그인 오류')
    expect(saveButton().disabled).toBe(false)
  })

  it('기간 역전 — 오류가 날짜 칸 바로 아래에 뜨고 시작일 칸으로 스크롤·초점, 아래 알림 상자는 없다', async () => {
    await open({ title: '기간 확인', startDate: '2026-12-01', dueDate: '2026-11-01' })
    act(() => saveButton().click())
    expect(onCreate).not.toHaveBeenCalled()
    const alert = document.querySelector('[role="alert"]')!
    expect(alert.textContent).toBe('시작일은 목표 해결일보다 늦을 수 없습니다.')
    // 날짜 격자 바로 다음 형제다 — 첨부 영역 아래가 아니다
    expect(alert.previousElementSibling?.contains(field('dates'))).toBe(true)
    expect(document.querySelector('[data-issue-error]')).toBeNull()
    expect(scrolled).toContain(field('dates'))
    expect(document.activeElement).toBe(field('dates'))
    expect(field('dates').getAttribute('aria-invalid')).toBe('true')
  })

  it('그 칸을 고치면 그 칸의 오류가 사라진다', async () => {
    await open({ title: '기간 확인', startDate: '2026-12-01', dueDate: '2026-11-01' })
    act(() => saveButton().click())
    expect(document.querySelector('[role="alert"]')).not.toBeNull()
    type(field('dates') as HTMLInputElement, '2026-10-01')
    expect(document.querySelector('[role="alert"]')).toBeNull()
  })

  it('칸을 모르는 오류(서버 거부)는 아래 알림 상자에 뜨고 그 상자로 스크롤한다', async () => {
    onCreate.mockResolvedValueOnce({ ok: false, error: '저장하지 못했습니다' } as never)
    await open({ title: '서버 거부' })
    await act(async () => { saveButton().click() })
    const box = document.querySelector('[data-issue-error]')!
    expect(box.textContent).toContain('저장하지 못했습니다')
    expect(scrolled).toContain(box)
  })
})
