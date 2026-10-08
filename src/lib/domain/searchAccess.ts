/**
 * 검색 요청의 프로젝트 접근 판정 — 이 검색의 유일한 관문이다.
 *
 * ai_documents 의 RLS 는 워크스페이스 단위이고(0036 — my_workspace_ids)
 * match_ai_documents 도 authenticated 실행이 허용돼 있다. 즉 DB 는 프로젝트를
 * 막지 않는다(이 검색은 service_role 로 돌아 RLS 도 없다). 비공개 프로젝트(0070)도 RLS 잠금이 아니라 앱 판정 하나뿐이라,
 * 여기서 막지 못하면 projectId 를 아는 로그인 사용자에게 회의록 본문이 샌다.
 */
export type SearchAccessDecision =
  | { ok: true; projectIds: string[]; workspaceId: string }
  | { ok: false; status: 403 | 503; reason: string }

type ScopeInput =
  | { ok: true; scope: { allowedProjectIds: string[]; projectWorkspace?: Readonly<Record<string, string>> } }
  | { ok: false }

export function decideSearchAccess(
  requestedProjectId: string,
  scope: ScopeInput,
): SearchAccessDecision {
  // 스코프를 못 읽었으면 모르는 것이다. 모르면 닫는다.
  if (!scope.ok) return { ok: false, status: 503, reason: 'ACCESS_SCOPE_UNAVAILABLE' }

  const requested = requestedProjectId.trim()
  if (!requested) return { ok: false, status: 403, reason: 'PROJECT_REQUIRED' }

  // 빈 허용 목록은 "전체 허용" 이 아니라 "아무것도 허용 안 됨" 이다.
  if (!scope.scope.allowedProjectIds.includes(requested)) {
    return { ok: false, status: 403, reason: 'PROJECT_FORBIDDEN' }
  }

  // 검색 RPC 는 워크스페이스가 필수다(0042). 그 프로젝트의 워크스페이스는 스코프(서버 조회)에서만 온다 —
  // 모르면 검색하지 않는다. 빈 결과가 아니라 실패로 돌려준다(조회 실패를 '없음'으로 위장하지 않는다).
  const workspaces = scope.scope.projectWorkspace
  const workspaceId = workspaces && Object.hasOwn(workspaces, requested) ? workspaces[requested] : null
  if (typeof workspaceId !== 'string' || !workspaceId.trim()) {
    return { ok: false, status: 503, reason: 'ACCESS_SCOPE_UNAVAILABLE' }
  }

  // 요청 하나만 넘긴다. 클라이언트가 보낸 목록은 어디에도 쓰지 않는다.
  return { ok: true, projectIds: [requested], workspaceId }
}
