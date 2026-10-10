// 특정 프로젝트 유형의 잔재가 사용자에게 보이는 글자·AI 프롬프트로 되돌아오지 못하게 한다(범용화 — 정본 §1.1 의 "원본 고객사 특화" 걷기).
// 걷은 것 셋: ① 프롬프트의 프로젝트 유형 고정(방법론 이름), ② 1레벨 단계 이름을 'Phase' 로 박은 문구(이름은 프로젝트 설정
// core.level_labels 에서 온다), ③ 대화형 답변 프롬프트의 답변 언어 고정(src/lib/ai/answerLanguage.ts 의 규칙을 쓴다).
// 주석·식별자·사전 키는 보지 않는다 — TS 파서로 리터럴(문자열·템플릿 조각·JSX 글자)만 꺼내 그 안에서 낱말 경계로 찾는다.
// 예외는 아래 닫힌 목록뿐이다(파일:사유). 새 예외는 사유와 함께 여기 덧붙인다 — 정규식을 느슨하게 고치지 않는다.
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { walk } from './_walk'

const SRC = join(process.cwd(), 'src')
const LITERAL_KINDS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.StringLiteral, ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateHead, ts.SyntaxKind.TemplateMiddle, ts.SyntaxKind.TemplateTail, ts.SyntaxKind.JsxText,
])

interface Lit { file: string; line: number; text: string; isKey: boolean }

