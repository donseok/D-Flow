/**
 * 사용자 매뉴얼의 보는 사람 등급(스펙 2026-10-16 §2.4) — 가드가 아니라 목차 거르기의 판정이다(매뉴얼은 로그인만 요구한다).
 * 가진 것 중 가장 높은 등급: 플랫폼 관리자 > 어느 워크스페이스든 관리자 > 어느 프로젝트든 명단 관리자 > 멤버.
 */
import { ACCESS_ROLE, WORKSPACE_ROLE, type Actor } from '@/lib/domain/authz'
import type { ManualAudience } from '@/lib/manual/parse'

export function manualAudienceOf(actor: Actor | null): ManualAudience {
  if (!actor) return 'member'
  if (actor.isSuperuser) return 'platformAdmin'
  for (const role of actor.workspaceRoles.values()) if (role === WORKSPACE_ROLE.admin) return 'workspaceAdmin'
  for (const role of actor.projectRoles.values()) if (role === ACCESS_ROLE.admin) return 'projectAdmin'
  return 'member'
}

/** 화면용 — 판독이 열화됐거나 actor 가 없으면 멤버로 좁히고 그 사실을 알린다(조회 실패를 숨기지 않는다: 화면 안내 + 로그) */
export function manualViewer(state: { actor: Actor | null; degraded: boolean }): { audience: ManualAudience; uncertain: boolean } {
  if (state.degraded || !state.actor) {
    console.error('[manual] 권한 정보를 읽지 못해 일반 사용자용 장만 보입니다', { degraded: state.degraded, actor: state.actor ? 'present' : 'none' })
    return { audience: 'member', uncertain: true }
  }
  return { audience: manualAudienceOf(state.actor), uncertain: false }
}
