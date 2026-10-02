// valueOf 를 상태로 감싼다 — 페이지(오류 상태)와 봇 도구(실패 응답)가 함께 쓴다. 해석기·세션 클라이언트를 끌어오지 않는다.
import { ConfigKeyError } from './errors'
import type { ProjectConfig } from './projectConfig'
import { valueOf, type ProjectSettingKey, type ProjectSettingValue } from './registry'

/** ConfigKeyError 의 구분을 유지한다 — 화면은 손상과 필요 설정 누락을 다른 상태로 표시한다. */
export function pick<K extends ProjectSettingKey>(cfg: ProjectConfig, key: K): { ok: true; value: ProjectSettingValue<K> } | { ok: false; error: string; key: K; kind: 'invalid' | 'required' } {
  try { return { ok: true, value: valueOf(cfg, key) } } catch (e) {
    if (e instanceof ConfigKeyError) return { ok: false, error: e.message, key, kind: e.code === 'CONFIG_REQUIRED' ? 'required' : 'invalid' }
    throw e
  }
}
