// @vitest-environment jsdom
// tests/ui/inbox-panel.test.tsx — 렌더 분기 검증
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { InboxPanel } from '@/components/app/InboxPanel'

vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ t: (k: string) => k }),
}))

const base = {
  derived: [], unreadAnnouncements: 0, projectId: 'p1',
  loading: false, failed: false, onItemClick: () => {}, onMarkAllRead: () => {},
}
const item = {
  recipientId: 'r1', type: 'issue.assigned', category: 'issue', title: '이슈 A',
  detail: null, href: '/p/p1/issues', createdAt: '2026-08-11', seen: false, read: false,
}

describe('InboxPanel', () => {
  it('빈 상태', () => {
    expect(renderToStaticMarkup(<InboxPanel {...base} items={[]} />)).toContain('inbox.empty')
  })
  it('개인 알림 구획 렌더', () => {
    const html = renderToStaticMarkup(<InboxPanel {...base} items={[item]} />)
    expect(html).toContain('이슈 A')
    expect(html).toContain('inbox.personal')
  })
  it('공지 안읽음을 모르면(null) 빈 상태라고 말하지 않고 확인 실패 한 줄(U2b-2 권한 리뷰 Y3)', () => {
    const html = renderToStaticMarkup(<InboxPanel {...base} items={[]} unreadAnnouncements={null} />)
    expect(html).not.toContain('inbox.empty'); expect(html).toContain('inbox.announcementsUnknown')
  })
  it('프로젝트 밖(projectId null)이면 공지 모름 줄을 그리지 않는다', () => {
    const html = renderToStaticMarkup(<InboxPanel {...base} projectId={null} items={[]} unreadAnnouncements={null} />)
    expect(html).toContain('inbox.empty'); expect(html).not.toContain('inbox.announcementsUnknown')
  })
  it('조회 실패는 위장하지 않고 표시', () => {
    expect(renderToStaticMarkup(<InboxPanel {...base} items={[]} failed />)).toContain('inbox.loadFailed')
  })
  it('공지 구획은 안읽음이 있고 프로젝트 문맥일 때만', () => {
    const html = renderToStaticMarkup(<InboxPanel {...base} items={[]} unreadAnnouncements={3} />)
    expect(html).toContain('inbox.announceUnread')
    const none = renderToStaticMarkup(<InboxPanel {...base} items={[]} unreadAnnouncements={3} projectId={null} />)
    expect(none).not.toContain('inbox.announceUnread')
  })
})