/** 파일의 리터럴 전부. 객체 속성의 이름 자리(사전 키 `'wbs.addPhase': …`)는 isKey 로 표시한다 — 키는 식별자다 */
function literalsOf(file: string, source: string): Lit[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const out: Lit[] = []
  const visit = (n: ts.Node): void => {
    if (LITERAL_KINDS.has(n.kind)) {
      const isKey = ts.isPropertyAssignment(n.parent) && n.parent.name === n
      out.push({ file: relative(process.cwd(), file), line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, text: n.getText(sf), isKey })
      return
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return out
}

const FILES = walk(SRC)
const ALL: Lit[] = FILES.flatMap(f => {
  const source = readFileSync(f, 'utf8')
  return /Phase|phase|한국어로|Process Innovation|PI\s*\(/.test(source) ? literalsOf(f, source) : []
}).filter(l => !l.isKey)

const hitsOf = (re: RegExp, lits: readonly Lit[], allow: Readonly<Record<string, string>>): string[] =>
  lits.filter(l => re.test(l.text) && !(l.file in allow)).map(l => `${l.file}:${l.line}: ${l.text.slice(0, 120)}`)

/** 방법론·프로젝트 유형 이름 — 프롬프트·문구 어디에도 두지 않는다(예외 없음) */
const PROJECT_TYPE = /Process Innovation|\bPI\s*\(|\bPI\s*프로젝트/

/** 1레벨 단계 이름으로 박힌 'Phase' — 대문자 낱말만(소문자 'phase' 는 보기·깊이 열거 키로 코드 곳곳에 쓰인다) */
const PHASE_WORD = /\bPhase\b/
const PHASE_ALLOW: Readonly<Record<string, string>> = {
  'src/lib/domain/levelSettings.ts': '단계 이름을 주입받지 못한 호출의 폴백 한 곳(FALLBACK_LEVEL_LABELS) — 옛 3단 표기를 그대로 둔다',
  'src/components/agents/DetailPanel.tsx': '에이전트 좌석의 작업 국면 사다리(aria-label) — WBS 단계 이름이 아니다',
}

/** 사전의 문구는 소문자 phase 도 본다 — 'By phase' 꼴로 1레벨을 부르던 자리 */
const DICT_PHASE = /\bphases?\b/i
const DICT_PHASE_ALLOW: Readonly<Record<string, string>> = {}

/** 대화형 답변 프롬프트의 언어 고정 — 프롬프트가 사는 두 폴더만 본다 */
const KOREAN_ONLY = /한국어로/
const KOREAN_ONLY_ALLOW: Readonly<Record<string, string>> = {
  'src/lib/ai/brief.ts': '주간 브리핑은 프로젝트가 공유하는 보고 문서다 — 보고서 생성 문구의 언어는 한국어(개정 §2.9.2 지원 제한)',
}

describe('특정 프로젝트 유형의 잔재 — 사용자 노출 문자열·프롬프트', () => {
  it('src 를 실제로 걷는다(빈 목록으로 통과하지 않는다)', () => {
    const rel = FILES.map(f => relative(process.cwd(), f))
    expect(rel).toEqual(expect.arrayContaining([
      'src/lib/ai/issue-analysis.ts', 'src/lib/ai/minute-issue-draft.ts', 'src/lib/i18n/dict/wbs.ts', 'src/lib/i18n/dict/kanban.ts',
      'src/components/report/ReportModal.tsx', 'src/lib/report/excel.ts',
    ]))
    expect(ALL.length).toBeGreaterThan(100)
  })

  it('프롬프트·문구가 프로젝트 유형(방법론 이름)을 가정하지 않는다', () => {
    const hits = hitsOf(PROJECT_TYPE, ALL, {})
    expect(hits, hits.join('\n')).toEqual([])
  })

  it("1레벨 단계 이름을 'Phase' 로 박지 않는다 — 프로젝트 설정의 이름({level})이나 유형 중립 문구를 쓴다", () => {
    const hits = hitsOf(PHASE_WORD, ALL, PHASE_ALLOW)
    expect(hits, hits.join('\n')).toEqual([])
  })

  it('사전의 문구는 소문자 phase 로도 1레벨을 부르지 않는다', () => {
    const hits = hitsOf(DICT_PHASE, ALL.filter(l => l.file.startsWith('src/lib/i18n/dict/')), DICT_PHASE_ALLOW)
    expect(hits, hits.join('\n')).toEqual([])
  })

  it('대화형 AI 답변 프롬프트가 답변 언어를 한국어로 고정하지 않는다', () => {
    const prompts = ALL.filter(l => l.file.startsWith('src/lib/ai/') || l.file.startsWith('src/app/api/'))
    const hits = hitsOf(KOREAN_ONLY, prompts, KOREAN_ONLY_ALLOW)
    expect(hits, hits.join('\n')).toEqual([])
  })

  it('예외 목록의 파일은 실제로 그 낱말을 갖고 있다(죽은 예외를 남기지 않는다)', () => {
    const has = (re: RegExp, file: string) => ALL.some(l => l.file === file && re.test(l.text))
    for (const f of Object.keys(PHASE_ALLOW)) expect(has(PHASE_WORD, f), f).toBe(true)
    for (const f of Object.keys(DICT_PHASE_ALLOW)) expect(has(DICT_PHASE, f), f).toBe(true)
    for (const f of Object.keys(KOREAN_ONLY_ALLOW)) expect(has(KOREAN_ONLY, f), f).toBe(true)
  })

  it('검사식은 낱말만 잡는다 — 사전 키·식별자 조각·열거 키는 잡지 않는다', () => {
    expect(PHASE_WORD.test("'새 Phase 이름'")).toBe(true)
    expect(PHASE_WORD.test("'wbs.newPhasePlaceholder'")).toBe(false)
    expect(PHASE_WORD.test("'phase'")).toBe(false)
    expect(DICT_PHASE.test("'By phase'")).toBe(true)
    expect(PROJECT_TYPE.test("'당신은 PI(Process Innovation) 프로젝트의 분석가다.'")).toBe(true)
    expect(PROJECT_TYPE.test("'SPI(actual/planned)'")).toBe(false)
    expect(PROJECT_TYPE.test("'회의록 API(외부 연동)'")).toBe(false)
  })
})

// {level} 치환자 — 사전 문구에 1레벨 단계 이름이 들어갈 자리. t() 에는 치환 기능이 없어(호출부가 .replace 한다) 치환을 빠뜨리면
// 화면에 '{level}' 이 그대로 뜬다. 그 키를 부르는 자리는 모두 바로 뒤에서 치환해야 한다.
describe('{level} 치환자 — 부르는 자리가 모두 치환한다', () => {
  const dictFiles = FILES.filter(f => relative(process.cwd(), f).startsWith('src/lib/i18n/dict/'))
  const keysIn = (file: string): string[] =>
    [...readFileSync(file, 'utf8').matchAll(/^\s*'([\w.]+)':\s*(['"`])(.*)\2,?\s*$/gm)].filter(m => m[3].includes('{level}')).map(m => m[1])
  const koKeys = dictFiles.flatMap(keysIn).sort()

  it('치환자를 쓰는 키가 있다', () => {
    expect(koKeys).toEqual(expect.arrayContaining(['kanban.byPhase', 'wbs.newPhasePlaceholder', 'wbs.weightTotalTitle']))
  })

  it('그 키를 부르는 t(…) 는 바로 .replace(\'{level}\', …) 로 이어진다', () => {
    const misses: string[] = []
    for (const f of FILES) {
      if (dictFiles.includes(f)) continue
      const source = readFileSync(f, 'utf8')
      for (const key of koKeys) {
        for (const m of source.matchAll(new RegExp(`['"]${key.replace(/\./g, '\\.')}['"]\\s*\\)`, 'g'))) {
          if (!source.slice(m.index + m[0].length).startsWith(".replace('{level}'")) {
            misses.push(`${relative(process.cwd(), f)}:${source.slice(0, m.index).split('\n').length}: ${key}`)
          }
        }
      }
    }
    expect(misses, misses.join('\n')).toEqual([])
  })
})

// 특정 방법론의 낱말 — 기본 어휘(이슈 출처·원인 분류)가 한 방법론의 용어(As-Is/To-Be, S·P·O·I 머리글자)를 전제하고 있었다.
// 조직이 그 용어를 쓰려면 설정에서 라벨을 바꾸면 된다 — 제품 기본값과 화면 문구에는 두지 않는다.
describe('방법론 전용 낱말 — src 의 문구·기본값에 없다', () => {
  const METHOD_WORD = /As-Is|To-Be|\b[SPOI] · /
  it('리터럴에 없다', () => {
    expect(hitsOf(METHOD_WORD, ALL, {})).toEqual([])
  })
  it('검사식은 그 낱말만 잡는다', () => {
    expect(METHOD_WORD.test("'As-Is 분석'")).toBe(true)
    expect(METHOD_WORD.test("'P · 프로세스'")).toBe(true)
    expect(METHOD_WORD.test("'WBS · 간트'")).toBe(false)
    expect(METHOD_WORD.test("'SPI · 편차'")).toBe(false)
  })
})
