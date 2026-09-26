'use server'

import { getComputedWbs } from '@/lib/data/wbs'
import { getSession } from '@/lib/auth'
import { createServerClient } from '@/lib/supabase/server'
import { collectLeaves } from '@/components/wbs/shared'
import type { ComputedItem, UiPrefs } from '@/lib/domain/types'
import { prefsWorkspaceId } from '@/lib/prefs/prefsWorkspace'

export type NotificationItem = {
  id: string
  type: 'delayed' | 'due_soon'
  severity: 'danger' | 'warning'
  title: string
  detail: string
  read: boolean // '모두 읽음' 처리된 알림 — 배지 카운트에서 제외, 패널에선 흐리게 유지
}

const NOTIF_IDS_MAX = 200 // 읽음 목록 상한 — 피드가 15개라 여유치, prefs 비대 방지

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
  // 부차 데이터 — 키 워크스페이스·조회 실패는 로깅 후 '전부 안 읽음'으로 열화한다.
  const sb = await createServerClient()
  let prefRow: { prefs: unknown } | null = null
  try {
    const ws = await prefsWorkspaceId(sb, user.id)
    if (!ws) console.error('[notifications] 소속 워크스페이스 없음 — 읽음 상태 생략')
    else {
      const { data, error } = await sb
        .from('user_preferences').select('prefs').eq('user_id', user.id).eq('workspace_id', ws).maybeSingle()
      if (error) console.error('[notifications] 읽음 상태 조회 실패:', error.message)
      prefRow = data
    }
  } catch (e) { console.error('[notifications]', e instanceof Error ? e.message : e) }
  const readIds = new Set((prefRow?.prefs as UiPrefs | null)?.notifRead?.[projectId] ?? [])

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
  const sb = await createServerClient()
  let ws: string | null
  try { ws = await prefsWorkspaceId(sb, user.id) } catch (e) {
    console.error('[markAllNotificationsRead]', e instanceof Error ? e.message : e); return { ok: false }
  }
  if (!ws) return { ok: false }
  const { data: existing, error: readErr } = await sb
    .from('user_preferences').select('prefs').eq('user_id', user.id).eq('workspace_id', ws).maybeSingle()
  // 병합 선행 조회 실패를 '설정 없음'으로 보면 다른 설정을 덮어쓴다 — 중단.
  if (readErr) { console.error('[markAllNotificationsRead] 기존 설정 조회 실패:', readErr.message); return { ok: false } }
  const prefs = (existing?.prefs as UiPrefs | null) ?? {}
  const notifRead = { ...(prefs.notifRead ?? {}), [projectId]: ids }
  const { error } = await sb.from('user_preferences').upsert(
    { user_id: user.id, workspace_id: ws, prefs: { ...prefs, notifRead }, updated_at: new Date().toISOString() },
    { onConflict: 'user_id,workspace_id' },
  )
  return { ok: !error }
}
