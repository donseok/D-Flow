'use client'
import type { UiPrefs } from '@/lib/domain/types'

// 서버 액션이 아니라 /api/prefs POST 를 쓴다 — 액션은 성공할 때마다 클라이언트 라우터
// 캐시를 통째로 비워, 내비게이션마다 도는 이 저장이 staleTimes(30s) 재방문 캐시를
// 무효화했다(2026-08-18 실측). keepalive 라 페이지 이탈 직전 저장도 유실되지 않는다.
// 실패는 로컬 적용을 되돌리지 않는다(로컬 캐시가 진실) — 다만 경고 한 줄을 남긴다(SP3b 스펙 §4.8 "로컬 적용 유지 + 로그").
// 4xx·5xx 도 실패다: 세션 만료(401)로 서버값이 옛 값에 머물면 다음 로그인 때 PrefsSync 가 그 값으로 덮는다 — 원인 기록이 있어야 한다.
function postPrefs(body: { prefs?: Partial<UiPrefs>; workspaceId?: string; wbsCollapse?: { projectId: string; ids: string[] } }): void {
  void fetch('/api/prefs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    keepalive: true,
  }).then(
    (res) => { if (!res.ok) console.warn('[prefs] 서버 저장 실패 — 로컬 적용은 유지:', res.status) },
    (e: unknown) => { console.warn('[prefs] 서버 저장 실패 — 로컬 적용은 유지:', e instanceof Error ? e.message : e) },
  )
}

let pendingPrefs: Partial<UiPrefs> = {}
let prefsTimer: ReturnType<typeof setTimeout> | null = null

/** 계정 범위 설정(테마·언어·사이드바 등 — SP3b D9) 변경을 병합해 debounce 저장. 실패는 경고만(로컬 캐시가 진실). */
export function queueUiPref(patch: Partial<UiPrefs>, delay = 600): void {
  pendingPrefs = { ...pendingPrefs, ...patch }
  if (prefsTimer) clearTimeout(prefsTimer)
  prefsTimer = setTimeout(() => {
    const p = pendingPrefs
    pendingPrefs = {}
    prefsTimer = null
    postPrefs({ prefs: p })
  }, delay)
}

const wsPending = new Map<string, Partial<UiPrefs>>()
const wsPrefTimers = new Map<string, ReturnType<typeof setTimeout>>()

/** 워크스페이스 키(즐겨찾기·최근 방문·시작 화면) — 워크스페이스마다 따로 병합·디바운스. 그 화면의 워크스페이스 id 를 넘긴다(쿠키 아님) */
export function queueWorkspacePref(workspaceId: string, patch: Partial<UiPrefs>, delay = 600): void {
  wsPending.set(workspaceId, { ...(wsPending.get(workspaceId) ?? {}), ...patch })
  const t = wsPrefTimers.get(workspaceId)
  if (t) clearTimeout(t)
  wsPrefTimers.set(workspaceId, setTimeout(() => {
    const p = wsPending.get(workspaceId) ?? {}
    wsPending.delete(workspaceId)
    wsPrefTimers.delete(workspaceId)
    postPrefs({ prefs: p, workspaceId })
  }, delay))
}

const wbsPending = new Map<string, string[]>()
const wbsTimers = new Map<string, ReturnType<typeof setTimeout>>()

/** 프로젝트별 WBS 접힘 상태를 debounce 저장(최신값만). 실패는 경고만. */
export function queueWbsCollapse(projectId: string, ids: string[], delay = 600): void {
  wbsPending.set(projectId, ids)
  const existing = wbsTimers.get(projectId)
  if (existing) clearTimeout(existing)
  wbsTimers.set(projectId, setTimeout(() => {
    const v = wbsPending.get(projectId) ?? []
    wbsPending.delete(projectId)
    wbsTimers.delete(projectId)
    postPrefs({ wbsCollapse: { projectId, ids: v } })
  }, delay))
}
