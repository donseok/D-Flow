// DB 오류 원문 노출 회귀 가드(스펙 §4.7·D21 — Q20). 파일 단위: 가드 대상 파일의 코드에서 결과 객체의 `error` 값이
//  ① `.message`(·`…Message`)를 읽지 않는다 — 예외는 토큰을 고정 문구로 바꾼 결과(`rpcFailure(…)`·`mapDbError(…)`)
//  ② `errMsg(…)`·`String(…)` 을 부르지 않는다(Error 를 문자열로 만드는 우회 — 비평 보안 §7)
//  ③ 다른 결과의 `.error` 를 옮기지 않는다 — 예외는 고정 문구만 내는 가드·관문·순수 검증과 같은 파일 함수의 결과
//     (`route.ts:129,145` ← `projectTeams.ts:30,36,41` 꼴의 옮기기를 잡는다)
//  ④ 고정 문구의 통로 `failWith`(src/lib/errors/dbFail.ts)를 import 한다 — 원문은 `failWith`·`console.*` 의 인자로만 남는다.
// `error` 값이 같은 파일 도우미를 부르면(`error: writeError(e)` — 지금 projectAreas.ts:30-35 꼴) 그 도우미의 반환 식도 같은 눈으로 본다(한 단계).
// 주석·로그 줄은 AST 가 보지 않는다(주석은 노드가 아니고, console.error(…) 는 `error:` 속성이 아니다). 의도적 난독화는 못 잡는다.
import { existsSync, readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { parse } from './_ast'

/** 가드 대상(파일 단위) — 가져오기 과제들이 §4.7 의 A1 나머지(과제 28 이 teams/register.ts, 과제 29 가 가져오기 라우트·과제 30 이 가져오기 읽기 액션 둘
 *  importReceipts·importBackup)를, A2 가 actions/wbs.ts·팀 액션을 더한다 */
const GUARDED_FILES: readonly string[] = [
  'src/app/actions/weekly.ts',
  'src/app/actions/projectAreas.ts',
  'src/lib/teams/register.ts',
  'src/app/api/import/execute/route.ts',
  'src/app/actions/importReceipts.ts',
  'src/app/actions/importBackup.ts',
  'src/app/actions/projectTeams.ts',
  'src/app/actions/teams.ts',
]

/** `.error` 를 옮겨도 되는 결과의 출처 — 고정 문구만 낸다 */
const SAFE_ERROR_SOURCES: ReadonlySet<string> = new Set([
  'requireSuperuser', 'requireWorkspaceAdmin', 'requireProjectAdmin', 'requireProjectMember',
  'requireModule', 'requireSessionModule', 'resolveProjectId', 'resolveScope',
  'validateArea', 'normalizeNewTeamCode', 'validateNewTeamCodes',
])
/** `.message` 를 읽어도 되는 결과의 출처 — 토큰을 고정 문구로 바꾼 것 */
const SAFE_MESSAGE_SOURCES: ReadonlySet<string> = new Set(['rpcFailure', 'mapDbError'])
/** 인자를 보지 않는 호출 — 원문은 여기로만 간다 */
const SINKS: ReadonlySet<string> = new Set(['failWith'])
const MESSAGE_PROP = /^(message|[A-Za-z]*Message)$/

function calleeName(e: ts.Expression): string | null {
  let x: ts.Expression = e
  while (ts.isAwaitExpression(x) || ts.isParenthesizedExpression(x) || ts.isAsExpression(x) || ts.isNonNullExpression(x)) x = x.expression
  if (!ts.isCallExpression(x)) return null
  const c = x.expression
  if (ts.isIdentifier(c)) return c.text
  if (ts.isPropertyAccessExpression(c)) return c.name.text
  return null
}

/** 지역 이름 → 그 이름을 만든 호출 이름들(`const x = await f(…)` 의 f, 호출이 아닌 초기화는 '?') — 같은 이름이 여러 함수에 있으면 모두 모은다 */
function bindings(sf: ts.SourceFile): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  const walk = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
      const set = out.get(n.name.text) ?? new Set<string>()
      set.add(calleeName(n.initializer) ?? '?')
      out.set(n.name.text, set)
    }
    ts.forEachChild(n, walk)
  }
  walk(sf)
  return out
}

