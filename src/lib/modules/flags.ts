// 하위 기능 플래그의 이름 있는 술어(스펙 §4.1) — process.env 만 읽는다. 'true' 문자열만 참(현행 판독부 10곳과 같은 규칙).
// Phase B 가 판독부를 이 술어로 바꾼다. ModuleDef.envAvailable 도 이 술어를 부른다.
type Env = Record<string, string | undefined>
const on = (env: Env, name: string) => env[name] === 'true'

export function agentApiEnabled(env: Env = process.env): boolean { return on(env, 'AGENT_API_ENABLED') }
/** 모듈 가용 술어 — 플래그만 본다(정본 §3.2.2). 라우트의 2단 게이트(시크릿 존재)는 src/lib/minutes/externalApi.ts 가 따로 본다 */
export function minutesApiEnabled(env: Env = process.env): boolean { return on(env, 'MINUTES_API_ENABLED') }
export function wikiServiceEnabled(env: Env = process.env): boolean { return on(env, 'WIKI_SERVICE_ENABLED') }
export function wikiWorkerEnabled(env: Env = process.env): boolean { return on(env, 'WIKI_WORKER_ENABLED') }
export function chatV2Enabled(env: Env = process.env): boolean { return on(env, 'CHAT_V2_ENABLED') }
export function chatPlannerEnabled(env: Env = process.env): boolean { return on(env, 'CHAT_V2_PLANNER_ENABLED') }
export function chatLlmSynthesisEnabled(env: Env = process.env): boolean { return on(env, 'CHAT_V2_LLM_SYNTHESIS_ENABLED') }
export function chatIndexWorkerEnabled(env: Env = process.env): boolean { return on(env, 'CHAT_V2_INDEX_WORKER_ENABLED') }

/** 모듈 플래그 8개 — 운영 설정 목록(Phase C operational.ts)과 env:local(Phase B)이 같은 목록을 쓴다 */
export const MODULE_FLAG_NAMES = [
  'AGENT_API_ENABLED', 'MINUTES_API_ENABLED', 'WIKI_SERVICE_ENABLED', 'WIKI_WORKER_ENABLED',
  'CHAT_V2_ENABLED', 'CHAT_V2_PLANNER_ENABLED', 'CHAT_V2_LLM_SYNTHESIS_ENABLED', 'CHAT_V2_INDEX_WORKER_ENABLED',
] as const
