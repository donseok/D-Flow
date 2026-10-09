// p_actor 의 출처(SP4 스펙 D51·§6.1, 마무리 판정 T7, 계획 P5). DEFINER RPC 는 p_actor 를 행위자로 그대로 믿고 그 안에서 auth.uid() 는
// null 이다 — p_actor 를 받는 RPC 를 부르는 src 의 모든 자리가 그 값을 가드 결과에서 얻는지 AST 로 본다.
//  (a) 직접: 값이 `<g>.actor.userId` 이고 <g> 의 가장 가까운 선언이 `const <g> = await <가드>(…)`(@/lib/authz 의 네 가드 — 별칭·네임스페이스 import 포함)
//  (b) 한 단계: 값이 지역 const(또는 그 객체 리터럴의 필드)면 초기값이 (a). 같은 파일 함수의 매개변수(또는 그 필드)면 그 함수의 모든
//      참조가 호출이고(export·콜백·객체 필드 아님) 각 호출이 그 자리에 (a) 를 넘긴다
//  (a)·(b) 모두 판정한 이름(가드 결과 g·매개변수·지역 const)을 같은 함수 안에서 바꾸면(대입·필드 쓰기·Object.assign·증감·delete·
//      var 재선언) 실패다(K5 — 선언만 보면 그 뒤 쓰기를 못 본다)
//  (c) 그 밖은 닫힌 허용 목록 ACTOR_SOURCE_EXCEPTIONS(`<파일>#<rpc>` → 값 식·자리 수·사유, 죽은 항목 검사) — 세션 가드가 아닌 행위자(에이전트
//      토큰·내부 경로)도 받는 라이브러리 도우미와 두 단계 전달. 도우미 예외는 HELPER_CALLERS 가 호출부(파일·호출 수·각 호출의 행위자 필드)를
//      닫는다(K6)
// 구조 규칙(허용 목록으로 덮지 못한다): p_actor 는 `.rpc('<P_ACTOR_RPCS 의 이름>', { … })` 의 객체 리터럴에만, 그 호출에는 반드시, 그 뒤
// 펼침이 p_actor 를 덮을 수 없게. 대상 = 마이그레이션에서 인자 이름이 정확히 p_actor 인 함수(자동 추출) ↔ P_ACTOR_RPCS(양방향 —
// p_actor_id·p_actor_name 의 회의록 RPC 는 범위 밖). 첫날 실측(main 81deae9 — 스펙 §6.1): p_actor 자리 9곳 = 직접 3·한 단계 2·허용 목록 4.
// 한계: 타입 검사기 없이 이름의 가장 가까운 선언을 찾는다. `g.ok` 확인은 타입 검사가 강제한다(GuardResult 유니온 — 좁히지 않으면 g.actor 가 형 오류).
//  보지 못하는 것(A1-1 범위 재리뷰 P3 — A2 이월 Z5): 별칭을 거친 변이(`const a = g.actor; a.userId = x`·`const h = g; h.actor.userId = x`),
//  다른 함수·호출 안의 변이(`mutate(g)`·`Reflect.set(g.actor, …)`) — 판정한 이름 그 자체의 쓰기만 센다.
//  보수적 거짓 양성(실패 쪽): 가림(콜백이 같은 이름을 다시 선언하고 쓰는 꼴)과 같은 객체의 행위자가 아닌 필드 쓰기(`payload.note = …`)도 실패로 센다.
//  도우미 호출부(K6)는 import 출처를 경로로 정규화해 센다(`./workflowEvent` 같은 상대 경로도 `@/lib/…` 와 같다). 동적 `import()`·재수출(barrel)은 보지 않는다.
import { readFileSync, readdirSync } from 'node:fs'
import { join, posix } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { hasModifier, parse } from './_ast'
import { walk } from './_walk'

/** 마이그레이션에서 인자 이름이 정확히 p_actor 인 public 함수 — 닫힌 목록. 새 마이그레이션이 p_actor 함수를 만들면 그 과제가 같이 더한다 */
const P_ACTOR_RPCS: ReadonlySet<string> = new Set([
  'actor_is_project_admin', 'actor_is_workspace_admin', 'activate_form_template', 'apply_project_settings', 'apply_wbs_bulk_item', 'apply_workflow_event', 'apply_workflow_event_cas', 'apply_workflow_event_stage_cas', 'apply_workspace_settings', 'backfill_custom_field', 'change_team_code', 'convert_inherited_teams', 'custom_field_command',
  'deactivate_form_template', 'get_project_creation_receipt',
  'create_project_with_settings', 'create_weekly_report', 'create_team', 'ensure_team_roots', 'import_wbs_cmd', 'merge_teams', 'migrate_setting_code', 'purge_custom_field', 'set_dependency_waiver', 'set_platform_admin', 'set_workspace_role',
  'upsert_project_area', 'upsert_project_member', 'upsert_project_member_cmd',
])

/** (c) 닫힌 허용 목록 — `<파일>#<rpc>` → 그 자리의 p_actor 값 식(공백 하나로 정규화)·그 식의 자리 수·사유. (a)·(b) 로 통과하는 자리를
 *  적으면 죽은 항목, 같은 식의 자리가 늘거나 줄면 실패(K6 — 같은 파일의 새 자리가 자동으로 덮이지 않게) */
type ActorException = { expr: string; count: number; why: string }
const ACTOR_SOURCE_EXCEPTIONS: Readonly<Record<string, ActorException>> = {
  'src/app/actions/settings.ts#apply_project_settings': {
    expr: 'x.actor',
    count: 1,
    why: '설정 명령 어댑터(두 단계) — updateProjectSettings 의 가드 결과 g.actor 를 runCommand 가 받아 어댑터 rpc(admin, x) 의 x.actor 로 싣는다',
  },
  'src/app/actions/settings.ts#apply_workspace_settings': {
    expr: 'x.actor',
    count: 1,
    why: '설정 명령 어댑터(두 단계) — updateWorkspaceSettings 의 가드 결과 g.actor 를 runCommand 가 받아 어댑터 rpc(admin, x) 의 x.actor 로 싣는다',
  },
  'src/app/actions/settings.ts#ensure_team_roots': {
    expr: 'actor.userId',
    count: 1,
    why: '설정 명령 어댑터의 저장 뒤 후처리(SP5 B2 — 최상위 폴더 모드 teams) — updateWorkspaceSettings 의 가드 결과 g.actor 를 runCommand 가 afterApplied(…, actor) 로 넘긴다. RPC 가 워크스페이스 관리자를 다시 판정한다',
  },
  'src/lib/settings/write.ts#apply_project_settings': {
    expr: 'actorUserId',
    count: 1,
    why: '서버 내부 쓰기 writeProjectSettingsInternal — 가져오기 라우트(가드 결과)와 에이전트 경로(lib/agent/wbsImport.ts)의 행위자를 함께 받는 라이브러리 도우미',
  },
  'src/lib/settings/write.ts#apply_workspace_settings': {
    expr: 'actorUserId',
    count: 1,
    why: '서버 내부 쓰기 writeWorkspaceSettingsInternal — 호출부는 createPlatformWorkspace 하나이고 requireSuperuser 결과의 g.actor.userId 를 넘긴다(호출부는 settings-writes 의 WORKSPACE_WRITE_CALLERS 가 닫는다)',
  },
  'src/lib/agent/workflowEvent.ts#apply_workflow_event': {
    expr: 'args.actorUserId',
    count: 1,
    why: '워크플로 사건 도우미 applyWorkflowEvent — 세션 액션의 가드 결과와 에이전트 토큰 라우트(api/v1/agent/work/[id]/*)·위임(lib/agent/delegation.ts)의 행위자를 함께 받는다. 호출부는 HELPER_CALLERS 가 닫는다',
  },
  'src/lib/agent/workflowEvent.ts#apply_workflow_event_cas': {
    expr: 'args.actorUserId',
    count: 1,
    why: '대량 단계 CAS 도우미 applyWorkflowEvent — 세션 액션의 가드 결과와 에이전트 토큰 라우트(api/v1/agent/work/[id]/*)·위임(lib/agent/delegation.ts)의 행위자를 함께 받는다. 호출부는 HELPER_CALLERS 가 닫는다',
  },
  'src/lib/agent/workflowEvent.ts#apply_workflow_event_stage_cas': {
    expr: 'args.actorUserId',
    count: 1,
    why: '사람의 단계 지정 값 CAS 도우미 applyWorkflowEvent(0048) — 세션 액션의 가드 결과와 에이전트 토큰 라우트(api/v1/agent/work/[id]/*)·위임(lib/agent/delegation.ts)의 행위자를 함께 받는다. 호출부는 HELPER_CALLERS 가 닫는다',
  },
}

