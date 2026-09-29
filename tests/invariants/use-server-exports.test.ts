// 'use server' 모듈은 async 함수와 타입만 export 한다. Next 는 이 파일의 export 를 서버 액션 참조로 바꾸므로
// 상수·배열·객체·클래스를 export 하면 클라이언트에서는 값이 아니라 참조가 된다 — WikiDocumentEditor 가 액션 모듈의
// WIKI_DOCUMENT_KINDS 로 .includes 를 부르다 위키 주제 화면이 SSR 에서 죽었다(H1 과제 10). 공유 상수는 도메인 모듈에 둔다.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'
import { hasModifier, isUseServerModule, parse } from './_ast'
import { walk } from './_walk'

const ROOT = join(process.cwd(), 'src')

/** 런타임 값이 남는 export 문. 허용: `export async function`, `export type`·`export interface`, 타입만 담은 `export { type … }`. */
function valueExports(sf: ts.SourceFile): string[] {
  const bad: string[] = []
  const report = (node: ts.Node) => {
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
    bad.push(`${line}: ${node.getText(sf).split('\n')[0]}`)
  }
  for (const s of sf.statements) {
    if (ts.isExportDeclaration(s)) {
      const typeOnly = s.isTypeOnly
        || (!!s.exportClause && ts.isNamedExports(s.exportClause) && s.exportClause.elements.every(e => e.isTypeOnly))
      if (!typeOnly) report(s)
      continue
    }
    if (ts.isExportAssignment(s)) { report(s); continue }
    if (!hasModifier(s, ts.SyntaxKind.ExportKeyword)) continue
    if (ts.isTypeAliasDeclaration(s) || ts.isInterfaceDeclaration(s)) continue
    if (ts.isFunctionDeclaration(s) && hasModifier(s, ts.SyntaxKind.AsyncKeyword) && !hasModifier(s, ts.SyntaxKind.DefaultKeyword)) continue
    report(s)
  }
  return bad
}

describe("'use server' 모듈의 export", () => {
  it('판정기: 값 export 는 잡고 async 함수·타입은 통과시킨다', () => {
    const sf = parse('x.ts', [
      "'use server'",
      'export async function ok() {}',
      'export type T = string',
      'export interface I { a: number }',
      'export type { T as U }',
      'export { type I as J }',
      'export const KINDS = [',
      "  'a',",
      '] as const',
      'export function sync() {}',
      'export class C {}',
      'export enum E { A }',
      'const local = 1',
      'export { local }',
      "export * from './other'",
      'export default local',
      'export default async function named() {}',
    ].join('\n'))
    expect(isUseServerModule(sf)).toBe(true)
    expect(valueExports(sf).map(v => v.split(':')[0])).toEqual(['7', '10', '11', '12', '14', '15', '16', '17'])
    expect(isUseServerModule(parse('y.ts', "// 주석\n'use server'\nexport const X = 1"))).toBe(true)
    expect(isUseServerModule(parse('z.ts', "'use client'\nexport const X = 1"))).toBe(false)
  })

  it('src 의 모든 use server 모듈은 async 함수와 타입만 export 한다', () => {
    // 글자로 먼저 거른다 — 지시문은 이 글자를 반드시 담는다. src 전체를 TypeScript 로 파싱하면 부하 때 5초 한도를 넘는다
    // (최종 리뷰 integ F1). 판정은 여전히 isUseServerModule(AST)이 한다.
    const files = walk(ROOT)
      .map(f => ({ f, text: readFileSync(f, 'utf8') }))
      .filter(({ text }) => text.includes('use server'))
      .map(({ f, text }) => ({ rel: relative(process.cwd(), f), sf: parse(f, text) }))
      .filter(({ sf }) => isUseServerModule(sf))
    // 파일을 하나도 못 찾으면 검사가 공허하게 통과한다.
    expect(files.length).toBeGreaterThan(0)
    expect(files.map(f => f.rel)).toContain('src/app/actions/wiki.ts')
    const hits = files.flatMap(({ rel, sf }) => valueExports(sf).map(v => `${rel}:${v}`))
    expect(hits, hits.join('\n')).toEqual([])
  })
})
