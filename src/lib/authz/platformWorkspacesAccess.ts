import type { Actor } from '@/lib/domain/authz'

/**
 * 워크스페이스 목록·생성(/admin/workspaces, 개정 §5.3.1·§5.3.2) — 플랫폼 관리자만. 판정은 이 한 곳(canManageLlmConfig 관례).
 * 페이지·소속 0 화면의 링크·내비 caps 가 같은 판정을 쓴다. 페이지는 requireSuperuser 를 부르지 않는다 — 그 호출 위치는
 * platform-guards 불변식이 닫는다(쓰기·목록 조회는 서버 액션이 다시 가드한다).
 * actor 가 null(권한 조회 실패)이면 거짓 — 페이지는 404 다(fail-closed).
 */
export function canManageWorkspaces(actor: Pick<Actor, 'isSuperuser'> | null): boolean {
  return actor?.isSuperuser === true
}
