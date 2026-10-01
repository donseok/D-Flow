'use client'
/**
 * 알림 벨(★10) — 옛 HeaderChrome 의 알림 부분을 옮겼다. 배지 = 개인 unseen + 파생 안읽음 + 프로젝트 공지 안읽음(결정 N3: 한 벨, 합산 배지).
 * 현재 프로젝트는 게시 저장소(useShellScope)에서 읽는다. 공지 안읽음을 모르면(null) 합산에서 빼고 0 이라고 주장하지 않는다.
 * 팝오버는 usePopover(첫 항목 초점·Esc·바깥 클릭·트리거 복귀). 낙관 반영·실패 복원 동작은 옛 셸과 같다.
 * 셸 상태는 새 계약(badges.projectUnreadAnnouncements — null 은 모름)이다. 패널도 null 을 0 으로 바꾸지 않는다(빈 상태라고 주장하지 않는다).
 */
import { Bell } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useMemo } from 'react'
import { useLocale } from '@/components/providers/LocaleProvider'
import { Tooltip } from '@/components/ui/Tooltip'
import { markAllNotificationsRead } from '@/app/actions/notifications'
import { markAllInboxRead, markInboxItemRead, markInboxSeen, type InboxItem } from '@/app/actions/inbox'
import { InboxPanel } from './InboxPanel'
import { useShellScope } from './ShellScope'
import { useShellState } from './ShellStateProvider'
import { usePopover } from './usePopover'

/** 현재 프로젝트의 공지 안읽음 — 프로젝트 밖·모름은 null(합산에서 뺀다) */
function unreadAnnouncementsOf(state: ReturnType<typeof useShellState>, projectId: string | null): number | null {
  return projectId ? state.badges.projectUnreadAnnouncements : null
}

export function NotificationBell() {
  const router = useRouter()
  const { t } = useLocale()
  const projectId = useShellScope()?.projectId ?? null
  const state = useShellState()
  const { inbox, setInbox, inboxLoading, inboxFailed, notifs, setNotifs, notifLoading } = state
  const unreadAnn = unreadAnnouncementsOf(state, projectId)
  const { open, setOpen, triggerRef, panelRef } = usePopover()

  // 패널·배지는 안읽음만. notifs 는 읽음 포함 전체를 유지한다 — '모두 읽음' 저장이 전체 id 를 보내야 기존 읽음이 유실되지 않는다
  const visibleNotifs = useMemo(() => notifs.filter((n) => !n.read), [notifs])
  const unseenInbox = useMemo(() => inbox.filter((n) => !n.seen).length, [inbox])
  const badge = unseenInbox + visibleNotifs.length + (unreadAnn ?? 0)

  const markAllDerived = () => {
    if (!projectId || visibleNotifs.length === 0) return
    const snapshot = notifs
    setNotifs((ns) => ns.map((n) => ({ ...n, read: true })))
    markAllNotificationsRead(projectId, snapshot.map((n) => n.id))
      .then((r) => { if (!r.ok) setNotifs(snapshot) })
      .catch(() => setNotifs(snapshot))
  }
  // 벨 열람 = seen 소등(read 는 항목 클릭에서). 액션은 throw 하지 않고 {ok:false} — 낙관 반영 뒤 r.ok 로 복원
  const toggle = () => {
    const next = !open
    setOpen(next)
    if (next && unseenInbox > 0) {
      const snapshot = inbox
      setInbox((ns) => ns.map((n) => ({ ...n, seen: true })))
      markInboxSeen().then((r) => { if (!r.ok) setInbox(snapshot) }).catch(() => setInbox(snapshot))
    }
  }
  const onItemClick = (item: InboxItem) => {
    const snapshot = inbox
    setInbox((ns) => ns.map((n) => (n.recipientId === item.recipientId ? { ...n, read: true } : n)))
    markInboxItemRead(item.recipientId).then((r) => { if (!r.ok) setInbox(snapshot) }).catch(() => setInbox(snapshot))
    if (item.href) { setOpen(false); router.push(item.href) }
  }
  const onMarkAllRead = () => {
    const snapshot = inbox
    setInbox((ns) => ns.map((n) => ({ ...n, read: true, seen: true })))
    markAllInboxRead().then((r) => { if (!r.ok) setInbox(snapshot) }).catch(() => setInbox(snapshot))
    markAllDerived()
  }

  return (
    <div className="relative">
      <Tooltip label={t('chrome.notifications')} side="bottom" disabled={open}>
        <button ref={triggerRef} type="button" onClick={toggle} aria-haspopup="dialog" aria-expanded={open} aria-label={t('chrome.notifications')}
          className="relative rounded-(--radius-control) p-2 text-fg-secondary hover:bg-surface-hover hover:text-fg">
          <Bell size={16} aria-hidden />
          {badge > 0 && (
            <span data-bell-badge className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-action px-1 text-xs font-bold text-action-fg ring-2 ring-surface">{badge}</span>
          )}
        </button>
      </Tooltip>
      {open && (
        <div ref={panelRef} role="dialog" aria-label={t('chrome.notifications')} className="absolute right-0 top-full z-(--z-popover) mt-1 w-80 overflow-hidden rounded-(--radius-panel) border border-border bg-surface-raised shadow-(--shadow-popover)">
          <InboxPanel
            items={inbox} derived={visibleNotifs} unreadAnnouncements={unreadAnn}
            projectId={projectId} loading={inboxLoading || notifLoading} failed={inboxFailed}
            onItemClick={onItemClick} onMarkAllRead={onMarkAllRead}
          />
        </div>
      )}
    </div>
  )
}
