// @vitest-environment jsdom
// 첨부 목록 조회 실패 — 뷰어는 첨부가 '없는' 회의록으로 그리지 않고 머리 영역에 경고를 띄운다(에러 처리 3원칙 ①).
// 본문 텍스트는 받을 수 있으므로 '내용 .md' 버튼은 남는다. 과거 버전 열람은 파일을 보이지 않으므로 경고도 없다.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Minute } from '@/lib/domain/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}))
vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ t: (key: string) => key }),
}))
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))
vi.mock('@/components/minutes/MarkdownView', () => ({ MarkdownView: () => null }))
vi.mock('@/components/minutes/MinuteInsightCard', () => ({ MinuteInsightCard: () => null }))
vi.mock('@/components/minutes/MinuteToc', () => ({ MinuteToc: () => null }))
vi.mock('@/components/minutes/MinuteChatPanel', () => ({ MinuteChatPanel: () => null }))
vi.mock('@/components/minutes/MinuteMetaModal', () => ({ MinuteMetaModal: () => null }))
vi.mock('@/components/minutes/MinuteShareModal', () => ({ MinuteShareModal: () => null }))
vi.mock('@/components/minutes/MinuteBlockPopover', () => ({ MinuteBlockPopover: () => null }))

import { MinuteViewer } from '@/components/minutes/MinuteViewer'

const minute: Minute = {
  id: 'm1', minuteDate: '2026-07-24', teamCode: '팀A', title: 'Acme 주간 회의',
  bodyMd: '본문', meetingId: null, createdBy: 'u1', createdByName: 'alice',
  createdAt: '2026-07-24T00:00:00Z', updatedAt: '2026-07-24T00:00:00Z',
}
const FILES_ERR = '첨부 목록을 불러오지 못했습니다.'

class IntersectionObserverStub {
  observe() {}
  disconnect() {}
}

describe('MinuteViewer — 첨부 목록 조회 실패', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).IntersectionObserver = IntersectionObserverStub
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function render(props: { filesError?: string | null; historicalVersion?: { id: string; versionNo: number } | null }) {
    act(() => {
      root.render(
        <MinuteViewer minute={minute} files={[]} canManage={false}
          annotations={{ highlights: [], insights: [] }} userId="u1" projects={[]}
          {...props} />,
      )
    })
  }
  const buttonTexts = () => [...container.querySelectorAll('button')].map(b => b.textContent)

  it('실패면 머리 영역에 경고를 띄우고 \'내용 .md\' 버튼은 남긴다', () => {
    render({ filesError: FILES_ERR })
    const alert = container.querySelector('[role="alert"]')
    expect(alert?.textContent).toBe('min.detail.filesLoadFailed')
    expect(buttonTexts()).toContain('min.detail.downloadBody')
  })

  it('정상(filesError 없음)이면 경고가 없다', () => {
    render({ filesError: null })
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('과거 버전 열람에서는 경고를 그리지 않는다 — 과거 버전은 파일을 보이지 않는다', () => {
    render({ filesError: FILES_ERR, historicalVersion: { id: 'v1', versionNo: 1 } })
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })
})