/** 라이브러리 도우미 예외의 호출부 닫힌 목록(K6) — 도우미가 행위자를 인자 필드로 받으면 p_actor 자리의 예외만으로는 호출부를 아무도 보지
 *  않는다. 도우미를 부르는 파일·호출 수를 닫고, 각 호출의 행위자 필드를 같은 judge(직접·한 단계)로 본다. 통과하지 못하는 호출은 파일별
 *  값 식·사유로만(세션 가드가 아닌 행위자 — 에이전트 토큰 라우트 등). settings-writes 의 INTERNAL_WRITE_CALLERS 와 같은 모양이다
 *  (writeProjectSettingsInternal 의 호출부는 그쪽이 닫는다) */
interface HelperSpec {
  helper: string
  source: string
  field: string
  /** 파일 → 도우미 호출 수, 그중 judge 를 통과하지 못해 값 식·사유로 허용하는 호출(except — 값 식이 같고 개수도 같아야 한다) */
  callers: Readonly<Record<string, { count: number; except?: { expr: string; count: number; why: string } }>>
}
const HELPER_CALLERS: Readonly<Record<string, HelperSpec>> = {
  'src/lib/agent/workflowEvent.ts#apply_workflow_event': {
    helper: 'applyWorkflowEvent', source: '@/lib/agent/workflowEvent', field: 'actorUserId',
    callers: {
      'src/app/actions/wbsAssign.ts': {
        count: 5,   // setWbsAssignee·assignWbsCascade 의 둘은 requireProjectAdmin 직접
        except: {
          expr: 'g.actor.userId', count: 3,
          why: 'setWbsStage·setWbsDevWorkflow 의 g 는 requireSubtreeManagerOrAdmin(lib/agent/subtreeManager — requireProjectAdmin 또는 requireProjectMember + 서브트리 관리자 판정의 actor). SP5b(B-23): setWbsStage 의 xx 지정·approveWbsStep 의 g 는 guardStepApproval — 대기 단계 승인자에 따라 requireProjectAdmin 또는 requireCompletionApprover(같은 파일 도우미)의 actor',
        },
      },
      'src/app/actions/agentWork.ts': {
        count: 3,
        except: {
          expr: 'actor.userId', count: 3,
          why: '주문 검토 액션 — loadOrderForAdmin·loadOrderForReview 가 requireProjectAdmin 결과의 g.actor.userId 를 actor 로 돌려준다(두 단계)',
        },
      },
      'src/app/api/v1/agent/work/[id]/claim/route.ts': {
        count: 1, except: { expr: 'loaded.userId', count: 1, why: '에이전트 토큰 라우트 — loadGatedOrderForUser 가 토큰 주체로 해석한 사용자' },
      },
      'src/app/api/v1/agent/work/[id]/release/route.ts': {
        count: 1, except: { expr: 'loaded.userId', count: 1, why: '에이전트 토큰 라우트 — loadGatedOrderForUser 가 토큰 주체로 해석한 사용자' },
      },
      'src/app/api/v1/agent/work/[id]/report/route.ts': {
        count: 1, except: { expr: 'loaded.userId', count: 1, why: '에이전트 토큰 라우트 — loadGatedOrderForUser 가 토큰 주체로 해석한 사용자' },
      },
      'src/lib/agent/delegation.ts': {
        count: 2,
        except: {
          expr: 'actorUserId', count: 2,
          why: '위임 도우미 applyDelegation 의 args.actorUserId(구조 분해) — 호출부는 세션 액션 agentHub.ts·wbsSpec.ts(이 불변식은 그 단계를 보지 않는다)',
        },
      },
    },
  },
}

/** 첫날 분류 실측(스펙 §6.1 — 직접 3·한 단계 2·허용 목록 4). 이 9곳만 적는다(새 자리는 더하지 않는다) — 바뀌면 의도를 확인하고 고친다 */
const FIRST_DAY: Readonly<Record<string, 'direct' | 'indirect' | 'exception'>> = {
  'src/app/actions/project.ts#create_project_with_settings': 'direct',
  'src/app/actions/accounts.ts#set_platform_admin': 'direct',
  'src/app/actions/accounts.ts#set_workspace_role': 'direct',
  'src/app/actions/roster.ts#upsert_project_member_cmd': 'indirect',
  'src/app/actions/accounts.ts#upsert_project_member_cmd': 'indirect',
  'src/app/actions/settings.ts#apply_project_settings': 'exception',
  'src/app/actions/settings.ts#apply_workspace_settings': 'exception',
  'src/lib/settings/write.ts#apply_project_settings': 'exception',
  'src/lib/agent/workflowEvent.ts#apply_workflow_event': 'exception',
}

const GUARDS: ReadonlySet<string> = new Set(['requireSuperuser', 'requireWorkspaceAdmin', 'requireProjectAdmin', 'requireProjectMember'])
const GUARD_SOURCE = '@/lib/authz'

type Verdict = { ok: true; how: 'direct' | 'indirect' } | { ok: false; why: string }
interface Site { file: string; line: number; rpc: string; expr: string; verdict: Verdict }
interface Scan { sites: Site[]; problems: string[] }
type Binding =
  | { kind: 'const'; init: ts.Expression }
  | { kind: 'param'; fn: ts.SignatureDeclaration; index: number }
  | { kind: 'fn'; decl: ts.FunctionDeclaration }
  | { kind: 'import'; source: string; imported: string }
  | { kind: 'other' }

const lineOf = (sf: ts.SourceFile, n: ts.Node): number => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1
const unwrap = (e: ts.Expression): ts.Expression => {
  let cur = e
  while (ts.isParenthesizedExpression(cur) || ts.isAsExpression(cur) || ts.isNonNullExpression(cur) || ts.isSatisfiesExpression(cur)
    || ts.isTypeAssertionExpression(cur)) cur = cur.expression
  return cur
}
const propName = (p: ts.ObjectLiteralElementLike): string | null => {
  if (ts.isSpreadAssignment(p)) return null
  if (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) return p.name.text
  if (ts.isComputedPropertyName(p.name) && ts.isStringLiteralLike(p.name.expression)) return p.name.expression.text
  return null
}
const bindsName = (b: ts.BindingName, name: string): boolean =>
  ts.isIdentifier(b) ? b.text === name : b.elements.some((e) => !ts.isOmittedExpression(e) && bindsName(e.name, name))

