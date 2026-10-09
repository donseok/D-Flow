// 화면 파일(src/components·src/app 의 .tsx)에 한국어 리터럴이 되돌아오지 못하게 한다 — 영어 로캘에서 한국어가 새는 것을 막는다(i18n 1·2차).
// 화면 글자는 사전(src/lib/i18n/dict/*)에 두고 `useLocale().t`(서버 화면은 `t(locale, …)`)로 읽는다.
// TS 파서로 리터럴(문자열·템플릿 조각·JSX 글자)만 본다 — 주석은 보지 않는다. 다음은 검사 대상이 아니다:
//   · `console.*(…)` 의 인자와 `throw …` 문(개발자용 문구), `data-*` 속성 값(표지)
// JSX 글자·사용자 노출 속성(title·aria-label·placeholder·alt·label …)·toast/confirm 인자뿐 아니라 그 밖의 리터럴(라벨 표·비교값)도 센다 —
// 화면 파일의 한국어는 어디에 있든 결국 화면으로 가기 쉽다. 의도해서 남긴 것은 ALLOW 에 파일 → 사유 → 허용 개수 상한으로 닫아 둔다.
// 상한을 넘으면(그 파일에 새 한국어가 늘면) 실패하고, 예외 파일에서 한국어가 사라지면(죽은 예외) 실패한다.
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { walk } from './_walk'
import { KO } from '@/lib/i18n/dict/ko'
import { EN } from '@/lib/i18n/dict/en'

const ROOT = process.cwd()
const DIRS = ['src/components', 'src/app']
const HANGUL = /[가-힣]/

/** 의도해서 남긴 한국어(닫힌 목록) — max 는 그 파일의 한국어 리터럴 수 상한(지금 값). 줄이는 것은 자유, 늘리려면 사유를 고친다 */
const ALLOW: Readonly<Record<string, { why: string; max: number }>> = {
  // ── 제품 고정 문구(개정 §2.9) ──
  'src/components/weekly/WeeklySheetView.tsx': { why: '주간 시트의 핵심 4열 머리(금주실적·차주계획·내용·이슈 및 주요 이벤트)와 기본 문서 제목 — 제품 고정', max: 7 },
  // ── 서버·모델로 보내거나 문서에 저장되는 글자 ──
  'src/components/chat/AssistantChat.tsx': { why: '챗 전송 문구(서버 인텐트 매칭용 — 표시는 SUGGESTION_LABEL_KEY 로 번역)', max: 7 },
  'src/components/wiki/WikiDocumentEditor.tsx': { why: '위키 본문 틀(문서에 저장되는 글자)', max: 7 },
  'src/components/import/ImportWizard.tsx': { why: '내려받기 파일 이름(wbs-양식.xlsx)', max: 1 },
  // ── 글자가 아니라 값(비교·대응 표의 키) ──
  'src/components/kanban/KanbanBoard.tsx': { why: '도메인이 만드는 한국어 컬럼 제목 → 사전 키 대응 표의 키(COLUMN_TITLE_KEY)', max: 9 },
  'src/components/invite/InviteRedeemCard.tsx': { why: '서버 액션 오류 문구와의 비교값(E_OTHER_ACCOUNT — 서버 오류 문구는 3차)', max: 1 },
  'src/app/(app)/p/[projectId]/settings/page.tsx': { why: '설정 검색 색인 낱말(searchText — 화면에 보이지 않는다, ko·en 낱말 혼합)', max: 22 },
  'src/app/(app)/w/[slug]/settings/page.tsx': { why: '설정 검색 색인 낱말(searchText — 화면에 보이지 않는다, ko·en 낱말 혼합)', max: 9 },
  // ── 번역하지 않는 글자 ──
  'src/components/account/AccountView.tsx': { why: '언어 선택의 언어 이름(한국어 — 그 언어로 적는다)', max: 1 },
  'src/components/admin/UiStatesShowcase.tsx': { why: '플랫폼 관리자용 상태 견본 화면의 견본 문구(점검 화면 — 옮기지 않는다)', max: 119 },
  // ── 미이전(다음 차) ──
  'src/app/layout.tsx': { why: '미이전 — 루트 레이아웃(UI 위험 파일)의 정적 metadata 설명', max: 1 },
  'src/app/(app)/p/[projectId]/members/page.tsx': { why: '미이전 — 조회 실패 결과의 오류 문구(서버 오류 문구는 3차)', max: 1 },
}

const TEXT_KINDS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.StringLiteral, ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateHead, ts.SyntaxKind.TemplateMiddle, ts.SyntaxKind.TemplateTail, ts.SyntaxKind.JsxText,
])

interface Hit { line: number; text: string }

