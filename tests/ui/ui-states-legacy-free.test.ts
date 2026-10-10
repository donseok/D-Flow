// 쇼케이스와 새 상태 컴포넌트는 옛 토큰 이름을 쓰지 않는다(계획 Review Focus 5·판정 Q12) — 옛 이름(별칭)은 UI-6 에서 지웠다.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const OLD = '(?:surface-2|line(?:-strong)?|ink(?:-muted|-subtle)?|brand(?:-hover|-weak|-fg|-ring)?|accent-(?:secondary|ink|warning)|done(?:-weak)?|delayed(?:-weak)?|grid(?:-strong)?|sheet-head|zebra|hero-[\\w-]+|team-[1-5](?:-weak)?)'
const UTIL = new RegExp(`(?<![\\w-])(?:[a-z-]+:)*(?:bg|text|border|ring|outline|fill|stroke|divide|from|via|to|shadow|placeholder|decoration|caret|accent)-${OLD}(?![\\w-])`)
const VAR = new RegExp(`var\\(--color-${OLD}\\)`)
const FILES = [
  'src/components/admin/UiStatesShowcase.tsx', 'src/components/ui/StatusMessage.tsx', 'src/components/ui/Button.tsx',
  'src/components/ui/IconButton.tsx', 'src/components/ui/Field.tsx', 'src/components/ui/StatusPill.tsx', 'src/components/ui/buttonStyles.ts',
]

describe('쇼케이스는 새 토큰 이름만', () => {
  it.each(FILES)('%s', (f) => {
    const lines = readFileSync(join(process.cwd(), f), 'utf8').split('\n').filter((l) => UTIL.test(l) || VAR.test(l))
    expect(lines).toEqual([])
  })
})

// 새 상태 컴포넌트는 옛 공용 버튼 클래스(.btn·.btn-*)를 쓰지 않는다(U1d 리뷰 J1) — .btn 계열은 높이를 호출부가 덮어(h-8 = 32px)
// 조작 높이 토큰(--control-h 36)을 벗어났다. 다음 행동은 Button(또는 같은 클래스 원천)으로. 쇼케이스는 옛 .btn-primary 대조 표본을 일부러 둔다
const BTN = /(?<![\w-])btn(?:-[\w-]+)?(?![\w-])/
describe('새 상태 컴포넌트는 옛 .btn 클래스를 쓰지 않는다', () => {
  it.each(FILES.filter((f) => !f.endsWith('UiStatesShowcase.tsx')))('%s', (f) => {
    const lines = readFileSync(join(process.cwd(), f), 'utf8').split('\n').filter((l) => /className/.test(l) && BTN.test(l))
    expect(lines).toEqual([])
  })
})