/** 문장 s 가 name 을 선언하면 그 바인딩 */
function declaredIn(s: ts.Statement, name: string): Binding | null {
  if (ts.isVariableStatement(s)) {
    for (const d of s.declarationList.declarations) {
      if (!bindsName(d.name, name)) continue
      const isConst = (s.declarationList.flags & ts.NodeFlags.Const) !== 0
      return ts.isIdentifier(d.name) && isConst && d.initializer ? { kind: 'const', init: d.initializer } : { kind: 'other' }
    }
  }
  if (ts.isFunctionDeclaration(s) && s.name?.text === name) return { kind: 'fn', decl: s }
  if (ts.isClassDeclaration(s) && s.name?.text === name) return { kind: 'other' }
  if (ts.isImportDeclaration(s) && s.importClause && ts.isStringLiteral(s.moduleSpecifier)) {
    const source = s.moduleSpecifier.text
    const c = s.importClause
    if (c.name?.text === name) return { kind: 'import', source, imported: 'default' }
    const nb = c.namedBindings
    if (nb && ts.isNamespaceImport(nb) && nb.name.text === name) return { kind: 'import', source, imported: '*' }
    if (nb && ts.isNamedImports(nb)) {
      const el = nb.elements.find((x) => x.name.text === name)
      if (el) return { kind: 'import', source, imported: (el.propertyName ?? el.name).text }
    }
  }
  return null
}

/** id 의 가장 가까운 선언 — 감싸는 함수의 매개변수·블록·소스 파일을 안에서 밖으로 본다. 못 찾으면 null(전역) */
function bindingOf(id: ts.Identifier): Binding | null {
  const name = id.text
  for (let n: ts.Node | undefined = id.parent; n; n = n.parent) {
    if (ts.isFunctionLike(n)) {
      const i = n.parameters.findIndex((p) => ts.isIdentifier(p.name) && p.name.text === name)
      if (i >= 0) return { kind: 'param', fn: n, index: i }
      if (n.parameters.some((p) => bindsName(p.name, name))) return { kind: 'other' }
    }
    if (ts.isBlock(n) || ts.isSourceFile(n) || ts.isModuleBlock(n) || ts.isCaseClause(n) || ts.isDefaultClause(n)) {
      for (const s of n.statements) {
        const b = declaredIn(s, name)
        if (b) return b
      }
    }
    if ((ts.isForStatement(n) || ts.isForOfStatement(n) || ts.isForInStatement(n)) && n.initializer
      && ts.isVariableDeclarationList(n.initializer) && n.initializer.declarations.some((d) => bindsName(d.name, name))) return { kind: 'other' }
    if (ts.isCatchClause(n) && n.variableDeclaration && bindsName(n.variableDeclaration.name, name)) return { kind: 'other' }
  }
  return null
}

/** 식이 가드 호출인가(await·괄호를 벗긴다) — 호출 이름의 가장 가까운 선언이 @/lib/authz 의 import 여야 한다 */
function isGuardCall(e: ts.Expression): boolean {
  let c = unwrap(e)
  if (ts.isAwaitExpression(c)) c = unwrap(c.expression)
  if (!ts.isCallExpression(c)) return false
  const callee = c.expression
  if (ts.isIdentifier(callee)) {
    const b = bindingOf(callee)
    return b?.kind === 'import' && b.source === GUARD_SOURCE && GUARDS.has(b.imported)
  }
  if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)) {
    const b = bindingOf(callee.expression)
    return b?.kind === 'import' && b.source === GUARD_SOURCE && b.imported === '*' && GUARDS.has(callee.name.text)
  }
  return false
}

/** 식의 맨 앞 이름 — `a.b.c`·`a['b']`·괄호·as 를 벗긴 a */
function rootName(e: ts.Expression): string | null {
  let c = unwrap(e)
  while (ts.isPropertyAccessExpression(c) || ts.isElementAccessExpression(c)) c = unwrap(c.expression)
  return ts.isIdentifier(c) ? c.text : null
}
/** 대입 왼쪽의 대상 식들 — 구조 분해(배열·객체·기본값·나머지)를 펼친다 */
function targetsOf(lhs: ts.Expression): ts.Expression[] {
  const x = unwrap(lhs)
  if (ts.isArrayLiteralExpression(x)) {
    return x.elements.flatMap((el) => (ts.isOmittedExpression(el) ? [] : ts.isSpreadElement(el) ? targetsOf(el.expression) : targetsOf(el)))
  }
  if (ts.isObjectLiteralExpression(x)) {
    return x.properties.flatMap((p) => (ts.isPropertyAssignment(p) ? targetsOf(p.initializer) : ts.isShorthandPropertyAssignment(p) ? [p.name]
      : ts.isSpreadAssignment(p) ? targetsOf(p.expression) : []))
  }
  if (ts.isBinaryExpression(x) && x.operatorToken.kind === ts.SyntaxKind.EqualsToken) return targetsOf(x.left)
  return [x]
}
const isAssignOp = (k: ts.SyntaxKind) => k >= ts.SyntaxKind.FirstAssignment && k <= ts.SyntaxKind.LastAssignment
/** scope(함수 본문) 안에서 name 을 바꾸는 첫 자리 — 대입(복합·구조 분해 포함, `name.x… = ` 처럼 필드 쓰기도)·증감·delete·for 대입·
 *  `Object.assign(name…, …)`·`var name` 재선언(K5). 이름으로만 본다(가림 무시 — 보수적). 없으면 null */
function writeIn(sf: ts.SourceFile, scope: ts.Node, name: string): string | null {
  let hit: string | null = null
  const at = (n: ts.Node, what: string) => { hit ??= `:${lineOf(sf, n)} ${what}` }
  const visit = (n: ts.Node): void => {
    if (hit) return
    if (ts.isBinaryExpression(n) && isAssignOp(n.operatorToken.kind) && targetsOf(n.left).some((t) => rootName(t) === name)) at(n, '대입')
    else if ((ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n))
      && (n.operator === ts.SyntaxKind.PlusPlusToken || n.operator === ts.SyntaxKind.MinusMinusToken) && rootName(n.operand) === name) at(n, '증감')
    else if (ts.isDeleteExpression(n) && rootName(n.expression) === name) at(n, 'delete')
    else if ((ts.isForOfStatement(n) || ts.isForInStatement(n)) && !ts.isVariableDeclarationList(n.initializer)
      && targetsOf(n.initializer).some((t) => rootName(t) === name)) at(n, 'for 대입')
    else if (ts.isCallExpression(n) && unwrap(n.expression).getText(sf).replace(/\s+/g, '') === 'Object.assign' && n.arguments[0]
      && rootName(n.arguments[0]) === name) at(n, 'Object.assign')
    else if (ts.isVariableDeclarationList(n) && (n.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const)) === 0
      && n.declarations.some((d) => bindsName(d.name, name))) at(n, 'var 재선언')
    ts.forEachChild(n, visit)
  }
  visit(scope)
  return hit
}
/** 선언을 감싸는 함수 본문(없으면 소스 파일) — 그 이름을 바꾸는 자리를 찾는 범위 */
function scopeOf(n: ts.Node): ts.Node {
  for (let c: ts.Node | undefined = n.parent; c; c = c.parent) {
    if (ts.isFunctionLike(c) && 'body' in c && c.body) return c.body as ts.Node
  }
  return n.getSourceFile()
}

/** (a) 값이 `<g>.actor.userId` 이고 <g> 의 가장 가까운 선언이 가드 결과의 const 이며, 그 함수 안에서 <g> 를 바꾸지 않는가(K5) */
function guardUse(e: ts.Expression): { kind: 'ok' } | { kind: 'no' } | { kind: 'mutated'; why: string } {
  const v = unwrap(e)
  if (!ts.isPropertyAccessExpression(v) || v.name.text !== 'userId') return { kind: 'no' }
  const a = unwrap(v.expression)
  if (!ts.isPropertyAccessExpression(a) || a.name.text !== 'actor' || !ts.isIdentifier(a.expression)) return { kind: 'no' }
  const b = bindingOf(a.expression)
  if (b?.kind !== 'const' || !isGuardCall(b.init)) return { kind: 'no' }
  const w = writeIn(a.getSourceFile(), scopeOf(b.init), a.expression.text)
  return w === null ? { kind: 'ok' } : { kind: 'mutated', why: `가드 결과 ${a.expression.text} 를 함수 안에서 바꾼다(${w})` }
}
const isGuardUserId = (e: ts.Expression): boolean => guardUse(e).kind === 'ok'

