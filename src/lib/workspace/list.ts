/** 내 소속 워크스페이스(스펙 §5.2, D4) — workspace_members 행만 센다(플랫폼 관리자도). 가입 순(created_at → workspace_id) =
 *  prefsWorkspaceId·0006 백필과 같은 규칙이라 첫 행이 "가장 먼저 가입한 소속"이다. 전환기 목록·현재 워크스페이스 해석의 원천 */
import { cache } from 'react'
import { getSession } from '@/lib/auth'
import { createServerClient } from '@/lib/supabase/server'
import type { WorkspaceRole } from '@/lib/domain/authz'
import type { WorkspaceRef } from './resolve'

export interface MyWorkspace extends WorkspaceRef { role: WorkspaceRole; joinedAt: string }
type Row = { role: WorkspaceRole; created_at: string; workspaces: WorkspaceRef | WorkspaceRef[] | null }

export const listMyWorkspaces = cache(async (): Promise<{ ok: true; rows: MyWorkspace[] } | { ok: false; error: string }> => {
  const user = await getSession()
  if (!user) return { ok: true, rows: [] }
  const db = await createServerClient()
  const { data, error } = await db.from('workspace_members')
    .select('role, created_at, workspace_id, workspaces!inner(id, slug, name)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true }).order('workspace_id', { ascending: true })
  if (error) {
    console.error('[workspace] 소속 목록 조회 실패:', error.message)
    return { ok: false, error: error.message }
  }
  const rows: MyWorkspace[] = []
  for (const r of (data ?? []) as Row[]) {
    const ws = Array.isArray(r.workspaces) ? r.workspaces[0] : r.workspaces
    if (ws) rows.push({ id: ws.id, slug: ws.slug, name: ws.name, role: r.role, joinedAt: r.created_at })
  }
  return { ok: true, rows }
})
