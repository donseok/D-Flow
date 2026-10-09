// 한국어 화면에 영문 머리말(eyebrow)이 되돌아오지 못하게 한다(개정 §5.2 — 제목 위 영문 보조 문구는 뜻 없이 자리만 차지해 걷었다).
// 보는 자리 넷: ① `eyebrow=` 속성(SectionCard·Modal·PageHeader 등), ② `eyebrow` 라는 이름의 변수(속성에 넘기려고 미리 고른 값),
// ③ className 리터럴에 `eyebrow` 가 든 요소의 글자, ④ 한국어 사전에서 키 이름에 eyebrow 가 든 문구.
// TS 파서로 리터럴(문자열·템플릿 조각·JSX 글자)만 본다. 함수 호출의 인자(사전 키 `t('…')`·치환 자리 `'{n}'`)와 비교의 피연산자는 문구가 아니라 보지 않는다.
// 한글이 섞인 문구는 통과하고, 영문 낱말만 있는 문구가 걸린다. 고유 낱말은 PROPER 에, 파일 예외는 ALLOW 에(파일:사유) 닫힌 목록으로 둔다.
// 영어 화면의 머리말이 필요하면 리터럴이 아니라 사전(`*.en.ts`)에 둔다 — 영어 사전은 검사하지 않는다.
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { walk } from './_walk'

const SRC = join(process.cwd(), 'src')

/** 번역하지 않는 고유 낱말 — 이것만으로 된 머리말은 영문이 아니다 */
const PROPER: ReadonlySet<string> = new Set(['WBS', 'SPI', 'CPI', 'KPI', 'AI', 'LLM', 'PPT', 'PDF', 'PAT', 'API', 'ID', 'Excel', 'Wiki'])
/** 파일 예외(닫힌 목록) — 지금은 없다. 더할 때는 사유와 함께 */
const ALLOW: Readonly<Record<string, string>> = {}

/** 영문 머리말인가 — 한글이 없고, 고유 낱말이 아닌 두 글자 이상 영문 낱말이 하나라도 있다 */
function isEnglishCaption(text: string): boolean {
  if (/[가-힣]/.test(text)) return false
  return (text.match(/[A-Za-z]{2,}/g) ?? []).some(word => !PROPER.has(word))
}

const TEXT_KINDS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.StringLiteral, ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateHead, ts.SyntaxKind.TemplateMiddle, ts.SyntaxKind.TemplateTail, ts.SyntaxKind.JsxText,
])

interface Site { file: string; line: number; text: string }

/** node 아래의 문구 리터럴 — 호출 인자와 안쪽 요소의 속성 값은 건너뛴다 */
function captionsUnder(node: ts.Node, sf: ts.SourceFile, file: string, out: Site[]): void {
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) { visit(n.expression); return }   // 인자(사전 키·치환 자리)는 문구가 아니다
    if (ts.isJsxAttribute(n)) return                              // 안쪽 요소의 className 등
    // 비교의 피연산자(`view === 'delete' ? … : …`)는 갈래를 고르는 값이지 문구가 아니다
    if (ts.isBinaryExpression(n) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken,
      ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(n.operatorToken.kind)) return
    if (TEXT_KINDS.has(n.kind)) {
      const raw = n.getText(sf)
      const text = n.kind === ts.SyntaxKind.JsxText ? raw.trim() : raw
      if (text) out.push({ file, line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, text })
      return
    }
    ts.forEachChild(n, visit)
  }
  visit(node)
}

/** 파일의 머리말 자리(① 속성 ② 변수 ③ eyebrow 클래스 요소의 글자) */
function eyebrowSites(file: string, source: string): Site[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const rel = relative(process.cwd(), file)
  const out: Site[] = []
  const hasEyebrowClass = (el: ts.JsxOpeningLikeElement) => el.attributes.properties.some(p =>
    ts.isJsxAttribute(p) && p.name.getText(sf) === 'className' && !!p.initializer && ts.isStringLiteral(p.initializer) && /(^|\s)eyebrow(\s|$)/.test(p.initializer.text))
  const visit = (n: ts.Node): void => {
    if (ts.isJsxAttribute(n) && n.name.getText(sf) === 'eyebrow' && n.initializer) captionsUnder(n.initializer, sf, rel, out)
    else if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === 'eyebrow' && n.initializer) captionsUnder(n.initializer, sf, rel, out)
    else if (ts.isJsxElement(n) && hasEyebrowClass(n.openingElement)) for (const child of n.children) captionsUnder(child, sf, rel, out)
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return out
}

