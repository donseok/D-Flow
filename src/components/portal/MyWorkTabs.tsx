'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { wsHref } from '@/lib/workspace/paths'
import { InboxPanel } from '@/components/app/InboxPanel'
import { useShellState } from '@/components/app/ShellStateProvider'
import { markAllInboxRead, markInboxItemRead, type InboxItem } from '@/app/actions/inbox'

export type MyWorkTabId = 'work' | 'review' | 'inbox'

export function MyWorkTabNav({
  slug,
  currentTab,
  reviewCount,
}: {
  slug: string
  currentTab: MyWorkTabId
  reviewCount?: number
}) {
  const tabs: { id: MyWorkTabId; label: string; count?: number }[] = [
    { id: 'work', label: '내 작업' },
    { id: 'review', label: '검토 대기', count: reviewCount },
    { id: 'inbox', label: '알림' },
  ]

  return (
    <div role="tablist" aria-label="내 업무 탭" className="flex border-b border-border gap-6">
      {tabs.map((tab) => {
        const active = currentTab === tab.id
        return (
          <Link
            key={tab.id}
            role="tab"
            href={wsHref(slug, 'my-work', { tab: tab.id === 'work' ? null : tab.id })}
            aria-selected={active}
            className={`flex items-center gap-1.5 pb-2.5 text-sm font-medium border-b-2 transition-colors ${
              active
                ? 'border-brand text-fg font-semibold'
                : 'border-transparent text-fg-secondary hover:text-fg'
            }`}
          >
            <span>{tab.label}</span>
            {tab.count !== undefined && tab.count > 0 && (
              <span className="rounded-full bg-surface-subtle px-1.5 py-0.5 text-xs text-fg-secondary">
                {tab.count}
              </span>
            )}
          </Link>
        )
      })}
    </div>
  )
}

export function MyWorkInboxView() {
  const router = useRouter()
  const state = useShellState()
  const { inbox, setInbox, inboxLoading, inboxFailed, notifs } = state

  const onItemClick = (item: InboxItem) => {
    const snapshot = inbox
    setInbox((ns) => ns.map((n) => (n.recipientId === item.recipientId ? { ...n, read: true } : n)))
    markInboxItemRead(item.recipientId)
      .then((r) => {
        if (!r.ok) setInbox(snapshot)
      })
      .catch(() => setInbox(snapshot))

    if (item.href) {
      router.push(item.href)
    }
  }

  const onMarkAllRead = () => {
    const snapshot = inbox
    setInbox((ns) => ns.map((n) => ({ ...n, read: true })))
    markAllInboxRead()
      .then((r) => {
        if (!r.ok) setInbox(snapshot)
      })
      .catch(() => setInbox(snapshot))
  }

  return (
    <div className="rounded-xl border border-border bg-surface overflow-hidden shadow-xs">
      <InboxPanel
        items={inbox}
        derived={notifs.filter((n) => !n.read)}
        unreadAnnouncements={null}
        projectId={null}
        loading={inboxLoading}
        failed={inboxFailed}
        onItemClick={onItemClick}
        onMarkAllRead={onMarkAllRead}
      />
    </div>
  )
}
