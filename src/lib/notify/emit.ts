import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { personOf } from '@/lib/data/memberSelect'
import { NOTIFICATION_CATALOG, type NotificationType } from '@/lib/domain/inbox'

export type EmitInput = {
  type: NotificationType
  projectId: string | null
  actorUserId?: string | null
  entityType?: string
  entityId?: string
  payload: { title: string; detail?: string; href?: string }
  recipientMemberIds?: string[]
  recipientUserIds?: string[]
  dedupeKey?: string
}
export type EmitResult = { ok: boolean; deduped?: boolean; recipients?: number }

export async function emitNotification(input: EmitInput): Promise<EmitResult> {
  try {
    const admin = createAdminClient()
    const actor = input.actorUserId ?? null

    // 1) 수신자 해석 — member_id → people.user_id 스냅샷(발행 시점 링크). 미링크(user_id null)도
    //    행은 남긴다: 멱등 키·감사 근거. 배지·피드는 user_id 기준이라 링크 전에는 보이지 않는다.
    const rows: { member_id: string | null; user_id: string | null }[] = []
    const memberIds = [...new Set(input.recipientMemberIds ?? [])]
    if (memberIds.length > 0) {
      const { data, error } = await admin
        .from('project_members').select('id, people!inner(user_id)').in('id', memberIds)
      if (error) {
        console.error('[notify] 수신자 해석 실패', input.type, error.message)
        return { ok: false }
      }
      for (const m of (data ?? []) as Array<Record<string, unknown>>) {
        const uid = personOf(m)?.user_id ?? null
        if (actor === null || uid !== actor) rows.push({ member_id: m.id as string, user_id: uid })
      }
    }
    for (const uid of new Set(input.recipientUserIds ?? [])) {
      if (uid !== actor) rows.push({ member_id: null, user_id: uid })
    }
    if (rows.length === 0) return { ok: true, recipients: 0 }

    // 2) 이벤트 — dedupe_key 유니크 충돌은 "이미 발행됨" = 성공.
    const { data: ev, error: evErr } = await admin
      .from('notification_events')
      .insert({
        type: input.type,
        category: NOTIFICATION_CATALOG[input.type].category,
        audience: 'direct',
        project_id: input.projectId,
        actor_user_id: actor,
        entity_type: input.entityType ?? null,
        entity_id: input.entityId ?? null,
        payload: input.payload,
        dedupe_key: input.dedupeKey ?? null,
      })
      .select('id')
      .single()
    if (evErr || !ev) {
      if (evErr?.code === '23505') return { ok: true, deduped: true }
      console.error('[notify] 이벤트 기록 실패', input.type, evErr?.message)
      return { ok: false }
    }

    // 3) 수신자 행 — 이벤트가 방금 생겼으므로 충돌 없음(부분 유니크는 안전망).
    const { error: rcErr } = await admin
      .from('notification_recipients')
      // project_id: member 수신자는 필수(CHECK notification_recipients_member_needs_project, 0003) — 이벤트의 프로젝트.
      .insert(rows.map(r => ({ event_id: ev.id, member_id: r.member_id, user_id: r.user_id, project_id: r.member_id ? input.projectId : null })))
    if (rcErr) {
      console.error('[notify] 수신자 기록 실패', input.type, rcErr.message)
      return { ok: false }
    }
    return { ok: true, recipients: rows.length }
  } catch (e) {
    console.error('[notify] emit 예외', input.type, e)
    return { ok: false }
  }
}
