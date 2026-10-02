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
