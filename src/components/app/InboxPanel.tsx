// src/components/app/InboxPanel.tsx — 벨 패널 본문. 데이터는 NotificationBell 이 내려준다(패널은 표현만).
'use client'

import Link from 'next/link'
import { AlertTriangle, BellRing, Clock4, Megaphone } from 'lucide-react'
import { useLocale } from '@/components/providers/LocaleProvider'
import type { NotificationItem } from '@/app/actions/notifications'
import type { InboxItem } from '@/app/actions/inbox'

export function InboxPanel({
  items, derived, unreadAnnouncements, projectId, loading, failed, onItemClick, onMarkAllRead,
}: {
  items: InboxItem[]
  derived: NotificationItem[]           // 기존 파생 피드(지연·마감) — 이벤트가 아니라 구획 유지
  /** 프로젝트 공지 안읽음 — null 은 모름(조회 실패). 0 으로 바꿔 '알림 없음'을 주장하지 않는다 */
  unreadAnnouncements: number | null
  projectId: string | null
  loading: boolean
  failed: boolean
  onItemClick: (item: InboxItem) => void
  onMarkAllRead: () => void
}) {
  const { t } = useLocale()
  const unread = items.filter(i => !i.read).length + derived.length
  const annUnknown = !!projectId && unreadAnnouncements === null
  const empty = items.length === 0 && derived.length === 0 && !annUnknown && !unreadAnnouncements

  return (
    <>
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="text-sm font-semibold text-fg">{t('inbox.title')}</span>
        {unread > 0 && (
          <span className="flex items-center gap-2">
            <span className="chip bg-danger-weak text-danger">{unread}</span>
            <button onClick={onMarkAllRead} className="text-xs font-medium text-fg-secondary underline-offset-2 hover:text-fg hover:underline">
              {t('inbox.markAllRead')}
            </button>
          </span>
        )}
      </div>
      <div className="max-h-96 overflow-y-auto">
        {failed ? (
          <div className="px-4 py-6 text-center text-xs text-danger">{t('inbox.loadFailed')}</div>
        ) : loading ? (
          <div className="px-4 py-6 text-center text-xs text-fg-muted">…</div>
        ) : empty ? (
          <div className="px-4 py-6 text-center text-xs text-fg-muted">{t('inbox.empty')}</div>
        ) : (
          <>
            {items.length > 0 && (
              <Section label={t('inbox.personal')}>
                {items.map(n => (
                  <li key={n.recipientId}>
                    <button onClick={() => onItemClick(n)} className={`flex w-full gap-3 px-4 py-3 text-left transition hover:bg-surface-subtle ${n.read ? 'opacity-55' : ''}`}>
                      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-subtle text-fg-secondary">
                        <BellRing className="h-3.5 w-3.5" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-medium text-fg">{n.title}</span>
                        {n.detail && <span className="block text-xs text-fg-secondary">{n.detail}</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </Section>
            )}
            {annUnknown && (
              <Section label={t('inbox.announcements')}>
                <li data-announcements-unknown className="px-4 py-3 text-xs text-fg-secondary">{t('inbox.announcementsUnknown')}</li>
              </Section>
            )}
            {projectId && !!unreadAnnouncements && unreadAnnouncements > 0 && (
              <Section label={t('inbox.announcements')}>
                <li>
                  <Link href={`/p/${projectId}/announcements`} className="flex gap-3 px-4 py-3 transition hover:bg-surface-subtle">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-pending-weak text-warning">
                      <Megaphone className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium text-fg">{unreadAnnouncements} {t('inbox.announceUnread')}</span>
                      <span className="block text-xs text-fg-secondary">{t('inbox.viewAnnouncements')}</span>
                    </span>
                  </Link>
                </li>
              </Section>
            )}
            {projectId && derived.length > 0 && (
              <Section label={t('inbox.derived')}>
                {derived.map(n => (
                  <li key={n.id}>
                    <Link href={`/p/${projectId}/wbs?view=board`} className="flex gap-3 px-4 py-3 transition hover:bg-surface-subtle">
                      <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${n.severity === 'danger' ? 'bg-danger-weak text-danger' : 'bg-pending-weak text-warning'}`}>
                        {n.type === 'delayed' ? <AlertTriangle className="h-3.5 w-3.5" /> : <Clock4 className="h-3.5 w-3.5" />}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-medium text-fg">{n.title}</span>
                        <span className="block text-xs text-fg-secondary">{n.detail}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </Section>
            )}
          </>
        )}
      </div>
    </>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="border-b border-border bg-surface-subtle/60 px-4 py-1.5 text-meta font-semibold text-fg-muted">{label}</div>
      <ul className="divide-y divide-border">{children}</ul>
    </div>
  )
}
