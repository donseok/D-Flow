// tests/invariants/_walk.ts — 소스 트리 재귀 파일 목록(기본 .ts/.tsx)과 주석 걷기(codeLines)의 단일 출처. 불변식 테스트마다 따로
// 베끼지 않는다(리뷰 D3 — walk() 가 no-legacy-org·domain-layering·roster-writes 세 곳에 중복돼 있었다).
// SP3a Phase B 과제 1(CARRY 2): 리터럴(문자열·템플릿 조각·정규식·JSX 텍스트) 안의 '//'·'/*' 는 주석이 아니다 — TS 파서로 글자 범위를 표시한다.
// 파싱은 선필터가 "리터럴 안에 표지가 있을 수 있다"고 본 파일만 한다(비용). 선필터의 완전성은 walk.test.ts 의 전수 대조가 고정한다.
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'

const DEFAULT_SKIP_DIRS = new Set(['node_modules', '.next'])

/** dir 아래 exts 에 맞는 파일 전체(재귀, 기본 .ts/.tsx).
 *  skipDirs 를 주지 않으면 기본값(node_modules·.next)을 **뿌리 바로 아래에서만** 건너뛴다 — src 안에 같은 이름의 폴더가 생겨도
 *  그 안의 파일이 검사에서 조용히 빠지지 않게. skipDirs 를 주면 그 이름은 어느 깊이에서든 건너뛴다(파이썬 캐시 같은 산출물 폴더용). */
export function walk(dir: string, skipDirs?: Set<string>, exts: RegExp = /\.(ts|tsx)$/): string[] {
  return walkInner(dir, skipDirs ?? null, exts, true)
}

function walkInner(dir: string, skipDirs: Set<string> | null, exts: RegExp, atRoot: boolean): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    if (skipDirs ? skipDirs.has(name) : atRoot && DEFAULT_SKIP_DIRS.has(name)) continue
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) out.push(...walkInner(p, skipDirs, exts, false))
    else if (exts.test(name)) out.push(p)
  }
  return out
}

const LITERAL_KINDS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.StringLiteral, ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateHead, ts.SyntaxKind.TemplateMiddle, ts.SyntaxKind.TemplateTail,
  ts.SyntaxKind.RegularExpressionLiteral, ts.SyntaxKind.JsxText,
])

function scriptKindOf(fileName: string): ts.ScriptKind {
  if (/\.[jt]sx$/.test(fileName)) return ts.ScriptKind.TSX
  if (/\.(mjs|cjs|js)$/.test(fileName)) return ts.ScriptKind.JS
  return ts.ScriptKind.TS
}

/** 리터럴에 속한 글자를 1 로 표시한다. 파일명이 없으면 TSX 로 읽는다(스니펫에 JSX 가 섞인다 — project-page-gates). */
export function literalMask(text: string, fileName = 'snippet.tsx'): Uint8Array {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, false, scriptKindOf(fileName))
  const mask = new Uint8Array(text.length)
  const visit = (n: ts.Node): void => {
    if (LITERAL_KINDS.has(n.kind)) {
      // JsxText 는 선행 공백까지 글자다(주석이 들 수 없다) — pos 부터 표시한다
      const start = n.kind === ts.SyntaxKind.JsxText ? n.pos : n.getStart(sf)
      mask.fill(1, start, n.getEnd())
      return
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return mask
}

const MARKER = /\/\/|\/\*/
/** 리터럴 안에 표지가 있을 수 있는 파일만 파싱한다. 첫 표지 앞이 따옴표·백틱·JSX 꺾쇠·정규식 시작·URL 스킴이거나,
 *  백틱이 홀수인 줄(여러 줄 템플릿의 경계)이 있으면 파싱한다. 놓치는 모양은 walk.test.ts 의 전수 대조가 잡는다 */
function needsParse(text: string): boolean {
  for (const line of text.split('\n')) {
    if (((line.match(/`/g) ?? []).length) % 2 === 1) return true                // 여러 줄 템플릿의 시작·끝 줄
    const i = line.search(MARKER)
    if (i <= 0) continue
    const before = line.slice(0, i)
    if (/['"`>]/.test(before)) return true                                       // 따옴표·백틱·JSX 뒤
    if (/[=(,:!&|?{};[]\s*\/\S+$/.test(before)) return true                     // 정규식 리터럴의 시작 뒤 — 여는 '/' 와 표지 사이에 글자가 있어야 한다(줄 끝 주석 'a(); // x' 는 파싱하지 않는다)
    if (/\w:$/.test(before)) return true                                          // URL 스킴(JSX 텍스트 줄의 https://)
  }
  return false
}

function nextMarker(line: string, from: number, base: number, mask: Uint8Array | null): number {
  for (let k = from; k < line.length - 1; k++) {
    if (line[k] === '/' && (line[k + 1] === '/' || line[k + 1] === '*') && !(mask && mask[base + k] === 1)) return k
  }
  return -1
}

function stripComments(text: string, mask: Uint8Array | null): string[] {
  let inBlock = false
  let offset = 0
  return text.split('\n').map((raw) => {
    const base = offset
    offset += raw.length + 1
    let out = ''
    let i = 0
    while (i < raw.length) {
      if (inBlock) {
        const end = raw.indexOf('*/', i)
        if (end < 0) { i = raw.length; break }
        i = end + 2; inBlock = false
        continue
      }
      const j = nextMarker(raw, i, base, mask)
      if (j < 0) { out += raw.slice(i); break }
      out += raw.slice(i, j)
      if (raw[j + 1] === '/') break              // '//' — 줄 끝까지 주석
      inBlock = true; i = j + 2                   // '/*'
    }
    return out
  })
}

/** 주석을 걷어낸 코드 줄들 — 설명문 속 가드 이름은 호출이 아니다([a38]). 리터럴 안의 '//'·'/*' 는 주석이 아니다(CARRY 2).
 *  fileName 을 넘기면 확장자로 TS/TSX/JS 를 고른다. 줄 수·줄 순서는 원문과 같다. */
export function codeLines(text: string, fileName?: string): string[] {
  return stripComments(text, needsParse(text) ? literalMask(text, fileName) : null)
}

/** 선필터 없이 늘 파싱한다 — walk.test.ts 의 전수 대조 전용 */
export function codeLinesExact(text: string, fileName?: string): string[] {
  return stripComments(text, literalMask(text, fileName))
}
