// 워크스페이스 설정 해석기(스펙 §3.5) — 조회 하나. 배포 기본값 env 셋(INVITE_ALLOWED_DOMAINS·NEXT_PUBLIC_BRAND_NAME·MAIL_FROM_NAME)은
// 정의의 deployDefault 가 읽고 resolveKeys 가 'deploy' 출처로 표시한다. 0행·오류는 throw(fail-closed — modules.*·ai.enabled·초대 도메인이 이 위에 선다).
import { cache } from 'react'
import { createServerClient } from '@/lib/supabase/server'
import { SETTINGS_SCHEMA_VERSION, WORKSPACE_SETTINGS, type SettingValue, type WorkspaceSettingKey } from './registry'
import { ConfigUnavailableError } from './errors'
import { isRecord, resolveKeys, type KeyState } from './resolve'
import type { ConfigReadClient } from './projectConfig'

export interface WorkspaceConfig {
  workspaceId: string
  revision: number; schemaVersion: number; schemaAhead: boolean
  keys: { [K in WorkspaceSettingKey]: KeyState<SettingValue<K>> }
  unknownKeys: string[]
}
type Row = { workspace_id: string; values: unknown; revision: number | string; schema_version: number }

async function load(workspaceId: string, client: ConfigReadClient | undefined): Promise<WorkspaceConfig> {
  const sb = client ?? (await createServerClient())
  const { data, error } = await sb.from('workspace_settings').select('workspace_id, values, revision, schema_version')
    .eq('workspace_id', workspaceId).maybeSingle()
  if (error) throw new ConfigUnavailableError(`워크스페이스 설정 조회 실패: ${error.message}`, { cause: error })
  const row = data as unknown as Row | null
  if (!row) throw new ConfigUnavailableError(`워크스페이스 설정 행이 없습니다: ${workspaceId}`)
  const values = isRecord(row.values) ? row.values : {}
  const { keys, unknownKeys } = resolveKeys({ scope: 'workspace', id: workspaceId, values, defs: WORKSPACE_SETTINGS })
  const schemaVersion = Number(row.schema_version)
  return { workspaceId, revision: Number(row.revision), schemaVersion, schemaAhead: schemaVersion > SETTINGS_SCHEMA_VERSION,
    keys: keys as WorkspaceConfig['keys'], unknownKeys }
}

const loadCached = cache(load)
export function getWorkspaceConfig(workspaceId: string, opts?: { client?: ConfigReadClient }): Promise<WorkspaceConfig> {
  return loadCached(workspaceId, opts?.client)
}
