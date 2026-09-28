// valueOf 를 상태로 감싼다 — 페이지(오류 상태)와 봇 도구(실패 응답)가 함께 쓴다. 해석기·세션 클라이언트를 끌어오지 않는다.
import { ConfigKeyError } from './errors'
import type { ProjectConfig } from './projectConfig'
import { valueOf, type ProjectSettingKey, type SettingValue } from './registry'

/** ConfigKeyError 는 { ok:false, key } — 문구는 고정 문구 + 키 이름이라 화면에 그려도 된다 */
export function pick<K extends ProjectSettingKey>(cfg: ProjectConfig, key: K): { ok: true; value: SettingValue<K> } | { ok: false; error: string; key: K } {
  try { return { ok: true, value: valueOf(cfg, key) } } catch (e) {
    if (e instanceof ConfigKeyError) return { ok: false, error: e.message, key }
    throw e
  }
}
