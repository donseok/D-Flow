import 'server-only'
import type { ProjectConfig } from '@/lib/settings/projectConfig'
import { getWorkspaceConfig } from '@/lib/settings/workspaceConfig'
import { valueOf } from '@/lib/settings/registry'
import { pick } from '@/lib/settings/pick'

/** 안내용 사유만 구분한다. 보드 허용 판정은 requireModule의 결과를 그대로 사용한다. */
export async function boardUnavailableReason(cfg: ProjectConfig): Promise<'project_off' | 'workspace_denied' | 'unknown'> {
  try {
    const ws = await getWorkspaceConfig(cfg.workspaceId)
    if (!valueOf(ws, 'modules.allowed').includes('kanban')) return 'workspace_denied'
    const enabled = pick(cfg, 'modules.enabled')
    if (!enabled.ok) console.error('[wbs] 프로젝트 모듈 판정 실패:', enabled.error)
    if (enabled.ok && !enabled.value.includes('kanban')) return 'project_off'
    return 'unknown'
  } catch (error) {
    console.error('[wbs] 보드 제한 사유 조회 실패:', error)
    return 'unknown'
  }
}
