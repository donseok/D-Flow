/** 클라이언트와 서버가 공유하는 순수 보기 계약. 설정 레지스트리를 끌어오지 않는다. */
export type WbsView = 'sheet' | 'timeline' | 'board'
export const WBS_VIEWS: readonly WbsView[] = ['sheet', 'timeline', 'board']
export type ViewsDefault = { wbs: WbsView }
export const DEFAULT_VIEWS: ViewsDefault = { wbs: 'sheet' }
export function parseViewsDefault(raw: unknown): { ok: true; value: ViewsDefault } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: '보기 기본값은 { wbs } 여야 합니다.' }
  const keys = Object.keys(raw)
  if (keys.length !== 1 || keys[0] !== 'wbs') return { ok: false, error: '보기 기본값에는 wbs 만 둡니다.' }
  const wbs = (raw as { wbs: unknown }).wbs
  return typeof wbs === 'string' && (WBS_VIEWS as readonly string[]).includes(wbs)
    ? { ok: true, value: { wbs: wbs as WbsView } }
    : { ok: false, error: '작업 계획 기본 보기는 sheet·timeline·board 중 하나입니다.' }
}
export function resolveWbsView({ view, focus, stored, boardOn }: { view?: string; focus?: string; stored: WbsView | null; boardOn: boolean }): { view: WbsView; notice: 'board_off' | null } {
  const explicit = (WBS_VIEWS as readonly string[]).includes(view ?? '') ? view as WbsView : null
  const chosen = explicit ?? (focus ? 'sheet' : stored ?? 'sheet')
  return chosen === 'board' && !boardOn ? { view: 'sheet', notice: explicit === 'board' ? 'board_off' : null } : { view: chosen, notice: null }
}
export function viewHref(basePath: string, query: Record<string, string | string[] | undefined>, view: WbsView): string {
  const q = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (key === 'focus' || key === 'view' || value === undefined) continue
    for (const v of Array.isArray(value) ? value : [value]) q.append(key, v)
  }
  q.append('view', view)
  return `${basePath}?${q.toString()}`
}
