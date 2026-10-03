import 'server-only'
import { getProjectConfig, type ConfigReadClient } from '@/lib/settings/projectConfig'
import { getWorkspaceConfig } from '@/lib/settings/workspaceConfig'
import { ConfigUnavailableError } from '@/lib/settings/errors'
import { valueOf } from '@/lib/settings/registry'
import type { AttachmentPolicy } from './attachmentPolicy'

/** 호출부가 가드 뒤 실제 minutes 행에서 얻은 scope를 전달한다. 클라이언트의 선택/정책을 신뢰하지 않는다.
 * D24: project_id 유무로 딱 한 스코프를 읽는다. 프로젝트 설정 오류를 워크스페이스/기본값으로 대체하지 않는다. */
export async function resolveAttachmentPolicy(
  minute: { workspaceId: string | null; projectId: string | null },
  opts?: { client?: ConfigReadClient },
): Promise<AttachmentPolicy> {
  if (!minute.workspaceId) throw new ConfigUnavailableError('회의록 첨부의 워크스페이스를 확인하지 못했습니다.')
  if (minute.projectId !== null) {
    if (!minute.projectId) throw new ConfigUnavailableError('회의록 첨부의 프로젝트를 확인하지 못했습니다.')
    const cfg = await getProjectConfig(minute.projectId, opts)
    if (cfg.schemaAhead || cfg.projectId !== minute.projectId || cfg.workspaceId !== minute.workspaceId) {
      throw new ConfigUnavailableError('회의록 첨부 설정의 범위·세대를 확인하지 못했습니다.')
    }
    return valueOf(cfg, 'minutes.attachments')
  }
  const cfg = await getWorkspaceConfig(minute.workspaceId, opts)
  if (cfg.schemaAhead || cfg.workspaceId !== minute.workspaceId) {
    throw new ConfigUnavailableError('회의록 첨부 설정의 범위·세대를 확인하지 못했습니다.')
  }
  return valueOf(cfg, 'minutes.attachments')
}
