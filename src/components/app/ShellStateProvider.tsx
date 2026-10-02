'use client'
// 앱 셸 상태(알림함·파생 알림·범위 배지 셋) 공급자 — 2026-08-18 성능 감사 P0 의 통합 조회를 새 계약(D34)으로.
//
// /api/shell GET 1왕복(이동당 1회 — R25)으로 합쳐 컨텍스트로 나눠준다. 범위는 게시 저장소(useShellScope — 범위 레이아웃의 <ShellScope>)에서 읽는다:
//  - ?ws=<워크스페이스 id>&project=<프로젝트 id>. 범위가 없으면(첫 게시 전·(global)) 쿼리 없이 인박스만 읽고 배지는 null(모름)이다
//    (global) 화면(계정·플랫폼 운영)은 쿠키 워크스페이스의 내비를 그리지만 '내 업무' 배지도 없다 — 의도다(Z7: 직전 범위를 지금 범위로 오인하지 않게. AA5)
//  - 배지 셋(myWorkReview·projectApprovals·projectUnreadAnnouncements)은 서버가 실패를 null 로 낸다 — 0 으로 바꾸지 않는다(3원칙 ①)
//  - 프로젝트를 벗어나면 파생 알림을 비우고 로딩 플래그를 리셋한다(공유 게이트 loading = inboxLoading || notifLoading 이 갇히지 않게)
//  - 응답 실패는 알림함만 failed 로 표시하고 나머지는 직전 값을 유지(옛 catch 시맨틱). 늦게 온 옛 응답은 시퀀스로 버린다
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import type { NotificationItem } from '@/app/actions/notifications'
import type { InboxItem } from '@/app/actions/inbox'
import { useShellScope } from '@/components/app/ShellScope'
import { useInboxRealtime } from '@/lib/hooks/useInboxRealtime'

export type ShellBadges = { myWorkReview: number | null; projectApprovals: number | null; projectUnreadAnnouncements: number | null }
type ShellPayload = {
  inbox: { items: InboxItem[]; unseen: number; failed?: true }
  notifications: { items: NotificationItem[]; count: number } | null
  badges: ShellBadges
}

export type ShellState = {
  inbox: InboxItem[]
  setInbox: React.Dispatch<React.SetStateAction<InboxItem[]>>
  inboxLoading: boolean
  inboxFailed: boolean
  notifs: NotificationItem[]
  setNotifs: React.Dispatch<React.SetStateAction<NotificationItem[]>>
  notifLoading: boolean
  /** 범위 배지 — null 은 모름(조회 실패·범위 밖). 내비·벨은 null 을 그리지 않는다 */
  badges: ShellBadges
  refresh: () => void
}

const SCOPE_WAIT_MS = 1500
/** 게시된 범위가 지금 경로의 범위인가 — /p/<pid> 는 그 프로젝트, /w/<slug> 는 그 워크스페이스(프로젝트 없음). 그 밖의 경로((global) 등)는 기다리지 않는다 */
export function scopeMatchesPath(pathname: string | null, slug: string | null, projectId: string | null): boolean {
  const p = /^\/p\/([^/]+)/.exec(pathname ?? '')
  if (p) return projectId === p[1]
  const w = /^\/w\/([^/]+)/.exec(pathname ?? '')
  if (w) return slug === w[1] && projectId === null
  return true
}
const NO_BADGES: ShellBadges = { myWorkReview: null, projectApprovals: null, projectUnreadAnnouncements: null }
const Ctx = createContext<ShellState | null>(null)

export function ShellStateProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const scope = useShellScope()
  const wsId = scope?.workspace?.id ?? null
  const projectId = scope?.projectId ?? null
  const [inbox, setInbox] = useState<InboxItem[]>([])
  const [inboxLoading, setInboxLoading] = useState(true)
  const [inboxFailed, setInboxFailed] = useState(false)
  const [notifs, setNotifs] = useState<NotificationItem[]>([])
  const [notifLoading, setNotifLoading] = useState(false)
  const [badges, setBadges] = useState<ShellBadges>(NO_BADGES)
  // 내비게이션 연타 시 늦게 도착한 이전 응답이 최신 상태를 덮지 않도록 시퀀스로 가드.
  const seq = useRef(0)

  const load = useCallback(async () => {
    const id = ++seq.current
    setInboxLoading(true)
    if (projectId) setNotifLoading(true)
    else { setNotifs([]); setNotifLoading(false) }
    if (!wsId) setBadges(NO_BADGES)
    else if (!projectId) setBadges((b) => ({ ...b, projectApprovals: null, projectUnreadAnnouncements: null }))
    try {
      const qs = new URLSearchParams()
      if (wsId) qs.set('ws', wsId)
      if (projectId) qs.set('project', projectId)
      const res = await fetch(`/api/shell?${qs.toString()}`, { cache: 'no-store' })
      if (!res.ok) throw new Error(`shell ${res.status}`)
      const data: ShellPayload = await res.json()
      if (id !== seq.current) return
      setInbox(data.inbox.items)
      setInboxFailed(data.inbox.failed === true)
      // notifications null = 서버측 파생 알림 실패·범위 밖 — 프로젝트 안이면 직전 값 유지(옛 catch(() => {}) 시맨틱)
      if (projectId && data.notifications) setNotifs(data.notifications.items)
      setBadges(wsId ? data.badges ?? NO_BADGES : NO_BADGES)
    } catch {
      if (id === seq.current) setInboxFailed(true)
    } finally {
      if (id === seq.current) { setInboxLoading(false); setNotifLoading(false) }
    }
  }, [wsId, projectId])

  // 내비게이션당 1회 재조회(R25) — pathname 이 deps 에 있어 같은 범위 안 메뉴 이동에도 갱신된다(공지 화면을 다녀오면 배지가 꺼진다).
  // 범위를 넘는 이동은 경로가 먼저 바뀌고 새 범위 레이아웃의 <ShellScope> 게시가 나중 커밋(스트리밍)에 온다 — 게시된 범위가 경로와 맞을 때만 부르고,
  // 맞지 않으면(옛 범위) 게시를 기다린다(S-3 실측: 기다리지 않으면 이동당 2회). 게시가 오지 않는 화면(열화 최소 셸 등)은 잠시 뒤 그대로 부른다.
  const scopeSlug = scope?.workspace?.slug ?? null
  useEffect(() => {
    const t = setTimeout(() => { void load() }, scopeMatchesPath(pathname, scopeSlug, projectId) ? 0 : SCOPE_WAIT_MS)
    return () => clearTimeout(t)
  }, [pathname, load, scopeSlug, projectId])

  const refresh = useCallback(() => { void load() }, [load])
  // 실시간 배지 갱신 — 향상 계층(구독 실패해도 내비게이션당 재조회가 대신 채운다).
  useInboxRealtime(refresh)

  return (
    <Ctx.Provider value={{ inbox, setInbox, inboxLoading, inboxFailed, notifs, setNotifs, notifLoading, badges, refresh }}>
      {children}
    </Ctx.Provider>
  )
}

export function useShellState(): ShellState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useShellState 는 ShellStateProvider 안에서만 호출할 수 있습니다')
  return v
}
