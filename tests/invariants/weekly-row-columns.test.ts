// 지운 주간 행 열의 정적 가드(스펙 §4.1.2 — 비평 반영 Q35, 계획 과제 25). SP4 마이그레이션이 weekly_report_rows 의 section·module·
// sort_order 를 지웠다. PostgREST 는 없는 열을 고르거나 거르거나 정렬하는 요청을 42703 으로 통째로 실패시키는데, Supabase 를 흉내 내는
// 단위 테스트는 쿼리 문자열을 보지 않아 이를 잡지 못한다(열 drop 뒤 런타임에서만 드러난다). 주간 행을 읽고 쓰는 파일에서 주간 행 문맥 —
// ① from('weekly_report_rows') 에 이어진 호출 사슬의 열 인자(select·order·필터의 첫 인자, 쓰기 객체의 키) ② 어느 표의 select 든 그 안의
// weekly_report_rows(…) 임베드 ③ referencedTable·foreignTable 이 weekly_report_rows 인 order — 에서 세 이름이 0 인지 본다. 열 인자는
// 리터럴·템플릿·이어 붙이기·[…].join()·같은 파일의 변수·가져온 const(한 단계)까지 푼다. 사슬 밖에서 변수로 이어 붙인 쿼리
// (let q = …; q = q.order(…))는 보지 못한다 — 주간 행 조회는 사슬로 쓴다.
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { parse } from './_ast'
import { walk } from './_walk'

/** 주간 행을 조회·쓰는 파일(스펙 Q35 의 명시 select·정렬·임베드가 든 곳) */
const WEEKLY_ROW_FILES = [
  'src/app/actions/weekly.ts',
  'src/app/actions/customFieldValues.ts', // SP5c session CAS update: custom only
  'src/app/actions/customFields.ts', // SP5c admin usage preview: id/custom only, project-scoped keyset query
  'src/lib/ai/index/content.ts',
  'src/lib/data/weeklySheet.ts',
  'src/lib/repositories/supabase/weekly.ts',
] as const
/** 표 이름을 들지만 열을 고르지 않는 파일 — 사유가 있어야 한다(죽은 항목은 실패) */
const NOT_QUERIES: Readonly<Record<string, string>> = {
  'src/components/weekly/WeeklySheetView.tsx': '실시간 구독의 표 이름(postgres_changes 의 table·filter) — 열 목록이 없다',
  'src/lib/domain/weeklySheet.ts': '주석(행·셀 편집이 가리키는 표)',
}
const TABLE = 'weekly_report_rows'
const DROPPED = /\b(?:section|module|sort_order)\b/
const EMBED = /weekly_report_rows(?:!\w+)?\s*\(([^()]*)\)/g
/** 첫 인자가 열(또는 열을 든 필터 문자열)인 PostgREST 빌더 메서드 */
const COLUMN_FIRST = new Set(['select', 'order', 'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in',
  'contains', 'containedBy', 'not', 'filter', 'or', 'textSearch'])
/** 첫 인자가 열 이름을 키로 든 객체(또는 그 배열)인 메서드 */
const KEYED = new Set(['insert', 'upsert', 'update', 'match'])

type Source = { file: string; sf: ts.SourceFile }
const cache = new Map<string, Source | null>()
const load = (file: string): Source | null => {
  if (!cache.has(file)) cache.set(file, existsSync(file) ? { file, sf: parse(file, readFileSync(file, 'utf8')) } : null)
  return cache.get(file) ?? null
}
const snippet = (text: string): Source => ({ file: 'snippet.ts', sf: parse('snippet.ts', text) })

function moduleFile(spec: string, from: string): string | null {
  const base = spec.startsWith('@/') ? path.join('src', spec.slice(2)) : spec.startsWith('.') ? path.join(path.dirname(from), spec) : null
  if (!base) return null
  return ['.ts', '.tsx', '/index.ts'].map((ext) => base + ext).find((f) => existsSync(f)) ?? null
}

