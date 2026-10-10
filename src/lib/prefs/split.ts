/**
 * 개인 설정 키의 범위(D9, 스펙 §5.6) — 닫힌 두 목록. 계정 키는 account_preferences(자기 행), 워크스페이스 키는 user_preferences
 * (user_id, workspace_id) 행이다. 형식·상한 검사를 여기서 한다(저장 라우트·셸이 같은 규칙). 개인 설정은 서버 판정에 들어가지 않는다
 * (개정 §2.8.5 — tests/prefs/no-server-judgment.test.ts). UI-3 이 projectsView(계정)·portalHiddenWidgets(워크스페이스)를 더했다 —
 * 값 파서·상수는 클라이언트와 함께 쓰는 순수 모듈 src/lib/portal/prefs.ts 에 있다.
 */
import type { UiPrefs } from '@/lib/domain/types'
import { UUID_RE } from '@/lib/domain/validate'
import { MINUTE_FS_MAX, MINUTE_FS_MIN } from '@/lib/minutes/fontSize'
import { isThemePref } from '@/lib/theme/policy'
import { isProjectsView, parseHiddenWidgets } from '@/lib/portal/prefs'
import { NOTIFICATION_CATALOG } from '@/lib/domain/inbox'

export const ACCOUNT_PREF_KEYS = [
  'theme', 'sidebarCollapsed', 'dashSections', 'minutesView', 'minuteFontSize', 'minutesExplorerLayout',
  'wbsHideDone', 'wbsOutline', 'wbsGanttScale', 'notif', 'projectsView',
] as const satisfies readonly (keyof UiPrefs)[]
export const WORKSPACE_PREF_KEYS = ['startPage', 'favoriteProjectIds', 'recentProjects', 'notifRead', 'portalHiddenWidgets'] as const satisfies readonly (keyof UiPrefs)[]
/** 폐기된 키 — 저장된 옛 값은 읽지 않는다. locale 은 한국어 전용 결정(2026-10-10)으로 폐기 */
export const RETIRED_PREF_KEYS = ['heroCollapsed', 'lastProjectId', 'locale'] as const
export const FAVORITES_MAX = 20
export const RECENT_MAX = 10
const START_PAGES = new Set(['home', 'my_work', 'projects', 'last_project'])
/** 계정 키 값의 크기 상한 — 본인 행이라도 저장 경로로 거대 값을 받지 않는다(U2a-2 리뷰 Y4) */
export const DASH_SECTIONS_MAX = 50
export const NOTIF_TYPES_MAX = 50
const SHORT_KEY_MAX = 64
const ACC = new Set<string>(ACCOUNT_PREF_KEYS)
const WSK = new Set<string>(WORKSPACE_PREF_KEYS)

const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const isFiniteIn = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi

/** 계정 키 값 검사 — 클라이언트가 보내는 꼴(UiPrefs 주석의 값 범위)만 받는다. 형식 밖이면 그 키만 버린다 */
function cleanAccountValue(key: string, v: unknown): { ok: true; value: unknown } | { ok: false } {
  switch (key) {
    case 'theme': return isThemePref(v) ? { ok: true, value: v } : { ok: false }
    case 'sidebarCollapsed': case 'wbsHideDone': case 'wbsOutline': return typeof v === 'boolean' ? { ok: true, value: v } : { ok: false }
    case 'minutesView': return v === 'list' || v === 'calendar' || v === 'tree' ? { ok: true, value: v } : { ok: false }
    case 'minutesExplorerLayout': return v === 'grid' || v === 'list' ? { ok: true, value: v } : { ok: false }
    case 'projectsView': return isProjectsView(v) ? { ok: true, value: v } : { ok: false }
    case 'minuteFontSize': return isFiniteIn(v, MINUTE_FS_MIN, MINUTE_FS_MAX) ? { ok: true, value: v } : { ok: false }
    case 'wbsGanttScale': return isFiniteIn(v, 1, 400) ? { ok: true, value: v } : { ok: false }
    case 'dashSections':
      return Array.isArray(v) && v.length <= DASH_SECTIONS_MAX && v.every((x) => typeof x === 'string' && x.length <= SHORT_KEY_MAX)
        ? { ok: true, value: v } : { ok: false }
    case 'notif': {
      if (!isPlainObject(v)) return { ok: false }
      const e = Object.entries(v)
      if (e.length > NOTIF_TYPES_MAX || !e.every(([k, b]) => k.length <= SHORT_KEY_MAX && typeof b === 'boolean')) {
        return { ok: false }
      }
      // required: true인 알림은 opt-out(false)을 차단한다 (SPU1, 개정 §4.10)
      const cleaned: Record<string, boolean> = {}
      for (const [k, b] of e) {
        const cat = (NOTIFICATION_CATALOG as Record<string, { required?: boolean }>)[k]
        if (cat?.required && b === false) {
          continue // 끄기 시도 무시
        }
        cleaned[k] = b as boolean
      }
      return { ok: true, value: cleaned }
    }
    default: return { ok: false }
  }
}

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
  if (key === 'portalHiddenWidgets') {
    const ids = parseHiddenWidgets(v)                                  // 레지스트리에서 빠진 위젯 id 는 조용히 버린다(배열이 아니면 키를 버린다)
    return ids === null ? { ok: false } : { ok: true, value: ids }
  }
  // notifRead 는 개인 설정 저장 경로로 받지 않는다 — 쓰기 주체는 markAllNotificationsRead 하나(id 상한·프로젝트의 워크스페이스 행, Y4)
  return { ok: false }
}

export function splitPrefs(patch: Partial<UiPrefs>): { account: Partial<UiPrefs>; workspace: Partial<UiPrefs>; dropped: string[] } {
  const account: Record<string, unknown> = {}, workspace: Record<string, unknown> = {}, dropped: string[] = []
  for (const [k, v] of Object.entries(patch ?? {})) {
    if (ACC.has(k)) {
      const c = cleanAccountValue(k, v)
      if (c.ok) account[k] = c.value; else dropped.push(k)
      continue
    }
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
