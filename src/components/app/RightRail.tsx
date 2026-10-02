'use client'
/**
 * 우측 레일(개정 §5.4.3, D33·D55·D56) — 점유자 하나(inspector | ai). 병치 조건이면 #app-rail 열(complementary, 비모달), 아니면 오버레이(dialog).
 * SSR·첫 렌더는 닫힘(열린 채로 SSR 하지 않는다). WBS 전체 화면이 열려 있으면 그 컨테이너 안의 레일 자리로 포털한다(전체 화면 층 아래로 숨지 않게).
 * 교체 전 확인(beforeSwitch)의 dirty 판정은 SPU1 이 채운다 — 여기는 자리만. AI 탐침 결과(aiAvailable)도 여기 실어 전역 바 아이콘이 읽는다.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { SIDEBAR_STORAGE_KEY, SIDEBAR_TOGGLE_EVENT } from './sidebarState'
import { focusablesIn, trapTab } from './focusTrap'

export const RAIL_WIDTH = 400
export const RAIL_MIN_MAIN = 720
export const SIDEBAR_WIDTH = { open: 232, closed: 64 } as const
const GUTTER = 24
const LG = 1024
const XL = 1280
export function railSideBySide(viewport: number, sidebar: number): boolean { return viewport - sidebar - RAIL_WIDTH - 2 * GUTTER >= RAIL_MIN_MAIN }

export type RailOccupant = 'inspector' | 'ai'
export type RailApi = {
  occupant: RailOccupant | null
  open(o: RailOccupant, opts?: { beforeSwitch?: () => boolean }): void
  /** 인자를 주면 그 점유자일 때만 닫는다(남의 점유를 닫지 않는다) */
  close(o?: RailOccupant): void
  aiAvailable: boolean
  setAiAvailable(v: boolean): void
}
const Ctx = createContext<RailApi | null>(null)

export function RightRailProvider({ children }: { children: ReactNode }) {
  const [occupant, setOccupant] = useState<RailOccupant | null>(null)
  const [aiAvailable, setAiAvailable] = useState(false)
  const open = useCallback((o: RailOccupant, opts?: { beforeSwitch?: () => boolean }) => {
    setOccupant((cur) => (cur && cur !== o && opts?.beforeSwitch && !opts.beforeSwitch() ? cur : o))
  }, [])
  const close = useCallback((o?: RailOccupant) => setOccupant((cur) => (o && cur !== o ? cur : null)), [])
  const api = useMemo(() => ({ occupant, open, close, aiAvailable, setAiAvailable }), [occupant, open, close, aiAvailable])
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>
}
export function useRightRail(): RailApi {
  const v = useContext(Ctx)
  if (!v) throw new Error('useRightRail 은 RightRailProvider 안에서만')
  return v
}
/** 공급자 밖(옛 셸)이면 null — 부르는 쪽이 옛 모양으로 그린다 */
export function useRightRailOptional(): RailApi | null { return useContext(Ctx) }

/** 사이드바 폭 — 명시 선호(localStorage 의 접힘 값)가 없으면 CSS 폭 규칙(1024~1279 접힘·1280+ 펼침, D55)과 같은 값 */
function sidebarWidthNow(): number {
  if (window.innerWidth < LG) return 0
  let pref: string | null = null
  try { pref = localStorage.getItem(SIDEBAR_STORAGE_KEY) } catch { /* 저장소 없음 */ }
  if (pref === '1') return SIDEBAR_WIDTH.closed
  if (pref === '0') return SIDEBAR_WIDTH.open
  return window.innerWidth >= XL ? SIDEBAR_WIDTH.open : SIDEBAR_WIDTH.closed
}

/** sync: 첫 렌더에 바로 판정(사용자 조작 뒤에만 마운트되는 RightRail 용 — SSR 하지 않으므로 불일치가 없다). 아니면 SSR·첫 렌더 닫힘(D55).
 *  ignoreSidebar: 전체 화면 안 레일 자리 — 전체 화면이 사이드바를 덮으므로 그 폭을 세지 않는다 */