/** 같은 파일의 최상위 함수(선언·const 화살표·함수식) 이름 → 몸. 그 결과의 `.error` 는 같은 규칙으로 이 파일에서 검사되고(그 함수 안의
 *  `error:` 도 이 파일의 속성이다), `error` 값이 그 함수를 부르면 반환 식을 따라가 본다 */
function localFunctions(sf: ts.SourceFile): Map<string, ts.ConciseBody> {
  const out = new Map<string, ts.ConciseBody>()
  for (const s of sf.statements) {
    if (ts.isFunctionDeclaration(s) && s.name && s.body) out.set(s.name.text, s.body)
    if (ts.isVariableStatement(s)) for (const d of s.declarationList.declarations) {
      if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) {
        out.set(d.name.text, d.initializer.body)
      }
    }
  }
  return out
}

/** 함수 몸의 반환 식 — 화살표의 식 몸은 그 식 하나, 블록이면 return 식들(안쪽 함수의 return 은 빼고) */
function returnExprs(body: ts.ConciseBody): ts.Expression[] {
  if (!ts.isBlock(body)) return [body]
  const out: ts.Expression[] = []
  const walk = (n: ts.Node): void => {
    if (ts.isFunctionLike(n)) return
    if (ts.isReturnStatement(n) && n.expression) out.push(n.expression)
    ts.forEachChild(n, walk)
  }
  ts.forEachChild(body, walk)
  return out
}

/** 한 파일의 위반 — `파일:줄 사유` 목록 */
function rawErrorProblems(file: string, text: string): string[] {
  const sf = parse(file, text)
  const bound = bindings(sf)
  const local = localFunctions(sf)
  const line = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1
  const from = (name: string, ok: (callee: string) => boolean) => {
    const s = bound.get(name)
    return !!s && s.size > 0 && [...s].every(ok)
  }
  const problems: string[] = []
  const following = new Set<string>()   // 도우미 따라가기 — 재귀 도우미에서 멈춘다
  const inspect = (value: ts.Expression) => {
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n)) {
        const name = calleeName(n)
        if (name !== null && SINKS.has(name)) return
        if (name === 'errMsg' || name === 'String') problems.push(`${file}:${line(n)} error 값이 ${name}(…) 로 원문을 싣는다`)
        const body = ts.isIdentifier(n.expression) ? local.get(n.expression.text) : undefined
        if (body && !following.has(n.expression.getText(sf))) {
          following.add(n.expression.getText(sf))
          for (const r of returnExprs(body)) visit(r)
          following.delete(n.expression.getText(sf))
        }
      }
      if (ts.isPropertyAccessExpression(n)) {
        const recv = n.expression
        const prop = n.name.text
        if (MESSAGE_PROP.test(prop) && !(ts.isIdentifier(recv) && from(recv.text, (c) => SAFE_MESSAGE_SOURCES.has(c)))) {
          problems.push(`${file}:${line(n)} error 값이 ${n.getText(sf)} 를 싣는다`)
        }
        if (prop === 'error' && !(ts.isIdentifier(recv) && from(recv.text, (c) => SAFE_ERROR_SOURCES.has(c) || local.has(c)))) {
          problems.push(`${file}:${line(n)} error 값이 다른 결과의 ${n.getText(sf)} 를 옮긴다`)
        }
      }
      ts.forEachChild(n, visit)
    }
    visit(value)
  }
  const walk = (n: ts.Node): void => {
    if (ts.isPropertyAssignment(n) && (ts.isIdentifier(n.name) || ts.isStringLiteral(n.name)) && n.name.text === 'error') inspect(n.initializer)
    if (ts.isShorthandPropertyAssignment(n) && n.name.text === 'error') {
      problems.push(`${file}:${line(n)} { error } 단축 속성 — 원문 객체일 수 있다. 고정 문구로 쓴다`)
    }
    ts.forEachChild(n, walk)
  }
  walk(sf)
  return problems
}

