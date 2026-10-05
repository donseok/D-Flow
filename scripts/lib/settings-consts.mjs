// scripts/lib/settings-consts.mjs — 스크립트가 설정 RPC 에 넘기는 값. 순수. .mjs 는 src 의 TS 를 import 하지 못하므로 한 번 더 적고
// tests/modules/bootstrap-ids.test.ts 가 src 의 상수와 대조한다 — 레지스트리를 바꾸면 여기를 같이 고친다.

/** 설정 스키마 세대(p_schema_version) — src/lib/settings/registry.ts SETTINGS_SCHEMA_VERSION 과 같다 */
export const SCRIPT_SCHEMA_VERSION = 1

/** 프로젝트 층 토글 10개(성능 시드의 modules.enabled — SP5 B1 issue_analysis 포함) — src/lib/modules/defaults.ts PROJECT_TOGGLABLE 과 같은 순서 */
export const PROJECT_TOGGLE_IDS = Object.freeze(['kanban', 'meetings', 'weekly', 'issues', 'issue_analysis', 'announcements', 'attendance', 'agents', 'wiki', 'chatbot'])

/** 모듈 플래그 8개 — src/lib/modules/flags.ts MODULE_FLAG_NAMES 와 같은 순서(tests/modules/bootstrap-ids.test.ts 가 대조) */
export const MODULE_FLAG_NAMES_SCRIPT = Object.freeze([
  'AGENT_API_ENABLED', 'MINUTES_API_ENABLED', 'WIKI_SERVICE_ENABLED', 'WIKI_WORKER_ENABLED',
  'CHAT_V2_ENABLED', 'CHAT_V2_PLANNER_ENABLED', 'CHAT_V2_LLM_SYNTHESIS_ENABLED', 'CHAT_V2_INDEX_WORKER_ENABLED',
])

/** env:local 이 병합할 모듈 플래그 — 로컬은 모든 모듈이 가용이어야 관문(Phase B) 뒤에도 화면·E2E 가 열린다(스펙 §4.1·§9 #5).
 *  시크릿(MINUTES_API_SECRET·CRON_SECRET 등)은 넣지 않는다 — 시크릿이 없는 라우트는 지금처럼 404 로 숨는다 */
export function localModuleFlagEnv() {
  return Object.fromEntries(MODULE_FLAG_NAMES_SCRIPT.map((n) => [n, 'true']))
}
