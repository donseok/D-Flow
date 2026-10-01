'use server'
// 권한 변경 이력 읽기(스펙 SP3a §6, Phase D) — 워크스페이스 설정 '기록' 범주의 '권한 변경' 목록. 쓰기는 없다(권한 RPC 안의 트리거가 남긴다).
import { requireWorkspaceAdmin } from '@/lib/authz'
import { listAuthzEventRows } from '@/lib/authz/events'
import { isUuidLike } from '@/lib/domain/validate'
import { AUTHZ_CAUSE_LABEL, AUTHZ_KIND_LABEL, describeAuthzChange, type AuthzEventKind } from '@/lib/domain/authzEvents'
import { adminFor } from '@/lib/supabase/adminFor'
import { createServerClient } from '@/lib/supabase/server'

export interface AuthzEventView {
  id: number
  kind: AuthzEventKind
  kindLabel: string
  summary: string
  causeLabel: string
  actorName: string
  targetName: string
  projectName: string | null
  createdAt: string
}
export type AuthzEventsResult = { ok: true; rows: AuthzEventView[]; nextBefore: number | null } | { ok: false; error: string }

const ERR_LOAD = '권한 변경 이력을 불러오지 못했습니다.'
const NAME_UNKNOWN = '이름 확인 불가'

type Named = Map<string, string> | null     // null = 조회 실패(삭제된 계정과 구분한다)

/** 이름 조회는 이력 행에 나온 id 만, 이 워크스페이스로 좁혀서 한다. 실패하면 null — '삭제된 계정'으로 위장하지 않는다. */
async function lookup(table: 'profiles' | 'people' | 'projects', admin: ReturnType<typeof adminFor>['admin'], ids: string[], workspaceId: string): Promise<Named> {
  if (ids.length === 0) return new Map()
  try {
    if (table === 'profiles') {
      const { data, error } = await admin.from('profiles').select('user_id, display_name').in('user_id', ids)
      if (error) throw error
      return new Map(((data ?? []) as { user_id: string; display_name: string | null }[]).map(r => [r.user_id, r.display_name?.trim() || '이름 없음']))
    }
    if (table === 'people') {
      const { data, error } = await admin.from('people').select('id, display_name').eq('workspace_id', workspaceId).in('id', ids)
      if (error) throw error
      return new Map(((data ?? []) as { id: string; display_name: string | null }[]).map(r => [r.id, r.display_name?.trim() || '이름 없음']))
    }
    const { data, error } = await admin.from('projects').select('id, name').eq('workspace_id', workspaceId).in('id', ids)
    if (error) throw error
    return new Map(((data ?? []) as { id: string; name: string | null }[]).map(r => [r.id, r.name?.trim() || '이름 없음']))
  } catch (error) {
    console.error('[authz events] 이름 조회 실패', { table, workspaceId, cause: error })
    return null
  }
}

export async function listAuthzEvents(workspaceId: string, opts?: { limit?: number; before?: number }): Promise<AuthzEventsResult> {
  if (typeof workspaceId !== 'string' || !isUuidLike(workspaceId)) return { ok: false, error: '워크스페이스 id가 올바르지 않습니다.' }
  const g = await requireWorkspaceAdmin(workspaceId)
  if (!g.ok) return { ok: false, error: g.error }
  const sb = await createServerClient()
  const r = await listAuthzEventRows(sb, { workspaceId, includePlatform: g.actor.isSuperuser, limit: opts?.limit, before: opts?.before })
  if (!r.ok) { console.error('[authz events] 이력 조회 실패', { workspaceId, cause: r.error }); return { ok: false, error: ERR_LOAD } }

  const { admin } = adminFor({ workspaceId })
  const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => x !== null))]
  const [users, people, projects] = await Promise.all([
    lookup('profiles', admin, uniq(r.rows.flatMap(row => [row.actorUserId, row.targetUserId])), workspaceId),
    lookup('people', admin, uniq(r.rows.map(row => row.targetPersonId)), workspaceId),
    lookup('projects', admin, uniq(r.rows.map(row => row.projectId)), workspaceId),
  ])
  const user = (id: string | null, none: string) => id === null ? none : users === null ? NAME_UNKNOWN : users.get(id) ?? '삭제된 계정'
  return {
    ok: true, nextBefore: r.nextBefore,
    rows: r.rows.map(row => ({
      id: row.id, kind: row.kind, kindLabel: AUTHZ_KIND_LABEL[row.kind],
      summary: describeAuthzChange(row.kind, row.before, row.after), causeLabel: AUTHZ_CAUSE_LABEL[row.cause],
      actorName: user(row.actorUserId, '시스템'),
      // 계정 없는 인물(명단에만 있는 사람)은 인물 이름이 대상이다
      targetName: row.targetUserId !== null ? user(row.targetUserId, '') : row.targetPersonId !== null
        ? (people === null ? NAME_UNKNOWN : people.get(row.targetPersonId) ?? '삭제된 인물') : '—',
      projectName: row.projectId === null ? null : projects === null ? NAME_UNKNOWN : projects.get(row.projectId) ?? '삭제된 프로젝트',
      createdAt: row.createdAt,
    })),
  }
}
