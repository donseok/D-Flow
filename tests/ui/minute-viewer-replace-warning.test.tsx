// @vitest-environment jsdom
// 본문 교체(새 판)의 녹취 보정 경고 토스트(a6 리뷰 Q2 — A-5 리뷰 O6 의 나머지 반쪽). 범위 달력을 못 읽었거나 시각이 범위 밖이면
// 서버는 원문 그대로 새 판을 저장하고 timeFixWarning 을 싣는다 — 화면은 '저장됨'만 보이지 않고 그 사실을 경고 토스트로 알린다.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Minute } from '@/lib/domain/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const m = vi.hoisted(() => ({
  toast: vi.fn(), replaceMinuteBody: vi.fn(), refresh: vi.fn(), upload: vi.fn(async () => ({ error: null })), remove: vi.fn(async () => ({ error: null })),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: m.refresh }) }))
vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...rest}>{children}</a>,
}))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ t: (key: string) => key }) }))
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ toast: m.toast }) }))
vi.mock('@/app/actions/minutes', () => ({
  getMinuteFileUrl: vi.fn(), getMinuteVersionFileUrl: vi.fn(), deleteMinute: vi.fn(), toggleMinuteHighlight: vi.fn(),
  replaceMinuteBody: m.replaceMinuteBody,
}))
vi.mock('@/components/minutes/MinuteAttachmentsPanel', () => ({ MinuteAttachmentsPanel: () => null }))
vi.mock('@/lib/supabase/client', () => ({ createBrowserClient: () => ({ storage: { from: () => ({ upload: m.upload, remove: m.remove }) } }) }))
vi.mock('@/components/minutes/MarkdownView', () => ({ MarkdownView: () => null }))
vi.mock('@/components/minutes/MinuteInsightCard', () => ({ MinuteInsightCard: () => null }))
vi.mock('@/components/minutes/MinuteToc', () => ({ MinuteToc: () => null }))
vi.mock('@/components/minutes/MinuteChatPanel', () => ({ MinuteChatPanel: () => null }))
vi.mock('@/components/minutes/MinuteMetaModal', () => ({ MinuteMetaModal: () => null }))
vi.mock('@/components/minutes/MinuteShareModal', () => ({ MinuteShareModal: () => null }))
vi.mock('@/components/minutes/MinuteBlockPopover', () => ({ MinuteBlockPopover: () => null }))

import { MinuteViewer } from '@/components/minutes/MinuteViewer'

const MID = '00000000-0000-4000-8000-0000000019c1'
const WID = '00000000-0000-4000-8000-0000000019c2'
const minute = {
  id: MID, minuteDate: '2026-07-24', teamCode: '팀A', title: 'Acme 주간 회의', bodyMd: '본문', meetingId: null,
  createdBy: 'u1', createdByName: 'alice', createdAt: '2026-07-24T00:00:00Z', updatedAt: '2026-07-24T00:00:00Z',
  workspaceId: WID, ownProjectId: null,
} as Minute

class IntersectionObserverStub { observe() {} disconnect() {} }

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  vi.clearAllMocks()
  ;(globalThis as Record<string, unknown>).IntersectionObserver = IntersectionObserverStub
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
  act(() => {
    root.render(<MinuteViewer timeZone="Asia/Seoul" minute={minute} files={[]} canManage annotations={{ highlights: [], insights: [] }} userId="u1" projects={[]} />)
  })
})
afterEach(() => { act(() => root.unmount()); container.remove() })

async function replaceWith(text: string) {
  const input = container.querySelector<HTMLInputElement>('input[type="file"][accept=".md,.markdown"]')!
  const file = new File([text], 'new.md', { type: 'text/markdown' })
  Object.defineProperty(file, 'text', { value: async () => text })
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })) })
}

describe('MinuteViewer — 본문 교체의 녹취 보정 경고(a6 리뷰 Q2)', () => {
  it.each([
    ['calendar_unavailable', 'min.timeFix.skippedCalendar'],
    ['invalid_time', 'min.timeFix.skippedInvalidTime'],
  ] as const)('결과의 timeFixWarning=%s 이면 경고 토스트(원문 시각 그대로라는 사실)', async (warning, description) => {
    m.replaceMinuteBody.mockResolvedValueOnce({ ok: true, timeFixWarning: warning })
    await replaceWith('# 새 본문')
    expect(m.replaceMinuteBody).toHaveBeenCalledWith(MID, '# 새 본문', expect.objectContaining({ fileName: 'new.md' }))
    expect(m.toast).toHaveBeenCalledWith({ title: 'min.timeFix.skippedTitle', description, variant: 'info' })
    expect(m.refresh).toHaveBeenCalled()
  })
  it('경고가 없으면 경고 토스트도 없다', async () => {
    m.replaceMinuteBody.mockResolvedValueOnce({ ok: true })
    await replaceWith('# 새 본문')
    expect(m.toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'min.timeFix.skippedTitle' }))
    expect(m.refresh).toHaveBeenCalled()
  })
})
