import 'server-only'
import type { Actor } from '@/lib/domain/authz'
import { isWorkspaceAdmin } from '@/lib/domain/authz'
import { fetchAllPages } from '@/lib/data/paging'
import { createServerClient } from '@/lib/supabase/server'

export interface WorkspaceLink { id: string; slug: string; name: string }

/** 화면 진입 링크용 목록. 관리자 권한과 세션 RLS를 모두 통과한 행만 돌려준다. */
export async function manageableWorkspaceLinks(actor: Actor | null, onlyId?: string): Promise<WorkspaceLink[]> {
  if (!actor) return []
  if (onlyId && !isWorkspaceAdmin(actor, onlyId)) return []
  const ids = actor.isSuperuser ? null : [...actor.workspaceRoles]
    .filter(([id]) => isWorkspaceAdmin(actor, id)).map(([id]) => id)
  if (ids?.length === 0) return []
  const db = await createServerClient()
  return fetchAllPages<WorkspaceLink>('관리 가능한 워크스페이스', (from, to) => {
    let query = db.from('workspaces').select('id, slug, name', { count: 'exact' })
    if (onlyId) query = query.eq('id', onlyId)
    else if (ids) query = query.in('id', ids)
    return query.order('id').range(from, to)
  })
}
