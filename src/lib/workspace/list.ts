/** 내 소속 워크스페이스(스펙 §5.2, D4) — workspace_members 행만 센다(플랫폼 관리자도). 가입 순(created_at → workspace_id) =
 *  prefsWorkspaceId·0006 백필과 같은 규칙이라 첫 행이 "가장 먼저 가입한 소속"이다. 전환기 목록·현재 워크스페이스 해석의 원천 */
import { cache } from 'react'
import { createServerClient } from '@/lib/supabase/server'
import type { WorkspaceRole } from '@/lib/domain/authz'
import type { WorkspaceRef } from './resolve'

export interface MyWorkspace extends WorkspaceRef { role: WorkspaceRole; joinedAt: string }
type Row = { role: WorkspaceRole; created_at: string; workspaces: WorkspaceRef | WorkspaceRef[] | null }

export const listMyWorkspaces = cache(async (): Promise<{ ok: true; rows: MyWorkspace[] } | { ok: false; error: string }> => {
  // 신원은 getActor 와 같은 원천(getClaims 의 sub)이다. 인증 호출의 오류를 "비로그인 = 소속 0"으로 바꾸면 장애가 "소속이 없습니다" 화면으로
  // 위장된다(U2a-1 보안 리뷰 P2) — 오류는 ok:false, claims 가 없을 때만 빈 목록.
  const db = await createServerClient()
  const { data: auth, error: authErr } = await db.auth.getClaims()
  if (authErr) {
    console.error('[workspace] 인증 조회 실패:', authErr.message)
    return { ok: false, error: authErr.message }
  }
  const userId = auth?.claims?.sub
  if (!userId) return { ok: true, rows: [] }
  const { data, error } = await db.from('workspace_members')
    .select('role, created_at, workspace_id, workspaces!inner(id, slug, name)')
    .eq('user_id', userId)
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
