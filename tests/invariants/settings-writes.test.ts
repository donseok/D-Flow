// 설정 표·설정 RPC 게이트(개정 §2.11 ⑦, 스펙 §3.4) — service_role 은 설정 표에 쓰기 권한을 가지므로(S8) 서버 코드의 우회를 막는 유일한 게이트다.
// 설정 쓰기는 RPC 한 길이다:
//   G1 표 이름은 허용 파일에만 있고, 허용 파일마다 표 참조 수를 고정한다(어떤 모양이든 새 사용은 목록 갱신을 강제한다).
//   G2 그 접근은 읽기(select)뿐이다. G3 설정 RPC 는 닫힌 파일에서 리터럴 이름으로만, 파일마다 정해진 횟수만 부른다.
//   G4 가드 없는 쓰기 경로(write 모듈·writeProjectSettingsInternal·그 통과 함수 runWbsImport)는 import·언급하는 파일, 파일별 호출 수,
//      export 이름 집합(default 포함)을 닫고, 설정 액션 파일(settings.ts)의 진입점 export 도 고정한다.
//   G5 검사는 파일 원문에 한다 — 주석 속 이름도 적중이다(Phase A 의 공용 codeLines 는 문자열 속 '//'·'/*' 뒤 코드를 가렸다. Phase B 과제 1 이 고쳤어도 원문 검사는 둔다).
//   G6 대상은 src·scripts(와 생기면 supabase/functions)의 js·ts 전부, 그리고 src·scripts 의 json·sh·sql(표 이름 단어만 본다).
//      REST 직접 경로·GraphQL 은 전 코드 파일(js·ts), raw SQL 은 scripts(pg 를 쓰는 곳)만 본다 — pg 가 src 에 들어오면 SQL 검사를 src 로 넓힌다.
// tests 는 제외(tests/rls 는 거부를 단언하려고 일부러 쓴다). 목록에 있는데 쓰지 않는 파일도 실패다.
// 한계(실측 — 아래 '경계' 케이스가 못 잡음을 not 단언으로 고정한다):
//   · 허용 파일 안에서 기존 참조를 다른 모양으로 바꾸는 것(참조 수가 그대로면) — 예: 허용 파일이 가진 표 이름을 상수로 export 해
//     다른 파일이 from(X) 로 쓰기, 허용 파일 안 대괄호 접근 admin['from'](…) 뒤 쓰기.
//   · 허용 파일 안 식 from 의 중첩 제네릭 from<A<B>>(…)·대문자로 시작하는 …Array 이름의 클라이언트 변수(HistArray.from(t)) 뒤 쓰기.
//   · 이름 조립: 이중 보간 `${scope}_${KIND}`, 조각 join, 문자열 줄 이음, 유니코드·퍼센트 이스케이프 같은 의도적 난독화.
//   · 코드·JSON 밖 운반자: process.env·DB 에 둔 표 이름, 스캔 밖 파일(tests/ 헬퍼를 scripts 가 import 하는 관례 — settings-verify.check.ts →
//     tests/rls/harness). (중첩 node_modules 는 Phase B 과제 1 뒤로 걷는다 — 공용 walk 의 기본 건너뛰기는 뿌리에서만.)
//   · 호출 수는 `이름(` 을 센다 — 별칭(const run = runWbsImport; run(…))으로 부르는 추가 호출.
// String.raw`…` 는 백틱 리터럴이라 잡힌다. 허용 목록 밖의 대괄호 접근은 G1 이 표 리터럴로 잡는다.
import { existsSync, readFileSync } from 'node:fs'
import { posix } from 'node:path'
import { describe, expect, it } from 'vitest'
import { codeLines, walk } from './_walk'

const TABLES = ['project_settings', 'workspace_settings', 'project_settings_history', 'workspace_settings_history', 'authz_events'] as const
const RPCS = ['apply_project_settings', 'apply_workspace_settings', 'create_project_with_settings'] as const
const T = TABLES.join('|')
const P = RPCS.join('|')

