import { cache } from 'react'
import { notFound } from 'next/navigation'
import { getActorViewState } from '@/lib/authz'
import { workspaceRoleIn } from '@/lib/domain/authz'
import { createServerClient } from '@/lib/supabase/server'

export interface WorkspacePageAccess {
  id: string
  slug: string
  name: string
  isSuperuser: boolean
  isAdmin: boolean
}

/** 설정 경로의 슬러그·소속 판정. 조회 장애는 404 로 위장하지 않는다. */
export const workspacePageAccess = cache(async (slug: string): Promise<WorkspacePageAccess> => {
  const state = await getActorViewState()
  if (state.degraded) throw new Error('워크스페이스 접근 권한을 확인하지 못했습니다.')
  if (!state.actor) notFound()

  const db = await createServerClient()
  const { data, error } = await db.from('workspaces').select('id, slug, name').eq('slug', slug).maybeSingle()
  if (error) {
    console.error('[workspace settings] 워크스페이스 조회 실패:', error.message)
    throw new Error('워크스페이스를 조회하지 못했습니다.')
  }
  if (!data) notFound()
  const row = data as { id: string; slug: string; name: string }
  const role = workspaceRoleIn(state.actor, row.id)
  if (!role) notFound()
  return { ...row, isSuperuser: state.actor.isSuperuser, isAdmin: role === 'superuser' || role === 'admin' }
})
