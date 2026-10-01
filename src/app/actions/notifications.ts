'use server'

import { getComputedWbs } from '@/lib/data/wbs'
import { getSession } from '@/lib/auth'
import { createServerClient } from '@/lib/supabase/server'
import { collectLeaves } from '@/components/wbs/shared'
import type { ComputedItem, UiPrefs } from '@/lib/domain/types'
import { getActor } from '@/lib/authz'

export type NotificationItem = {
  id: string
  type: 'delayed' | 'due_soon'
  severity: 'danger' | 'warning'
  title: string
  detail: string
  read: boolean // '모두 읽음' 처리된 알림 — 배지 카운트에서 제외, 패널에선 흐리게 유지
}

const NOTIF_IDS_MAX = 200 // 읽음 목록 상한 — 피드가 15개라 여유치, prefs 비대 방지
/** 저장된 notifRead 를 객체로만 읽는다 — 형식 밖(배열·문자열·null)이면 빈 객체(본인 직접 쓰기에 견딘다) */
function readNotifRead(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

/** 프로젝트의 워크스페이스(actor 의 소속 프로젝트 맵 — 조회 없음). 비로그인·소속 밖·형식 밖 projectId 는 null. 권한 조회 실패는 throw */
async function projectWorkspaceOf(projectId: string): Promise<string | null> {
  if (typeof projectId !== 'string') return null
  return (await getActor())?.projectWorkspace.get(projectId) ?? null
}

function diffDays(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10))
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10))
  return Math.round((b - a) / 86_400_000)
}

/** 활성 프로젝트의 알림 피드 — 지연 작업 + 마감 임박(7일 내) 작업. count는 안읽음 수. */
export async function getNotifications(projectId: string): Promise<{ items: NotificationItem[]; count: number }> {
  const user = await getSession()
  if (!user) return { items: [], count: 0 }
  const { items, today } = await getComputedWbs(projectId)
  const leaves = collectLeaves(items)

  const delayed: Omit<NotificationItem, 'read'>[] = leaves
    .filter(l => l.status === 'delayed')
    .sort((a, b) => (a.plannedEnd ?? '').localeCompare(b.plannedEnd ?? ''))
    .map((l: ComputedItem) => ({
      id: `delay-${l.id}`,
      type: 'delayed' as const,
      severity: 'danger' as const,
      title: l.name,
      detail: l.plannedEnd
        ? `${diffDays(l.plannedEnd, today)}일 지연 · 실적 ${Math.round(l.rolledActualPct)}%`
        : `실적 ${Math.round(l.rolledActualPct)}%`,
    }))

  const dueSoon: Omit<NotificationItem, 'read'>[] = leaves
    .filter(l => l.status !== 'done' && l.status !== 'delayed' && l.plannedEnd && l.plannedEnd >= today && diffDays(today, l.plannedEnd) <= 7)
    .sort((a, b) => (a.plannedEnd ?? '').localeCompare(b.plannedEnd ?? ''))
    .map((l: ComputedItem) => ({
      id: `due-${l.id}`,
      type: 'due_soon' as const,
      severity: 'warning' as const,
      title: l.name,
      detail: `D-${diffDays(today, l.plannedEnd!)} · ${l.plannedEnd} 마감`,
    }))

  // 읽음 상태 병합 — '모두 읽음' 시점의 id 목록(prefs.notifRead[projectId])과 대조.
  // notifRead 는 워크스페이스 키다 — 그 프로젝트의 워크스페이스 행(SP3b D9). 부차 데이터 — 권한·조회 실패는 로깅 후 '전부 안 읽음'으로 열화한다.
  const sb = await createServerClient()
  let prefRow: { prefs: unknown } | null = null
  try {
    const ws = await projectWorkspaceOf(projectId)
    if (!ws) console.error('[notifications] 프로젝트의 워크스페이스를 모른다 — 읽음 상태 생략')
    else {
      const { data, error } = await sb
        .from('user_preferences').select('prefs').eq('user_id', user.id).eq('workspace_id', ws).maybeSingle()
      if (error) console.error('[notifications] 읽음 상태 조회 실패:', error.message)
      prefRow = data
    }
  } catch (e) { console.error('[notifications]', e instanceof Error ? e.message : e) }
  // 개인 설정은 본인이 PostgREST 로 직접 쓸 수도 있다 — 읽는 쪽이 방어한다(배열의 문자열만, Y4). 잘못된 값이면 '전부 안 읽음'
  const readRaw = readNotifRead((prefRow?.prefs as UiPrefs | null)?.notifRead)[projectId]
  const readIds = new Set(Array.isArray(readRaw) ? readRaw.filter((x): x is string => typeof x === 'string') : [])

  const items_ = [...delayed, ...dueSoon].slice(0, 15).map(n => ({ ...n, read: readIds.has(n.id) }))
  return { items: items_, count: items_.filter(n => !n.read).length }
}

/** 현재 피드의 알림 id를 통째로 '읽음' 저장 — 배지를 비운다. 같은 id가 다시 계산돼도 읽음 유지,
 *  새로 생긴 지연/마감 항목(새 id)만 다시 배지에 잡힌다. 현재 피드 id만 저장해 옛 id는 자연 정리. */
export async function markAllNotificationsRead(projectId: string, ids: string[]): Promise<{ ok: boolean }> {
  const user = await getSession()
  if (!user) return { ok: false }
  if (!Array.isArray(ids) || ids.length > NOTIF_IDS_MAX || ids.some(i => typeof i !== 'string' || i.length > 100)) {
    return { ok: false }
  }
  // 그 프로젝트의 워크스페이스 행에 쓴다(SP3b D9) — 소속 워크스페이스의 프로젝트가 아니면 actor 에 없어 거부(없는 프로젝트와 같은 응답).
  // 쓰기 전 선행 조회(권한)가 실패하면 중단한다.
  let ws: string | null
  try { ws = await projectWorkspaceOf(projectId) } catch (e) {
    console.error('[markAllNotificationsRead] 권한 조회 실패:', e instanceof Error ? e.message : e); return { ok: false }
  }
  if (!ws) return { ok: false }
  const sb = await createServerClient()
  const { data: existing, error: readErr } = await sb
    .from('user_preferences').select('prefs').eq('user_id', user.id).eq('workspace_id', ws).maybeSingle()
  // 병합 선행 조회 실패를 '설정 없음'으로 보면 다른 설정을 덮어쓴다 — 중단.
  if (readErr) { console.error('[markAllNotificationsRead] 기존 설정 조회 실패:', readErr.message); return { ok: false } }
  const prefs = (existing?.prefs as UiPrefs | null) ?? {}
  const notifRead = { ...readNotifRead(prefs.notifRead), [projectId]: ids }
  const { error } = await sb.from('user_preferences').upsert(
    { user_id: user.id, workspace_id: ws, prefs: { ...prefs, notifRead }, updated_at: new Date().toISOString() },
    { onConflict: 'user_id,workspace_id' },
  )
  return { ok: !error }
}
