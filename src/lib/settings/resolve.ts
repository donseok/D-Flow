// 두 해석기의 공통 — 저장 문서(values)를 레지스트리로 상태 넷(개정 §2.5)으로 푼다. 순수. 로그는 요청마다 키당 한 줄(표시 = 로깅).
import type { SettingDef, SettingScope } from './def'
import { REQUIRED_ON_CREATE } from './def'

export type KeyState<T> =
  | { status: 'set'; value: T }                                   // 저장값(명시적 빈 배열·null 포함)
  | { status: 'default'; value: T; from: 'product' | 'deploy' }   // 미설정 → 기본값(출처 표시용)
  | { status: 'required_missing' }                                // 생성 필수 키 부재 — 정상 경로로는 불가
  | { status: 'invalid'; error: string }                          // 저장값 parse 실패 — 기본값으로 치환하지 않는다

export function resolveKeys(input: {
  scope: SettingScope; id: string; values: Record<string, unknown>; defs: readonly SettingDef[]; env?: NodeJS.ProcessEnv
}): { keys: Record<string, KeyState<unknown>>; unknownKeys: string[] } {
  const { scope, id, values, defs } = input
  const env = input.env ?? process.env
  const keys: Record<string, KeyState<unknown>> = {}
  for (const def of defs) {
    if (Object.prototype.hasOwnProperty.call(values, def.key)) {
      const p = def.parse(values[def.key])
      if (p.ok) keys[def.key] = { status: 'set', value: p.value }
      else {
        console.error('[settings] invalid', { scope, id, key: def.key, error: p.error })
        keys[def.key] = { status: 'invalid', error: p.error }
      }
      continue
    }
    if (def.default === REQUIRED_ON_CREATE) { keys[def.key] = { status: 'required_missing' }; continue }
    if (def.deployDefault) {
      const v = def.deployDefault.parse(env[def.deployDefault.env])
      if (v !== undefined) { keys[def.key] = { status: 'default', value: v, from: 'deploy' }; continue }
    }
    keys[def.key] = { status: 'default', value: def.default, from: 'product' }
  }
  const known = new Set(defs.map((d) => d.key))
  const unknownKeys = Object.keys(values).filter((k) => !known.has(k)).sort()
  return { keys, unknownKeys }
}

export function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}
