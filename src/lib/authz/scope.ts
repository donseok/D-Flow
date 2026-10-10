import type { SupabaseClient } from '@supabase/supabase-js'
import { guardFail, type GuardFailure } from './errors'

/** project_id 컬럼을 직접 가진 표 화이트리스트 — 임의 표 조회를 막는다. */
export type ProjectScopedTable =
  | 'wbs_items' | 'meetings' | 'issues' | 'minutes' | 'attendance_records'
  | 'announcements' | 'weekly_reports' | 'project_members' | 'task_dependencies'
  /** 프로젝트 행 자체 — id 가 곧 프로젝트다(프로젝트 삭제처럼 projectId 를 받지만 판정은 워크스페이스 등급인 액션) */
  | 'projects'
export type ScopeResult = { ok: true; projectId: string | null; workspaceId: string } | GuardFailure

/** 대상 행의 프로젝트·워크스페이스. minutes 만 project_id 가 nullable 이라 자기 workspace_id(0006)를 읽는다.
 *  조회 실패는 쓰기 중단 사유(3원칙 ②), 워크스페이스를 못 얻으면 fail-closed. 세션 클라이언트면 RLS 가 타 워크스페이스 행을 가려 ERR_MISSING. */
export async function readScope(
  db: Pick<SupabaseClient, 'from'>, table: ProjectScopedTable, id: string, tag: string,
): Promise<ScopeResult> {
  const own = table === 'minutes' || table === 'projects'   // 자기 workspace_id 열을 읽는 표
  const cols = table === 'projects' ? 'id, workspace_id' : table === 'minutes' ? 'project_id, workspace_id' : 'project_id, projects!inner(workspace_id)'
  const { data, error } = await db.from(table).select(cols).eq('id', id).maybeSingle()
  if (error) {
    console.error(`[${tag}] ${table} 조회 실패:`, error.message)
    return guardFail('lookup')
  }
  if (!data) return guardFail('missing')
  const row = data as Record<string, unknown>
  const embedded = row.projects as { workspace_id?: unknown } | Array<{ workspace_id?: unknown }> | null | undefined
  const ws = own ? row.workspace_id : (Array.isArray(embedded) ? embedded[0]?.workspace_id : embedded?.workspace_id)
  if (typeof ws !== 'string' || !ws) {
    console.error(`[${tag}] ${table} 워크스페이스를 확정하지 못했다:`, id)
    return guardFail('lookup')
  }
  return { ok: true, projectId: ((table === 'projects' ? row.id : row.project_id) as string | null) ?? null, workspaceId: ws }
}
