// 설정 표·설정 RPC 게이트(개정 §2.11 ⑦, 스펙 §3.4) — service_role 은 설정 표에 쓰기 권한을 가지므로(S8) 서버 코드의 우회를 막는 유일한 게이트다.
// 설정 쓰기는 RPC 한 길이다: 표 이름은 허용 파일에만 있고(G1) 그 접근은 읽기뿐이며(G2), 설정 RPC 는 닫힌 파일에서 리터럴 이름으로만 부르고(G3),
// 가드 없는 내부 쓰기 함수는 닫힌 호출자만 쓴다(G4). 검사는 파일 원문에 한다(G5 — 공용 codeLines 는 문자열 속 '//'·'/*' 를 주석으로 읽어
// 뒤 코드를 가린다. 그 고침은 Phase B). 그래서 주석 속 이름도 적중이다. 대상은 src·scripts(와 생기면 supabase/functions)의 js·ts 전부다(G6).
// tests 는 제외(tests/rls 는 거부를 단언하려고 일부러 쓴다). 목록에 있는데 쓰지 않는 파일도 실패다.
// 한계(grep 게이트): 의도적 난독화 — 조각 join·String.raw·대괄호 접근(admin['from'])·유니코드·퍼센트 이스케이프, 다른 파일이 export 한 표 이름
// 상수를 가져와 쓰는 것 — 는 잡지 못한다. 아래 '게이트 자기 검사' 가 잡는 모양과 못 잡는 모양의 경계를 고정한다.
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { codeLines, walk } from './_walk'

const TABLES = ['project_settings', 'workspace_settings', 'project_settings_history', 'workspace_settings_history', 'authz_events'] as const
const RPCS = ['apply_project_settings', 'apply_workspace_settings', 'create_project_with_settings'] as const
const T = TABLES.join('|')
const P = RPCS.join('|')

