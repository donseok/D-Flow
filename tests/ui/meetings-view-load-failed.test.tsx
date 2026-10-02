// @vitest-environment jsdom
// 회의 목록 조회 실패(최종 리뷰 UI I-2) — 화면 머리에 '불러오지 못했습니다' 를 띄우면서 목록 탭 본문에
// '등록된 회의가 없습니다' 빈 상태를 같이 그리면 서로 모순이고, 조회 실패를 '없음'으로 위장한다(에러 처리 3원칙 ①).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ locale: 'ko', t: (k: string) => k }) }))
vi.mock('@/components/chat/BotPageContextProvider', () => ({ useBotPageContext: vi.fn() }))
vi.mock('@/components/meetings/MeetingCalendar', () => ({ MeetingCalendar: () => <div data-testid="calendar" /> }))
vi.mock('@/components/meetings/MeetingFormModal', () => ({ MeetingFormModal: () => null }))
vi.mock('@/components/meetings/MeetingDetailModal', () => ({ MeetingDetailModal: () => null }))

import { MeetingsView } from '@/components/meetings/MeetingsView'
import { SUNDAY_CAL } from '../fixtures/calendarView'

let container: HTMLDivElement, root: Root
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container) })
afterEach(() => { act(() => root.unmount()); container.remove() })

async function openList(loadFailed?: boolean) {
  await act(async () => {
    root.render(<MeetingsView calendar={SUNDAY_CAL} projectId="p1" meetings={[]} exceptions={[]} members={[]} todayIso="2026-09-27"
      currentUserId="u1" canManage={false} canEdit {...(loadFailed === undefined ? {} : { loadFailed })} />)
  })
  const listTab = [...container.querySelectorAll('button[role="tab"]')].find(b => b.textContent === 'meet.view.list')!
  await act(async () => { (listTab as HTMLButtonElement).click() })
}

describe('MeetingsView — 목록 조회 실패', () => {
  it('loadFailed 면 목록 탭에 빈 상태(등록된 회의가 없습니다)를 그리지 않는다', async () => {
    await openList(true)
    expect(container.textContent).not.toContain('meet.empty.title')
    expect(container.textContent).not.toContain('meet.empty.desc')
  })

  it('조회 성공 + 회의 0건이면 종전대로 빈 상태', async () => {
    await openList()
    expect(container.textContent).toContain('meet.empty.title')
  })
})