/** 파일의 한국어 리터럴 — console.*·throw·data-* 는 건너뛴다 */
function koreanLiterals(file: string, source: string): Hit[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const out: Hit[] = []
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && /^console\./.test(n.expression.getText(sf))) return
    if (ts.isThrowStatement(n)) return
    if (ts.isJsxAttribute(n) && /^data-/.test(n.name.getText(sf))) return
    if (TEXT_KINDS.has(n.kind)) {
      const text = n.getText(sf)
      if (HANGUL.test(text)) out.push({ line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, text: text.trim().replace(/\s+/g, ' ') })
      return
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return out
}

const FILES = DIRS.flatMap(d => walk(join(ROOT, d), undefined, /\.tsx$/))
const HITS = new Map<string, Hit[]>()
for (const f of FILES) {
  const source = readFileSync(f, 'utf8')
  if (!HANGUL.test(source)) continue   // 주석에도 한국어가 없으면 파싱하지 않는다
  const hits = koreanLiterals(f, source)
  if (hits.length) HITS.set(relative(ROOT, f), hits)
}

describe('화면 파일의 한국어 리터럴 — 사전을 거치지 않는 글자가 되돌아오지 않는다', () => {
  it('화면 파일을 실제로 본다(빈 목록으로 통과하지 않는다)', () => {
    expect(FILES.length).toBeGreaterThan(300)
    expect(HITS.has('src/components/admin/UiStatesShowcase.tsx')).toBe(true)
  })

  it('예외 목록 밖의 .tsx 에 한국어 리터럴이 없다 — 사전 키로 옮긴다(ko·en 둘 다)', () => {
    const found: string[] = []
    for (const [file, hits] of HITS) {
      if (file in ALLOW) continue
      for (const h of hits) found.push(`${file}:${h.line}: ${h.text.slice(0, 80)}`)
    }
    expect(found, found.join('\n')).toEqual([])
  })

  it('예외 파일의 한국어 리터럴은 허용 개수를 넘지 않는다(그 파일에 새 한국어를 더하지 않는다)', () => {
    const over: string[] = []
    for (const [file, { max }] of Object.entries(ALLOW)) {
      const n = HITS.get(file)?.length ?? 0
      if (n > max) over.push(`${file}: ${n} > ${max}\n${HITS.get(file)!.map(h => `  ${h.line}: ${h.text.slice(0, 80)}`).join('\n')}`)
    }
    expect(over, over.join('\n')).toEqual([])
  })

  it('예외 목록의 파일은 실제로 한국어 리터럴을 갖고 있다(죽은 예외를 남기지 않는다)', () => {
    const dead = Object.keys(ALLOW).filter(f => !HITS.has(f))
    expect(dead, dead.join('\n')).toEqual([])
  })

  it('예외마다 사유가 있다', () => {
    for (const [file, { why, max }] of Object.entries(ALLOW)) { expect(why.trim().length, file).toBeGreaterThan(5); expect(max, file).toBeGreaterThan(0) }
  })

  it('검사식 — JSX 글자·속성·toast 인자·템플릿은 잡고, 주석·console·throw·data-*·사전 키는 잡지 않는다', () => {
    const sample = `
      // 주석의 한국어
      const a = <p title="제목" data-label="표지">글자 {n}건</p>
      const b = <input placeholder={t('common.search')} aria-label={\`\${name} 이름\`} />
      toast({ title: '저장했습니다' })
      console.error('[x] 조회 실패')
      function f() { throw new Error('불변식 위반') }
      if (window.confirm('지울까요?')) run()
      const c = \`완료 \${done}/\${total}\``
    expect(koreanLiterals('sample.tsx', sample).map(h => h.text)).toEqual(['"제목"', '글자', '건', '} 이름`', "'저장했습니다'", "'지울까요?'", '`완료 ${'])
  })
})

describe('사전 — ko·en 의 키 집합이 같다', () => {
  it('한쪽에만 있는 키가 없다(영어 화면에 한국어 폴백이 섞이지 않는다)', () => {
    const ko = new Set(Object.keys(KO)), en = new Set(Object.keys(EN))
    const onlyKo = [...ko].filter(k => !en.has(k)), onlyEn = [...en].filter(k => !ko.has(k))
    expect(onlyKo, `ko 에만: ${onlyKo.slice(0, 20).join(', ')}`).toEqual([])
    expect(onlyEn, `en 에만: ${onlyEn.slice(0, 20).join(', ')}`).toEqual([])
  })

  it('치환 자리({이름})의 집합이 ko·en 에서 같다(한쪽에서 값이 빠지지 않는다)', () => {
    const slots = (s: string) => [...new Set(s.match(/\{\w+\}/g) ?? [])].sort().join(',')
    const en = EN as Record<string, string>
    const diff = Object.entries(KO as Record<string, string>).filter(([k, v]) => k in en && slots(v) !== slots(en[k])).map(([k, v]) => `${k}: ko[${slots(v)}] en[${slots(en[k])}]`)
    expect(diff, diff.join('\n')).toEqual([])
  })
})