/** 같은 파일에서 이름으로만 부르는 함수의 이름 — 함수 선언 또는 const 의 화살표·함수 식. export·이름 없음(객체 필드의 화살표 등)은 null */
function callableName(fn: ts.SignatureDeclaration): string | null {
  if (ts.isFunctionDeclaration(fn)) return fn.name && !hasModifier(fn, ts.SyntaxKind.ExportKeyword) ? fn.name.text : null
  if ((ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) && ts.isVariableDeclaration(fn.parent) && fn.parent.initializer === fn
    && ts.isIdentifier(fn.parent.name)) {
    const list = fn.parent.parent
    if (!ts.isVariableDeclarationList(list) || (list.flags & ts.NodeFlags.Const) === 0) return null
    if (ts.isVariableStatement(list.parent) && hasModifier(list.parent, ts.SyntaxKind.ExportKeyword)) return null
    return fn.parent.name.text
  }
  return null
}

/** 이름 자리(속성·메서드 이름, import 지정자)가 아닌 참조인가 */
const isReference = (id: ts.Identifier): boolean => {
  const p = id.parent
  if (ts.isPropertyAccessExpression(p) && p.name === id) return false
  if ((ts.isPropertyAssignment(p) || ts.isMethodDeclaration(p) || ts.isPropertyDeclaration(p) || ts.isPropertySignature(p)
    || ts.isMethodSignature(p)) && p.name === id) return false
  return !(ts.isImportSpecifier(p) || ts.isImportClause(p) || ts.isNamespaceImport(p))
}

