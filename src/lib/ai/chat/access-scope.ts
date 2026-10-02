import type { ChatRequestV2 } from './protocol'

export type ChatProjectScopeResult =
  | { ok: true; projectId: string | null }
  | { ok: false; code: 'PROJECT_CONTEXT_MISMATCH' | 'PROJECT_ACCESS_DENIED'; status: 400 | 403; message: string }

function projectHints(request: ChatRequestV2) {
  const legacyHint = request.projectId
  const pageHint = request.pageContext?.projectId ?? null
  // typed PageContextV1.selectedProjectId 계약(리뷰 M-4). sanitize가 공백/형식을 이미 걸렀다.
  const selectedProjectValue = request.pageContext?.selectedProjectId
  const selectedProjectHint = typeof selectedProjectValue === 'string'
    && selectedProjectValue.toLowerCase() !== 'all'
    ? selectedProjectValue
    : null
  return { legacyHint, pageHint, selectedProjectHint }
}

/** 요청이 가리키는 프로젝트 — 화면 문맥 > 옛 필드 > 선택 프로젝트(스코프 검증과 같은 우선순위). 범위 관문(requireScopedSessionModule)의
 *  프로젝트 입력도 이것이다 — 선택 프로젝트 힌트로 "프로젝트와 다른 워크스페이스는 404" 판정을 우회하지 않게(U2b-5 리뷰 수정 CC6) */
export function chatProjectHint(request: ChatRequestV2): string | null {
  const { legacyHint, pageHint, selectedProjectHint } = projectHints(request)
  return pageHint ?? legacyHint ?? selectedProjectHint
}

/** Client project IDs are hints; this only accepts them after intersection with the server-resolved scope. */
export function validateChatProjectScope(
  request: ChatRequestV2,
  allowedProjectIds: readonly string[],
): ChatProjectScopeResult {
  const { legacyHint, pageHint, selectedProjectHint } = projectHints(request)
  const hints = [legacyHint, pageHint, selectedProjectHint].filter((id): id is string => !!id)
  if (new Set(hints).size > 1) {
    return {
      ok: false,
      code: 'PROJECT_CONTEXT_MISMATCH',
      status: 400,
      message: '프로젝트 문맥이 일치하지 않습니다.',
    }
  }
  const projectId = chatProjectHint(request)
  if (projectId && !allowedProjectIds.includes(projectId)) {
    return {
      ok: false,
      code: 'PROJECT_ACCESS_DENIED',
      status: 403,
      message: '해당 프로젝트에 접근할 수 없습니다.',
    }
  }
  return { ok: true, projectId }
}
