import type { Actor } from '@/lib/domain/authz'

/**
 * 컴포넌트 상태 점검(/admin/ui-states, SP3b 스펙 D16) — 플랫폼 관리자만. 판정은 이 한 곳(canManageLlmConfig 관례).
 * 페이지는 requireSuperuser 를 부르지 않는다 — 그 호출 위치는 platform-guards 불변식이 11곳으로 고정한다.
 * actor 가 null(권한 조회 실패)이면 거짓 — 페이지는 404 다(fail-closed).
 */
export function canViewUiStates(actor: Pick<Actor, 'isSuperuser'> | null): boolean {
  return actor?.isSuperuser === true
}
