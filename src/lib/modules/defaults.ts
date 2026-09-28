// 모듈 id 와 층 상수 — 잎 파일(import 없음). 설정 정의는 여기서 ModuleId 타입을, 모듈 레지스트리(registry.ts)는 목록을 가져온다.
// 설정 → 모듈은 타입 import, 모듈 → 설정은 값 import(스펙 §3.6)라 두 레지스트리가 서로를 값으로 import 하지 않게 하는 장치다.
// 모듈을 더하는 SP 는 여기와 registry.ts 를 함께 고친다(개정 §2.6.2 R6). issue_analysis 는 SP5 다(스펙 E16).
export const MODULE_IDS = [
  'dashboard', 'wbs', 'members', 'settings',                                                        // core
  'kanban', 'meetings', 'weekly', 'issues', 'wiki', 'announcements', 'attendance', 'agents',        // 프로젝트 층 토글
  'minutes', 'minutes_integration', 'chatbot', 'portfolio', 'usage',
] as const
export type ModuleId = (typeof MODULE_IDS)[number]

export const CORE_MODULES: readonly ModuleId[] = ['dashboard', 'wbs', 'members', 'settings']
/** 프로젝트 층 토글 대상 — scope ∈ {project, both} ∧ !core. modules.enabled 의 원소는 이 안이어야 한다(개정 §2.7.2) */
export const PROJECT_TOGGLABLE: ReadonlySet<ModuleId> = new Set<ModuleId>(
  ['kanban', 'meetings', 'weekly', 'issues', 'announcements', 'attendance', 'agents', 'wiki', 'chatbot'])
/** 워크스페이스 층 모듈 — 프로젝트 교집합에 참여하지 않는다 */
export const WORKSPACE_SCOPED: ReadonlySet<ModuleId> = new Set<ModuleId>(['minutes', 'minutes_integration', 'portfolio', 'usage'])
/** 워크스페이스 ai.enabled = false 면 빠지는 모듈(정본 §3.2.3) */
export const AI_MODULES: readonly ModuleId[] = ['wiki', 'chatbot']
/** 새 프로젝트에서 처음부터 꺼 두는 모듈(개정 §2.8.2). SP5 가 issue_analysis 를 더한다 */
export const OFF_ON_CREATE: readonly ModuleId[] = []
/** 비core 13개 — modules.allowed 의 원소는 이 안이어야 한다 */
export const NON_CORE_MODULES: readonly ModuleId[] = MODULE_IDS.filter((id) => !CORE_MODULES.includes(id))

const ID_SET: ReadonlySet<string> = new Set(MODULE_IDS)
export function isModuleId(x: unknown): x is ModuleId {
  return typeof x === 'string' && ID_SET.has(x)
}
