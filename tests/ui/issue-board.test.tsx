// @vitest-environment jsdom
// 이슈 보드(SPU2 이월) — 열은 설정의 표시 상태, 카드 이동은 메뉴(전이표가 허용하는 상태만)이고 저장은 updateIssueProgress 한 길.
// 합성 구성 R 의 5상태를 쓴다 — 기본 4범주 열이 코드에 박혀 있으면 이 파일이 깨진다.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Issue } from '@/lib/domain/issues'
import { ISSUE_BOARD_PAGE } from '@/lib/domain/issueBoard'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({ update: vi.fn(), refresh: vi.fn() }))

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh, replace: vi.fn(), push: vi.fn() }) }))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ t: (key: string) => key }) }))
vi.mock('@/app/actions/issues', () => ({ updateIssueProgress: mocks.update }))

import { IssueBoard } from '@/components/issues/IssueBoard'
import { SEVERITIES } from '../fixtures/vocab'
import { RESEARCH_STATUSES, statusIssue } from '../fixtures/issue-statuses'

describe('IssueBoard', () => {
  let container: HTMLDivElement
  let root: Root
  const onOpen = vi.fn()

  beforeEach(() => {
    mocks.update.mockReset()
    mocks.refresh.mockReset()
    onOpen.mockReset()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  const render = (issues: Issue[], over: Partial<Parameters<typeof IssueBoard>[0]> = {}) => act(async () => {
    root.render(<IssueBoard issues={issues} statuses={RESEARCH_STATUSES} severities={SEVERITIES} areas={[]}
      assigneeLabel={() => null} today="2026-07-31" canMove onOpen={onOpen} {...over} />)
  })
  const column = (code: string) => container.querySelector<HTMLElement>(`[data-issue-column="${code}"]`)!
  const card = (id: string) => container.querySelector<HTMLElement>(`[data-issue-card="${id}"]`)!
  const openMenu = (id: string) => act(async () => card(id).querySelector<HTMLButtonElement>('[data-testid="issue-card-move-trigger"]')!.click())
  const menuItems = (id: string) => [...card(id).querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].map(b => b.textContent)

  it('열은 설정의 다섯 상태가 설정 순서로 — 라벨·건수·카드 위치', async () => {
    await render([statusIssue('a', 'intake'), statusIssue('b', 'client_approval'), statusIssue('c', 'client_approval')])
    expect([...container.querySelectorAll('[data-issue-column]')].map(el => el.getAttribute('data-issue-column')))
      .toEqual(['intake', 'review', 'client_approval', 'execution', 'done'])
    expect(column('client_approval').querySelector('h3')?.textContent).toContain('고객 승인')
    expect(column('client_approval').querySelector('[data-testid="issue-column-count"]')?.textContent).toBe('2')
    expect(column('client_approval').contains(card('b'))).toBe(true)
    expect(column('review').textContent).toContain('issue.board.empty')
  })

  it('카드에 코드·제목·심각도·담당자·영역·목표일을 그린다', async () => {
    await render([statusIssue('a', 'intake', { title: '납기 확인', severity: 'high', dueDate: '2026-08-10', areaId: 'ar1' })], {
      areas: [{ id: 'ar1', code: 'RND', name: '연구', sortOrder: 0, active: true }], assigneeLabel: () => '김담당',
    })
    const text = card('a').textContent
    for (const part of ['ISS-a', '납기 확인', 'issue.severity.high', '김담당', 'RND · 연구', '2026-08-10']) expect(text).toContain(part)
  })

  it('이동 메뉴는 전이표가 허용하는 상태만 보인다 — 종료에서 고객 승인으로는 갈 수 없다', async () => {
    await render([statusIssue('a', 'intake'), statusIssue('z', 'done')])
    expect(card('a').querySelector('[role="menu"]')).toBeNull()
    await openMenu('a')
    expect(menuItems('a')).toEqual(['검토', '고객 승인', '실행', '종료'])
    await openMenu('z')
    expect(menuItems('z')).toEqual(['접수', '검토', '실행'])
    // 메뉴는 한 번에 하나만 열린다
    expect(card('a').querySelector('[role="menu"]')).toBeNull()
  })

  it('조회 전용은 이동 메뉴가 없다', async () => {
    await render([statusIssue('a', 'intake')], { canMove: false })
    expect(container.querySelector('[data-testid="issue-card-move-trigger"]')).toBeNull()
    expect(card('a')).not.toBeNull()
  })

  it('메뉴에서 고르면 그 액션을 한 번 부른다 — 화면이 본 상태를 기준값으로', async () => {
    mocks.update.mockResolvedValue({ ok: true })
    await render([statusIssue('a', 'intake')])
    await openMenu('a')
    await act(async () => card('a').querySelector<HTMLButtonElement>('[data-testid="issue-card-move-client_approval"]')!.click())
    expect(mocks.update).toHaveBeenCalledTimes(1)
    expect(mocks.update).toHaveBeenCalledWith('a', { status: 'client_approval', expectedStatus: 'intake' })
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
    expect(card('a').querySelector('[role="alert"]')).toBeNull()
    expect(card('a').querySelector('[role="menu"]')).toBeNull()
  })

  it('서버가 전이를 거부하면 카드에 그 사유를 표시한다(성공으로 위장하지 않는다)', async () => {
    mocks.update.mockResolvedValue({ ok: false, error: '허용되지 않는 상태 전환입니다. 화면을 새로고침해 주세요.' })
    await render([statusIssue('a', 'intake')])
    await openMenu('a')
    await act(async () => card('a').querySelector<HTMLButtonElement>('[data-testid="issue-card-move-done"]')!.click())
    expect(card('a').querySelector('[role="alert"]')?.textContent).toContain('허용되지 않는 상태 전환입니다.')
    expect(mocks.refresh).not.toHaveBeenCalled()
    await act(async () => card('a').querySelector<HTMLButtonElement>('[aria-label="issue.board.dismiss"]')!.click())
    expect(card('a').querySelector('[role="alert"]')).toBeNull()
  })

  it('충돌이면 사유를 보이고 최신 상태를 받아 온다', async () => {
    mocks.update.mockResolvedValue({ ok: false, conflict: true, error: '다른 사용자가 먼저 변경했습니다.' })
    await render([statusIssue('a', 'intake')])
    await openMenu('a')
    await act(async () => card('a').querySelector<HTMLButtonElement>('[data-testid="issue-card-move-review"]')!.click())
    expect(card('a').querySelector('[role="alert"]')?.textContent).toContain('다른 사용자가 먼저 변경했습니다.')
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
  })

  it('응답을 받지 못해도 실패로 남긴다', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.update.mockRejectedValue(new Error('network'))
    await render([statusIssue('a', 'intake')])
    await openMenu('a')
    await act(async () => card('a').querySelector<HTMLButtonElement>('[data-testid="issue-card-move-review"]')!.click())
    expect(card('a').querySelector('[role="alert"]')?.textContent).toContain('issue.bulk.noResponse')
    quiet.mockRestore()
  })

  it('비활성 상태에 남은 이슈는 따로 열로 보이고, 그 열로 가는 선택지는 없다', async () => {
    const defs = RESEARCH_STATUSES.map(d => (d.code === 'review' ? { ...d, active: false } : d))
    await render([statusIssue('a', 'review'), statusIssue('b', 'intake')], { statuses: defs })
    expect(column('review').getAttribute('data-column-kind')).toBe('inactive')
    expect(column('review').textContent).toContain('issue.board.columnInactive')
    await openMenu('b')
    expect(menuItems('b')).toEqual(['고객 승인', '실행', '종료'])
    await openMenu('a')
    expect(menuItems('a')).toEqual(['접수', '고객 승인', '실행', '종료'])
  })

  it('열이 길면 상한까지만 그리고 더 보기로 늘린다', async () => {
    const many = Array.from({ length: ISSUE_BOARD_PAGE + 5 }, (_, i) => statusIssue(`n${i}`, 'execution'))
    await render(many)
    expect(column('execution').querySelectorAll('[data-issue-card]')).toHaveLength(ISSUE_BOARD_PAGE)
    expect(column('execution').querySelector('[data-testid="issue-column-count"]')?.textContent).toBe(String(ISSUE_BOARD_PAGE + 5))
    await act(async () => column('execution').querySelector<HTMLButtonElement>('[data-testid="issue-column-more"]')!.click())
    expect(column('execution').querySelectorAll('[data-issue-card]')).toHaveLength(ISSUE_BOARD_PAGE + 5)
    expect(column('execution').querySelector('[data-testid="issue-column-more"]')).toBeNull()
  })

  it('카드 본문을 누르면 상세를 연다 — 이동 메뉴 버튼은 상세를 열지 않는다', async () => {
    await render([statusIssue('a', 'intake')])
    await openMenu('a')
    expect(onOpen).not.toHaveBeenCalled()
    await act(async () => card('a').querySelector<HTMLElement>('[role="button"]')!.click())
    expect(onOpen).toHaveBeenCalledWith('a')
  })

  it('Esc 로 메뉴를 닫는다', async () => {
    await render([statusIssue('a', 'intake')])
    await openMenu('a')
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    expect(card('a').querySelector('[role="menu"]')).toBeNull()
  })
})
