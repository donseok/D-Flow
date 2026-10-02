'use client'
// 사이드바 접힘(계정 키 sidebarCollapsed — §5.4.2, D55). null = 선호 없음 → CSS 폭 규칙(1024~1279 접힘·1280 이상 펼침). 사용자 조작만 저장한다
import { useEffect, useState } from 'react'
import { queueUiPref } from '@/lib/prefs/debouncedSave'

export type SidebarCollapsed = boolean | null
export const SIDEBAR_STORAGE_KEY = 'dflow-sidebar'

/** 헤더 등 외부에서 사이드바 접기/펼치기를 일괄 제어할 때 dispatch하는 CustomEvent 이름. */
export const SIDEBAR_TOGGLE_EVENT = 'dflow-sidebar-toggle'

/** localStorage 갱신 + 이벤트 dispatch. 서버 쓰기는 사용자 토글 시에만(여기서 하지 않음 — reconcile 재사용 안전). */
export function dispatchSidebarToggle(collapsed: boolean): void {
  try { localStorage.setItem(SIDEBAR_STORAGE_KEY, collapsed ? '1' : '0') } catch {}
  window.dispatchEvent(new CustomEvent(SIDEBAR_TOGGLE_EVENT, { detail: { collapsed } }))
}

/** 접힘 상태 — 첫 값은 서버가 준 계정 선호(null = 선호 없음). 외부(PrefsSync reconcile) 토글 이벤트를 따라가고, 사용자 조작만 서버에 저장한다 */
export function useSidebarCollapsed(initial: SidebarCollapsed): [SidebarCollapsed, (v: boolean) => void] {
  const [v, setV] = useState<SidebarCollapsed>(initial)
  useEffect(() => {
    const on = (e: Event) => setV((e as CustomEvent<{ collapsed: boolean }>).detail.collapsed)
    window.addEventListener(SIDEBAR_TOGGLE_EVENT, on)
    return () => window.removeEventListener(SIDEBAR_TOGGLE_EVENT, on)
  }, [])
  return [v, (next: boolean) => { dispatchSidebarToggle(next); queueUiPref({ sidebarCollapsed: next }) }]
}
