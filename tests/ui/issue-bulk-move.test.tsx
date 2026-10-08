// @vitest-environment jsdom
// 이슈 목록의 보기 전환·다중 선택·상태 일괄 이동(SPU2·SPU3 이월). 미리보기(가능·불가) → 건별 실행 → 항목별 결과 → 실패한 건만 재시도.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Issue } from '@/lib/domain/issues'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({ update: vi.fn(), refresh: vi.fn(), replace: vi.fn(), search: '' }))

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(mocks.search),
  useRouter: () => ({ replace: mocks.replace, push: vi.fn(), refresh: mocks.refresh }),
  usePathname: () => '/p/p1/issues',
}))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ locale: 'ko', t: (key: string) => key }) }))
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))
vi.mock('@/app/actions/issues', () => ({ updateIssueProgress: mocks.update }))
vi.mock('@/components/issues/IssueModals', () => ({
  DeleteIssueModal: () => null, IssueFormModal: () => null,
  IssueDetailModal: ({ issue }: { issue: Issue | null }) => (issue ? <div data-detail={issue.id} /> : null),
}))
vi.mock('@/components/issues/IssueAnalysisModal', () => ({ IssueAnalysisModal: () => null }))

import { IssuesView } from '@/components/issues/IssuesView'
import { TEST_ENTRY_CONTEXT } from '../fixtures/issue-areas'
import { SEVERITIES, SOURCES } from '../fixtures/vocab'
import { RESEARCH_STATUSES, statusIssue } from '../fixtures/issue-statuses'

