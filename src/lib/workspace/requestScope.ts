/**
 * 세션 라우트 요청이 실을 워크스페이스(D26 — UI-2b, 계획 과제 34) — 순수. 셸의 게시 저장소(ShellScope)는 효과로 게시되어 경로보다 한 커밋 늦다.
 * - 프로젝트 화면(/p/…)은 싣지 않는다 — 프로젝트가 판정하고, 이전 워크스페이스가 실리면 서버(requireScopedSessionModule)가 조합 불일치로 404 를 낸다.
 * - 워크스페이스 화면(/w/<slug>…)은 게시 범위의 슬러그가 경로와 같을 때만 — 다르면 아직 이전 범위라 null(호출부는 기다리거나 보내지 않는다).
 * - 그 밖(범위 없음)은 null — 서버가 400 으로 닫는다. 추측하지 않는다.
 */
import { parseScopePath } from '@/lib/nav/active'
import type { WorkspaceRef } from './constants'

export function requestWorkspaceId(pathname: string, scope: { workspace: WorkspaceRef | null } | null): string | null {
  const parsed = parseScopePath(pathname)
  if (parsed?.scope === 'project') return null
  const ws = scope?.workspace
  if (!ws) return null
  if (parsed?.scope === 'workspace' && parsed.key !== ws.slug) return null
  return ws.id
}
