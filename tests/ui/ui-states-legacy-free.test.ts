// 쇼케이스와 새 상태 컴포넌트는 옛 토큰 이름을 쓰지 않는다(계획 Review Focus 5·판정 Q12) — 옛 이름의 var() 는 :root 에서 계산돼
// 중첩 .dark·[data-theme-scope] 안에서 라이트 값을 상속한다. 그러면 쇼케이스가 "다크가 맞다"고 거짓으로 보인다.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const OLD = '(?:surface-2|line(?:-strong)?|ink(?:-muted|-subtle)?|brand(?:-hover|-weak|-fg|-ring)?|accent-(?:secondary|ink|warning)|done(?:-weak)?|delayed(?:-weak)?|grid(?:-strong)?|sheet-head|zebra|hero-[\\w-]+|team-[1-5](?:-weak)?)'
const UTIL = new RegExp(`(?<![\\w-])(?:[a-z-]+:)*(?:bg|text|border|ring|outline|fill|stroke|divide|from|via|to|shadow|placeholder|decoration|caret|accent)-${OLD}(?![\\w-])`)
const VAR = new RegExp(`var\\(--color-${OLD}\\)`)
const FILES = [
  'src/components/admin/UiStatesShowcase.tsx', 'src/components/ui/StatusMessage.tsx', 'src/components/ui/Button.tsx',
  'src/components/ui/IconButton.tsx', 'src/components/ui/Field.tsx', 'src/components/ui/StatusPill.tsx',
]

describe('쇼케이스는 새 토큰 이름만', () => {
  it.each(FILES)('%s', (f) => {
    const lines = readFileSync(join(process.cwd(), f), 'utf8').split('\n').filter((l) => UTIL.test(l) || VAR.test(l))
    expect(lines).toEqual([])
  })
})