describe('IssuesView — 보기 전환·일괄 상태 이동', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    mocks.update.mockReset()
    mocks.refresh.mockReset()
    mocks.replace.mockReset()
    mocks.search = ''
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  const render = (issues: Issue[], canEdit = true) => act(async () => {
    root.render(<IssuesView entryContext={TEST_ENTRY_CONTEXT} timeZone="Asia/Seoul" projectId="project-1" currentUserId="user-1"
      canEdit={canEdit} isProjectAdmin={false} myMemberIds={[]} today="2026-07-31" members={[]}
      issues={issues} severities={SEVERITIES} sources={SOURCES} statuses={RESEARCH_STATUSES} />)
  })
  const q = <T extends HTMLElement>(sel: string) => document.body.querySelector<T>(sel)
  const click = (sel: string) => act(async () => q<HTMLElement>(sel)!.click())
  const select = (id: string) => act(async () => {
    const row = [...container.querySelectorAll('tbody tr')].find(tr => tr.textContent?.includes(`ISS-${id}`))!
    row.querySelector<HTMLInputElement>('[data-testid="issue-select"]')!.click()
  })
  const chooseTarget = (code: string) => act(async () => {
    const el = q<HTMLSelectElement>('[data-testid="issue-bulk-target"]')!
    el.value = code
    el.dispatchEvent(new Event('change', { bubbles: true }))
  })
  const rowState = (id: string) => q(`[data-bulk-row="${id}"]`)?.getAttribute('data-bulk-state')

  it('보기 전환 — 보드를 누르면 보드를 그리고 URL 에 ?view=board 를 남긴다', async () => {
    await render([statusIssue('a', 'intake')])
    expect(container.querySelector('table')).not.toBeNull()
    expect(container.querySelector('[data-issue-board]')).toBeNull()
    const boardTab = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(b => b.textContent?.includes('issue.view.board'))!
    await act(async () => boardTab.click())
    expect(container.querySelector('[data-issue-board]')).not.toBeNull()
    expect(container.querySelector('table')).toBeNull()
    expect(mocks.replace).toHaveBeenCalledWith('/p/p1/issues?view=board', { scroll: false })
  })

  it('?view=board 로 들어오면 보드, 다른 쿼리는 목록으로 돌아갈 때 남긴다', async () => {
    mocks.search = 'view=board&x=1'
    await render([statusIssue('a', 'intake')])
    expect(container.querySelector('[data-issue-board]')).not.toBeNull()
    const listTab = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(b => b.textContent?.includes('issue.view.list'))!
    await act(async () => listTab.click())
    expect(mocks.replace).toHaveBeenCalledWith('/p/p1/issues?x=1', { scroll: false })
  })

  it('목록의 필터는 보드에도 적용된다', async () => {
    mocks.search = 'view=board'
    await render([statusIssue('a', 'intake', { severity: 'high' }), statusIssue('b', 'intake', { severity: 'low' })])
    expect(container.querySelectorAll('[data-issue-card]')).toHaveLength(2)
    const high = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(b => b.textContent === 'issue.severity.high')!
    await act(async () => high.click())
    expect([...container.querySelectorAll('[data-issue-card]')].map(el => el.getAttribute('data-issue-card'))).toEqual(['a'])
  })

  it('조회 전용에게는 선택 칸이 없다', async () => {
    await render([statusIssue('a', 'intake')], false)
    expect(container.querySelector('[data-testid="issue-select"]')).toBeNull()
    expect(container.querySelector('[data-testid="issue-select-page"]')).toBeNull()
    expect(container.querySelector('[data-testid="issue-bulk-bar"]')).toBeNull()
  })

  it('선택 칸을 눌러도 상세가 열리지 않고 선택 바가 건수를 보인다', async () => {
    await render([statusIssue('a', 'intake'), statusIssue('b', 'review')])
    expect(container.querySelector('[data-testid="issue-bulk-bar"]')).toBeNull()
    await select('a')
    expect(container.querySelector('[data-detail]')).toBeNull()
    expect(container.querySelector('[data-testid="issue-bulk-count"]')?.textContent).toBe('issue.bulk.selected')
    // 대조: 행 자체를 누르면 상세가 열린다
    await act(async () => container.querySelector<HTMLElement>('tbody tr')!.click())
    expect(container.querySelector('[data-detail]')).not.toBeNull()
    await click('[data-testid="issue-select-page"]')
    expect(container.querySelectorAll<HTMLInputElement>('[data-testid="issue-select"]:checked')).toHaveLength(2)
    await click('[data-testid="issue-select-page"]')
    expect(container.querySelector('[data-testid="issue-bulk-bar"]')).toBeNull()
  })

  it('미리보기가 가능·불가를 나누고, 실행은 가능한 건만 그 액션으로 한 번씩 보낸다', async () => {
    mocks.update.mockResolvedValue({ ok: true })
    await render([statusIssue('a', 'intake'), statusIssue('b', 'done'), statusIssue('c', 'client_approval')])
    for (const id of ['a', 'b', 'c']) await select(id)
    await click('[data-testid="issue-bulk-open"]')
    expect(q<HTMLButtonElement>('[data-testid="issue-bulk-run"]')!.disabled).toBe(true)
    // 선택지는 설정의 활성 상태 전부(설정 순서)
    expect([...q('[data-testid="issue-bulk-target"]')!.querySelectorAll('option')].map(o => o.value))
      .toEqual(['', 'intake', 'review', 'client_approval', 'execution', 'done'])
    await chooseTarget('client_approval')
    expect([rowState('a'), rowState('b'), rowState('c')]).toEqual(['movable', 'skipped', 'skipped'])
    expect(q('[data-bulk-row="b"]')?.textContent).toContain('issue.bulk.reason.not_allowed')
    expect(q('[data-bulk-row="c"]')?.textContent).toContain('issue.bulk.reason.same')
    expect(mocks.update).not.toHaveBeenCalled()

    await click('[data-testid="issue-bulk-run"]')
    expect(mocks.update.mock.calls).toEqual([['a', { status: 'client_approval', expectedStatus: 'intake' }]])
    expect([rowState('a'), rowState('b'), rowState('c')]).toEqual(['ok', 'skipped', 'skipped'])
    expect(q('[data-testid="issue-bulk-summary"]')).not.toBeNull()
    expect(q('[data-testid="issue-bulk-retry"]')).toBeNull()
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
  })

  it('항목별 결과에 거부 사유를 보이고, 재시도는 실패한 건만 다시 보낸다', async () => {
    mocks.update
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, error: '허용되지 않는 상태 전환입니다.' })
      .mockResolvedValueOnce({ ok: true })
    await render([statusIssue('a', 'intake'), statusIssue('b', 'review'), statusIssue('c', 'client_approval')])
    for (const id of ['a', 'b', 'c']) await select(id)
    await click('[data-testid="issue-bulk-open"]')
    await chooseTarget('execution')
    await click('[data-testid="issue-bulk-run"]')
    expect(mocks.update).toHaveBeenCalledTimes(3)
    const failed = mocks.update.mock.calls[1][0] as string
    expect(rowState(failed)).toBe('failed')
    expect(q(`[data-bulk-row="${failed}"]`)?.textContent).toContain('허용되지 않는 상태 전환입니다.')
    expect(['a', 'b', 'c'].filter(id => rowState(id) === 'ok')).toHaveLength(2)

    mocks.update.mockResolvedValueOnce({ ok: true })
    await click('[data-testid="issue-bulk-retry"]')
    expect(mocks.update).toHaveBeenCalledTimes(4)
    expect(mocks.update.mock.calls[3][0]).toBe(failed)
    expect(['a', 'b', 'c'].map(rowState)).toEqual(['ok', 'ok', 'ok'])
    expect(q('[data-testid="issue-bulk-retry"]')).toBeNull()
  })

  it('재시도 전에 상태가 이미 바뀌어 있으면 다시 보내지 않는다', async () => {
    mocks.update.mockResolvedValueOnce({ ok: false, conflict: true, error: '다른 사용자가 먼저 변경했습니다.' })
    await render([statusIssue('a', 'intake')])
    await select('a')
    await click('[data-testid="issue-bulk-open"]')
    await chooseTarget('execution')
    await click('[data-testid="issue-bulk-run"]')
    expect(rowState('a')).toBe('failed')
    // 새로고침으로 최신 목록이 왔다 — 다른 사람이 이미 실행으로 옮겨 놓았다
    await render([statusIssue('a', 'execution')])
    await click('[data-testid="issue-bulk-retry"]')
    expect(mocks.update).toHaveBeenCalledTimes(1)
    expect(rowState('a')).toBe('ok')
  })

  it('필터로 가려진 선택은 일괄 이동 대상에서 빠진다', async () => {
    await render([statusIssue('a', 'intake', { severity: 'high' }), statusIssue('b', 'intake', { severity: 'low' })])
    await select('a'); await select('b')
    const high = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(b => b.textContent === 'issue.severity.high')!
    await act(async () => high.click())
    await click('[data-testid="issue-bulk-open"]')
    await chooseTarget('review')
    expect(rowState('a')).toBe('movable')
    expect(q('[data-bulk-row="b"]')).toBeNull()
  })
})