/** G1 — 표 이름이 통째로 인용된 리터럴. from(…) 인자든 변수·삼항·상수 객체·헬퍼 인자·타입이든 어디 있든 센다 */
const TABLE_LIT = new RegExp(`(['"\`])(${T})\\1`, 'g')
/** G1 — 이름을 조립하는 조각: 범위 보간(`${scope}_settings`), 앞 조각('project_'·'authz_' + …, `project_${kind}`), 뒤 조각(scope + '_settings') */
const TABLE_FRAG = /\$\{[^}]*\}_settings(?:_history)?\b|(['"`])(?:project|workspace|authz)_\1|(['"`])_settings(?:_history)?\2|`(?:project|workspace|authz)_\$\{/g
/** G1 — PostgREST 임베드 select('id, project_settings(values)')·'project_settings!inner(…)' */
const EMBED = new RegExp(`\\b(${T})(?:!\\w+)?\\s*\\(`, 'g')
/** G1 — json·sh·sql 파일은 표 이름 단어를 어디서든 센다 */
const TABLE_WORD = new RegExp(`\\b(${T})\\b`, 'g')
/** G6(scripts) SQL — 키워드 뒤 공백·블록 주석, 스키마 자리의 "public"·${…} 를 흡수한다 */
const SQL_SEP = String.raw`(?:\s|\/\*[\s\S]*?\*\/)+`
const SQL_SCHEMA = String.raw`(?:"?public"?\.|\$\{[^}]*\}\.)?`
/** pg 로 보내는 SQL 의 표 참조 — 허용 목록으로 판정한다(settings-verify 의 읽기) */
const SQL_REF = new RegExp(String.raw`\b(?:from(?:\s+only)?|join|into|update(?:\s+only)?|table|truncate(?:\s+table)?(?:\s+only)?|copy)${SQL_SEP}${SQL_SCHEMA}"?(${T})\b`, 'gi')
/** G6 — SQL 쓰기(scripts)·PostgREST 직접 경로·GraphQL(전 파일)·SQL 로 부르는 설정 RPC(scripts). 0건 */
const SQL_WRITE = new RegExp(String.raw`\b(?:update(?:\s+only)?|insert\s+into|delete\s+from(?:\s+only)?|merge\s+into|truncate(?:\s+table)?(?:\s+only)?|copy)${SQL_SEP}${SQL_SCHEMA}"?(?:${T})\b`, 'gi')
const REST = new RegExp(`(?:^|\\W)rest/v1/(?:rpc/)?(?:${T}|${P})\\b|['"\`](?:(?:${T})\\?|rpc/(?:${P})\\b)`, 'g')
const GRAPHQL = new RegExp(`(?:${T})Collection\\b|graphql`, 'gi')
const SQL_RPC = new RegExp(`\\bpublic\\.(?:${P})\\b|\\bselect\\s+(?:\\*\\s+from\\s+)?(?:${P})\\s*\\(`, 'gi')
/** G2 — 첫 인자가 표 리터럴로 시작하는 from(…)(앞 주석·뒤 as·satisfies·주석, 괄호 앞 공백·제네릭 흡수). 짝 괄호 뒤 첫 메서드를 본다 */
const FROM_LIT = new RegExp(`from\\s*(?:<[^>]*>)?\\s*\\((?=\\s*(?:\\/\\*[\\s\\S]*?\\*\\/\\s*)*(['"\`])(${T})\\1)`, 'g')
/** G2 — 표 이름을 식으로 받는 from(…)(보간 템플릿 포함) — 표 이름을 가진 파일 안에서는 뒤 첫 메서드가 select 여야 한다.
 *  *Array 클래스·Buffer·`.storage.from`(버킷) 만 뺀다 — 이름이 storage 인 변수는 센다 */
const FROM_EXPR = /(?<!\b(?:[A-Z]\w*)?Array|\bBuffer|\.storage)\.from\s*(?:<[^>]*>)?\s*\((?!\s*['"]|\s*`[^`$]*`)/g
/** 설정 RPC 이름 리터럴, 그 리터럴로 부르는 .rpc( 호출 */
const RPC_LIT = new RegExp(`(['"\`])(${P})\\1`, 'g')
const RPC_CALL = new RegExp(`\\.rpc\\s*(?:\\?\\.)?\\s*\\(\\s*(['"\`])(?:${P})\\1`, 'g')
/** G3 — 첫 인자가 온전한 문자열 리터럴이 아닌 .rpc((괄호 앞 공백·옵셔널 호출 흡수), 이름 조립 조각 */
const RPC_DYNAMIC = /\.rpc\s*(?:\?\.)?\s*\((?!\s*(['"`])[^'"`$\\]*\1\s*[,)])/g
const RPC_FRAG = /apply_\$\{|(['"`])apply_\1\s*\+/g
/** G4 — 모듈 지정자(정적 from·동적 import·require — 동적은 보간 없는 백틱도), 그 문장의 키워드 */
const SPEC = /\bfrom\s*(['"])([^'"\n]+)\1|\b(?:import|require)\s*\(\s*(['"`])([^'"`$\n]+)\3\s*\)/g
const KEYWORD = /\b(?:import|export)\b/g
const EXPORT_DECL = /^export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm
const EXPORT_LIST = /^export\s+(?:type\s+)?\{([^}]*)\}/gm
const EXPORT_STAR = /^export\s+\*/m
const EXPORT_DEFAULT = /^export\s+default\b/m
const INTERNAL_WRITE = /\bwriteProjectSettingsInternal\b/
const INTERNAL_WRITE_CALL = /\bwriteProjectSettingsInternal\s*(?:\?\.)?\s*\(/g
const RUN_WBS_IMPORT = /\brunWbsImport\b/
const RUN_WBS_IMPORT_CALL = /\brunWbsImport\s*(?:\?\.)?\s*\(/g

/** 파일 → 허용 표·표 참조 수(리터럴·조각·임베드·SQL 참조의 합)와 사유(G1). 접근은 읽기뿐이다(G2) */
const ALLOW: Record<string, { tables: string[]; refs: number; why: string }> = {
  'src/lib/settings/projectConfig.ts': { tables: ['project_settings'], refs: 1, why: '해석기 — 유일한 읽기 경로' },
  'src/lib/settings/workspaceConfig.ts': { tables: ['workspace_settings'], refs: 1, why: '해석기 — 유일한 읽기 경로' },
  'src/lib/settings/write.ts': { tables: ['project_settings'], refs: 2, why: 'revision 판독 뒤 RPC(머리 주석의 백틱 이름도 원문 검사라 센다)' },
  'src/lib/settings/history.ts': { tables: ['project_settings_history', 'workspace_settings_history'], refs: 5, why: '이력 읽기(D24) — tableOf 가 이름을 고르고 from(table).select 만 한다' },
  'scripts/settings-verify.check.ts': { tables: ['project_settings', 'workspace_settings'], refs: 2, why: '전 행을 해석기로 검사 — pg SQL 읽기' },
  'scripts/dev-bootstrap.mjs': { tables: ['workspace_settings'], refs: 2, why: 'revision 판독 뒤 apply_workspace_settings(나머지 1은 롤백 이름표 문자열)' },
  'scripts/e2e-local.mjs': { tables: ['project_settings', 'project_settings_history', 'workspace_settings', 'authz_events'], refs: 8, why: '결과 확인 읽기, B 의 revision 판독 뒤 apply_workspace_settings, SP3a B 의 A 설정·워크스페이스 revision 판독, SP3a D 의 권한 이력 읽기(select 한 곳)' },
  'scripts/ui-capture.mjs': { tables: ['workspace_settings'], refs: 1, why: '캡처 시드 — 워크스페이스 B 의 revision 판독 뒤 apply_workspace_settings(로컬 전용, SP3b UI-0)' },
  'scripts/e2e-synthetic.mjs': { tables: ['project_settings', 'workspace_settings', 'project_settings_history', 'workspace_settings_history'], refs: 20, why: '합성 게이트(마감) — 설정은 화면과 같은 서버 액션으로 넣고 여기서는 결과·이력·격리를 읽는다. 워크스페이스 시드(허용 모듈)만 apply_workspace_settings' },
  'src/lib/authz/events.ts': { tables: ['authz_events'], refs: 1, why: '권한 이력 읽기(Phase D) — select 만, from 리터럴 하나(쓰기는 권한 RPC 안의 트리거)' },
}

/** 설정 RPC(개정 §2.11 ⑦) → 부르는 파일·리터럴 .rpc( 호출 수·사유. 새 호출은 그 가드를 확인한 뒤 수를 올린다. 권한 RPC 는 이 게이트 밖이다 */
const RPC_ALLOW: Record<string, { rpcs: (typeof RPCS)[number][]; calls: number; why: string }> = {
  'src/lib/settings/write.ts': { rpcs: ['apply_project_settings'], calls: 1, why: '서버 내부 쓰기 한 함수(W5 양식 저장·W6 골격 단계 이름)' },
  'src/app/actions/settings.ts': { rpcs: ['apply_project_settings', 'apply_workspace_settings'], calls: 2, why: '설정 액션 — 범위 어댑터 둘, 가드 requireProjectAdmin(:286)·requireWorkspaceAdmin(:294) 뒤' },
  'src/app/actions/project.ts': { rpcs: ['create_project_with_settings'], calls: 1, why: 'createProject — requireWorkspaceAdmin 뒤 생성·복사' },
  'scripts/dev-bootstrap.mjs': { rpcs: ['apply_workspace_settings'], calls: 1, why: '부트스트랩 워크스페이스의 modules.allowed(로컬 전용)' },
  'scripts/e2e-local.mjs': { rpcs: ['apply_workspace_settings'], calls: 2, why: '워크스페이스 B 의 modules.allowed·B 단계 22 의 A minutes_integration 해제 — 생성·편집 화면(Phase C) 전이라 service_role(로컬 전용)' },
  'scripts/e2e-synthetic.mjs': { rpcs: ['apply_workspace_settings'], calls: 1, why: '합성 워크스페이스 세 개의 허용 모듈 시드(로컬 전용 — 생성 화면은 SP3, 서버 액션 경로는 그 위에서 구성별로 바꾼다)' },
  'scripts/perf-baseline.mjs': { rpcs: ['create_project_with_settings'], calls: 1, why: 'PERF 프로젝트 시드(로컬 전용)' },
  'scripts/ui-capture.mjs': { rpcs: ['create_project_with_settings', 'apply_workspace_settings'], calls: 2, why: '캡처 시드 — UI-CAPTURE 프로젝트 생성·워크스페이스 B 허용 모듈(로컬 전용, SP3b UI-0)' },
  'scripts/perf-grid.mjs': { rpcs: ['create_project_with_settings'], calls: 1, why: '1만 행 WBS 시드 — PERF-GRID 생성(로컬 전용, SP3b UI-0)' },
}
/** G3 — 리터럴이 아닌 .rpc( 의 파일별 건수 */
const RPC_DYNAMIC_ALLOW: Record<string, { count: number; why: string }> = {
  'src/app/actions/settings.ts': { count: 1, why: '범위 어댑터의 메서드 a.rpc(admin, …) — supabase 호출이 아니다. 실제 RPC 는 같은 파일의 리터럴 두 곳' },
}

// ── G4 — 가드 없는 쓰기 경로. 새 호출부·새 export 는 가드를 확인한 뒤 아래 목록·수에 더한다(목록 밖·수 불일치면 테스트가 막는다)
const WRITE_FILE = 'src/lib/settings/write.ts'
const WRITE_MODULE = 'src/lib/settings/write'
/** write 모듈의 export 이름(default 포함) — 래퍼 export 가 늘면 그 호출자가 아래 목록 밖으로 샌다 */
const WRITE_EXPORTS = ['InternalWriteResult', 'SettingsChange', 'commandDigestInput', 'writeProjectSettingsInternal']
/** write 모듈을 값으로 import 하는 파일(import type 은 부를 수 없어 뺀다) */
const WRITE_IMPORTERS: Record<string, string> = {
  'src/app/actions/settings.ts': 'commandDigestInput(명령 요약의 입력 모양)만 쓴다 — 아래 INTERNAL_WRITE_CALLERS 에 없으므로 writeProjectSettingsInternal 을 언급하면 실패한다',
  'src/app/api/import/execute/route.ts': 'W5 양식 저장 — requireProjectAdmin(pid)(:62) 뒤 그 pid·actor 로 writeProjectSettingsInternal(:189)',
  'src/lib/agent/wbsImport.ts': 'W6 골격 단계 이름(:231) — 가드 없는 통과 함수 runWbsImport 안이다. 가드는 그 호출부가 하고 RUN_WBS_IMPORT_CALLERS 가 호출부를 닫는다',
}
/** writeProjectSettingsInternal 을 언급하는 파일(정의 제외)과 호출 수 — import 기준과 함께 둔다(가져오는 이름·지정자 모양과 무관하게 문다) */
const INTERNAL_WRITE_CALLERS: Record<string, { calls: number; why: string }> = {
  'src/app/api/import/execute/route.ts': { calls: 1, why: 'W5 — requireProjectAdmin(:62) 뒤 :189' },
  'src/lib/agent/wbsImport.ts': { calls: 1, why: 'W6 — runWbsImport 골격 분기 :231(가드는 RUN_WBS_IMPORT_CALLERS)' },
}
const WBS_IMPORT_FILE = 'src/lib/agent/wbsImport.ts'
/** wbsImport 모듈의 export 이름(default 포함) — runWbsImport 를 감싸는 새 export 가 생기면 그 호출자가 아래 목록 밖으로 샌다 */
const WBS_IMPORT_EXPORTS = ['ERR_LEVEL_LABELS_INVALID', 'ImportNode', 'LevelDecl', 'RunWbsImportResult', 'SpecSections', 'applyAssigneesAndOrders',
  'assembleSpecMarkdown', 'parseSchedule', 'runWbsImport', 'toRpcNode', 'validateLevels']
/** runWbsImport(가드 없음, 골격 업로드면 core.level_labels 를 쓴다)를 부르는 파일·호출 수와 그 가드 */
const RUN_WBS_IMPORT_CALLERS: Record<string, { calls: number; why: string }> = {
  'src/app/api/v1/wbs/import/route.ts': { calls: 1, why: 'POST — PAT requireScope(:42)·patProjectAllowed(:44)·requireAgentProject(:45)·isAgentProjectMember(:48)·isAgentProjectAdmin(:51) 뒤 :56' },
  'src/app/actions/wbsMarkdown.ts': { calls: 1, why: 'applyWbsUpload — requireProjectAdmin(:153) 뒤 :186' },
}
/** 설정 액션 파일의 진입점 — 'use server' 라 export 가 곧 공개 엔드포인트다. 새 액션은 가드를 확인한 뒤 더한다(어댑터 재사용은 호출 수로 못 잡는다) */
const SETTINGS_ACTIONS_FILE = 'src/app/actions/settings.ts'
const SETTINGS_ACTIONS_EXPORTS = ['SettingsCommandResult', 'SettingsHistoryResult', 'SettingsHistoryScope', 'SettingsOutcomeResult', 'SettingsPatch',
  'getSettingsCommandOutcome', 'listSettingsHistory', 'updateProjectSettings', 'updateWorkspaceSettings']

/** 여는 괄호 위치에서 짝이 맞는 닫는 괄호 다음 위치(문자열 안의 괄호는 건너뛴다). 못 찾으면 -1 */
function afterCall(text: string, open: number): number {
  let depth = 0
  let quote: string | null = null
  for (let i = open; i < text.length; i++) {
    const c = text[i]
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue }
    if (c === '\'' || c === '"' || c === '`') quote = c
    else if (c === '(') depth++
    else if (c === ')' && --depth === 0) return i + 1
  }
  return -1
}
/** 여는 괄호 뒤 짝 괄호 다음의 첫 메서드 이름(없으면 null) */
function nextMethod(text: string, open: number): string | null {
  const end = afterCall(text, open)
  return end < 0 ? null : /^\s*\.\s*(\w+)/.exec(text.slice(end))?.[1] ?? null
}
const lineOf = (text: string, index: number) => text.slice(0, index).split('\n').length
const countOf = (text: string, re: RegExp) => [...text.matchAll(re)].length
/** 모듈 지정자 → 리포 기준 경로(정규화, 확장자·/index 없음). @/ 는 src/, 상대 경로는 파일 기준 */
function resolveSpec(file: string, spec: string): string {
  const p = spec.startsWith('@/') ? `src/${spec.slice(2)}` : spec.startsWith('.') ? posix.join(posix.dirname(file), spec) : spec
  return posix.normalize(p).replace(/\.[cm]?[jt]sx?$/, '').replace(/\/index$/, '')
}
function exportsOf(text: string): string[] {
  const names = new Set<string>()
  for (const m of text.matchAll(EXPORT_DECL)) names.add(m[1])
  for (const m of text.matchAll(EXPORT_LIST)) for (const part of m[1].split(',')) {
    const name = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/).pop()?.trim()
    if (name) names.add(name)
  }
  if (EXPORT_STAR.test(text)) names.add('*')
  if (EXPORT_DEFAULT.test(text)) names.add('default')     // 식별자·익명 함수·화살표 — 이름 없는 default 도 export 다
  return [...names].sort()
}

interface Scan {
  tables: Set<string>        // G1 표 참조(리터럴·임베드·단어, 조각은 '조각:…', scripts 는 SQL 참조 포함)
  refs: number               // G1 표 참조 적중 수
  writes: string[]           // G2 리터럴 표 from(…) 뒤가 select 가 아닌 곳
  exprFroms: string[]        // G2 식으로 받은 from(…) 뒤가 select 가 아닌 곳 — 표 참조가 있는 파일에서만 판정한다
  rpcs: Set<string>          // 설정 RPC 리터럴
  rpcCalls: number           // G3 리터럴 설정 RPC 로 부르는 .rpc( 수
  rpcDynamic: string[]       // G3 리터럴이 아닌 .rpc( 와 이름 조립 조각
  bypass: string[]           // G6 REST·GraphQL(전 파일)·SQL 쓰기·SQL RPC(scripts)
  valueImports: Set<string>  // G4 값으로 import 한 모듈(resolveSpec)
  exports: string[]          // G4 export 이름
  internalWrite: boolean     // G4 writeProjectSettingsInternal 언급
  internalCalls: number
  runWbsImport: boolean      // G4 runWbsImport 언급
  runCalls: number
}
const DATA = /\.(json|sh|sql)$/

/** 게이트 본체 — 파일 하나의 원문을 판정한다(자기 검사가 같은 함수에 공격 모양을 먹인다) */
function scan(file: string, text: string): Scan {
  const s: Scan = { tables: new Set(), refs: 0, writes: [], exprFroms: [], rpcs: new Set(), rpcCalls: 0, rpcDynamic: [], bypass: [], valueImports: new Set(),
    exports: [], internalWrite: false, internalCalls: 0, runWbsImport: false, runCalls: 0 }
  const ref = (name: string) => { s.tables.add(name); s.refs++ }
  if (DATA.test(file)) {   // json·sh·sql — 표 이름 단어만
    for (const m of text.matchAll(TABLE_WORD)) ref(m[1])
    return s
  }
  const isScript = file.startsWith('scripts/')
  s.exports = exportsOf(text)
  for (const m of text.matchAll(TABLE_LIT)) ref(m[2])
  for (const m of text.matchAll(TABLE_FRAG)) ref(`조각:${m[0]}`)
  for (const m of text.matchAll(EMBED)) ref(m[1])
  for (const m of text.matchAll(FROM_LIT)) {
    const method = nextMethod(text, m.index + m[0].length - 1)
    if (method !== 'select') s.writes.push(`${lineOf(text, m.index)}: from(${m[2]}).${method ?? '(체인 없음)'}`)
  }
  for (const m of text.matchAll(FROM_EXPR)) {
    const method = nextMethod(text, m.index + m[0].length - 1)
    if (method !== 'select') s.exprFroms.push(`${lineOf(text, m.index)}: from(…).${method ?? '(체인 없음)'}`)
  }
  for (const m of text.matchAll(RPC_LIT)) s.rpcs.add(m[2])
  s.rpcCalls = countOf(text, RPC_CALL)
  for (const m of text.matchAll(RPC_DYNAMIC)) s.rpcDynamic.push(`${lineOf(text, m.index)}: .rpc(<리터럴 아님>`)
  for (const m of text.matchAll(RPC_FRAG)) s.rpcDynamic.push(`${lineOf(text, m.index)}: 이름 조각 ${m[0]}`)
  for (const re of [REST, GRAPHQL]) for (const m of text.matchAll(re)) s.bypass.push(`${lineOf(text, m.index)}: ${m[0].trim()}`)
  if (isScript) {
    for (const m of text.matchAll(SQL_REF)) ref(m[1].toLowerCase())
    for (const re of [SQL_WRITE, SQL_RPC]) for (const m of text.matchAll(re)) s.bypass.push(`${lineOf(text, m.index)}: ${m[0]}`)
  }
  const keywords = [...text.matchAll(KEYWORD)].map((m) => m.index)
  for (const m of text.matchAll(SPEC)) {
    if (m[2] !== undefined) {   // 정적 from — from 앞에서 가장 가까운 import/export 키워드가 type 이면 부를 수 없다(같은 줄의 ;import 도 따로 본다)
      const head = keywords.filter((i) => i < m.index).pop()
      if (head !== undefined && /^(?:import|export)\s+type\b/.test(text.slice(head, m.index))) continue
    }
    s.valueImports.add(resolveSpec(file, m[2] ?? m[4]))
  }
  s.internalWrite = file !== WRITE_FILE && INTERNAL_WRITE.test(text)
  s.internalCalls = countOf(text, INTERNAL_WRITE_CALL)
  s.runWbsImport = file !== WBS_IMPORT_FILE && RUN_WBS_IMPORT.test(text)
  s.runCalls = countOf(text, RUN_WBS_IMPORT_CALL)
  return s
}

/** 허용 목록과 실측이 파일마다 정확히 같은지 — 다르면 "파일: 목록 / 실측" 줄 */
function staleEntries(allow: Record<string, readonly string[]>, got: (f: string) => Iterable<string>): string[] {
  const stale: string[] = []
  for (const [f, want] of Object.entries(allow)) {
    const g = [...got(f)].sort().join(',')
    if (g !== [...want].sort().join(',')) stale.push(`${f}: 목록 ${want.join(',')} / 실측 ${g || '(없음)'}`)
  }
  return stale
}
/** 닫힌 목록의 양방향 차이 */
const closedList = (got: string[], want: string[]) =>
  [...got.filter((f) => !want.includes(f)).map((f) => `목록 밖: ${f}`), ...want.filter((f) => !got.includes(f)).map((f) => `죽은 항목: ${f}`)]
const sameExports = (file: string, got: string[] | undefined, want: string[]) =>
  got === undefined ? [`${file}: 파일 없음`] : closedList(got, want).map((d) => `${file} export ${d}`)
/** 파일별 수 — 목록의 수와 실측이 다르면 "파일: 실측 / 목록" 줄 */
const sameCounts = (want: Record<string, number>, got: (f: string) => number | undefined) =>
  Object.entries(want).filter(([f, n]) => got(f) !== n).map(([f, n]) => `${f}: 실측 ${got(f) ?? '(파일 없음)'} / 목록 ${n}`)
const numbers = <V extends Record<string, unknown>>(list: Record<string, V>, key: keyof V) =>
  Object.fromEntries(Object.entries(list).map(([f, v]) => [f, v[key] as number]))

/** 판정부 — 파일별 스캔을 모아 게이트마다 위반 목록을 낸다(자기 검사가 합성 스캔 맵으로 부른다) */
function verdicts(scans: ReadonlyMap<string, Scan>) {
  const all = [...scans]
  const dynamic = Object.fromEntries(all.filter(([, s]) => s.rpcDynamic.length).map(([f, s]) => [f, s.rpcDynamic.length]))
  return {
    G1: all.filter(([f, s]) => s.tables.size && !ALLOW[f]).map(([f, s]) => `${f}: ${[...s.tables].join(', ')}`),
    G1stale: staleEntries(Object.fromEntries(Object.entries(ALLOW).map(([f, a]) => [f, a.tables])), (f) => scans.get(f)?.tables ?? []),
    G1refs: sameCounts(numbers(ALLOW, 'refs'), (f) => scans.get(f)?.refs),
    G2: all.flatMap(([f, s]) => [...s.writes, ...(s.tables.size ? s.exprFroms : [])].map((w) => `${f}:${w}`)),
    RPC: all.filter(([f, s]) => s.rpcs.size && !RPC_ALLOW[f]).map(([f, s]) => `${f}: ${[...s.rpcs].join(', ')}`),
    RPCstale: staleEntries(Object.fromEntries(Object.entries(RPC_ALLOW).map(([f, a]) => [f, a.rpcs])), (f) => scans.get(f)?.rpcs ?? []),
    RPCcalls: sameCounts(numbers(RPC_ALLOW, 'calls'), (f) => scans.get(f)?.rpcCalls),
    G3: [...new Set([...Object.keys(dynamic), ...Object.keys(RPC_DYNAMIC_ALLOW)])]
      .filter((f) => dynamic[f] !== RPC_DYNAMIC_ALLOW[f]?.count).map((f) => `${f}: 실측 ${dynamic[f] ?? 0} / 허용 ${RPC_DYNAMIC_ALLOW[f]?.count ?? 0}`),
    G4writeImporters: closedList(all.filter(([f, s]) => f !== WRITE_FILE && s.valueImports.has(WRITE_MODULE)).map(([f]) => f), Object.keys(WRITE_IMPORTERS)),
    G4writeExports: sameExports(WRITE_FILE, scans.get(WRITE_FILE)?.exports, WRITE_EXPORTS),
    G4internal: closedList(all.filter(([, s]) => s.internalWrite).map(([f]) => f), Object.keys(INTERNAL_WRITE_CALLERS)),
    G4internalCalls: sameCounts(numbers(INTERNAL_WRITE_CALLERS, 'calls'), (f) => scans.get(f)?.internalCalls),
    G4runners: closedList(all.filter(([, s]) => s.runWbsImport).map(([f]) => f), Object.keys(RUN_WBS_IMPORT_CALLERS)),
    G4runnerCalls: sameCounts(numbers(RUN_WBS_IMPORT_CALLERS, 'calls'), (f) => scans.get(f)?.runCalls),
    G4wbsExports: sameExports(WBS_IMPORT_FILE, scans.get(WBS_IMPORT_FILE)?.exports, WBS_IMPORT_EXPORTS),
    G4settingsExports: sameExports(SETTINGS_ACTIONS_FILE, scans.get(SETTINGS_ACTIONS_FILE)?.exports, SETTINGS_ACTIONS_EXPORTS),
    G6: all.flatMap(([f, s]) => s.bypass.map((w) => `${f}:${w}`)),
  }
}

// ── 옛 넓은 열 이름(과제 32 셋째 케이스) — 설명문에 옛 이름이 남는 것은 정상이라 여기는 주석을 걷은 코드(codeLines)를 본다
// 새 키 문자열('core.level_labels')·i18n 키('settings.core.level_labels.label')만 앞의 따옴표·settings. 로 뺀다 — 변수 wbs.level_labels 는 센다
const OLD = /(?<!(?:['"`]|settings\.)(?:core|wbs|workflow|invites|calendar)\.)\b(level_labels|max_depth|milestone_keywords|excel_profile|extra_axis_label|enabled_modules|weekly_sections|working_days|preset_applied|stage_credits|allowed_domains)\b/
const STRUCTURE = 'src/app/api/v1/wbs/structure/route.ts'
/** 외부 계약의 같은 이름 — 줄 모양만 지우고 남은 줄을 다시 본다(단어째 빼면 그 파일의 옛 열 접근까지 놓친다) */
const CONTRACT_SHAPES: { file: string | null; shape: RegExp; why: string }[] = [
  { file: STRUCTURE, shape: /searchParams\.get\('max_depth'\)/, why: 'structure 질의 인자 max_depth(스킬 계약)' },
  { file: STRUCTURE, shape: /`max_depth 는 0~/, why: 'structure 질의 인자의 오류 문구' },
  { file: null, shape: /\bmax_depth:\s/, why: '응답 필드 키 max_depth:(스킬 계약)' },
]
function oldNames(file: string, text: string): { offenders: string[]; exempt: Record<string, number> } {
  const offenders: string[] = []
  const exempt: Record<string, number> = {}
  codeLines(text, file).forEach((raw, i) => {
    if (!OLD.test(raw)) return
    let l = raw
    for (const c of CONTRACT_SHAPES) {
      if ((c.file === null || c.file === file) && c.shape.test(l)) { l = l.replace(c.shape, ''); exempt[c.why] = (exempt[c.why] ?? 0) + 1 }
    }
    if (OLD.test(l)) offenders.push(`${file}:${i + 1}: ${raw.trim()}`)
  })
  return { offenders, exempt }
}

// ── 실제 트리
// supabase/functions 는 지금 없다 — 생기면(엣지 함수) 자동으로 든다
const ROOTS = ['src', 'scripts', 'supabase/functions']
const EXT = /\.[cm]?[jt]sx?$/
/** 검사 대상 — ROOTS 아래의 js·jsx·cjs·mjs·ts·tsx·cts·mts, 그리고 src·scripts 아래의 json·sh·sql(G1 만) */
const targetFiles = (paths: string[]) => paths.filter((p) =>
  (ROOTS.some((r) => p.startsWith(`${r}/`)) && EXT.test(p)) || ((p.startsWith('src/') || p.startsWith('scripts/')) && DATA.test(p)))
const files = targetFiles(ROOTS.filter((d) => existsSync(d)).flatMap((d) => walk(d, undefined, /$/)))
const scans = new Map(files.map((f) => [f, scan(f, readFileSync(f, 'utf8'))]))
const tree = verdicts(scans)

describe('settings-writes', () => {
  it('G1 허용 목록 밖에서 설정 표 이름이 0건이다(리터럴·조각·임베드·SQL 참조·json/sh/sql 단어)', () => {
    expect(tree.G1, '설정은 해석기로 읽고 RPC 로 쓴다').toEqual([])
  })
  it('G1 허용 목록의 파일은 적힌 표를 실제로 쓰고(죽은 예외 없음), 표 참조 수가 목록과 같다', () => {
    expect(tree.G1stale).toEqual([])
    expect(tree.G1refs, '새 참조는 모양과 무관하게 검토 뒤 수를 올린다').toEqual([])
  })
  it('G2 설정 표 접근은 어느 파일이든(허용 목록 포함) 읽기뿐이다 — 쓰기는 RPC 한 길', () => {
    expect(tree.G2).toEqual([])
  })
  it('설정 RPC 는 허용 목록 밖에서 0건이고, 목록의 파일은 적힌 RPC 를 적힌 횟수만큼 부른다', () => {
    expect(tree.RPC, '설정 쓰기는 설정 액션·내부 쓰기 한 함수·생성 액션을 지난다').toEqual([])
    expect(tree.RPCstale).toEqual([])
    expect(tree.RPCcalls, '새 호출은 그 가드를 확인한 뒤 수를 올린다').toEqual([])
  })
  it('G3 RPC 이름을 조립하지 않는다 — 리터럴이 아닌 .rpc( 는 어댑터 한 곳뿐', () => {
    expect(tree.G3).toEqual([])
  })
  it('G4 가드 없는 쓰기 경로가 닫혀 있다 — import 자·언급 파일·호출 수·export(default 포함)·설정 액션 진입점(양방향)', () => {
    expect(tree.G4writeImporters).toEqual([])
    expect(tree.G4writeExports).toEqual([])
    expect(tree.G4internal).toEqual([])
    expect(tree.G4internalCalls).toEqual([])
    expect(tree.G4runners).toEqual([])
    expect(tree.G4runnerCalls).toEqual([])
    expect(tree.G4wbsExports).toEqual([])
    expect(tree.G4settingsExports).toEqual([])
  })
  it('G6 REST 직접 경로·GraphQL(전 파일)·scripts 의 SQL 쓰기·SQL 로 부르는 설정 RPC 가 0건이다', () => {
    expect(tree.G6).toEqual([])
  })
  it('옛 넓은 열 이름을 src·scripts 가 더는 쓰지 않는다 — 외부 계약 예외는 정확히 그 줄들', () => {
    const offenders: string[] = []
    const exempt: Record<string, number> = {}
    for (const f of files.filter((p) => EXT.test(p))) {
      if (f.startsWith('scripts/lib/baseline') || f.startsWith('scripts/baseline-dump')) continue   // 기준선 도구는 옛 스키마를 읽는다
      const r = oldNames(f, readFileSync(f, 'utf8'))
      offenders.push(...r.offenders)
      for (const [k, n] of Object.entries(r.exempt)) exempt[k] = (exempt[k] ?? 0) + n
    }
    expect(offenders).toEqual([])
    expect(exempt, '예외가 더 넓어지거나 죽으면 실패').toEqual(Object.fromEntries(CONTRACT_SHAPES.map((c) => [c.why, 1])))
  }, 20_000)
})

describe('게이트 자기 검사 — 적대 탐색의 모양(gate-attack·rereview-gate 1·2차)을 게이트 본체에 먹인다', () => {
  const src = (code: string) => scan('src/app/actions/attack.ts', code)
  const script = (code: string) => scan('scripts/attack.mjs', code)
  /** 합성 트리 — 판정부(verdicts)를 파일 몇 개로 돌린다 */
  const judge = (entries: [string, string][]) => verdicts(new Map(entries.map(([f, code]) => [f, scan(f, code)])))
  it('G1 변수·상수 객체·삼항·헬퍼 인자로 넘긴 표 이름(V1·V2·V6·V7)', () => {
    expect([...src("const t = 'project_settings'\nawait admin.from(t).update({ values: {} })").tables]).toEqual(['project_settings'])
    expect([...src("const T = { ws: 'workspace_settings' } as const\nawait admin.from(T.ws).upsert({})").tables]).toEqual(['workspace_settings'])
    expect([...src("await admin.from(isP ? 'project_settings_history' : 'workspace_settings_history').insert({})").tables].sort())
      .toEqual(['project_settings_history', 'workspace_settings_history'])
    expect([...script("for (const [label, table, rows] of [['설정', 'project_settings', r]]) await upsert(table, rows)").tables]).toEqual(['project_settings'])
    expect([...src("type Tbl = 'authz_events'").tables]).toEqual(['authz_events'])
  })
  it('G1 이름 조립 조각 — 범위 보간·앞 조각(연결·템플릿·authz_)·뒤 조각(V3·V4·V5·I-1·I-B·m-F)', () => {
    expect(src('await admin.from(`${scope}_settings`).update({})').tables.size).toBe(1)
    expect(src('await admin.from(`${scope}_settings_history`).insert({})').tables.size).toBe(1)
    expect(src("await admin.from('project_' + 'settings').update({})").tables.size).toBe(1)
    expect(src("await admin.from(scope + '_settings').update({ values: {} }).eq(scope + '_id', id)").tables.size).toBe(1)
    expect(src("await admin.from('project' + '_settings').update({})").tables.size).toBe(1)
    expect(src("await admin.from(scope + '_settings_history').insert({})").tables.size).toBe(1)
    expect(src("const kind = h ? 'settings_history' : 'settings'\nawait admin.from(`project_${kind}`).delete().eq('project_id', id)").tables.size).toBe(1)
    expect(src("await admin.from('authz_' + 'events').insert({})").tables.size).toBe(1)
    expect(src('await admin.from(`authz_${x}`).insert({})').tables.size).toBe(1)
  })
  it('G1 PostgREST 임베드 읽기 — select 문자열 안의 표(m-4)', () => {
    expect([...src("await createAdminClient().from('projects').select('id, project_settings(values)')").tables]).toEqual(['project_settings'])
    expect([...src("await sb.from('projects').select('id, workspace_settings!inner(values)')").tables]).toEqual(['workspace_settings'])
  })
  it('G1 json·sh·sql 의 표 이름 단어(m-F)', () => {
    // 코드 식(리터럴·SQL 참조)이 못 보는 맨 단어 — sh 변수 값, src 의 sql(SQL 식은 scripts 만 돈다)
    expect([...scan('scripts/zz-fix.sh', 'TABLE=project_settings\npsql "$DSN" -c "delete from $TABLE"').tables]).toEqual(['project_settings'])
    expect([...scan('src/lib/settings/fix.sql', 'delete from authz_events;').tables]).toEqual(['authz_events'])
    expect([...scan('src/lib/settings/tables.json', '{ "ps": "workspace_settings_history" }').tables]).toEqual(['workspace_settings_history'])
    expect(scan('src/lib/domain/lines.json', '{ "a": "project settings" }').tables.size).toBe(0)     // 대조
  })
  it('G1 허용 파일의 표 참조 수 — 모양과 무관하게 새 사용은 목록 갱신을 강제한다(attack m-B)', () => {
    const write = "// `project_settings`\nconst { data } = await admin.from('project_settings').select('revision')\nawait casUpdate(admin, 'project_settings', id, rev)"
    expect(judge([[WRITE_FILE, write]]).G1refs).toContain(`${WRITE_FILE}: 실측 3 / 목록 2`)
    // e2e-local 의 참조 8(목록 수) + 새 헬퍼 한 줄 → 수가 올라 실패한다
    const e2eBase = ["'project_settings'", "'project_settings_history'", "'workspace_settings'", "'project_settings'", "'workspace_settings'", "'project_settings'", "'workspace_settings'", "'authz_events'"].map((t) => `await read(admin, ${t})`).join('\n')
    expect(judge([['scripts/e2e-local.mjs', e2eBase]]).G1refs.filter((l) => l.startsWith('scripts/e2e-local.mjs'))).toEqual([])     // 대조
    expect(judge([['scripts/e2e-local.mjs', `${e2eBase}\nawait upsertRows(admin, 'project_settings', rows)`]]).G1refs).toContain('scripts/e2e-local.mjs: 실측 9 / 목록 8')
  })
  it('G1·G6 서식 변형 — 괄호 안 공백·줄바꿈·끝 쉼표·as const(F1~F3)', () => {
    expect([...src("admin.from( 'project_settings' )").tables]).toEqual(['project_settings'])
    expect([...src("admin\n  .from(\n    'project_settings',\n  )\n  .update({})").tables]).toEqual(['project_settings'])
    expect([...src("admin.from('workspace_settings' as const)").tables]).toEqual(['workspace_settings'])
  })
  it('G5 원문 검사 — 문자열·정규식 속 // 와 /* 가 뒤 코드를 가리지 않는다(C1·C3·C4)', () => {
    expect([...src("const ACCEPT = 'image/*'\nawait admin.from('project_settings').update({})").tables]).toEqual(['project_settings'])
    expect([...src("const u = 'https://x'; await admin.from('workspace_settings').update({})").tables]).toEqual(['workspace_settings'])
    expect([...src("s.replace(/\\/*$/, '')\nawait admin.rpc('apply_project_settings', {})").rpcs]).toEqual(['apply_project_settings'])
  })
  it('G2 허용 파일 안의 쓰기 — 리터럴 from 뒤 update·upsert·insert·delete·체인 없음(A1~A4)', () => {
    expect(src("await admin.from('project_settings').update({ values: {} }).eq('project_id', id)").writes).toHaveLength(1)
    expect(src("await admin\n  .from(\n    'workspace_settings',\n  )\n  .upsert({})").writes).toHaveLength(1)
    expect(src("await admin.from( 'authz_events' as const ).insert({})").writes).toHaveLength(1)
    expect(src("await sb.from(\"project_settings_history\").delete()").writes).toHaveLength(1)
    expect(src("const q = admin.from('project_settings')\nawait q.update({})").writes).toHaveLength(1)
    expect(src("await admin.from('project_settings').select('revision').eq('project_id', id)").writes).toEqual([])     // 대조
  })
  it('G2 리터럴로 시작하는 인자 — as·satisfies·앞뒤 주석 뒤의 쓰기(attack m-A)', () => {
    expect(src("await admin.from('project_settings' as Tbl).update({})").writes).toHaveLength(1)
    expect(src("await admin.from('project_settings' satisfies string).update({})").writes).toHaveLength(1)
    expect(src("await admin.from('project_settings' /* c */).update({})").writes).toHaveLength(1)
    expect(src("await admin.from(/* c */ 'workspace_settings').upsert({})").writes).toHaveLength(1)
    expect(src("await admin.from('project_settings' as Tbl).select('revision')").writes).toEqual([])                   // 대조
  })
  it('G2·G3 서식 변형 — 괄호 앞 공백·명시 제네릭·옵셔널 호출(m-1)', () => {
    expect(src("await admin.from ('project_settings').update({})").writes).toHaveLength(1)
    expect(src("await admin.from<'project_settings'>('project_settings').update({})").writes).toHaveLength(1)
    expect(src("const t = 'project_settings_history'\nawait client.from <Row>(t).insert({})").exprFroms).toHaveLength(1)
    expect(src('await createAdminClient().rpc?.(fn, {})').rpcDynamic).toHaveLength(1)
    expect(src('await admin.rpc (FN, {})').rpcDynamic).toHaveLength(1)
  })
  it('G2 식으로 받은 표 이름의 쓰기 — history.ts 모양(A8)·보간 템플릿(m-B)·storage 변수, 대조는 *Array·Buffer·.storage(m-8·attack m-A)', () => {
    const tbl = "const table = pick ? 'project_settings_history' : 'workspace_settings_history'\n"
    expect(src(`${tbl}await client.from(table).insert({})`).exprFroms).toHaveLength(1)
    expect(src(`${tbl}await client.from(tableOf(scope).table).update({})`).exprFroms).toHaveLength(1)
    expect(src(`${tbl}await client.from(\`\${table}\`).delete().eq(column, id)`).exprFroms).toHaveLength(1)
    expect(src(`${tbl}const storage = client; await storage.from(table).insert({})`).exprFroms).toHaveLength(1)
    expect(src(`${tbl}const myArray = client; await myArray.from(table).insert({})`).exprFroms).toHaveLength(1)
    expect(src(`${tbl}await client.from(table).select('key').eq(column, id)`).exprFroms).toEqual([])                   // 대조
    expect(src(`${tbl}Array.from(xs).map(String); await sb.storage.from(BUCKET).upload(p, b)`).exprFroms).toEqual([])  // 대조
    expect(src(`${tbl}void Uint8Array.from([1]); Int32Array.from(xs).fill(0); Buffer.from(s).toString('hex')`).exprFroms).toEqual([])   // 대조
    expect(src(`${tbl}await sb.from(\`projects\`).select('id')`).exprFroms).toEqual([])                                // 대조(보간 없는 템플릿)
  })
  it('G2 판정 조합 — 표 이름을 가진 파일의 식 from 쓰기는 트리 판정에서 실패다(A8 종단, m-7)', () => {
    const history = "const t = pick ? 'project_settings_history' : 'workspace_settings_history'\nawait client.from(t).insert({})"
    expect(judge([['src/lib/settings/history.ts', history]]).G2).toHaveLength(1)
    expect(judge([['src/lib/settings/history.ts', history.replace('.insert({})', ".select('key')")]]).G2).toEqual([])   // 대조
  })
  it('G3 RPC 이름 보간·연결·상수(P2~P4)', () => {
    expect(src('await admin.rpc(`apply_${scope}_settings`, {})').rpcDynamic).toHaveLength(2)          // .rpc( + 조각
    expect(src("await admin.rpc('apply_' + scope + '_settings', {})").rpcDynamic).toHaveLength(2)
    expect(src('await admin.rpc(FN, {})').rpcDynamic).toHaveLength(1)
    expect(src("const fn = 'apply_' + scope").rpcDynamic).toHaveLength(1)
    expect(src("await admin.rpc(\n  'apply_workspace_settings',\n  { p_workspace_id: id },\n)").rpcDynamic).toEqual([])   // 대조
    expect([...src("export const APPLY = 'apply_project_settings'").rpcs]).toEqual(['apply_project_settings'])
  })
  it('G3 목록 파일 안의 새 RPC 호출은 호출 수로 잡는다(I-B ④⑥)', () => {
    const settings = "admin.rpc('apply_project_settings', a)\nadmin.rpc('apply_workspace_settings', b)\nexport async function quick(p) { return adminFor({ projectId: p }).admin.rpc('apply_project_settings', {}) }"
    expect(judge([[SETTINGS_ACTIONS_FILE, settings]]).RPCcalls).toContain(`${SETTINGS_ACTIONS_FILE}: 실측 3 / 목록 2`)
    const project = "admin.rpc('create_project_with_settings', a)\nexport async function quickCreate(x) { return createAdminClient().rpc('create_project_with_settings', x) }"
    expect(judge([['src/app/actions/project.ts', project]]).RPCcalls).toContain('src/app/actions/project.ts: 실측 2 / 목록 1')
  })
  it('G4 write 모듈 — 새 import 자·래퍼 export·default export 는 실패, import type 은 대조(H1·I-2·I-A)', () => {
    const newImporter = judge([['src/lib/ai/tools/evil.ts', "import { writeLevelLabelsInternal } from '@/lib/settings/write'"]])
    expect(newImporter.G4writeImporters).toContain('목록 밖: src/lib/ai/tools/evil.ts')
    expect(judge([['src/lib/settings/evil.ts', "const w = await import('./write')"]]).G4writeImporters).toContain('목록 밖: src/lib/settings/evil.ts')
    expect(judge([['src/lib/agent/evil.ts', "import * as w from '../settings/write'"]]).G4writeImporters).toContain('목록 밖: src/lib/agent/evil.ts')
    expect(judge([['src/lib/x.ts', "import type { SettingsChange } from '@/lib/settings/write'"]]).G4writeImporters).not.toContain('목록 밖: src/lib/x.ts')   // 대조
    const base = "export async function writeProjectSettingsInternal() {}\nexport function commandDigestInput() {}\nexport interface SettingsChange {}\nexport type InternalWriteResult = unknown\n"
    const wrapper = `${base}export const writeLevelLabelsInternal = (admin, pid, labels) => writeProjectSettingsInternal(admin, pid, { set: { 'core.level_labels': labels } }, null)`
    expect(judge([[WRITE_FILE, wrapper]]).G4writeExports).toEqual([`${WRITE_FILE} export 목록 밖: writeLevelLabelsInternal`])
    const anon = `${base}export default async function (admin, pid, labels) { return writeProjectSettingsInternal(admin, pid, { set: { 'core.level_labels': labels } }, null) }`
    expect(judge([[WRITE_FILE, anon]]).G4writeExports).toEqual([`${WRITE_FILE} export 목록 밖: default`])
  })
  it('G4 import 판정 — ;import·한 줄 두 import·백틱 동적 지정자·@/…/../ 경로(rereview m-A·attack m-C)', () => {
    const sameLine = "import type { SettingsChange } from '@/lib/settings/write'; import { commandDigestInput } from '@/lib/settings/write'"
    expect(src(sameLine).valueImports.has(WRITE_MODULE)).toBe(true)
    expect(src("import type { SettingsChange } from '@/lib/settings/write'\n;import { commandDigestInput } from '@/lib/settings/write'").valueImports.has(WRITE_MODULE)).toBe(true)
    expect(src('const w = await import(`@/lib/settings/write`)').valueImports.has(WRITE_MODULE)).toBe(true)
    expect(src("import { commandDigestInput } from '@/lib/agent/../settings/write'").valueImports.has(WRITE_MODULE)).toBe(true)
    expect(src("import type { SettingsChange } from '@/lib/settings/write'").valueImports.has(WRITE_MODULE)).toBe(false)   // 대조
  })
  it('G4 writeProjectSettingsInternal 언급은 두 파일뿐, 호출 수 고정 — settings.ts 가 가져다 가드 없는 새 액션에서 불러도 실패(I-A 회귀·I-B ③)', () => {
    const settings = "import { commandDigestInput, writeProjectSettingsInternal } from '@/lib/settings/write'\n" +
      "export async function setAgentModule(projectId, enabled) { return writeProjectSettingsInternal(adminFor({ projectId }).admin, projectId, { set: { 'modules.enabled': enabled } }, null) }"
    expect(judge([[SETTINGS_ACTIONS_FILE, settings]]).G4internal).toContain(`목록 밖: ${SETTINGS_ACTIONS_FILE}`)
    const execute = "writeProjectSettingsInternal(admin, projectId, a, g.actor.userId)\nexport async function PUT(req) { return writeProjectSettingsInternal(createAdminClient(), id, b, null) }"
    expect(judge([['src/app/api/import/execute/route.ts', execute]]).G4internalCalls).toContain('src/app/api/import/execute/route.ts: 실측 2 / 목록 1')
  })
  it('G4 runWbsImport — 가드 없는 새 호출부·목록 파일 안의 새 호출·default·래퍼 export 는 실패(I-2·I-A·I-B ①②)', () => {
    const evil = "import { runWbsImport } from '@/lib/agent/wbsImport'\nawait runWbsImport(adminFor({ projectId }).admin, { projectId, module: 'core', actorUserId, levels, attachRef: null, nodes: [] })"
    expect(judge([['src/lib/ai/tools/evilImport.ts', evil]]).G4runners).toContain('목록 밖: src/lib/ai/tools/evilImport.ts')
    const wbsmd = "await runWbsImport(admin, a)\nexport async function reuploadSkeleton(p, md) { return runWbsImport(createAdminClient(), b) }"
    expect(judge([['src/app/actions/wbsMarkdown.ts', wbsmd]]).G4runnerCalls).toContain('src/app/actions/wbsMarkdown.ts: 실측 2 / 목록 1')
    const v1 = "const result = await runWbsImport(admin, a)\nexport async function PUT(req) { return NextResponse.json(await runWbsImport(createAdminClient(), await req.json())) }"
    expect(judge([['src/app/api/v1/wbs/import/route.ts', v1]]).G4runnerCalls).toContain('src/app/api/v1/wbs/import/route.ts: 실측 2 / 목록 1')
    const names = WBS_IMPORT_EXPORTS.map((n) => `export const ${n} = 1`).join('\n')
    expect(judge([[WBS_IMPORT_FILE, `${names}\nexport const seedLevels = (a, p, l) => runWbsImport(a, { projectId: p, levels: l })`]]).G4wbsExports)
      .toEqual([`${WBS_IMPORT_FILE} export 목록 밖: seedLevels`])
    expect(judge([[WBS_IMPORT_FILE, `${names}\nexport default runWbsImport`]]).G4wbsExports).toEqual([`${WBS_IMPORT_FILE} export 목록 밖: default`])
    expect(judge([[WBS_IMPORT_FILE, `${names}\nexport default async function (admin, input) { return runWbsImport(admin, input) }`]]).G4wbsExports)
      .toEqual([`${WBS_IMPORT_FILE} export 목록 밖: default`])
    expect(judge([[WBS_IMPORT_FILE, `${names}\nexport default (a, i) => runWbsImport(a, i)`]]).G4wbsExports).toEqual([`${WBS_IMPORT_FILE} export 목록 밖: default`])
  })
  it('G4 설정 액션 진입점 — 어댑터를 재사용하는 새 액션은 export 집합으로 잡는다(I-B ⑤)', () => {
    const names = SETTINGS_ACTIONS_EXPORTS.map((n) => `export const ${n} = 1`).join('\n')
    const quick = `${names}\nexport async function quickSet(projectId, patch) { return runCommand(projectAdapter(projectId), { userId } as Actor, patch) }`
    expect(judge([[SETTINGS_ACTIONS_FILE, quick]]).G4settingsExports).toEqual([`${SETTINGS_ACTIONS_FILE} export 목록 밖: quickSet`])
  })
  it('닫힌 목록은 양방향이다 — 빈 트리에서 모든 목록 항목이 죽은 항목·파일 없음·수 불일치로 나온다(rereview m-C)', () => {
    const empty = judge([])
    expect(empty.G4writeImporters).toEqual(Object.keys(WRITE_IMPORTERS).map((f) => `죽은 항목: ${f}`))
    expect(empty.G4internal).toEqual(Object.keys(INTERNAL_WRITE_CALLERS).map((f) => `죽은 항목: ${f}`))
    expect(empty.G4runners).toEqual(Object.keys(RUN_WBS_IMPORT_CALLERS).map((f) => `죽은 항목: ${f}`))
    expect([empty.G4writeExports, empty.G4wbsExports, empty.G4settingsExports]).toEqual([[`${WRITE_FILE}: 파일 없음`], [`${WBS_IMPORT_FILE}: 파일 없음`], [`${SETTINGS_ACTIONS_FILE}: 파일 없음`]])
    // 파일은 있고 목록의 export 가 사라진 방향(죽은 항목)
    const dead = judge([[WRITE_FILE, 'export function commandDigestInput() {}\nexport interface SettingsChange {}\nexport type InternalWriteResult = unknown']]).G4writeExports
    expect(dead).toEqual([`${WRITE_FILE} export 죽은 항목: writeProjectSettingsInternal`])
    expect(empty.G1stale).toHaveLength(Object.keys(ALLOW).length)
    expect(empty.RPCstale).toHaveLength(Object.keys(RPC_ALLOW).length)
    expect([empty.G1refs, empty.RPCcalls, empty.G4internalCalls, empty.G4runnerCalls].map((l) => l.length))
      .toEqual([Object.keys(ALLOW).length, Object.keys(RPC_ALLOW).length, Object.keys(INTERNAL_WRITE_CALLERS).length, Object.keys(RUN_WBS_IMPORT_CALLERS).length])
    expect(empty.G3).toEqual(['src/app/actions/settings.ts: 실측 0 / 허용 1'])
  })
  it('G6 REST·GraphQL(src 포함)·scripts 의 raw SQL·SQL RPC(R1~R4·P7·m-2·m-3·rereview m-D·attack m-D·m-E), 읽기 SQL 은 표 참조로', () => {
    expect(script("await pool.query('update public.project_settings set \"values\" = $1 where project_id = $2', [v, id])").bypass).toHaveLength(1)
    expect(script('await pool.query(`insert into public.project_settings_history (key) values ($1)`)').bypass).toHaveLength(1)
    expect(script("await pool.query('update only public.project_settings set \"values\" = $1')").bypass).toHaveLength(1)
    expect(script('await pool.query(\'update "public"."workspace_settings" set "values" = $1\')').bypass).toHaveLength(1)
    expect(script("await pool.query('merge into public.project_settings t using src s on true when matched then update set revision = 1')").bypass).toHaveLength(1)
    expect(script("await pool.query('delete from only public.project_settings where project_id = $1', [id])").bypass).toHaveLength(1)
    expect(script("await pool.query('truncate public.project_settings_history')").bypass).toHaveLength(1)
    expect(script("await pool.query('truncate table only public.authz_events')").bypass).toHaveLength(1)
    expect(script("await pool.query('copy public.project_settings from stdin')").bypass).toHaveLength(1)
    expect(script('await pool.query(`update ${SCHEMA}.project_settings set "values" = $1`)').bypass).toHaveLength(1)
    expect(script("await pool.query('update /* 복구 */ public.project_settings set revision = 0')").bypass).toHaveLength(1)
    expect(script('await fetch(`${url}/rest/v1/project_settings?project_id=eq.${id}`, { method: "PATCH" })').bypass).toHaveLength(1)
    expect(script("await rest('workspace_settings?workspace_id=eq.' + id, { method: 'PATCH' })").bypass).toHaveLength(1)
    expect(script("await rest('rpc/apply_project_settings', { method: 'POST' })").bypass).toHaveLength(1)
    expect(script("await pool.query('select public.apply_workspace_settings($1, $2)')").bypass).toHaveLength(1)
    expect(src('await fetch(`${URL}/rest/v1/project_settings?project_id=eq.${id}`, { method: "PATCH", headers: { apikey: KEY } })').bypass).toHaveLength(1)
    expect(src('await fetch(`${URL}/rest/v1/rpc/apply_project_settings`, { method: "POST" })').bypass).toHaveLength(1)
    expect(src("await fetch(new URL('rest/v1/project_settings?project_id=eq.' + id, base), { method: 'PATCH' })").bypass).toHaveLength(1)
    expect(src('await fetch(`${URL}/graphql/v1`, { method: "POST", body: JSON.stringify({ query: q }) })').bypass).toHaveLength(1)
    expect(src("await createAdminClient().schema('graphql_public').rpc('graphql', { query: 'mutation { insertIntoauthz_eventsCollection(objects: []) { affectedCount } }' })").bypass).toHaveLength(3)
    expect([...script("await pool.query('select project_id from public.project_settings')").tables]).toEqual(['project_settings'])
    expect([...script("await pool.query('select 1 from only public.project_settings')").tables]).toEqual(['project_settings'])
    expect([...script('await pool.query(\'select 1 from "public"."workspace_settings"\')').tables]).toEqual(['workspace_settings'])
  })
  it('G6 대상 파일 — ROOTS 아래의 js·jsx·cjs·mjs·cts·mts·ts·tsx, src·scripts 의 json·sh·sql(m-7·m-F)', () => {
    const paths = ['src/app/api/x/route.js', 'src/x.jsx', 'scripts/a.cjs', 'scripts/b.mts', 'src/c.cts', 'src/d.ts', 'src/e.tsx', 'scripts/f.mjs',
      'supabase/functions/f/index.ts', 'scripts/x.sh', 'scripts/sql/x.sql', 'src/lib/x.json',
      'tests/x.test.ts', 'tests/rls/zzHelpers.ts', 'docs/a.md', 'supabase/migrations/0012_settings.sql', 'supabase/functions/f/x.sql', 'src/app/globals.css']
    expect(targetFiles(paths)).toEqual(paths.slice(0, 12))
  })
  it('G7 옛 열 이름 — 계약 예외는 줄 모양만, 변수 접근은 센다(O1·O4·O5·O7)', () => {
    const at = (file: string, code: string) => oldNames(file, code)
    expect(at('src/lib/x.ts', 'const maxDepth = project.max_depth ?? 3').offenders).toHaveLength(1)
    expect(at('src/lib/x.ts', 'const n = wbs.level_labels.length').offenders).toHaveLength(1)
    expect(at(STRUCTURE, "const { data } = await sb.from('projects').select('id, max_depth')").offenders).toHaveLength(1)
    expect(at(STRUCTURE, '  max_depth: settings?.max_depth ?? null,').offenders).toHaveLength(1)
    expect(at(STRUCTURE, "const rawDepth = req.nextUrl.searchParams.get('max_depth')").offenders).toEqual([])        // 대조(계약)
    expect(at(STRUCTURE, '  max_depth: levels ? levels.length : null,').offenders).toEqual([])                          // 대조(응답 필드)
    expect(at('src/lib/x.ts', "settingDef('project', 'core.level_labels'); t('settings.core.level_labels.label')").offenders).toEqual([])
  })
  it('경계 — 머리 주석의 한계는 실제로 못 잡고(not 단언), 잡는다고 적은 것은 잡는다(m-5·rereview m-E)', () => {
    const PC = 'src/lib/settings/projectConfig.ts'
    const evil = 'src/app/actions/evil.ts'
    const quiet = (v: ReturnType<typeof verdicts>, file: string) => [...v.G1, ...v.G2, ...v.G1refs.filter((l) => l.startsWith(file))]
    // 못 잡음: 허용 파일이 가진 표 이름을 상수로 export(참조 수 그대로) → 다른 파일이 from(X) 쓰기
    const exported = judge([[PC, "export const PS = 'project_settings'\nconst s = await sb.from(PS).select('values')"],
      [evil, "import { PS } from '@/lib/settings/projectConfig'\nawait admin.from(PS).update({ values: {} })"]])
    expect(quiet(exported, PC)).toEqual([])
    // 못 잡음: 허용 파일 안 기존 참조를 대괄호 접근 쓰기로 바꾸기(참조 수 그대로)
    expect(quiet(judge([[WRITE_FILE, "// `project_settings`\nawait admin['from']('project_settings').update({ values: {} })"]]), WRITE_FILE)).toEqual([])
    // 못 잡음: 이중 보간·join·줄 이음·process.env
    for (const code of ["const KIND = 'settings'\nawait admin.from(`${scope}_${KIND}`).update({})", "await admin.from(['project', 'settings'].join('_')).update({})",
      "await admin.from('project_\\\nsettings').update({})", 'await admin.from(process.env.SETTINGS_TABLE!).update({})']) {
      expect(quiet(judge([[evil, code]]), evil), code).toEqual([])
    }
    // 못 잡음: 목록 파일 안의 별칭 호출(이름( 호출 수 그대로)
    const alias = "await runWbsImport(admin, a)\nconst run = runWbsImport\nexport async function again(p) { return run(createAdminClient(), b) }"
    expect(judge([['src/app/actions/wbsMarkdown.ts', alias]]).G4runnerCalls).toEqual(['src/app/api/v1/wbs/import/route.ts: 실측 (파일 없음) / 목록 1'])
    // 못 잡음: 스캔 밖 파일(tests/ 헬퍼)
    expect(targetFiles(['tests/rls/zzHelpers.ts'])).toEqual([])
    // 못 잡음: 허용 파일 안 식 from 의 중첩 제네릭·대문자 …Array 이름 변수 뒤 쓰기(참조 수 그대로)
    const HIST = 'src/lib/settings/history.ts'
    const tbl = "const table = pick ? 'project_settings_history' : 'workspace_settings_history'\n"
    expect(quiet(judge([[HIST, `${tbl}await client.from<Pick<Row, 'a'>>(table).delete()`]]), HIST).filter((l) => !l.includes('실측'))).toEqual([])
    expect(quiet(judge([[HIST, `${tbl}const HistArray = client; await HistArray.from(table).delete()`]]), HIST).filter((l) => !l.includes('실측'))).toEqual([])
    // 못 잡음: 유니코드 이스케이프로 쓴 표 이름
    expect(quiet(judge([[evil, "await admin.from('\\u0070roject_settings').update({})"]]), evil)).toEqual([])
    // 잡음: 허용 목록 밖의 대괄호 접근(G1 표 리터럴), String.raw(백틱 리터럴)
    expect(judge([[evil, "await admin['from']('project_settings').update({})"]]).G1).toHaveLength(1)
    const raw = judge([[evil, 'await admin.from(String.raw`project_settings`).update({})']])
    expect(raw.G1).toHaveLength(1)
    expect(raw.G2).toHaveLength(1)
  })
})
