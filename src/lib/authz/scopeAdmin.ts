import type { SupabaseClient } from '@supabase/supabase-js'
import { readScope, type ProjectScopedTable, type ScopeResult } from './scope'

/** service_role 경로용(RLS 없음) — 호출자가 이미 주체(PAT·세션 가드)를 확인한 뒤에만 쓴다. */
export async function resolveScopeAdmin(
  admin: Pick<SupabaseClient, 'from'>, table: ProjectScopedTable, id: string,
): Promise<ScopeResult> {
  return readScope(admin, table, id, 'resolveScopeAdmin')
}
