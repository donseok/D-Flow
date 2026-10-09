'use server'
// 권한 변경 이력 읽기(스펙 SP3a §6, Phase D) — 워크스페이스 설정 '기록' 범주의 '권한 변경' 목록. 쓰기는 없다(권한 RPC 안의 트리거가 남긴다).
import { requireWorkspaceAdmin } from '@/lib/authz'
import { listAuthzEventRows } from '@/lib/authz/events'
import { isUuidLike } from '@/lib/domain/validate'
import { authzCauseLabel, authzKindLabel, describeAuthzChange, type AuthzEventKind } from '@/lib/domain/authzEvents'
import { serverTranslator } from '@/lib/i18n/server'
import type { Translate } from '@/lib/i18n/translate'
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

const ERR_LOAD = 'srv.authzEvents.couldNotLoadPermissionChange'

type Named = Map<string, string> | null     // null = 조회 실패(삭제된 계정과 구분한다)

/** 이름 조회는 이력 행에 나온 id 만, 이 워크스페이스로 좁혀서 한다. 실패하면 null — '삭제된 계정'으로 위장하지 않는다. */
async function lookup(table: 'profiles' | 'people' | 'projects', admin: ReturnType<typeof adminFor>['admin'], ids: string[], workspaceId: string, t: Translate): Promise<Named> {
  if (ids.length === 0) return new Map()
  const unnamed = t('authz.who.unnamed')
  try {
    if (table === 'profiles') {
      const { data, error } = await admin.from('profiles').select('user_id, display_name').in('user_id', ids)
      if (error) throw error
      return new Map(((data ?? []) as { user_id: string; display_name: string | null }[]).map(r => [r.user_id, r.display_name?.trim() || unnamed]))
    }
    if (table === 'people') {
      const { data, error } = await admin.from('people').select('id, display_name').eq('workspace_id', workspaceId).in('id', ids)
      if (error) throw error
      return new Map(((data ?? []) as { id: string; display_name: string | null }[]).map(r => [r.id, r.display_name?.trim() || unnamed]))
    }
    const { data, error } = await admin.from('projects').select('id, name').eq('workspace_id', workspaceId).in('id', ids)
    if (error) throw error
    return new Map(((data ?? []) as { id: string; name: string | null }[]).map(r => [r.id, r.name?.trim() || unnamed]))
  } catch (error) {
    console.error('[authz events] 이름 조회 실패', { table, workspaceId, cause: error })
    return null
  }
}

export async function listAuthzEvents(workspaceId: string, opts?: { limit?: number; before?: number }): Promise<AuthzEventsResult> {
  // 오류 문구와 목록에 보이는 글자(종류·원인·요약·이름 자리 대체)는 요청의 화면 언어를 따른다 — 요청 범위 밖(단위 테스트)에서는 한국어
  const t = await serverTranslator()
  if (typeof workspaceId !== 'string' || !isUuidLike(workspaceId)) return { ok: false, error: t('err.workspaceIdNotValid') }
  const g = await requireWorkspaceAdmin(workspaceId)
  if (!g.ok) return { ok: false, error: g.error }
  const sb = await createServerClient()
  const r = await listAuthzEventRows(sb, { workspaceId, includePlatform: g.actor.isSuperuser, limit: opts?.limit, before: opts?.before })
  if (!r.ok) { console.error('[authz events] 이력 조회 실패', { workspaceId, cause: r.error }); return { ok: false, error: t(ERR_LOAD) } }

  const nameUnknown = t('authz.who.unavailable')
  const { admin } = adminFor({ workspaceId })
  const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => x !== null))]
  const [users, people, projects] = await Promise.all([
    lookup('profiles', admin, uniq(r.rows.flatMap(row => [row.actorUserId, row.targetUserId])), workspaceId, t),
    lookup('people', admin, uniq(r.rows.map(row => row.targetPersonId)), workspaceId, t),
    lookup('projects', admin, uniq(r.rows.map(row => row.projectId)), workspaceId, t),
  ])
  const user = (id: string | null, none: string) => id === null ? none : users === null ? nameUnknown : users.get(id) ?? t('authz.who.deletedAccount')
  return {
    ok: true, nextBefore: r.nextBefore,
    rows: r.rows.map(row => ({
      id: row.id, kind: row.kind, kindLabel: authzKindLabel(row.kind, t),
      summary: describeAuthzChange(row.kind, row.before, row.after, t), causeLabel: authzCauseLabel(row.cause, t),
      actorName: user(row.actorUserId, t('authz.who.system')),
      // 계정 없는 인물(명단에만 있는 사람)은 인물 이름이 대상이다
      targetName: row.targetUserId !== null ? user(row.targetUserId, '') : row.targetPersonId !== null
        ? (people === null ? nameUnknown : people.get(row.targetPersonId) ?? t('authz.who.deletedPerson')) : '—',
      projectName: row.projectId === null ? null : projects === null ? nameUnknown : projects.get(row.projectId) ?? t('authz.who.deletedProject'),
      createdAt: row.createdAt,
    })),
  }
}
