// scripts/lib/bootstrap-modules.mjs — dev-bootstrap 의 BOOTSTRAP_MODULES 파서(스펙 §3.7, D27). 순수. I/O 없음.
// .mjs 는 src 의 TS 를 import 하지 못하므로 비core 모듈 id 를 여기 한 번 더 적는다 —
// tests/modules/bootstrap-ids.test.ts 가 src/lib/modules/defaults.ts 의 NON_CORE_MODULES 와 같음을 단언한다.
export const BOOTSTRAP_MODULE_IDS = Object.freeze([
  'kanban', 'meetings', 'weekly', 'issues', 'wiki', 'announcements', 'attendance', 'agents',
  'minutes', 'minutes_integration', 'chatbot', 'portfolio', 'usage',
])

/** undefined → 전부(개발 기본값). '' → [](core 만). 목록 밖 id 가 하나라도 있으면 ok:false 와 허용 목록 — 조용히 걸러 내지 않는다. */
export function parseBootstrapModules(raw) {
  if (raw === undefined) return { ok: true, modules: [...BOOTSTRAP_MODULE_IDS] }
  const parts = String(raw).split(/[\s,]+/).filter(Boolean)
  const unknown = parts.filter((p) => !BOOTSTRAP_MODULE_IDS.includes(p))
  if (unknown.length) return { ok: false, unknown: [...new Set(unknown)], allowed: [...BOOTSTRAP_MODULE_IDS] }
  return { ok: true, modules: [...new Set(parts)] }
}

/**
 * 재실행 판단 — BOOTSTRAP_MODULES 를 env 로 명시했으면(빈 문자열 포함) 덮는다. 명시하지 않았고 워크스페이스에 이미 modules.allowed 가
 * 있으면 그대로 둔다(설정 화면에서 좁힌 값을 기본값으로 되돌리지 않게). db:reset 뒤 첫 실행은 값이 없어 기본값을 기록한다.
 * @param {{ explicit: boolean, existingValues: Record<string, unknown> | null | undefined }} input
 * @returns {'write' | 'keep'}
 */
export function bootstrapModulesAction({ explicit, existingValues }) {
  if (explicit) return 'write'
  return Object.prototype.hasOwnProperty.call(existingValues ?? {}, 'modules.allowed') ? 'keep' : 'write'
}
