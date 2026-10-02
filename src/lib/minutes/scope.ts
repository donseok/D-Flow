/** 회의록 화면의 범위(계획 V13) — 슬러그 워크스페이스 + 선택 프로젝트(?project=, D53). 액션 인자는 클라이언트 입력이라 모양만 본다 —
 *  소속·접근 판정은 액션의 관문이 한다 */
export interface MinutesScope { workspaceId: string; projectId: string | null }

export function parseMinutesScope(x: unknown): MinutesScope | null {
  if (!x || typeof x !== 'object') return null
  const { workspaceId, projectId } = x as { workspaceId?: unknown; projectId?: unknown }
  if (typeof workspaceId !== 'string' || !workspaceId) return null
  if (projectId !== null && projectId !== undefined && typeof projectId !== 'string') return null
  return { workspaceId, projectId: projectId ?? null }
}
