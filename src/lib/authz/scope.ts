import type { SupabaseClient } from '@supabase/supabase-js'
import { ERR_LOOKUP, ERR_MISSING } from './errors'

/** project_id 컬럼을 직접 가진 표 화이트리스트 — 임의 표 조회를 막는다. */
export type ProjectScopedTable =
  | 'wbs_items' | 'meetings' | 'issues' | 'minutes' | 'attendance_records'
  | 'announcements' | 'weekly_reports' | 'project_members' | 'task_dependencies'
export type ScopeResult = { ok: true; projectId: string | null; workspaceId: string } | { ok: false; error: string }

/** 대상 행의 프로젝트·워크스페이스. minutes 만 project_id 가 nullable 이라 자기 workspace_id(0006)를 읽는다.
 *  조회 실패는 쓰기 중단 사유(3원칙 ②), 워크스페이스를 못 얻으면 fail-closed. 세션 클라이언트면 RLS 가 타 워크스페이스 행을 가려 ERR_MISSING. */
export async function readScope(
  db: Pick<SupabaseClient, 'from'>, table: ProjectScopedTable, id: string, tag: string,
): Promise<ScopeResult> {
  const cols = table === 'minutes' ? 'project_id, workspace_id' : 'project_id, projects!inner(workspace_id)'
  const { data, error } = await db.from(table).select(cols).eq('id', id).maybeSingle()
  if (error) {
    console.error(`[${tag}] ${table} 조회 실패:`, error.message)
    return { ok: false, error: ERR_LOOKUP }
  }
  if (!data) return { ok: false, error: ERR_MISSING }
  const row = data as Record<string, unknown>
  const embedded = row.projects as { workspace_id?: unknown } | Array<{ workspace_id?: unknown }> | null | undefined
  const ws = table === 'minutes' ? row.workspace_id : (Array.isArray(embedded) ? embedded[0]?.workspace_id : embedded?.workspace_id)
  if (typeof ws !== 'string' || !ws) {
    console.error(`[${tag}] ${table} 워크스페이스를 확정하지 못했다:`, id)
    return { ok: false, error: ERR_LOOKUP }
  }
  return { ok: true, projectId: (row.project_id as string | null) ?? null, workspaceId: ws }
}
