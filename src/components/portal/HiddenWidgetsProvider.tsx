'use client'
import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { postPrefsNow } from '@/lib/prefs/debouncedSave'
import { reloadPortalPage } from '@/lib/portal/reload'
import type { PortalWidgetId } from '@/lib/portal/widgets'

type HiddenWidgetsCommands = { pending: boolean; disabled: boolean; change(widgetId: PortalWidgetId | null): Promise<boolean> }
const Context = createContext<HiddenWidgetsCommands | null>(null)

/** 페이지 수명의 공유 저장 큐. 다음 변경은 성공한 최신 목록에서 만들고 큐가 빌 때 화면을 한 번만 갱신한다. */
export function HiddenWidgetsProvider({ workspaceId, hidden, children }: {
  workspaceId: string; hidden: readonly PortalWidgetId[] | null; children: ReactNode
}) {
  const [pending, setPending] = useState(false)
  const state = useRef({ hidden: [...(hidden ?? [])], tail: Promise.resolve(), pending: 0, changed: false })
  const commands = useMemo(() => ({
    pending,
    disabled: hidden === null,
    change(widgetId: PortalWidgetId | null): Promise<boolean> {
      if (hidden === null) return Promise.resolve(false)
      const s = state.current
      s.pending++
      setPending(true)
      const result = s.tail.then(async () => {
        const next = widgetId === null ? [] : [...new Set([...s.hidden, widgetId])]
        const response = await postPrefsNow({ prefs: { portalHiddenWidgets: next }, workspaceId }).catch(() => null)
        if (!response?.ok) return false
        s.hidden = next
        s.changed = true
        return true
      })
      s.tail = result.then(() => {
        s.pending--
        if (s.pending === 0) {
          setPending(false)
          // 프로덕션 RSC 부분 갱신의 경합을 피한다. 실패만 있었으면 그대로 두어 실패 알림을 보존한다.
          if (s.changed) reloadPortalPage()
        }
      })
      return result
    },
  }), [workspaceId, pending, hidden])
  return <Context.Provider value={commands}>{children}</Context.Provider>
}

export function useHiddenWidgets() {
  const commands = useContext(Context)
  if (!commands) throw new Error('HiddenWidgetsProvider가 필요합니다')
  return commands
}