/** fn(이름 name)의 참조가 전부 호출이면 그 호출들, 하나라도 값으로 쓰이면(콜백·export·객체 필드) null */
function callsOf(sf: ts.SourceFile, fn: ts.SignatureDeclaration, name: string): ts.CallExpression[] | null {
  const declName = ts.isFunctionDeclaration(fn) ? fn.name : ts.isVariableDeclaration(fn.parent) ? fn.parent.name : undefined
  const calls: ts.CallExpression[] = []
  let escaped = false
  const visit = (n: ts.Node): void => {
    if (ts.isIdentifier(n) && n.text === name && n !== declName && isReference(n)) {
      const b = bindingOf(n)
      if (b && ((b.kind === 'fn' && b.decl === fn) || (b.kind === 'const' && unwrap(b.init) === fn))) {
        if (ts.isCallExpression(n.parent) && n.parent.expression === n) calls.push(n.parent)
        else escaped = true
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return escaped ? null : calls
}

/** 객체 리터럴 식의 필드 값 — 펼침이 있거나 값 속성이 아니면 null(덮이거나 따라갈 수 없다). 같은 이름이 여럿이면 마지막(JS 의미) */
function fieldOf(e: ts.Expression, field: string): ts.Expression | null {
  const o = unwrap(e)
  if (!ts.isObjectLiteralExpression(o) || o.properties.some((p) => ts.isSpreadAssignment(p))) return null
  const p = [...o.properties].reverse().find((x) => propName(x) === field)
  return p && ts.isPropertyAssignment(p) ? p.initializer : null
}

/** (b) 한 단계 — 값 식이 가드 결과로 이어지면 null, 아니면 이유 */
function oneHop(v: ts.Expression, sf: ts.SourceFile): string | null {
  const e = unwrap(v)
  let id: ts.Identifier | null = null
  let field: string | null = null
  if (ts.isIdentifier(e)) id = e
  else if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression)) { id = e.expression; field = e.name.text }
  if (!id) return '이름·이름.필드 꼴이 아니라 따라갈 수 없다'
  const label = field === null ? id.text : `${id.text}.${field}`
  const b = bindingOf(id)
  if (b?.kind === 'const') {
    const w = writeIn(sf, scopeOf(b.init), id.text)
    if (w !== null) return `지역 const ${id.text} 를 함수 안에서 바꾼다(${w})`
    const src = field === null ? b.init : fieldOf(b.init, field)
    return src && isGuardUserId(src) ? null : `지역 const ${label} 의 초기값이 가드 결과가 아니다`
  }
  if (b?.kind === 'param') {
    const body = (b.fn as ts.FunctionLikeDeclaration).body
    const w = body ? writeIn(sf, body, id.text) : null
    if (w !== null) return `매개변수 ${id.text} 를 함수 안에서 바꾼다(${w})`
    const name = callableName(b.fn)
    if (!name) return `${id.text} 는 export 되거나 이름 없는 함수의 매개변수다 — 호출을 모두 볼 수 없다`
    const calls = callsOf(sf, b.fn, name)
    if (calls === null) return `${name} 이 호출 밖(콜백·export·객체 필드)에서 쓰인다`
    if (calls.length === 0) return `${name} 을 부르는 곳이 없다`
    for (const c of calls) {
      const spreadAt = c.arguments.findIndex((a) => ts.isSpreadElement(a))
      if (spreadAt >= 0 && spreadAt <= b.index) return `${name} 의 :${lineOf(sf, c)} 호출이 펼침 인자를 쓴다`
      const arg: ts.Expression | undefined = c.arguments[b.index]
      const src = arg === undefined ? null : field === null ? arg : fieldOf(arg, field)
      if (!src || !isGuardUserId(src)) return `${name} 의 :${lineOf(sf, c)} 호출이 그 자리(${label})에 가드 결과를 넘기지 않는다`
    }
    return null
  }
  return `${label} 의 선언이 const·매개변수가 아니다`
}

function judge(v: ts.Expression, sf: ts.SourceFile): Verdict {
  const g = guardUse(v)
  if (g.kind === 'ok') return { ok: true, how: 'direct' }
  if (g.kind === 'mutated') return { ok: false, why: g.why }
  const why = oneHop(v, sf)
  return why === null ? { ok: true, how: 'indirect' } : { ok: false, why }
}

/** 펼침 식이 p_actor 를 실을 수 있는가 — 객체 리터럴과 삼항의 두 갈래만 들여다본다. 그 밖(이름·호출)은 실을 수 있다고 본다 */
function mayCarry(e: ts.Expression): boolean {
  const x = unwrap(e)
  if (ts.isObjectLiteralExpression(x)) return x.properties.some((p) => propName(p) === 'p_actor' || (ts.isSpreadAssignment(p) && mayCarry(p.expression)))
  if (ts.isConditionalExpression(x)) return mayCarry(x.whenTrue) || mayCarry(x.whenFalse)
  return true
}

/** 한 파일의 p_actor 자리(판정 포함)와 구조 문제 */
function scanFile(file: string, sf: ts.SourceFile, rpcs: ReadonlySet<string>): Scan {
  const sites: Site[] = []
  const problems: string[] = []
  const handled = new Set<ts.Node>()
  const at = (n: ts.Node) => `${file}:${lineOf(sf, n)}`
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'rpc') {
      const first = n.arguments[0]
      if (first && ts.isStringLiteralLike(first) && rpcs.has(first.text)) {
        const rpc = first.text
        const args = n.arguments.length > 1 ? unwrap(n.arguments[1]) : null
        if (!args || !ts.isObjectLiteralExpression(args)) problems.push(`${at(n)} ${rpc} 의 인자가 객체 리터럴이 아니다 — p_actor 출처를 볼 수 없다`)
        else {
          const props = [...args.properties]
          const idx = props.map(propName).lastIndexOf('p_actor')
          if (props.slice(idx + 1).some((p) => ts.isSpreadAssignment(p) && mayCarry(p.expression))) {
            problems.push(`${at(n)} ${rpc} 의 p_actor 뒤 펼침이 p_actor 를 덮을 수 있다`)
          }
          if (idx < 0) problems.push(`${at(n)} ${rpc} 에 p_actor 가 없다`)
          else {
            const p = props[idx]
            handled.add(p)
            const value = ts.isShorthandPropertyAssignment(p) ? p.name : ts.isPropertyAssignment(p) ? p.initializer : null
            if (!value) problems.push(`${at(p)} ${rpc} 의 p_actor 가 값 속성이 아니다`)
            else sites.push({ file, line: lineOf(sf, p), rpc, expr: value.getText(sf).replace(/\s+/g, ' '), verdict: judge(value, sf) })
          }
        }
      }
    }
    if (ts.isObjectLiteralExpression(n)) {
      for (const p of n.properties) {
        if (propName(p) !== 'p_actor' || handled.has(p)) continue
        const call = ts.isCallExpression(n.parent) && n.parent.arguments[1] === n ? n.parent : null
        const name0 = call?.arguments[0]
        const rpc = call && ts.isPropertyAccessExpression(call.expression) && call.expression.name.text === 'rpc'
          && name0 && ts.isStringLiteralLike(name0) ? name0.text : null
        problems.push(rpc !== null
          ? `${at(p)} p_actor 를 받지 않는 RPC ${rpc} 에 넘긴다(P_ACTOR_RPCS·마이그레이션과 어긋남)`
          : `${at(p)} p_actor 를 .rpc('<p_actor 함수>', { … }) 밖에 적는다 — 출처를 볼 수 없다`)
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return { sites, problems }
}

/** 판정 — 구조 문제 + (a)·(b) 로 통과하지 못하고 허용 목록에도 없는 자리 + 허용 목록의 죽은 항목·사유 없음 */
function evaluate(scan: Scan, exceptions: Readonly<Record<string, ActorException>>): string[] {
  const out = [...scan.problems]
  const used = new Map<string, number>()
  for (const s of scan.sites) {
    if (s.verdict.ok) continue
    const key = `${s.file}#${s.rpc}`
    if (Object.hasOwn(exceptions, key) && exceptions[key].expr === s.expr) { used.set(key, (used.get(key) ?? 0) + 1); continue }
    out.push(`${s.file}:${s.line} ${s.rpc} 의 p_actor(${s.expr}) — ${s.verdict.why}. 가드 결과의 actor.userId 를 넘기거나, 다른 행위자도 받는 라이브러리 도우미면 ACTOR_SOURCE_EXCEPTIONS 에 사유와 함께 적는다(SP4 D51)`)
  }
  for (const [key, ex] of Object.entries(exceptions)) {
    if (ex.why.length < 12) out.push(`ACTOR_SOURCE_EXCEPTIONS ${key}: 사유가 없다`)
    if (used.has(key)) {
      if (used.get(key) !== ex.count) out.push(`ACTOR_SOURCE_EXCEPTIONS ${key}: 자리 수 ${ex.count} ≠ 실측 ${used.get(key)} — 새 자리는 출처를 확인하고 개수를 고친다`)
      continue
    }
    const live = scan.sites.filter((s) => `${s.file}#${s.rpc}` === key)
    if (live.length === 0) out.push(`ACTOR_SOURCE_EXCEPTIONS ${key}: 죽은 항목 — 그 자리가 없다`)
    else if (live.every((s) => s.verdict.ok)) out.push(`ACTOR_SOURCE_EXCEPTIONS ${key}: 죽은 항목 — 예외 없이 통과한다(${live.map((s) => s.expr).join(', ')})`)
    else out.push(`ACTOR_SOURCE_EXCEPTIONS ${key}: 값 식 ${ex.expr} 이 실제(${live.map((s) => s.expr).join(', ')})와 다르다`)
  }
  return out
}

/** 도우미 호출부 판정(K6) — files 의 모든 도우미 참조가 호출이고, 호출의 둘째 인자 객체 리터럴에 행위자 필드 값 속성이 있으며, 그 값이
 *  judge 를 통과하거나 파일별 값 식·사유와 같다. 파일·호출 수는 닫힌 목록과 같아야 한다(목록 문제가 먼저, 호출 문제가 뒤) */
function helperCallerProblems(files: readonly (readonly [string, ts.SourceFile])[], spec: HelperSpec): string[] {
  const list: string[] = []
  const calls: string[] = []
  const counts = new Map<string, number>()
  const usedExpr = new Map<string, number>()
  for (const [file, sf] of files) {
    let n = 0
    // 상대 경로 import 도 같은 모듈이다(A1-1 재리뷰 P3 — 상대 경로로 부르면 호출 수 0 으로 조용히 빠졌다) — `@/` 꼴로 정규화해 견준다
    const normalized = (source: string) => (source.startsWith('.')
      ? `@/${posix.relative('src', posix.normalize(posix.join(posix.dirname(file), source))).replace(/\.(ts|tsx)$/, '')}` : source)
    const isHelperImport = (id: ts.Identifier, imported: string) => {
      const b = bindingOf(id)
      return b?.kind === 'import' && normalized(b.source) === spec.source && b.imported === imported
    }
    const onRef = (r: ts.Expression) => {
      const call = ts.isCallExpression(r.parent) && r.parent.expression === r ? r.parent : null
      if (!call) { calls.push(`${file}:${lineOf(sf, r)} ${spec.helper} 를 호출 밖에서 쓴다 — 호출마다 행위자 출처를 볼 수 없다`); return }
      n++
      const arg = call.arguments[1] ? unwrap(call.arguments[1]) : null
      const prop = arg && ts.isObjectLiteralExpression(arg) && !arg.properties.some((p) => ts.isSpreadAssignment(p))
        ? [...arg.properties].reverse().find((p) => propName(p) === spec.field) : undefined
      const value = prop && ts.isShorthandPropertyAssignment(prop) ? prop.name : prop && ts.isPropertyAssignment(prop) ? prop.initializer : null
      if (!value) { calls.push(`${file}:${lineOf(sf, call)} ${spec.helper} 의 인자에 ${spec.field} 값 속성이 없거나 펼침이 있다 — 출처를 볼 수 없다`); return }
      const v = judge(value, sf)
      if (v.ok) return
      const expr = value.getText(sf).replace(/\s+/g, ' ')
      const allowed = Object.hasOwn(spec.callers, file) ? spec.callers[file] : undefined
      if (allowed?.except?.expr === expr && allowed.except.why.length >= 12) { usedExpr.set(file, (usedExpr.get(file) ?? 0) + 1); return }
      calls.push(`${file}:${lineOf(sf, value)} ${spec.helper} 의 ${spec.field}(${expr}) — ${v.why}. 가드 결과를 넘기거나 HELPER_CALLERS 에 파일별 값 식·사유를 적는다`)
    }
    const visit = (x: ts.Node): void => {
      if (ts.isIdentifier(x) && isReference(x) && isHelperImport(x, spec.helper)) onRef(x)
      else if (ts.isPropertyAccessExpression(x) && x.name.text === spec.helper && ts.isIdentifier(x.expression) && isHelperImport(x.expression, '*')) onRef(x)
      ts.forEachChild(x, visit)
    }
    visit(sf)
    counts.set(file, n)
  }
  for (const [file, n] of counts) if (n > 0 && !Object.hasOwn(spec.callers, file)) list.push(`${spec.helper} 호출부 ${file}: 닫힌 목록에 없는 파일이다(호출 ${n})`)
  for (const [file, c] of Object.entries(spec.callers)) {
    const n = counts.get(file) ?? 0
    if (n !== c.count) list.push(`${spec.helper} 호출부 ${file}: 호출 수 ${c.count} ≠ 실측 ${n}`)
    else if (n > 0 && c.except !== undefined && (usedExpr.get(file) ?? 0) !== c.except.count) {
      list.push(`${spec.helper} 호출부 ${file}: 값 식 ${c.except.expr} 의 허용 호출 수 ${c.except.count} ≠ 실측 ${usedExpr.get(file) ?? 0}`)
    }
  }
  return [...list, ...calls]
}

/** 마이그레이션 원문에서 인자 이름이 정확히 p_actor 인 public 함수(주석 제외, 대소문자·따옴표 무시, 인자 모드 IN·OUT·INOUT·VARIADIC 건너뜀) */
function pActorFunctions(texts: readonly string[]): string[] {
  const out = new Set<string>()
  const head = /create\s+(?:or\s+replace\s+)?function\s+(?:"?([a-z_0-9]+)"?\.)?"?([a-z_0-9]+)"?\s*\(/gi
  for (const raw of texts) {
    const t = raw.replace(/--[^\n]*/g, '')
    for (const m of t.matchAll(head)) {
      if (m[1] && m[1].toLowerCase() !== 'public') continue
      const params: string[] = []
      let cur = ''
      let depth = 1
      for (let i = m.index! + m[0].length; i < t.length; i++) {
        const ch = t[i]
        if (ch === '(') depth++
        else if (ch === ')' && --depth === 0) break
        if (ch === ',' && depth === 1) { params.push(cur); cur = '' } else cur += ch
      }
      params.push(cur)
      const names = params.map((p) => {
        const words = p.trim().split(/\s+/)
        const first = /^(in|out|inout|variadic)$/i.test(words[0] ?? '') ? words[1] : words[0]
        return (first ?? '').replace(/"/g, '').toLowerCase()
      })
      if (names.includes('p_actor')) out.add(m[2].toLowerCase())
    }
  }
  return [...out].sort()
}

const MIG = 'supabase/migrations'
const MIGRATIONS = readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort().map((f) => readFileSync(join(MIG, f), 'utf8'))

function scanSrc(): Scan {
  const out: Scan = { sites: [], problems: [] }
  for (const f of walk('src')) {
    const text = readFileSync(f, 'utf8')
    if (!text.includes('p_actor') && ![...P_ACTOR_RPCS].some((r) => text.includes(r))) continue
    const r = scanFile(f, parse(f, text), P_ACTOR_RPCS)
    out.sites.push(...r.sites)
    out.problems.push(...r.problems)
  }
  return out
}
const SCAN = scanSrc()

describe('p_actor 대상 — 마이그레이션 ↔ P_ACTOR_RPCS(양방향)', () => {
  it('마이그레이션에서 인자 이름이 정확히 p_actor 인 함수 = P_ACTOR_RPCS', () => {
    const found = pActorFunctions(MIGRATIONS)
    expect(found.filter((n) => !P_ACTOR_RPCS.has(n)), 'P_ACTOR_RPCS 에 더할 것(새 p_actor 함수)').toEqual([])
    expect([...P_ACTOR_RPCS].filter((n) => !found.includes(n)), 'P_ACTOR_RPCS 에서 뺄 것(마이그레이션에 없다)').toEqual([])
  })
})

describe('p_actor 출처 — src 의 모든 자리(D51·T7)', () => {
  it('가드 결과(직접·한 단계) 또는 닫힌 허용 목록 — 구조 문제·죽은 항목·사유 없음 0', () => {
    expect(evaluate(SCAN, ACTOR_SOURCE_EXCEPTIONS)).toEqual([])
  })

  it('[K6] 라이브러리 도우미 예외의 호출부 — 파일·호출 수 닫힘, 각 호출의 행위자는 가드 결과 또는 파일별 값 식·사유', () => {
    expect(Object.keys(HELPER_CALLERS).filter((k) => !Object.hasOwn(ACTOR_SOURCE_EXCEPTIONS, k)), 'HELPER_CALLERS 키는 허용 목록 항목이다').toEqual([])
    const bad = Object.values(HELPER_CALLERS).flatMap((spec) => {
      const files = walk('src').filter((f) => readFileSync(f, 'utf8').includes(spec.helper))
        .map((f) => [f, parse(f, readFileSync(f, 'utf8'))] as const)
      return helperCallerProblems(files, spec)
    })
    expect(bad).toEqual([])
  })

  it('첫날 9곳의 분류가 실측과 같다(스펙 §6.1 — 직접 3·한 단계 2·허용 목록 4)', () => {
    const classOf = (s: Site) => (s.verdict.ok ? s.verdict.how : 'exception')
    const bad = Object.entries(FIRST_DAY).flatMap(([key, want]) => {
      const live = SCAN.sites.filter((s) => `${s.file}#${s.rpc}` === key)
      if (live.length === 0) return [`${key}: 자리가 없다`]
      return live.filter((s) => classOf(s) !== want).map((s) => `${key}:${s.line} ${classOf(s)} ≠ ${want}`)
    })
    expect(bad).toEqual([])
  })
})

describe('판별기 민감도 — 합성 소스', () => {
  const RPCS: ReadonlySet<string> = new Set(['rpc_a'])
  const HEAD = "import { requireProjectAdmin, requireWorkspaceAdmin } from '@/lib/authz'\nimport * as authz from '@/lib/authz'\n"
  const scan = (body: string) => scanFile('s.ts', parse('s.ts', HEAD + body), RPCS)
  const kinds = (body: string) => scan(body).sites.map((s) => (s.verdict.ok ? s.verdict.how : 'fail'))
  const run = (body: string, ex: Readonly<Record<string, ActorException>> = {}) => evaluate(scan(body), ex)

  it('(a) 직접 — 가드 결과의 actor.userId(네임스페이스 import·중첩 블록·콜백·as 안 포함)', () => {
    expect(kinds([
      "export async function a(p) { const g = await requireProjectAdmin(p); if (!g.ok) return g; await sb.rpc('rpc_a', { p_actor: g.actor.userId }) }",
      'export async function b(p) { const w = await authz.requireWorkspaceAdmin(p); if (!w.ok) return; for (const x of [1]) {',
      "  await Promise.all([x].map(() => sb.rpc('rpc_a', { p_x: x, p_actor: (w.actor.userId as string) }))) } }",
    ].join('\n'))).toEqual(['direct', 'direct'])
  })

  it('(a) 아님 — 인자 값, 가드가 아닌 호출, 같은 이름의 지역 함수, let', () => {
    expect(kinds([
      "export async function a(p, input) { const g = await requireProjectAdmin(p); if (!g.ok) return g; await sb.rpc('rpc_a', { p_actor: input.actorId }) }",
      "export async function b(p) { const g = await getActor(); await sb.rpc('rpc_a', { p_actor: g.actor.userId }) }",
      "export async function c(p) { const requireProjectAdmin = async () => ({ ok: true, actor: { userId: 'x' } }); const g = await requireProjectAdmin(p); await sb.rpc('rpc_a', { p_actor: g.actor.userId }) }",
      "export async function d(p) { let g = await requireProjectAdmin(p); g = { ok: true, actor: { userId: 'x' } }; await sb.rpc('rpc_a', { p_actor: g.actor.userId }) }",
    ].join('\n'))).toEqual(['fail', 'fail', 'fail', 'fail'])
  })

  it('(b) 한 단계 — 같은 파일 도우미의 매개변수·그 필드, 지역 const·지역 객체 필드', () => {
    expect(kinds([
      "async function call(sb, actorId) { await sb.rpc('rpc_a', { p_actor: actorId }) }",
      'export async function a(p) { const g = await requireProjectAdmin(p); if (!g.ok) return g; await call(sb, g.actor.userId) }',
      'export async function b(p) { const g = await requireProjectAdmin(p); if (!g.ok) return g; return call(null, g.actor.userId) }',
      "const viaField = async (opts) => sb.rpc('rpc_a', { p_actor: opts.actor })",
      'export async function c(p) { const g = await requireProjectAdmin(p); if (!g.ok) return g; await viaField({ actor: g.actor.userId }) }',
      'export async function d(p) { const g = await requireProjectAdmin(p); if (!g.ok) return g; const actorId = g.actor.userId; const ctx = { actor: g.actor.userId }',
      "  await sb.rpc('rpc_a', { p_actor: actorId }); await sb.rpc('rpc_a', { p_actor: ctx.actor }) }",
    ].join('\n'))).toEqual(['indirect', 'indirect', 'indirect', 'indirect'])
  })

  it('(b) 아님 — 호출 하나라도 다른 값, 두 단계, export, 콜백으로 샘, 펼침 인자, 호출 없음', () => {
    expect(kinds([
      "async function one(actorId) { await sb.rpc('rpc_a', { p_actor: actorId }) }",
      'export async function a(p, input) { const g = await requireProjectAdmin(p); if (!g.ok) return g; await one(g.actor.userId); await one(input.actor) }',
      "async function inner(actorId) { await sb.rpc('rpc_a', { p_actor: actorId }) }",
      'async function outer(actorId) { await inner(actorId) }',
      'export async function b(p) { const g = await requireProjectAdmin(p); if (!g.ok) return g; await outer(g.actor.userId) }',
      "export async function exported(actorId) { await sb.rpc('rpc_a', { p_actor: actorId }) }",
      "async function cb(actorId) { await sb.rpc('rpc_a', { p_actor: actorId }) }",
      'export async function c(p) { const g = await requireProjectAdmin(p); if (!g.ok) return g; await cb(g.actor.userId); [g.actor.userId].forEach(cb) }',
      "async function spread(a, actorId) { await sb.rpc('rpc_a', { p_actor: actorId }) }",
      'export async function d(p, rest) { const g = await requireProjectAdmin(p); if (!g.ok) return g; await spread(...rest) }',
      "async function orphan(actorId) { await sb.rpc('rpc_a', { p_actor: actorId }) }",
    ].join('\n'))).toEqual(['fail', 'fail', 'fail', 'fail', 'fail', 'fail'])
  })

  it('[K5] 판정한 이름을 같은 함수 안에서 바꾸면 실패 — 매개변수 재대입·구조 분해 대입·가드 결과 필드 변이·지역 객체 필드 변이·Object.assign·var 재선언', () => {
    const body = [
      "async function re(sb, actorId, input) { if (input.as) actorId = input.as; await sb.rpc('rpc_a', { p_actor: actorId }) }",
      'export async function a(p, input) { const g = await requireProjectAdmin(p); if (!g.ok) return g; await re(sb, g.actor.userId, input) }',
      "export async function b(p, body) { const g = await requireProjectAdmin(p); if (!g.ok) return g; g.actor.userId = body.actorId; await sb.rpc('rpc_a', { p_actor: g.actor.userId }) }",
      "export async function c(p, x) { const g = await requireProjectAdmin(p); if (!g.ok) return g; const ctx = { actor: g.actor.userId }; ctx.actor = x; await sb.rpc('rpc_a', { p_actor: ctx.actor }) }",
      "export async function d(p, body) { const g = await requireProjectAdmin(p); if (!g.ok) return g; Object.assign(g.actor, body); await sb.rpc('rpc_a', { p_actor: g.actor.userId }) }",
      "async function hoist(actorId, input) { if (input.as) { var actorId = input.as } await sb.rpc('rpc_a', { p_actor: actorId }) }",
      'export async function e(p, input) { const g = await requireProjectAdmin(p); if (!g.ok) return g; await hoist(g.actor.userId, input) }',
      "async function des(actorId, input) { ;({ actorId } = input); await sb.rpc('rpc_a', { p_actor: actorId }) }",
      'export async function f(p, input) { const g = await requireProjectAdmin(p); if (!g.ok) return g; await des(g.actor.userId, input) }',
      "async function viaCaller(actorId) { await sb.rpc('rpc_a', { p_actor: actorId }) }",
      'export async function h(p, body) { const g = await requireProjectAdmin(p); if (!g.ok) return g; g.actor = body; await viaCaller(g.actor.userId) }',
    ].join('\n')
    expect(kinds(body)).toEqual(['fail', 'fail', 'fail', 'fail', 'fail', 'fail', 'fail'])
    const why = scan(body).sites.map((x) => (x.verdict.ok ? '' : x.verdict.why))
    expect(why.slice(0, 5)).toEqual([
      expect.stringContaining('매개변수 actorId 를 함수 안에서 바꾼다(:3 대입)'),
      expect.stringContaining('가드 결과 g 를 함수 안에서 바꾼다(:5 대입)'),
      expect.stringContaining('지역 const ctx 를 함수 안에서 바꾼다(:6 대입)'),
      expect.stringContaining('가드 결과 g 를 함수 안에서 바꾼다(:7 Object.assign)'),
      expect.stringContaining('매개변수 actorId 를 함수 안에서 바꾼다(:8 var 재선언)'),
    ])
    // 대조 — 다른 이름을 바꾸거나 가드 결과를 읽기만 하는 것은 자유다
    expect(kinds([
      "export async function k(p, x) { const g = await requireProjectAdmin(p); if (!g.ok) return g; let n = 0; n += 1; x.y = g.actor.userId; await sb.rpc('rpc_a', { p_actor: g.actor.userId }) }",
    ].join('\n'))).toEqual(['direct'])
  })

  it('[K6] 허용 항목은 자리 수까지 닫는다 — 같은 파일에 같은 식의 새 자리가 생기면 실패', () => {
    const lib = [
      "export async function lib(admin, args) { await admin.rpc('rpc_a', { p_actor: args.actorUserId }) }",
      "export async function lib2(admin, args) { await admin.rpc('rpc_a', { p_actor: args.actorUserId }) }",
    ].join('\n')
    const why = '라이브러리 도우미 — 합성 사유(열두 글자 넘게)'
    expect(run(lib, { 's.ts#rpc_a': { expr: 'args.actorUserId', count: 2, why } })).toEqual([])
    expect(run(lib, { 's.ts#rpc_a': { expr: 'args.actorUserId', count: 1, why } })).toEqual([
      'ACTOR_SOURCE_EXCEPTIONS s.ts#rpc_a: 자리 수 1 ≠ 실측 2 — 새 자리는 출처를 확인하고 개수를 고친다',
    ])
  })

  it('[K6] 도우미 호출부 닫힌 목록 — 파일·호출 수, 각 호출의 행위자 필드는 가드 결과(직접·한 단계) 또는 파일별 값 식·사유', () => {
    const W = "import { applyWorkflowEvent } from '@/lib/agent/workflowEvent'\n"
    const spec = (callers: HelperSpec['callers']): HelperSpec => ({ helper: 'applyWorkflowEvent', source: '@/lib/agent/workflowEvent', field: 'actorUserId', callers })
    const why = '에이전트 토큰 라우트 — 합성 사유(열두 글자 넘게)'
    const files = (...xs: [string, string][]) => xs.map(([f, t]) => [f, parse(f, HEAD + W + t)] as const)
    const ok = "export async function a(p) { const g = await requireProjectAdmin(p); if (!g.ok) return g; await applyWorkflowEvent(admin, { event: 'x', actorUserId: g.actor.userId }) }"
    const tok = 'export async function r(loaded) { await applyWorkflowEvent(admin, { event: \'x\', actorUserId: loaded.userId }) }'
    const bad = "export async function b(p, input) { const g = await requireProjectAdmin(p); if (!g.ok) return g; await applyWorkflowEvent(admin, { event: 'x', actorUserId: input.actorId }) }"
    expect(helperCallerProblems(files(['a.ts', ok], ['r.ts', tok]), spec({ 'a.ts': { count: 1 }, 'r.ts': { count: 1, except: { expr: 'loaded.userId', count: 1, why } } }))).toEqual([])
    expect(helperCallerProblems(files(['a.ts', ok], ['b.ts', bad]), spec({ 'a.ts': { count: 1 } }))).toEqual([
      'applyWorkflowEvent 호출부 b.ts: 닫힌 목록에 없는 파일이다(호출 1)',
      expect.stringContaining('b.ts:4 applyWorkflowEvent 의 actorUserId(input.actorId) — '),
    ])
    expect(helperCallerProblems(files(['a.ts', ok + '\n' + ok.replace('function a', 'function a2')]), spec({ 'a.ts': { count: 1 } }))).toEqual([
      'applyWorkflowEvent 호출부 a.ts: 호출 수 1 ≠ 실측 2',
    ])
    expect(helperCallerProblems(files(['a.ts', ok]), spec({ 'a.ts': { count: 1 }, 'gone.ts': { count: 1, except: { expr: 'x', count: 1, why } } }))).toEqual([
      'applyWorkflowEvent 호출부 gone.ts: 호출 수 1 ≠ 실측 0',
    ])
    expect(helperCallerProblems(files(['r.ts', tok + '\n' + tok.replace('function r', 'function r2')]),
      spec({ 'r.ts': { count: 2, except: { expr: 'loaded.userId', count: 1, why } } }))).toEqual([
      'applyWorkflowEvent 호출부 r.ts: 값 식 loaded.userId 의 허용 호출 수 1 ≠ 실측 2',
    ])
    // 상대 경로 import 도 호출부로 센다(A1-1 재리뷰 P3) — 목록 밖 파일이면 실패한다
    const rel = [['src/lib/agent/other.ts', HEAD + "import { applyWorkflowEvent } from './workflowEvent'\n" + bad.replace('function b', 'function o')]] as [string, string][]
    expect(helperCallerProblems(rel.map(([f, t]) => [f, parse(f, t)] as const), spec({}))).toEqual([
      'applyWorkflowEvent 호출부 src/lib/agent/other.ts: 닫힌 목록에 없는 파일이다(호출 1)',
      expect.stringContaining('src/lib/agent/other.ts:4 applyWorkflowEvent 의 actorUserId(input.actorId) — '),
    ])
    const esc = "export function c() { return [1].map(applyWorkflowEvent) }"
    const spreadArg = "export async function d(args) { await applyWorkflowEvent(admin, { ...args }) }"
    expect(helperCallerProblems(files(['c.ts', esc], ['d.ts', spreadArg]), spec({ 'c.ts': { count: 0 }, 'd.ts': { count: 1 } }))).toEqual([
      'c.ts:4 applyWorkflowEvent 를 호출 밖에서 쓴다 — 호출마다 행위자 출처를 볼 수 없다',
      'd.ts:4 applyWorkflowEvent 의 인자에 actorUserId 값 속성이 없거나 펼침이 있다 — 출처를 볼 수 없다',
    ])
  })

  it('구조 — .rpc 밖의 p_actor·객체 리터럴 아닌 인자·p_actor 없음·덮는 펼침·목록 밖 RPC·이름 아닌 RPC(허용 목록으로 덮지 못한다)', () => {
    const problems = run([
      "export async function a(p) { const g = await requireProjectAdmin(p); if (!g.ok) return g; const args = { p_actor: g.actor.userId }; await sb.rpc('rpc_a', args) }",
      "export async function b(p) { await sb.rpc('rpc_a', { p_x: 1 }) }",
      "export async function c(p, extra) { const g = await requireProjectAdmin(p); if (!g.ok) return g; await sb.rpc('rpc_a', { p_actor: g.actor.userId, ...extra }) }",
      "export async function d(p) { const g = await requireProjectAdmin(p); if (!g.ok) return g; await sb.rpc('other_rpc', { p_actor: g.actor.userId }) }",
      'export async function e(p, name) { const g = await requireProjectAdmin(p); if (!g.ok) return g; await sb.rpc(name, { p_actor: g.actor.userId }) }',
      "export async function f(p) { const g = await requireProjectAdmin(p); if (!g.ok) return g; await sb.rpc('rpc_a', { ...(p ? { p_x: 1 } : {}), p_actor: g.actor.userId, ...(p ? { p_y: 2 } : {}) }) }",
    ].join('\n'))
    expect(problems.map((m) => m.replace(/^s\.ts:\d+ /, ''))).toEqual([
      "p_actor 를 .rpc('<p_actor 함수>', { … }) 밖에 적는다 — 출처를 볼 수 없다",
      'rpc_a 의 인자가 객체 리터럴이 아니다 — p_actor 출처를 볼 수 없다',
      'rpc_a 에 p_actor 가 없다',
      'rpc_a 의 p_actor 뒤 펼침이 p_actor 를 덮을 수 있다',
      'p_actor 를 받지 않는 RPC other_rpc 에 넘긴다(P_ACTOR_RPCS·마이그레이션과 어긋남)',
      "p_actor 를 .rpc('<p_actor 함수>', { … }) 밖에 적는다 — 출처를 볼 수 없다",
    ])
  })

  it('허용 목록 — 값 식이 같아야 덮는다, 죽은 항목(자리 없음·예외 없이 통과·값 식 다름)과 사유 없음은 실패', () => {
    const lib = "export async function lib(admin, args) { await admin.rpc('rpc_a', { p_actor: args.actorUserId }) }"
    const why = '라이브러리 도우미 — 합성 사유(열두 글자 넘게)'
    expect(run(lib, { 's.ts#rpc_a': { expr: 'args.actorUserId', count: 1, why } })).toEqual([])
    expect(run(lib)).toEqual([expect.stringContaining('s.ts:3 rpc_a 의 p_actor(args.actorUserId) — args 는 export 되거나 이름 없는 함수의 매개변수다')])
    expect(run(lib, { 's.ts#rpc_a': { expr: 'args.actor', count: 1, why } })).toEqual([
      expect.stringContaining('s.ts:3 rpc_a 의 p_actor(args.actorUserId) — '),
      'ACTOR_SOURCE_EXCEPTIONS s.ts#rpc_a: 값 식 args.actor 이 실제(args.actorUserId)와 다르다',
    ])
    expect(run(lib, { 's.ts#rpc_a': { expr: 'args.actorUserId', count: 1, why: '짧음' } })).toEqual(['ACTOR_SOURCE_EXCEPTIONS s.ts#rpc_a: 사유가 없다'])
    expect(run(lib, { 's.ts#rpc_a': { expr: 'args.actorUserId', count: 1, why }, 's.ts#other': { expr: 'x', count: 1, why } })).toEqual([
      'ACTOR_SOURCE_EXCEPTIONS s.ts#other: 죽은 항목 — 그 자리가 없다',
    ])
    const direct = "export async function a(p) { const g = await requireProjectAdmin(p); if (!g.ok) return g; await sb.rpc('rpc_a', { p_actor: g.actor.userId }) }"
    expect(run(direct, { 's.ts#rpc_a': { expr: 'g.actor.userId', count: 1, why } })).toEqual([
      'ACTOR_SOURCE_EXCEPTIONS s.ts#rpc_a: 죽은 항목 — 예외 없이 통과한다(g.actor.userId)',
    ])
  })

  it('마이그레이션 판독 — 여러 줄 인자·모드·괄호 든 기본값·따옴표·주석·다른 스키마, p_actor_id·p_actor_name 은 아니다', () => {
    expect(pActorFunctions([[
      'create or replace function public.one(',
      '  p_event text,',
      '  IN p_actor uuid,',
      '  p_amount numeric(10, 2) default round(1.5, 0)',
      ') returns void language sql as $$ select 1 $$;',
      'CREATE FUNCTION public."two"("p_actor" uuid) RETURNS void LANGUAGE sql AS $$ select 1 $$;',
      'create function public.three(p_actor_id uuid, p_actor_name text) returns void language sql as $$ select 1 $$;',
      '-- create function public.four(p_actor uuid)',
      'create function storage.five(p_actor uuid) returns void language sql as $$ select 1 $$;',
    ].join('\n')])).toEqual(['one', 'two'])
  })
})
