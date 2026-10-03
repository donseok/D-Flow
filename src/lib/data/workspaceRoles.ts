import 'server-only'
import { createServerClient } from '@/lib/supabase/server'
import { fetchAllPages } from '@/lib/data/paging'
import type { WorkspaceRole } from '@/lib/domain/authz'

/** 세션 RLS 아래에서 대상 워크스페이스만 끝까지 읽는다. */
export async function getWorkspaceRoleMap(workspaceId: string): Promise<{ ok: true; map: Map<string, WorkspaceRole> } | { ok: false; error: string }> {
  try {
    const sb = await createServerClient()
    const rows = await fetchAllPages<{ user_id: string; role: WorkspaceRole }>('워크스페이스 역할', (from, to) =>
      sb.from('workspace_members').select('user_id, role', { count: 'exact' }).eq('workspace_id', workspaceId).order('user_id').range(from, to))
    return { ok: true, map: new Map(rows.map(row => [row.user_id, row.role])) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
