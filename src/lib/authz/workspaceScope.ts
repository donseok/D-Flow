/**
 * /w/[slug]/** 페이지의 첫 await(스펙 §5.2, E19) — 레이아웃의 notFound() 는 페이지 로더를 멈추지 못하므로 페이지가 스스로 판정한다.
 * 가드가 아니다(require* 이름 금지 — CLAUDE.md 가드 넷). 액션은 여전히 네 가드를 쓴다.
 * - 미존재·비소속(RLS 0행) 또는 (열화가 아니고) 그 워크스페이스 역할이 없음 → notFound()(존재 은닉)
 * - 슬러그 조회 오류 → throw(오류 경계 — 404 로 위장하지 않는다)
 * - 권한 조회 실패(열화) → { actor: null, degraded: true } — 페이지는 service_role 로더를 부르지 않는다(fail-closed)
 */
import { notFound } from 'next/navigation'
import { getActorViewState } from '@/lib/authz'
import { workspaceRoleIn, type Actor, type WorkspaceRole } from '@/lib/domain/authz'
import { resolveWorkspaceBySlug, type WorkspaceRef } from '@/lib/workspace/resolve'

export interface WorkspaceScope { ws: WorkspaceRef; actor: Actor | null; degraded: boolean; role: 'superuser' | WorkspaceRole | null }

export async function loadWorkspaceScope(slug: string): Promise<WorkspaceScope> {
  const [lookup, state] = await Promise.all([resolveWorkspaceBySlug(slug), getActorViewState()])
  if (!lookup.ok) {
    if (lookup.kind === 'missing') notFound()
    throw new Error(`워크스페이스를 조회하지 못했습니다: ${lookup.error}`)
  }
  if (state.degraded) return { ws: lookup.ws, actor: null, degraded: true, role: null }
  const role = workspaceRoleIn(state.actor, lookup.ws.id)
  if (role === null) notFound()
  return { ws: lookup.ws, actor: state.actor, degraded: false, role }
}
