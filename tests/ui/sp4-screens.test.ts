// SP4 B 화면(D52 — #23·#25)의 패턴 계약(스펙 §6.1 "B 화면 테스트"·§7 B 여섯째 줄): 12px 미만·uppercase·넓은 자간 0, 상태 = StatusMessage.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/** tests/css/type-scale.test.ts 의 SMALL_OR_CAPS 와 같은 식 — 그 파일은 export 하지 않는다(바꿀 때 둘 다) */
const SMALL_OR_CAPS = /text-\[(?:9|10|10\.5|11)px\]|\buppercase\b|tracking-\[0\.1\d?em\]|tracking-wide(?:st|r)?\b/
const read = (f: string) => readFileSync(f, 'utf8')
const IMPORT_FILES = [
  'src/app/(app)/p/[projectId]/import/page.tsx', 'src/components/import/ImportWizard.tsx',
  'src/components/import/ImportReceiptPanel.tsx', 'src/components/import/ImportRunSummary.tsx',
]

describe('#23 가져오기 — 글자·상태', () => {
  it.each(IMPORT_FILES)('%s — 12px 미만·uppercase·넓은 자간 0', (f) => { expect(read(f)).not.toMatch(SMALL_OR_CAPS) })
  it('영수증 패널·중복 안내는 StatusMessage 로 말한다', () => {
    expect(read('src/components/import/ImportReceiptPanel.tsx')).toContain('<StatusMessage')
    expect(read('src/components/import/ImportRunSummary.tsx')).toContain('<StatusMessage')
  })
  it('단계 표시 — 순서 목록, 활성 단계 aria-current="step"', () => {
    const src = read('src/components/import/ImportWizard.tsx')
    expect(src).toMatch(/<ol[^>]*aria-label=/)
    expect(src).toContain("aria-current={")
  })
})

const WEEKLY_COLOR_FILES = [
  'src/components/weekly/SheetCell.tsx', 'src/components/weekly/WeeklyAiRewriteModal.tsx',
  'src/components/weekly/WeeklyLintPanel.tsx', 'src/components/weekly/WeeklySheetView.tsx',
]
/** no-raw-color 의 PATTERNS 가 보지 않는 흑백 고정색·style 의 hex 리터럴까지 — 시트가 테마를 따른다(다크 대비 — D52·Q17) */
const FIXED_COLOR = /(?<![\w-])(?:text|bg|border|outline|ring|fill|stroke)-(?:black|white)(?![\w-])|-\[#[0-9a-fA-F]{3,8}\]|rgba?\(|'#[0-9a-fA-F]{3,8}'/

describe('#25 주간 — 색 토큰', () => {
  it.each(WEEKLY_COLOR_FILES)('%s — 원색·흑백 고정색 0', (f) => { expect(read(f)).not.toMatch(FIXED_COLOR) })
  it('no-raw-color 허용 목록에 주간 줄이 없고, 프로젝트 점 색 표의 사유는 SP5 다(스펙 §2.4)', () => {
    const allow = read('tests/css/no-raw-color.test.ts')
    expect(allow).not.toContain("'src/components/weekly/")
    expect(allow).toMatch(/'src\/lib\/domain\/projectColors\.ts': \{[^}]*SP5/)
  })
  it('프레즌스 이름 칩은 배경·글자 짝(presenceStyle) — 흰 글자 고정이 없다(레인 B 인계 E)', () => {
    const src = read('src/components/weekly/SheetCell.tsx')
    expect(src).toContain('presenceStyle(peer.userId)')
    expect(src).not.toContain('background: presenceColor(peer.userId)')
  })
})
