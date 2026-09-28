// src/lib/settings/pageConfig.ts — 서버 컴포넌트가 설정 실패를 화면 상태로 그리게 하는 얇은 층(스펙 §3.5: 기본값으로 이어 가지 않는다).
import { CONFIG_MESSAGES, ConfigUnavailableError } from './errors'
import { getProjectConfig, type ConfigReadClient, type ProjectConfig } from './projectConfig'

export type PageConfig = { ok: true; cfg: ProjectConfig } | { ok: false; error: string; key: string | null }

/** 원인(DB 원문 포함)은 로그로, 화면에는 고정 문구만 — 표시 = 로깅 */
export async function loadProjectConfigForPage(projectId: string, opts?: { client?: ConfigReadClient }): Promise<PageConfig> {
  try { return { ok: true, cfg: await getProjectConfig(projectId, opts) } } catch (e) {
    if (e instanceof ConfigUnavailableError) {
      console.error('[settings] 페이지 설정 조회 실패:', { projectId, cause: e.message })
      return { ok: false, error: CONFIG_MESSAGES.CONFIG_UNAVAILABLE, key: null }
    }
    throw e
  }
}