/** 이름의 초기값 — 같은 파일의 변수 선언, 없으면 그 파일이 이름으로 가져온 모듈의 것(한 단계) */
function declOf(name: string, src: Source, hops = 0): { init: ts.Expression; src: Source } | null {
  const find = (n: ts.Node): ts.Expression | undefined =>
    ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name && n.initializer ? n.initializer : ts.forEachChild(n, find)
  const init = find(src.sf)
  if (init) return { init, src }
  if (hops > 0) return null
  for (const st of src.sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue
    const named = st.importClause?.namedBindings
    if (!named || !ts.isNamedImports(named)) continue
    const el = named.elements.find((e) => e.name.text === name)
    if (!el) continue
    const file = moduleFile(st.moduleSpecifier.text, src.file)
    const next = file ? load(file) : null
    return next ? declOf((el.propertyName ?? el.name).text, next, hops + 1) : null
  }
  return null
}

/** 식을 문자열로 푼다 — 못 풀면 null. 템플릿의 치환 칸은 풀리면 그 값, 아니면 빈 문자열(값 자리다 — 열 이름이 아니다) */
function textOf(expr: ts.Expression, src: Source, depth = 0): string | null {
  if (depth > 6) return null
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) return expr.text
  if (ts.isTemplateExpression(expr)) {
    return expr.head.text + expr.templateSpans.map((s) => (textOf(s.expression, src, depth + 1) ?? '') + s.literal.text).join('')
  }
  if (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr) || ts.isSatisfiesExpression(expr)) return textOf(expr.expression, src, depth + 1)
  if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const l = textOf(expr.left, src, depth + 1)
    const r = textOf(expr.right, src, depth + 1)
    return l === null || r === null ? null : l + r
  }
  if (ts.isCallExpression(expr) && ts.isPropertyAccessExpression(expr.expression) && expr.expression.name.text === 'join') {
    const items = itemsOf(expr.expression.expression, src, depth + 1)
    const sep = expr.arguments[0] ? textOf(expr.arguments[0], src, depth + 1) : ','
    return items === null || sep === null ? null : items.join(sep)
  }
  if (ts.isIdentifier(expr)) {
    const d = declOf(expr.text, src)
    return d ? textOf(d.init, d.src, depth + 1) : null
  }
  return null
}

function itemsOf(expr: ts.Expression, src: Source, depth: number): string[] | null {
  if (ts.isArrayLiteralExpression(expr)) {
    const out: string[] = []
    for (const el of expr.elements) {
      const t = textOf(el, src, depth + 1)
      if (t === null) return null
      out.push(t)
    }
    return out
  }
  if (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr) || ts.isSatisfiesExpression(expr)) return itemsOf(expr.expression, src, depth + 1)
  if (ts.isIdentifier(expr)) {
    const d = declOf(expr.text, src)
    return d ? itemsOf(d.init, d.src, depth + 1) : null
  }
  return null
}

/** 쓰기 인자의 열 이름 — 객체 리터럴의 키(배열이면 원소 전부), 변수면 그 초기값. 계산된 키·못 푸는 값은 건너뛴다 */
function keysOf(expr: ts.Expression, src: Source, depth = 0): string[] {
  if (depth > 6) return []
  if (ts.isObjectLiteralExpression(expr)) {
    return expr.properties.flatMap((p) => (!ts.isSpreadAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? [p.name.text] : []))
  }
  if (ts.isArrayLiteralExpression(expr)) return expr.elements.flatMap((e) => keysOf(e, src, depth + 1))
  if (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr) || ts.isSatisfiesExpression(expr)) return keysOf(expr.expression, src, depth + 1)
  if (ts.isIdentifier(expr)) {
    const d = declOf(expr.text, src)
    return d ? keysOf(d.init, d.src, depth + 1) : []
  }
  return []
}

type Scan = { contexts: number; findings: string[] }

