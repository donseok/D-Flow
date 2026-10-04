/**
 * 회의록 폴더 행 → MinuteFolder(SP5 B2) — 폴더 로더 셋(탐색기 data·액션 loadFolders·서버 스냅샷)이 같은 열과 같은 해석을 쓴다.
 * 종류는 kind, 팀 루트의 팀은 team_id 와 조인한 팀 code 다 — created_by 로 종류를 판정하지 않는다(minute-folder-kind 불변식).
 * 팀 조인이 비면(팀을 볼 수 없음) teamCode null — 팀을 파생하지 않는다(fail-closed).
 */
import type { MinuteFolder, MinuteFolderKind } from '@/lib/domain/types'

export const MINUTE_FOLDER_COLS = 'id, name, parent_id, sort, created_by, project_id, workspace_id, kind, team_id, team:teams(code)'

const KINDS: readonly MinuteFolderKind[] = ['user', 'team_root', 'custom_root']

export function folderKindOf(raw: unknown): MinuteFolderKind {
  return KINDS.includes(raw as MinuteFolderKind) ? raw as MinuteFolderKind : 'user'
}

/** 조인 결과(객체 또는 배열 하나)에서 팀 code */
export function joinedTeamCode(raw: unknown): string | null {
  const one = Array.isArray(raw) ? raw[0] : raw
  const code = (one as { code?: unknown } | null | undefined)?.code
  return typeof code === 'string' && code.trim() !== '' ? code.trim() : null
}

export function minuteFolderFromRow(f: Record<string, unknown>): MinuteFolder {
  const kind = folderKindOf(f.kind)
  return {
    id: f.id as string,
    name: f.name as string,
    parentId: (f.parent_id as string | null) ?? null,
    sort: (f.sort as number | null) ?? 0,
    createdBy: (f.created_by as string | null) ?? null,
    projectId: (f.project_id as string | null) ?? null,
    workspaceId: (f.workspace_id as string | null) ?? null,
    kind,
    teamId: kind === 'team_root' ? (f.team_id as string | null) ?? null : null,
    teamCode: kind === 'team_root' ? joinedTeamCode(f.team) : null,
  }
}
