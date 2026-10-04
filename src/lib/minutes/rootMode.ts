/**
 * 워크스페이스의 회의록 최상위 폴더 모드 판독(SP5 B2 — minutes.root_folders). 서버 전용.
 * 판독 실패는 { ok: false } — 편철 정규화가 모드에 따라 갈리므로 추측하지 않고 호출부가 중단한다(3원칙 ②).
 * 저장 값이 손상이면 teams(v2.8 그대로 — 제품 기본값)로 동작하고 로그만 남긴다(설정 화면도 같은 안내 — RootFoldersEditor).
 */
import { getWorkspaceConfig } from '@/lib/settings/workspaceConfig'
import type { ConfigReadClient } from '@/lib/settings/projectConfig'
import { DEFAULT_ROOT_FOLDERS, type RootFoldersSetting } from './rootFolders'

export async function loadRootFolders(
  workspaceId: string, opts?: { client?: ConfigReadClient },
): Promise<{ ok: true; value: RootFoldersSetting } | { ok: false }> {
  try {
    const state = (await getWorkspaceConfig(workspaceId, opts)).keys['minutes.root_folders']
    if (state.status === 'set' || state.status === 'default') return { ok: true, value: state.value as RootFoldersSetting }
    console.error('[minutes] 최상위 폴더 설정 손상 — teams 로 동작한다', { workspaceId, status: state.status })
    return { ok: true, value: { ...DEFAULT_ROOT_FOLDERS } }
  } catch (e) {
    console.error('[minutes] 워크스페이스 설정 조회 실패 — 편철하지 않는다', { workspaceId }, e)
    return { ok: false }
  }
}