describe('DB 오류 원문 — 가드 대상 파일(스펙 §4.7)', () => {
  it.each(GUARDED_FILES)('%s 는 결과의 error 에 원문을 싣지 않는다', (file) => {
    expect(existsSync(file), `${file} 가 없다 — 목록을 고친다`).toBe(true)
    expect(rawErrorProblems(file, readFileSync(file, 'utf8'))).toEqual([])
  })
  it.each(GUARDED_FILES)('%s 는 고정 문구의 통로 failWith 를 쓴다', (file) => {
    const text = readFileSync(file, 'utf8')
    expect(text).toMatch(/import \{[^}]*\bfailWith\b[^}]*\} from '@\/lib\/errors\/dbFail'/)
    expect(text).toMatch(/\bfailWith\(/)
  })
})

describe('판별기 민감도(합성 소스)', () => {
  const src = (body: string) => [
    "import { requireProjectAdmin } from '@/lib/authz'",
    "import { addProjectTeam } from '@/app/actions/projectTeams'",
    "import { failWith, rpcFailure } from '@/lib/errors/dbFail'",
    'async function local() { return { ok: false, error: "고정" } }',
    'function describeError(e) { return `저장 실패: ${e.message}` }',
    "const fixed = (code) => `'${code}' 코드가 이미 있습니다.`",
    `export async function a(p, error, e) { ${body} }`,
  ].join('\n')
  it.each([
    ['원문 .message', 'return { ok: false, error: error.message }'],
    ['템플릿 보간', 'return { ok: false, error: `실패: ${e.message}` }'],
    ['…Message 필드', 'const r = { errorMessage: e.message }; return { ok: false, error: r.errorMessage }'],
    ['errMsg', 'return { ok: false, error: errMsg(e) }'],
    ['String(e)', 'return { ok: false, error: String(e) }'],
    ['다른 결과의 error 옮기기', "const added = await addProjectTeam(p, 'X'); return { ok: false, error: added.error }"],
    ['다른 결과의 error 보간', "const added = await addProjectTeam(p, 'X'); return { ok: false, error: `팀 등록 실패: ${added.error}` }"],
    ['단축 속성', 'return { ok: false, error }'],
    ['같은 파일 도우미가 원문을 돌려준다', 'return { ok: false, error: describeError(error) }'],
  ])('%s 는 잡는다', (_n, body) => {
    expect(rawErrorProblems('s.ts', src(body)).length).toBeGreaterThan(0)
  })
  it.each([
    ['가드 결과의 error', 'const g = await requireProjectAdmin(p); if (!g.ok) return { ok: false, error: g.error }'],
    ['rpcFailure 결과의 message', "const f = rpcFailure(error, {}); return { ok: false, error: f ? f.message : '고정' }"],
    ['failWith 통로', "return { ok: false, error: failWith('t', error, '고정 문구') }"],
    ['로그의 원문', "console.error('[t]', error.message); return { ok: false, error: '고정' }"],
    ['같은 파일 함수의 결과', 'const s = await local(); return { ok: false, error: s.error }'],
    ['고정 문구 템플릿', 'return { ok: false, error: `제목은 ${200}자 이하여야 합니다.` }'],
    ['같은 파일 도우미의 고정 문구', "return { ok: false, error: fixed('DATA') }"],
  ])('%s 는 통과한다', (_n, body) => {
    expect(rawErrorProblems('s.ts', src(body))).toEqual([])
  })
})