/** G1 — 표 이름이 통째로 인용된 리터럴. from(…) 인자든 변수·삼항·상수 객체·헬퍼 인자·타입이든 어디 있든 센다 */
const TABLE_LIT = new RegExp(`(['"\`])(${T})\\1`, 'g')
/** G1 — 이름을 조립하는 조각: 범위 보간 템플릿(`${scope}_settings`), 연결 조각('project_' + …) */
const TABLE_FRAG = /\$\{[^}]*\}_settings(?:_history)?\b|(['"`])(?:project|workspace)_\1/g
/** G6(scripts) — pg 로 보내는 SQL 의 표 참조. 허용 목록으로 판정한다(settings-verify 의 읽기) */
const SQL_REF = new RegExp(`\\b(?:from|join|into|update|table)\\s+(?:public\\.)?"?(${T})\\b`, 'gi')
/** G6(scripts) — SQL 쓰기·PostgREST 직접 경로·SQL 로 부르는 설정 RPC. 0건 */
const SQL_WRITE = new RegExp(`\\b(?:update|insert\\s+into|delete\\s+from)\\s+(?:public\\.)?"?(?:${T})\\b`, 'gi')
const REST = new RegExp(`/rest/v1/(?:rpc/)?(?:${T}|${P})\\b|['"\`](?:(?:${T})\\?|rpc/(?:${P})\\b)`, 'g')
const SQL_RPC = new RegExp(`\\bpublic\\.(?:${P})\\b|\\bselect\\s+(?:\\*\\s+from\\s+)?(?:${P})\\s*\\(`, 'gi')
/** G2 — 리터럴 표 이름의 from(…)(서식 변형 흡수: 괄호 안 공백·줄바꿈·끝 쉼표·as const)과 그 뒤 첫 메서드 */
const FROM_LIT = new RegExp(`from\\(\\s*(['"\`])(${T})\\1(?:\\s+as\\s+const)?\\s*,?\\s*\\)(\\s*\\.\\s*(\\w+))?`, 'g')
/** G2 — 표 이름을 식으로 받는 from(…) — 표 이름을 가진 파일 안에서는 뒤 첫 메서드가 select 여야 한다(Array·Buffer·storage 의 from 은 뺀다) */
const FROM_EXPR = /(?<!\b(?:Array|Buffer|storage))\.from\((?!\s*['"`])/g
/** 설정 RPC 이름 리터럴 */
const RPC_LIT = new RegExp(`(['"\`])(${P})\\1`, 'g')
/** G3 — 첫 인자가 온전한 문자열 리터럴이 아닌 .rpc((보간·연결·상수), 이름 조립 조각 */
const RPC_DYNAMIC = /\.rpc\((?!\s*(['"`])[^'"`$\\]*\1\s*[,)])/g
const RPC_FRAG = /apply_\$\{|(['"`])apply_\1\s*\+/g
/** G4 — 가드 없는 서버 내부 쓰기 함수(src/lib/settings/write.ts) */
const INTERNAL_WRITE = /\bwriteProjectSettingsInternal\b/
const INTERNAL_WRITE_DEF = 'src/lib/settings/write.ts'

/** 파일 → 허용 표와 사유(G1). 접근은 읽기뿐이다(G2) */
const ALLOW: Record<string, { tables: string[]; why: string }> = {
  'src/lib/settings/projectConfig.ts': { tables: ['project_settings'], why: '해석기 — 유일한 읽기 경로' },
  'src/lib/settings/workspaceConfig.ts': { tables: ['workspace_settings'], why: '해석기 — 유일한 읽기 경로' },
  'src/lib/settings/write.ts': { tables: ['project_settings'], why: 'revision 판독 뒤 RPC(머리 주석의 from(…) 도 원문 검사라 센다)' },
  'src/lib/settings/history.ts': { tables: ['project_settings_history', 'workspace_settings_history'], why: '이력 읽기(D24) — tableOf 가 이름을 고르고 from(table).select 만 한다' },
  'scripts/settings-verify.check.ts': { tables: ['project_settings', 'workspace_settings'], why: '전 행을 해석기로 검사 — pg SQL 읽기' },
  'scripts/dev-bootstrap.mjs': { tables: ['workspace_settings'], why: 'revision 판독 뒤 apply_workspace_settings' },
  'scripts/e2e-local.mjs': { tables: ['project_settings', 'project_settings_history', 'workspace_settings'], why: '결과 확인 읽기, B 의 revision 판독 뒤 apply_workspace_settings' },
  // Phase D: 'src/lib/authz/events.ts': { tables: ['authz_events'], why: '권한 이력 읽기' },
}

/** 설정 RPC(개정 §2.11 ⑦) → 부르는 파일과 사유. 권한 RPC(set_platform_admin 등)는 이 게이트 밖이다. */
const RPC_ALLOW: Record<string, { rpcs: (typeof RPCS)[number][]; why: string }> = {
  'src/lib/settings/write.ts': { rpcs: ['apply_project_settings'], why: '서버 내부 쓰기 한 함수(W5 양식 저장·W6 골격 단계 이름)' },
  'src/app/actions/settings.ts': { rpcs: ['apply_project_settings', 'apply_workspace_settings'], why: '설정 액션 — 가드 뒤 RPC' },
  'src/app/actions/project.ts': { rpcs: ['create_project_with_settings'], why: 'createProject — requireWorkspaceAdmin 뒤 생성·복사' },
  'scripts/dev-bootstrap.mjs': { rpcs: ['apply_workspace_settings'], why: '부트스트랩 워크스페이스의 modules.allowed(로컬 전용)' },
  'scripts/e2e-local.mjs': { rpcs: ['apply_workspace_settings'], why: '워크스페이스 B 의 modules.allowed — 생성 화면(Phase C) 전이라 service_role(로컬 전용)' },
  'scripts/perf-baseline.mjs': { rpcs: ['create_project_with_settings'], why: 'PERF 프로젝트 시드(로컬 전용)' },
}
/** G3 — 리터럴이 아닌 .rpc( 의 파일별 건수 */
const RPC_DYNAMIC_ALLOW: Record<string, { count: number; why: string }> = {
  'src/app/actions/settings.ts': { count: 1, why: '범위 어댑터의 메서드 a.rpc(admin, …) — supabase 호출이 아니다. 실제 RPC 는 같은 파일의 리터럴 두 곳' },
}
/** G4 — writeProjectSettingsInternal 을 쓰는 파일(정의 파일 제외)과 사유 */
const INTERNAL_WRITE_CALLERS: Record<string, string> = {
  'src/app/api/import/execute/route.ts': 'W5 양식 저장 — requireProjectAdmin(pid) 뒤 그 pid·actor 로 부른다',
  'src/lib/agent/wbsImport.ts': 'W6 골격 단계 이름 — 가드는 호출부(v1/wbs/import 라우트·wbsMarkdown 액션)가 한다. 새 호출부는 가드 확인 뒤 여기에 더한다',
}

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
const lineOf = (text: string, index: number) => text.slice(0, index).split('\n').length

interface Scan {
  tables: Set<string>       // G1 표 참조(리터럴, 조각은 '조각:…', scripts 는 SQL 참조 포함)
  writes: string[]          // G2 리터럴 표 from(…) 뒤가 select 가 아닌 곳
  exprFroms: string[]       // G2 식으로 받은 from(…) 뒤가 select 가 아닌 곳 — 표 참조가 있는 파일에서만 판정한다
  rpcs: Set<string>         // 설정 RPC 리터럴
  rpcDynamic: string[]      // G3 리터럴이 아닌 .rpc( 와 이름 조립 조각
  scriptWrites: string[]    // G6(scripts) SQL 쓰기·REST·SQL RPC
  internalWrite: boolean    // G4
}

/** 게이트 본체 — 파일 하나의 원문을 판정한다(자기 검사가 같은 함수에 공격 모양을 먹인다) */
function scan(file: string, text: string): Scan {
  const isScript = file.startsWith('scripts/')
  const s: Scan = { tables: new Set(), writes: [], exprFroms: [], rpcs: new Set(), rpcDynamic: [], scriptWrites: [], internalWrite: false }
  for (const m of text.matchAll(TABLE_LIT)) s.tables.add(m[2])
  for (const m of text.matchAll(TABLE_FRAG)) s.tables.add(`조각:${m[0]}`)
  for (const m of text.matchAll(FROM_LIT)) if (m[4] !== 'select') s.writes.push(`${lineOf(text, m.index)}: from(${m[2]}).${m[4] ?? '(체인 없음)'}`)
  for (const m of text.matchAll(FROM_EXPR)) {
    const end = afterCall(text, m.index + m[0].indexOf('('))
    const next = end < 0 ? null : /^\s*\.\s*(\w+)/.exec(text.slice(end))
    if (next?.[1] !== 'select') s.exprFroms.push(`${lineOf(text, m.index)}: from(…).${next?.[1] ?? '(체인 없음)'}`)
  }
  for (const m of text.matchAll(RPC_LIT)) s.rpcs.add(m[2])
  for (const m of text.matchAll(RPC_DYNAMIC)) s.rpcDynamic.push(`${lineOf(text, m.index)}: .rpc(<리터럴 아님>`)
  for (const m of text.matchAll(RPC_FRAG)) s.rpcDynamic.push(`${lineOf(text, m.index)}: 이름 조각 ${m[0]}`)
  if (isScript) {
    for (const m of text.matchAll(SQL_REF)) s.tables.add(m[1].toLowerCase())
    for (const re of [SQL_WRITE, REST, SQL_RPC]) for (const m of text.matchAll(re)) s.scriptWrites.push(`${lineOf(text, m.index)}: ${m[0]}`)
  }
  s.internalWrite = file !== INTERNAL_WRITE_DEF && INTERNAL_WRITE.test(text)
  return s
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
  codeLines(text).forEach((raw, i) => {
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
const EXT = /\.[cm]?[jt]sx?$/
// supabase/functions 는 지금 없다 — 생기면(엣지 함수) 자동으로 든다
const files = ['src', 'scripts', 'supabase/functions'].filter((d) => existsSync(d)).flatMap((d) => walk(d, undefined, EXT))
const scans = new Map(files.map((f) => [f, scan(f, readFileSync(f, 'utf8'))]))

/** 허용 목록과 실측이 파일마다 정확히 같은지 — 다르면 "파일: 목록 / 실측" 줄 */
function staleEntries(allow: Record<string, readonly string[]>, got: (f: string) => Iterable<string>): string[] {
  const stale: string[] = []
  for (const [f, want] of Object.entries(allow)) {
    const g = [...got(f)].sort().join(',')
    if (g !== [...want].sort().join(',')) stale.push(`${f}: 목록 ${want.join(',')} / 실측 ${g || '(없음)'}`)
  }
  return stale
}
const pick = <K extends keyof Scan>(k: K) => (f: string) => (scans.get(f)?.[k] ?? []) as Iterable<string>

describe('settings-writes', () => {
  it('G1 허용 목록 밖에서 설정 표 이름이 0건이다(리터럴·조각·SQL 참조)', () => {
    const offenders = [...scans].filter(([f, s]) => s.tables.size && !ALLOW[f]).map(([f, s]) => `${f}: ${[...s.tables].join(', ')}`)
    expect(offenders, '설정은 해석기로 읽고 RPC 로 쓴다').toEqual([])
  })
  it('G1 허용 목록의 파일은 적힌 표를 실제로 쓴다(죽은 예외 없음)', () => {
    expect(staleEntries(Object.fromEntries(Object.entries(ALLOW).map(([f, a]) => [f, a.tables])), pick('tables'))).toEqual([])
  })
  it('G2 설정 표 접근은 어느 파일이든(허용 목록 포함) 읽기뿐이다 — 쓰기는 RPC 한 길', () => {
    const writes = [...scans].flatMap(([f, s]) => [...s.writes, ...(s.tables.size ? s.exprFroms : [])].map((w) => `${f}:${w}`))
    expect(writes).toEqual([])
  })
  it('설정 RPC 는 허용 목록 밖에서 0건이고, 목록의 파일은 적힌 RPC 를 실제로 부른다', () => {
    const offenders = [...scans].filter(([f, s]) => s.rpcs.size && !RPC_ALLOW[f]).map(([f, s]) => `${f}: ${[...s.rpcs].join(', ')}`)
    expect(offenders, '설정 쓰기는 설정 액션·내부 쓰기 한 함수·생성 액션을 지난다').toEqual([])
    expect(staleEntries(Object.fromEntries(Object.entries(RPC_ALLOW).map(([f, a]) => [f, a.rpcs])), pick('rpcs'))).toEqual([])
  })
  it('G3 RPC 이름을 조립하지 않는다 — 리터럴이 아닌 .rpc( 는 어댑터 한 곳뿐', () => {
    const got = Object.fromEntries([...scans].filter(([, s]) => s.rpcDynamic.length).map(([f, s]) => [f, s.rpcDynamic.length]))
    expect(got).toEqual(Object.fromEntries(Object.entries(RPC_DYNAMIC_ALLOW).map(([f, a]) => [f, a.count])))
  })
  it('G4 가드 없는 내부 쓰기 함수의 호출자가 닫혀 있다(양방향)', () => {
    const got = [...scans].filter(([, s]) => s.internalWrite).map(([f]) => f).sort()
    expect(got).toEqual(Object.keys(INTERNAL_WRITE_CALLERS).sort())
  })
  it('G6 scripts 는 SQL 쓰기·REST 직접 경로·SQL 로 부르는 설정 RPC 가 0건이다', () => {
    expect([...scans].flatMap(([f, s]) => s.scriptWrites.map((w) => `${f}:${w}`))).toEqual([])
  })
  it('옛 넓은 열 이름을 src·scripts 가 더는 쓰지 않는다 — 외부 계약 예외는 정확히 그 줄들', () => {
    const offenders: string[] = []
    const exempt: Record<string, number> = {}
    for (const f of files) {
      if (f.startsWith('scripts/lib/baseline') || f.startsWith('scripts/baseline-dump')) continue   // 기준선 도구는 옛 스키마를 읽는다
      const r = oldNames(f, readFileSync(f, 'utf8'))
      offenders.push(...r.offenders)
      for (const [k, n] of Object.entries(r.exempt)) exempt[k] = (exempt[k] ?? 0) + n
    }
    expect(offenders).toEqual([])
    expect(exempt, '예외가 더 넓어지거나 죽으면 실패').toEqual(Object.fromEntries(CONTRACT_SHAPES.map((c) => [c.why, 1])))
  })
})

describe('게이트 자기 검사 — 적대 탐색의 모양(gate-attack.md)을 게이트 본체에 먹인다', () => {
  const src = (code: string) => scan('src/app/actions/attack.ts', code)
  const script = (code: string) => scan('scripts/attack.mjs', code)
  it('G1 변수·상수 객체·삼항·헬퍼 인자로 넘긴 표 이름(V1·V2·V6·V7)', () => {
    expect([...src("const t = 'project_settings'\nawait admin.from(t).update({ values: {} })").tables]).toEqual(['project_settings'])
    expect([...src("const T = { ws: 'workspace_settings' } as const\nawait admin.from(T.ws).upsert({})").tables]).toEqual(['workspace_settings'])
    expect([...src("await admin.from(isP ? 'project_settings_history' : 'workspace_settings_history').insert({})").tables].sort())
      .toEqual(['project_settings_history', 'workspace_settings_history'])
    expect([...script("for (const [label, table, rows] of [['설정', 'project_settings', r]]) await upsert(table, rows)").tables]).toEqual(['project_settings'])
    expect([...src("type Tbl = 'authz_events'").tables]).toEqual(['authz_events'])
  })
  it('G1 이름 조립 조각 — 범위 보간 템플릿·연결(V3·V4·V5)', () => {
    expect(src('await admin.from(`${scope}_settings`).update({})').tables.size).toBe(1)
    expect(src('await admin.from(`${scope}_settings_history`).insert({})').tables.size).toBe(1)
    expect(src("await admin.from('project_' + 'settings').update({})").tables.size).toBe(1)
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
  it('G2 식으로 받은 표 이름의 쓰기 — history.ts 모양(A8)', () => {
    const tbl = "const table = pick ? 'project_settings_history' : 'workspace_settings_history'\n"
    expect(src(`${tbl}await client.from(table).insert({})`).exprFroms).toHaveLength(1)
    expect(src(`${tbl}await client.from(tableOf(scope).table).update({})`).exprFroms).toHaveLength(1)
    expect(src(`${tbl}await client.from(table).select('key').eq(column, id)`).exprFroms).toEqual([])                   // 대조
    expect(src(`${tbl}Array.from(xs).map(String); await sb.storage.from(BUCKET).upload(p, b)`).exprFroms).toEqual([])  // 대조
  })
  it('G3 RPC 이름 보간·연결·상수(P2~P4)', () => {
    expect(src('await admin.rpc(`apply_${scope}_settings`, {})').rpcDynamic).toHaveLength(2)          // .rpc( + 조각
    expect(src("await admin.rpc('apply_' + scope + '_settings', {})").rpcDynamic).toHaveLength(2)
    expect(src('await admin.rpc(FN, {})').rpcDynamic).toHaveLength(1)
    expect(src("const fn = 'apply_' + scope").rpcDynamic).toHaveLength(1)
    expect(src("await admin.rpc(\n  'apply_workspace_settings',\n  { p_workspace_id: id },\n)").rpcDynamic).toEqual([])   // 대조
    expect([...src("export const APPLY = 'apply_project_settings'").rpcs]).toEqual(['apply_project_settings'])
  })
  it('G4 가드 없는 내부 쓰기 함수(H1)', () => {
    expect(src("import { writeProjectSettingsInternal } from '@/lib/settings/write'").internalWrite).toBe(true)
    expect(scan(INTERNAL_WRITE_DEF, 'export async function writeProjectSettingsInternal() {}').internalWrite).toBe(false)
  })
  it('G6 scripts 의 raw SQL·REST·SQL RPC(R1~R4·P7), 읽기 SQL 은 표 참조로', () => {
    expect(script("await pool.query('update public.project_settings set \"values\" = $1 where project_id = $2', [v, id])").scriptWrites).toHaveLength(1)
    expect(script('await pool.query(`insert into public.project_settings_history (key) values ($1)`)').scriptWrites).toHaveLength(1)
    expect(script('await fetch(`${url}/rest/v1/project_settings?project_id=eq.${id}`, { method: "PATCH" })').scriptWrites).toHaveLength(1)
    expect(script("await rest('workspace_settings?workspace_id=eq.' + id, { method: 'PATCH' })").scriptWrites).toHaveLength(1)
    expect(script("await rest('rpc/apply_project_settings', { method: 'POST' })").scriptWrites).toHaveLength(1)
    expect(script("await pool.query('select public.apply_workspace_settings($1, $2)')").scriptWrites).toHaveLength(1)
    expect([...script("await pool.query('select project_id from public.project_settings')").tables]).toEqual(['project_settings'])
  })
  it('G6 대상 확장자 — js·jsx·cjs·mjs·cts·mts·ts·tsx', () => {
    for (const ext of ['js', 'jsx', 'cjs', 'mjs', 'cts', 'mts', 'ts', 'tsx']) expect(EXT.test(`src/app/api/x/route.${ext}`), ext).toBe(true)
    expect(EXT.test('scripts/x.sh')).toBe(false)
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
})
