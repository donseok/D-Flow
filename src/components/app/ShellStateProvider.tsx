'use client'
// 앱 셸 상태(알림함·파생 알림·범위 배지 셋) 공급자 — 2026-08-18 성능 감사 P0 의 통합 조회를 새 계약(D34)으로.
//
// /api/shell GET 1왕복(이동당 1회 — R25)으로 합쳐 컨텍스트로 나눠준다. 범위는 게시 저장소(useShellScope — 범위 레이아웃의 <ShellScope>)에서 읽는다:
//  - ?ws=<워크스페이스 id>&project=<프로젝트 id>. 범위가 없으면(첫 게시 전·소속 0) 쿼리 없이 인박스만 읽고 배지는 null(모름)이다
//    (global) 화면(계정·플랫폼 운영)은 레이아웃이 소속을 다시 본 쿠키 워크스페이스를 게시하므로(persist=false — U2b-5 리뷰 수정 CC4) 그리는 내비와
//    같은 워크스페이스의 '내 업무' 배지가 붙는다. 직전 범위를 지금 범위로 오인하지 않는 것(Z7)은 그대로다 — 범위 레이아웃이 떠나며 해제하고
//    (global) 이 자기 값을 같은 커밋에 게시한다(AA5 의 '배지 없음'은 게시가 없던 때의 결과였다)
//  - 배지 셋(myWorkReview·projectApprovals·projectUnreadAnnouncements)은 서버가 실패를 null 로 낸다 — 0 으로 바꾸지 않는다(3원칙 ①)
//  - 프로젝트를 벗어나면 파생 알림을 비우고 로딩 플래그를 리셋한다(공유 게이트 loading = inboxLoading || notifLoading 이 갇히지 않게)
//  - 응답 실패는 알림함만 failed 로 표시하고 나머지는 직전 값을 유지(옛 catch 시맨틱). 늦게 온 옛 응답은 시퀀스로 버린다
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
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
const BadgesCtx = createContext<ShellBadges>(NO_BADGES)
const sameBadges = (a: ShellBadges, b: ShellBadges) => a.myWorkReview === b.myWorkReview && a.projectApprovals === b.projectApprovals && a.projectUnreadAnnouncements === b.projectUnreadAnnouncements

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
  const active = useRef<AbortController | null>(null)
  const loadedScope = useRef<string | null>(null)
  const requestedScope = useRef<string | null>(null)

  const load = useCallback(async () => {
    const id = ++seq.current
    active.current?.abort()
    const controller = new AbortController()
    active.current = controller
    const scopeKey = `${wsId ?? ''}:${projectId ?? ''}`
    const changed = requestedScope.current !== scopeKey
    requestedScope.current = scopeKey
    // 같은 범위의 백그라운드 갱신은 이미 읽은 패널을 로딩 화면으로 되돌리지 않는다.
    setInboxLoading(loadedScope.current !== scopeKey)
    setNotifLoading(!!projectId && loadedScope.current !== scopeKey)
    if (changed) {
      setNotifs([])
      setBadges(NO_BADGES)
    }
    try {
      const qs = new URLSearchParams()
      if (wsId) qs.set('ws', wsId)
      if (projectId) qs.set('project', projectId)
      const res = await fetch(`/api/shell?${qs.toString()}`, { cache: 'no-store', signal: controller.signal })
      if (!res.ok) throw new Error(`shell ${res.status}`)
      const data: ShellPayload = await res.json()
      if (id !== seq.current) return
      loadedScope.current = scopeKey
      setInbox(data.inbox.items)
      setInboxFailed(data.inbox.failed === true)
      // notifications null = 서버측 파생 알림 실패·범위 밖 — 프로젝트 안이면 직전 값 유지(옛 catch(() => {}) 시맨틱)
      if (projectId && data.notifications) setNotifs(data.notifications.items)
      const nextBadges = wsId ? data.badges ?? NO_BADGES : NO_BADGES
      setBadges((current) => sameBadges(current, nextBadges) ? current : nextBadges)
    } catch {
      if (id === seq.current && !controller.signal.aborted) setInboxFailed(true)
    } finally {
      if (id === seq.current) { active.current = null; setInboxLoading(false); setNotifLoading(false) }
    }
  }, [wsId, projectId])

  // 내비게이션당 1회 재조회(R25) — pathname 이 deps 에 있어 같은 범위 안 메뉴 이동에도 갱신된다(공지 화면을 다녀오면 배지가 꺼진다).
  // 범위를 넘는 이동은 경로가 먼저 바뀌고 새 범위 레이아웃의 <ShellScope> 게시가 나중 커밋(스트리밍)에 온다 — 게시된 범위가 경로와 맞을 때만 부르고,
  // 맞지 않으면(옛 범위) 게시를 기다린다(S-3 실측: 기다리지 않으면 이동당 2회). 게시가 오지 않는 화면(열화 최소 셸 등)은 잠시 뒤 그대로 부른다.
  const scopeSlug = scope?.workspace?.slug ?? null
  useEffect(() => {
    const t = setTimeout(() => { void load() }, scopeMatchesPath(pathname, scopeSlug, projectId) ? 0 : SCOPE_WAIT_MS)
    return () => { clearTimeout(t); seq.current += 1; active.current?.abort(); active.current = null }
  }, [pathname, load, scopeSlug, projectId])

  const refresh = useCallback(() => { void load() }, [load])
  // 연속 broadcast 는 한 조회로 합친다. 구독 콜백의 정체성은 범위 이동과 무관하다.
  const refreshRef = useRef(refresh)
  useEffect(() => { refreshRef.current = refresh }, [refresh])
  const realtimeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const refreshRealtime = useCallback(() => {
    if (realtimeTimer.current) clearTimeout(realtimeTimer.current)
    realtimeTimer.current = setTimeout(() => { realtimeTimer.current = null; refreshRef.current() }, 150)
  }, [])
  useEffect(() => () => { if (realtimeTimer.current) clearTimeout(realtimeTimer.current) }, [pathname])
  useInboxRealtime(refreshRealtime)

  const value = useMemo(() => ({ inbox, setInbox, inboxLoading, inboxFailed, notifs, setNotifs, notifLoading, badges, refresh }),
    [inbox, inboxLoading, inboxFailed, notifs, notifLoading, badges, refresh])
  return (
    <BadgesCtx.Provider value={badges}>
      <Ctx.Provider value={value}>{children}</Ctx.Provider>
    </BadgesCtx.Provider>
  )
}

export function useShellState(): ShellState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useShellState 는 ShellStateProvider 안에서만 호출할 수 있습니다')
  return v
}

/** 내비게이션은 알림 목록·로딩 상태를 구독하지 않는다. */
export function useShellBadges(): ShellBadges { return useContext(BadgesCtx) }
