/**
 * 워크스페이스 해석(스펙 §5.2, ★1·★2) — 슬러그·id → { id, slug, name }. 세션 클라이언트라 RLS `workspaces_read` 가 비소속을 0행으로 만든다
 * (존재 은닉 — 플랫폼 관리자는 my_workspace_ids() 가 전부를 준다). 조회 오류는 unavailable — 404 로 위장하지 않는다(에러 3원칙 ①).
 * 요청 범위 React cache — 레이아웃·페이지가 같은 요청에서 다시 불러도 1회.
 */
import { cache } from 'react'
import { createServerClient } from '@/lib/supabase/server'
import { UUID_RE } from '@/lib/domain/validate'
import { SLUG_RE, type WorkspaceRef } from './constants'

export { SLUG_RE, type WorkspaceRef } from './constants'

export type WsLookup =
  | { ok: true; ws: WorkspaceRef }
  | { ok: false; kind: 'missing' }
  | { ok: false; kind: 'unavailable'; error: string }

async function lookup(col: 'slug' | 'id', value: string): Promise<WsLookup> {
  const db = await createServerClient()
  const { data, error } = await db.from('workspaces').select('id, slug, name').eq(col, value).maybeSingle()
  if (error) {
    console.error('[workspace] 조회 실패:', col, value, error.message)
    return { ok: false, kind: 'unavailable', error: error.message }
  }
  return data ? { ok: true, ws: data as WorkspaceRef } : { ok: false, kind: 'missing' }
}

export const resolveWorkspaceBySlug = cache(async (slug: string): Promise<WsLookup> => {
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) return { ok: false, kind: 'missing' }
  return lookup('slug', slug)
})

/** 프로젝트 화면·스텁이 워크스페이스 id 에서 슬러그·이름을 얻는 길(D38) */
export const workspaceRefById = cache(async (id: string): Promise<WsLookup> => {
  if (typeof id !== 'string' || !UUID_RE.test(id)) return { ok: false, kind: 'missing' }
  return lookup('id', id)
})
