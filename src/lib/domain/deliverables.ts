// 산출물 첨부 도메인 — 순수 함수만(I/O 없음). 경로 규약은 storagePath.ts 가 정본이다.
import { isStoragePathFor } from './storagePath'

/** 경로가 그 WBS 항목 스코프(ws/<wid>/p/<pid>/deliverables/<itemId>/…)인지. scope 는 DB 의 항목 행(→ 프로젝트 → 워크스페이스)에서 얻는다. */
export function isDeliverablePathValid(
  scope: { workspaceId: string; projectId: string }, itemId: string, path: string,
): boolean {
  if (!itemId) return false
  return isStoragePathFor(path, { workspaceId: scope.workspaceId, projectId: scope.projectId, entity: 'deliverables', entityId: itemId })
}
