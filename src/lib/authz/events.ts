// 권한 변경 이력 읽기(스펙 SP3a §6) — 받은 클라이언트로 읽는다. 화면 경로는 세션이라 RLS 정책(authz_events_read: 플랫폼 관리자는 전부,
// 워크스페이스 관리자는 자기 워크스페이스 행)이 한 번 더 좁힌다. 이 표의 이름은 src 에서 이 파일에만 있고 접근은 select 뿐이다
// (settings-writes 허용 목록·읽기 전용). 쓰기는 권한 RPC 안의 트리거가 한다 — 앱은 쓰지 않는다.
import type { ConfigReadClient } from '@/lib/settings/projectConfig'
import type { AuthzEventCause, AuthzEventKind } from '@/lib/domain/authzEvents'

export const AUTHZ_EVENTS_PAGE = 20
const AUTHZ_EVENTS_MAX = 100

export interface AuthzEventRow {
  id: number
  kind: AuthzEventKind
  workspaceId: string | null
  projectId: string | null
  targetUserId: string | null
  targetPersonId: string | null
  before: unknown
  after: unknown
  cause: AuthzEventCause
  actorUserId: string | null
  commandId: string | null
  createdAt: string
}

type Row = {
  id: number | string; kind: AuthzEventKind; workspace_id: string | null; project_id: string | null; target_user_id: string | null
  target_person_id: string | null; before: unknown; after: unknown; cause: AuthzEventCause; actor_user_id: string | null
  command_id: string | null; created_at: string
}
const COLS = 'id, kind, workspace_id, project_id, target_user_id, target_person_id, before, after, cause, actor_user_id, command_id, created_at'

const toRow = (r: Row): AuthzEventRow => ({
  id: Number(r.id), kind: r.kind, workspaceId: r.workspace_id, projectId: r.project_id, targetUserId: r.target_user_id,
  targetPersonId: r.target_person_id, before: r.before, after: r.after, cause: r.cause, actorUserId: r.actor_user_id,
  commandId: r.command_id, createdAt: r.created_at,
})

/**
 * 한 워크스페이스의 이력(최신 순, 커서 = id). includePlatform 은 플랫폼 관리자 지정·해제 행(워크스페이스가 없다)도 싣는다 —
 * 호출부가 플랫폼 관리자에게만 켠다(RLS 도 같은 선을 긋는다).
 */
export async function listAuthzEventRows(
  client: ConfigReadClient,
  opts: { workspaceId: string; includePlatform: boolean; limit?: number; before?: number },
) {
  const limit = Math.min(Math.max(1, Math.trunc(opts.limit ?? AUTHZ_EVENTS_PAGE)), AUTHZ_EVENTS_MAX)
  let q = client.from('authz_events').select(COLS)
  q = opts.includePlatform ? q.or(`workspace_id.eq.${opts.workspaceId},kind.eq.platform_admin`) : q.eq('workspace_id', opts.workspaceId)
  if (opts.before !== undefined) q = q.lt('id', opts.before)
  const { data, error } = await q.order('id', { ascending: false }).limit(limit + 1)
  if (error) return { ok: false as const, error: `권한 이력 조회 실패: ${error.message}` }
  const rows = ((data ?? []) as unknown as Row[]).map(toRow)
  const page = rows.slice(0, limit)
  return { ok: true as const, rows: page, nextBefore: rows.length > limit ? page[page.length - 1].id : null }
}
