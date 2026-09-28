// 새 ProjectConfig 모양의 픽스처 — 값 몇 개만 주면 레지스트리로 상태를 계산한다(해석기와 같은 함수).
import { PROJECT_SETTINGS, type ProjectSettingKey } from '@/lib/settings/registry'
import { resolveKeys } from '@/lib/settings/resolve'
import type { ProjectConfig } from '@/lib/settings/projectConfig'

export function makeProjectConfig(values: Partial<Record<ProjectSettingKey, unknown>> = {}, over: Partial<Omit<ProjectConfig, 'keys'>> = {}): ProjectConfig {
  const { keys, unknownKeys } = resolveKeys({ scope: 'project', id: over.projectId ?? 'p-test', values: values as Record<string, unknown>, defs: PROJECT_SETTINGS })
  return {
    projectId: 'p-test', workspaceId: 'ws-test', revision: 1, schemaVersion: 1, schemaAhead: false,
    areas: { weekly_section: [], issue_area: [] }, teams: [], unknownKeys, ...over, keys: keys as ProjectConfig['keys'],
  }
}