function scan(src: Source): Scan {
  const out: Scan = { contexts: 0, findings: [] }
  const at = (n: ts.Node): string => `${src.file}:${src.sf.getLineAndCharacterOfPosition(n.getStart(src.sf)).line + 1}`
  const column = (n: ts.Expression, what: string): void => {
    const text = textOf(n, src)
    if (text === null) out.findings.push(`${at(n)} ${what} — 정적으로 풀 수 없다(리터럴·const 로 쓴다)`)
    else if (DROPPED.test(text)) out.findings.push(`${at(n)} ${what}: ${text}`)
  }
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const method = n.expression.name.text
      const [first, second] = n.arguments
      if (method === 'from' && first && textOf(first, src) === TABLE) {                          // ①
        out.contexts++
        let cur: ts.Expression = n
        while (ts.isPropertyAccessExpression(cur.parent) && cur.parent.expression === cur
          && ts.isCallExpression(cur.parent.parent) && cur.parent.parent.expression === cur.parent) {
          const call: ts.CallExpression = cur.parent.parent
          const m = cur.parent.name.text
          const arg = call.arguments[0]
          if (arg && COLUMN_FIRST.has(m)) column(arg, `.${m}()`)
          if (arg && KEYED.has(m)) {
            const bad = keysOf(arg, src).filter((k) => DROPPED.test(k))
            if (bad.length) out.findings.push(`${at(call)} .${m}() 키: ${bad.join(', ')}`)
          }
          cur = call
        }
      }
      if (method === 'select' && first) {                                                         // ②
        for (const m of (textOf(first, src) ?? '').matchAll(EMBED)) {
          out.contexts++
          if (DROPPED.test(m[1])) out.findings.push(`${at(n)} 임베드 ${m[0]}`)
        }
      }
      if (method === 'order' && first && second && ts.isObjectLiteralExpression(second)) {        // ③
        for (const p of second.properties) {
          if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && (p.name.text === 'referencedTable' || p.name.text === 'foreignTable')
            && textOf(p.initializer, src) === TABLE) {
            out.contexts++
            column(first, '.order(referencedTable)')
          }
        }
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(src.sf)
  return out
}

describe('지운 주간 행 열(section·module·sort_order) — 정적 가드(Q35)', () => {
  it('탐지기 자기 시험 — 사슬·임베드·임베드 정렬·쓰기 키·못 푸는 열 인자를 잡고, 다른 표는 보지 않는다', () => {
    const bad = [
      `const r = await sb.from('weekly_report_rows').select('id, section').eq('report_id', id)`,
      `const C = ['id', 'area_id'].join(', ')\nconst r = await sb.from('weekly_report_rows').select(C).order('sort_order')`,
      `const r = await sb.from('weekly_reports').select('id, weekly_report_rows!inner(module, area_id)')`,
      `const r = await sb.from('weekly_reports').select('id').order('sort_order', { referencedTable: 'weekly_report_rows' })`,
      `const r = await sb.from('weekly_report_rows').update({ sort_order: 1 }).eq('id', id)`,
      `export async function f(cols: string) { return sb.from('weekly_report_rows').select(cols) }`,
    ]
    for (const text of bad) expect(scan(snippet(text)).findings, text).toHaveLength(1)
    const clean = scan(snippet([
      `const T = 'weekly_report_rows'`,
      `const r = await sb.from(T).select('id, area_id').eq('report_id', id).eq('project_id', pid)`,
      `const u = await sb.from('weekly_report_rows').update({ this_content: v }).eq('id', id)`,
      `const a = await sb.from('project_areas').select('id, name, sort_order').eq('kind', 'weekly_section').order('sort_order')`,
      `const c = await sb.from('weekly_reports').select('id, weekly_report_rows(count)').or(\`project_id.eq.\${pid}\`)`,
    ].join('\n')))
    expect(clean.findings).toEqual([])
    expect(clean.contexts).toBe(3)   // from 사슬 둘 + 임베드 하나 — project_areas 는 주간 행 문맥이 아니다
  })

  it.each(WEEKLY_ROW_FILES)('%s — 주간 행 문맥에 지운 열 이름이 없다', (file) => {
    const src = load(file)
    expect(src, `${file} 가 없다 — 목록을 고친다`).not.toBeNull()
    const { contexts, findings } = scan(src!)
    expect(contexts, '주간 행 조회·쓰기가 하나도 없다 — 가드가 공허하다(목록을 고친다)').toBeGreaterThan(0)
    expect(findings).toEqual([])
  })

  it('표 이름을 드는 src 파일은 위 목록이거나 사유가 있는 예외다 — 새 소비처가 가드 밖에 생기지 않게', () => {
    const mentions = walk('src').filter((f) => readFileSync(f, 'utf8').includes(TABLE))
    const listed = new Set<string>([...WEEKLY_ROW_FILES, ...Object.keys(NOT_QUERIES)])
    expect(mentions.filter((f) => !listed.has(f))).toEqual([])
    expect(Object.keys(NOT_QUERIES).filter((f) => !mentions.includes(f)), '죽은 예외').toEqual([])
  })
})
