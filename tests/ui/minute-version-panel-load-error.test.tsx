// @vitest-environment jsdom
// 버전 목록 조회 실패(T18 리뷰 carry k) — 패널이 사라지면 '버전 없음'으로 보인다. 제목을 남기고 LoadErrorNotice 로 사유와
// 재시도를 보인다. 독립 카드(과거 버전 열람)는 기본 접힘이지만 사유는 접힘과 무관하게 보인다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Minute } from '@/lib/domain/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }))
vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ t: (k: string) => k, locale: 'ko' }),
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    <a href={href} {...props}>{children}</a>,
}))
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))
vi.mock('@/components/minutes/MarkdownView', () => ({ MarkdownView: () => null }))
// 핵심 요약 카드는 접힘 영역(details)만 그대로 그린다 — 현재 버전 화면의 버전 패널이 거기 있다.
vi.mock('@/components/minutes/MinuteInsightCard', () => ({
  MinuteInsightCard: ({ details }: { details: React.ReactNode }) => <div data-testid="insight-details">{details}</div>,
}))
vi.mock('@/components/minutes/MinuteToc', () => ({ MinuteToc: () => null }))
vi.mock('@/components/minutes/MinuteChatPanel', () => ({ MinuteChatPanel: () => null }))
vi.mock('@/components/minutes/MinuteMetaModal', () => ({ MinuteMetaModal: () => null }))
vi.mock('@/components/minutes/MinuteShareModal', () => ({ MinuteShareModal: () => null }))
vi.mock('@/components/minutes/MinuteBlockPopover', () => ({ MinuteBlockPopover: () => null }))
vi.mock('@/components/minutes/MinuteWikiImpactCard', () => ({ MinuteWikiImpactCard: () => null }))

import { MinuteVersionPanel } from '@/components/minutes/MinuteVersionPanel'
import { MinuteViewer } from '@/components/minutes/MinuteViewer'

const minute: Minute = {
  id: 'm1', minuteDate: '2026-07-24', teamCode: '팀A', title: 'Acme 주간 회의',
  bodyMd: '본문', meetingId: null, createdBy: 'u1', createdByName: 'alice',
  createdAt: '2026-07-24T00:00:00Z', updatedAt: '2026-07-24T00:00:00Z',
}

class IntersectionObserverStub {
  observe() {}
  disconnect() {}
}

let container: HTMLDivElement, root: Root
beforeEach(() => {
  ;(globalThis as Record<string, unknown>).IntersectionObserver = IntersectionObserverStub
  refresh.mockClear()
  container = document.createElement('div'); document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove() })

const notice = () => container.querySelector('[data-load-error]')

describe('MinuteVersionPanel — loadError', () => {
  it.each([true, false])('embedded=%s: 제목과 LoadErrorNotice(사유·재시도)를 보이고 목록은 없다', (embedded) => {
    act(() => root.render(<MinuteVersionPanel versions={[]} embedded={embedded} loadError="버전 목록 실패" />))
    expect(container.textContent).toContain('min.version.title')
    expect(notice()?.getAttribute('role')).toBe('alert')
    expect(notice()?.textContent).toContain('버전 목록 실패')
    expect(container.querySelector('ul')).toBeNull()
    act(() => { container.querySelector<HTMLButtonElement>('[data-load-error] button')!.click() })
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('대조: loadError 가 없고 버전도 없으면 아무것도 그리지 않는다', () => {
    act(() => root.render(<MinuteVersionPanel versions={[]} embedded />))
    expect(container.innerHTML).toBe('')
  })
})

describe('MinuteViewer — versionsError', () => {
  function render(props: { versionsError?: string | null; historicalVersion?: { id: string; versionNo: number } | null }) {
    act(() => root.render(
      <MinuteViewer minute={minute} files={[]} canManage={false}
        annotations={{ highlights: [], insights: [] }} userId="u1" projects={[]} versions={[]}
        {...props} />,
    ))
  }

  it('현재 버전 화면 — 핵심 요약의 버전 패널 자리에 i18n 사유를 보인다', () => {
    render({ versionsError: '버전 목록을 불러오지 못했습니다.' })
    expect(container.querySelector('[data-testid="insight-details"] [data-load-error]')?.textContent)
      .toContain('min.version.loadFailed')
  })

  it('과거 버전 열람 화면 — 독립 버전 패널에 사유를 보인다', () => {
    render({ versionsError: '버전 목록을 불러오지 못했습니다.', historicalVersion: { id: 'v1', versionNo: 1 } })
    expect(notice()?.textContent).toContain('min.version.loadFailed')
  })

  it('대조: versionsError 가 없으면 사유가 없다', () => {
    render({ versionsError: null })
    expect(notice()).toBeNull()
  })
})
