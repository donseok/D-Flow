// scripts/lib/settings-consts.mjs — 스크립트가 설정 RPC 에 넘기는 값. 순수. .mjs 는 src 의 TS 를 import 하지 못하므로 한 번 더 적고
// tests/modules/bootstrap-ids.test.ts 가 src 의 상수와 대조한다 — 레지스트리를 바꾸면 여기를 같이 고친다.

/** 설정 스키마 세대(p_schema_version) — src/lib/settings/registry.ts SETTINGS_SCHEMA_VERSION 과 같다 */
export const SCRIPT_SCHEMA_VERSION = 1

/** 프로젝트 층 토글 9개(성능 시드의 modules.enabled) — src/lib/modules/defaults.ts PROJECT_TOGGLABLE 과 같은 순서 */
export const PROJECT_TOGGLE_IDS = Object.freeze(['kanban', 'meetings', 'weekly', 'issues', 'announcements', 'attendance', 'agents', 'wiki', 'chatbot'])