const FILES = walk(SRC, undefined, /\.tsx$/)
const SITES: Site[] = FILES.flatMap(f => {
  const source = readFileSync(f, 'utf8')
  return /eyebrow/.test(source) ? eyebrowSites(f, source) : []
})

describe('영문 머리말(eyebrow) — 한국어 화면에 되돌아오지 않는다', () => {
  it('src 의 머리말 자리를 실제로 본다(빈 목록으로 통과하지 않는다)', () => {
    const files = new Set(SITES.map(s => s.file))
    // 보고서 모달·초대 카드의 머리말은 사전(reportUi.title·invite.eyebrow)으로 옮겨 리터럴 자리가 아니게 됐다 — 남은 리터럴 자리(상태 견본)로 확인한다
    expect([...files]).toEqual(expect.arrayContaining(['src/components/admin/UiStatesShowcase.tsx']))
    // 머리말이 사전(`t(…)` — 호출 인자는 문구로 세지 않는다)으로 옮겨 가면서 리터럴 자리는 줄어든다(워크스페이스 설정의 열 곳이 그랬다)
    expect(SITES.length).toBeGreaterThan(0)
  })

  it('머리말 리터럴에 영문 문구가 없다 — 제목과 겹치면 지우고, 정보가 있으면 한국어(사전)로 쓴다', () => {
    const hits = SITES.filter(s => isEnglishCaption(s.text) && !(s.file in ALLOW)).map(s => `${s.file}:${s.line}: ${s.text.slice(0, 80)}`)
    expect(hits, hits.join('\n')).toEqual([])
  })

  it('한국어 사전의 머리말 문구(키 이름에 eyebrow)는 영문이 아니다', () => {
    const hits: string[] = []
    let seen = 0
    for (const f of walk(join(SRC, 'lib/i18n/dict'), undefined, /\.ts$/).filter(f => !f.endsWith('.en.ts'))) {
      for (const m of readFileSync(f, 'utf8').matchAll(/'([\w.]*eyebrow[\w.]*)':\s*'([^']*)'/gi)) {
        seen++
        if (isEnglishCaption(m[2])) hits.push(`${relative(process.cwd(), f)}: ${m[1]} = ${m[2]}`)
      }
    }
    expect(seen).toBeGreaterThan(0)
    expect(hits, hits.join('\n')).toEqual([])
  })

  it('예외 목록의 파일은 실제로 영문 머리말을 갖고 있다(죽은 예외를 남기지 않는다)', () => {
    for (const f of Object.keys(ALLOW)) expect(SITES.some(s => s.file === f && isEnglishCaption(s.text)), f).toBe(true)
  })

  it('검사식 — 영문 문구는 잡고, 한글·고유 낱말·사전 키·치환 자리는 잡지 않는다', () => {
    expect(isEnglishCaption('"Delete meeting"')).toBe(true)
    expect(isEnglishCaption('"AI ASSISTANT"')).toBe(true)
    expect(isEnglishCaption('"주간 보고서"')).toBe(false)
    expect(isEnglishCaption('"WBS"')).toBe(false)
    expect(isEnglishCaption('`건`')).toBe(false)
    const sample = `
      const eyebrow = view === 'delete' ? 'Profile form' : '프로필'
      const a = <Modal eyebrow="Reset password" title="x" />
      const b = <Modal eyebrow={t('nav.announcements')} title="x" />
      const c = <Modal eyebrow={n > 0 ? t('issue.bulk.selected').replace('{n}', String(n)) : undefined} title="x" />
      const d = <div className="eyebrow mb-1">Account board</div>
      const e = <p className="eyebrow">{t('min.toc.title')}</p>
      const f = <Modal eyebrow={ok ? 'Edit item' : \`\${n}건\`} title="x" />`
    const english = eyebrowSites('sample.tsx', sample).filter(s => isEnglishCaption(s.text)).map(s => s.text)
    expect(english).toEqual(["'Profile form'", '"Reset password"', 'Account board', "'Edit item'"])
  })
})