export function useRailMode(sidebarWidth?: number, opts: { sync?: boolean; ignoreSidebar?: boolean } = {}): 'side' | 'overlay' | 'closed' {
  const { sync = false, ignoreSidebar = false } = opts
  const calc = useCallback((): 'side' | 'overlay' => {
    const sb = ignoreSidebar || window.innerWidth < LG ? 0 : sidebarWidth ?? sidebarWidthNow()
    return railSideBySide(window.innerWidth, sb) ? 'side' : 'overlay'
  }, [sidebarWidth, ignoreSidebar])
  const [mode, setMode] = useState<'side' | 'overlay' | 'closed'>(() => (sync && typeof window !== 'undefined' ? calc() : 'closed'))
  useEffect(() => {
    const on = () => setMode(calc())
    on()
    window.addEventListener('resize', on)
    window.addEventListener(SIDEBAR_TOGGLE_EVENT, on)
    return () => { window.removeEventListener('resize', on); window.removeEventListener(SIDEBAR_TOGGLE_EVENT, on) }
  }, [calc])
  return mode
}

const pickHost = () => document.querySelector<HTMLElement>('[data-wbs-fullscreen="open"] [data-rail-host="fullscreen"]') ?? document.getElementById('app-rail')

/** sync: 첫 렌더에 바로 찾는다(RightRail 용 — SSR 하지 않는다). AssistantChat 처럼 SSR 되는 소비처는 기본값(첫 렌더 null — 수화 불일치 방지) */
export function useRailHost(opts: { sync?: boolean } = {}): HTMLElement | null {
  const [host, setHost] = useState<HTMLElement | null>(() => (opts.sync && typeof document !== 'undefined' ? pickHost() : null))
  useEffect(() => {
    const pick = () => setHost(pickHost())
    pick()
    const mo = new MutationObserver(pick)
    mo.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-wbs-fullscreen'] })
    return () => mo.disconnect()
  }, [])
  return host
}

export function RightRail({ title, onClose, sidebarWidth, header, children }: {
  occupant: RailOccupant; title: string; onClose(): void; sidebarWidth?: number; header?: ReactNode; children: ReactNode
}) {
  // 첫 커밋에 모드·자리를 정해 본문을 바로 붙인다 — 한 커밋 늦으면 부모(AssistantChat)의 입력 초점·맨 아래 스크롤 효과가 빈 ref 를 본다(Z6)
  const host = useRailHost({ sync: true })
  const mode = useRailMode(sidebarWidth, { sync: true, ignoreSidebar: host?.getAttribute('data-rail-host') === 'fullscreen' })
  const ref = useRef<HTMLDivElement>(null)
  const trigger = useRef<Element | null>(null)
  useEffect(() => {
    trigger.current = document.activeElement
    return () => { const el = trigger.current as HTMLElement | null; if (el?.isConnected) el.focus?.() }
  }, [])
  // 오버레이(모달) 첫 초점은 입력창([data-autofocus]) — 머리의 첫 버튼(대화 초기화)에 두면 Enter 한 번에 대화가 지워진다(Z6)
  useEffect(() => {
    if (mode !== 'overlay' || !host) return
    const auto = ref.current?.querySelector<HTMLElement>('[data-autofocus]')
    ;(auto ?? focusablesIn(ref.current)[0])?.focus()
  }, [mode, host])
  if (mode === 'closed' || !host) return null
  const head = header ?? (
    <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-3">
      <h2 className="text-section text-fg">{title}</h2>
      <button type="button" aria-label="닫기" onClick={onClose} className="rounded-(--radius-control) p-2 hover:bg-surface-hover"><X size={16} aria-hidden /></button>
    </div>
  )
  const width = { '--rail-w': `${RAIL_WIDTH}px` } as React.CSSProperties
  const body = mode === 'side'
    ? <aside ref={ref} role="complementary" aria-label={title} className="flex h-full w-(--rail-w) flex-col border-l border-border bg-surface" style={width}>{head}<div className="flex min-h-0 flex-1 flex-col">{children}</div></aside>
    : <div className="fixed inset-0 z-(--z-overlay) flex justify-end bg-fg/20" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
        <div ref={ref} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); return } trapTab(e, ref.current) }}
          className="flex h-full w-(--rail-w) max-w-full flex-col border-l border-border bg-surface" style={width}>{head}<div className="flex min-h-0 flex-1 flex-col">{children}</div></div>
      </div>
  return createPortal(body, host)
}
