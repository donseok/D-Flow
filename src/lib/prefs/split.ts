/**
 * 개인 설정 키의 범위(D9, 스펙 §5.6) — 닫힌 두 목록. 계정 키는 account_preferences(자기 행), 워크스페이스 키는 user_preferences
 * (user_id, workspace_id) 행이다. 형식·상한 검사를 여기서 한다(저장 라우트·셸이 같은 규칙). 개인 설정은 서버 판정에 들어가지 않는다
 * (개정 §2.8.5 — tests/prefs/no-server-judgment.test.ts). UI-3 이 projectsView(계정)·portalHiddenWidgets(워크스페이스)를 더한다.
 */
import type { UiPrefs } from '@/lib/domain/types'
import { UUID_RE } from '@/lib/domain/validate'

export const ACCOUNT_PREF_KEYS = [
  'theme', 'locale', 'sidebarCollapsed', 'dashSections', 'minutesView', 'minuteFontSize', 'minutesExplorerLayout',
  'wbsHideDone', 'wbsOutline', 'wbsGanttScale', 'notif',
] as const satisfies readonly (keyof UiPrefs)[]
export const WORKSPACE_PREF_KEYS = ['startPage', 'favoriteProjectIds', 'recentProjects', 'notifRead'] as const satisfies readonly (keyof UiPrefs)[]
export const RETIRED_PREF_KEYS = ['heroCollapsed', 'lastProjectId'] as const
export const FAVORITES_MAX = 20
export const RECENT_MAX = 10
const START_PAGES = new Set(['home', 'my_work', 'projects', 'last_project'])
const ACC = new Set<string>(ACCOUNT_PREF_KEYS)
const WSK = new Set<string>(WORKSPACE_PREF_KEYS)

function cleanWorkspaceValue(key: string, v: unknown): { ok: true; value: unknown } | { ok: false } {
  if (key === 'startPage') return typeof v === 'string' && START_PAGES.has(v) ? { ok: true, value: v } : { ok: false }
  if (key === 'favoriteProjectIds') {
    if (!Array.isArray(v)) return { ok: false }
    return { ok: true, value: [...new Set(v.filter((x): x is string => typeof x === 'string' && UUID_RE.test(x)))].slice(0, FAVORITES_MAX) }
  }
  if (key === 'recentProjects') {
    if (!Array.isArray(v)) return { ok: false }
    const seen = new Set<string>()
    const out: { id: string; at: string }[] = []
    for (const x of v) {
      if (!x || typeof x !== 'object') continue
      const { id, at } = x as { id?: unknown; at?: unknown }
      if (typeof id !== 'string' || !UUID_RE.test(id) || typeof at !== 'string' || !Number.isFinite(Date.parse(at)) || seen.has(id)) continue
      seen.add(id); out.push({ id, at })
    }
    return { ok: true, value: out.slice(0, RECENT_MAX) }
  }
  if (key === 'notifRead') return v && typeof v === 'object' && !Array.isArray(v) ? { ok: true, value: v } : { ok: false }
  return { ok: false }
}

export function splitPrefs(patch: Partial<UiPrefs>): { account: Partial<UiPrefs>; workspace: Partial<UiPrefs>; dropped: string[] } {
  const account: Record<string, unknown> = {}, workspace: Record<string, unknown> = {}, dropped: string[] = []
  for (const [k, v] of Object.entries(patch ?? {})) {
    if (ACC.has(k)) { account[k] = v; continue }
    if (WSK.has(k)) {
      const c = cleanWorkspaceValue(k, v)
      if (c.ok) workspace[k] = c.value; else dropped.push(k)
      continue
    }
    dropped.push(k)
  }
  return { account: account as Partial<UiPrefs>, workspace: workspace as Partial<UiPrefs>, dropped }
}

export function mergePrefs(account: Partial<UiPrefs>, workspace: Partial<UiPrefs>): UiPrefs {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(account ?? {})) if (ACC.has(k)) out[k] = v
  for (const [k, v] of Object.entries(workspace ?? {})) if (WSK.has(k)) out[k] = v
  return out as UiPrefs
}

export function pushRecent(list: readonly { id: string; at: string }[] | undefined, id: string, at: string): { id: string; at: string }[] {
  return [{ id, at }, ...(list ?? []).filter((x) => x.id !== id)].slice(0, RECENT_MAX)
}
