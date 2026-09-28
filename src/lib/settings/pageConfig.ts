// src/lib/settings/pageConfig.ts — 서버 컴포넌트가 설정 실패를 화면 상태로 그리게 하는 얇은 층(스펙 §3.5: 기본값으로 이어 가지 않는다).
import { ConfigKeyError, ConfigUnavailableError } from './errors'
import { getProjectConfig, type ConfigReadClient, type ProjectConfig } from './projectConfig'
import { valueOf, type ProjectSettingKey, type SettingValue } from './registry'

export type PageConfig = { ok: true; cfg: ProjectConfig } | { ok: false; error: string; key: string | null }

export async function loadProjectConfigForPage(projectId: string, opts?: { client?: ConfigReadClient }): Promise<PageConfig> {
  try { return { ok: true, cfg: await getProjectConfig(projectId, opts) } } catch (e) {
    if (e instanceof ConfigUnavailableError) { console.error('[settings] 페이지 설정 조회 실패:', e.message); return { ok: false, error: e.message, key: null } }
    throw e
  }
}

/** valueOf 를 페이지 상태로 감싼다 — ConfigKeyError 는 { ok:false, key } */
export function pick<K extends ProjectSettingKey>(cfg: ProjectConfig, key: K): { ok: true; value: SettingValue<K> } | { ok: false; error: string; key: K } {
  try { return { ok: true, value: valueOf(cfg, key) } } catch (e) {
    if (e instanceof ConfigKeyError) return { ok: false, error: e.message, key }
    throw e
  }
}
