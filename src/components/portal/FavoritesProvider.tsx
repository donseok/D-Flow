'use client'
import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { reloadPortalPage } from '@/lib/portal/reload'
import { postPrefsNow } from '@/lib/prefs/debouncedSave'
import { FAVORITES_MAX } from '@/lib/prefs/split'
import { toggleFavorite } from '@/lib/portal/favorites'
import { useLocale } from '@/components/providers/LocaleProvider'

type Api = { ids: ReadonlySet<string>; full: boolean; disabled: boolean; toggle(id: string): Promise<void>; error: string | null }
const Context = createContext<Api | null>(null)
/** 전체 목록 쓰기는 직렬화하고 다음 요청은 최신 성공 값에서 만든다. 실패분은 후속 요청에 섞지 않는다. */
export function FavoritesProvider({ workspaceId, initial, children }: { workspaceId: string; initial: readonly string[] | null; children: ReactNode }) {
  const [list, setList] = useState([...(initial ?? [])])
  const { t } = useLocale()
  const [error, setError] = useState(false)
  const state = useRef({ saved: [...(initial ?? [])], displayed: [...(initial ?? [])], tail: Promise.resolve(), queued: [] as { id: string }[], changed: false, failed: false })
  const api = useMemo<Api>(() => ({
    ids: new Set(list), full: list.length >= FAVORITES_MAX, disabled: initial === null, error: error ? t('portalUi.fav.saveFailed') : null,
    toggle(id) {
      if (initial === null) return Promise.resolve()
      const s = state.current
      const optimistic = toggleFavorite(s.displayed, id)
      if (!optimistic.ok) return Promise.resolve()
      if (!s.queued.length) { setError(false); s.failed = false }
      const operation = { id }
      s.queued.push(operation)
      s.displayed = optimistic.next
      setList(s.displayed)
      const task = s.tail.then(async () => {
        const patch = toggleFavorite(s.saved, id)
        if (patch.ok) {
          const result = await postPrefsNow({ prefs: { favoriteProjectIds: patch.next }, workspaceId }).catch(() => null)
          if (result?.ok) { s.saved = patch.next; s.changed = true }
          else { s.failed = true; setError(true) }
        }
        s.queued = s.queued.filter(item => item !== operation)
        s.displayed = s.queued.reduce((base, item) => { const r = toggleFavorite(base, item.id); return r.ok ? r.next : base }, s.saved)
        setList(s.displayed)
        if (!s.queued.length && s.changed) { s.changed = false; if (!s.failed) reloadPortalPage() }
      })
      s.tail = task
      return task
    },
  }), [list, initial, workspaceId, error, t])
  return <Context.Provider value={api}>{children}{api.error && <p role="alert" className="mt-2 text-meta text-danger">{api.error}</p>}</Context.Provider>
}
export function useFavorites(): Api { const api = useContext(Context); if (!api) throw new Error('FavoritesProvider가 필요합니다'); return api }
