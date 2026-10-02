import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/** 본문 머리 강등(MarkdownView demoteHeadings)의 시각 불변 — 한 칸 내린 머리가 원래 수준의 모양을 그대로 입는다(판정 R-h1). */
const css = readFileSync(join(fileURLToPath(new URL('../..', import.meta.url)), 'src/app/globals.css'), 'utf8')
function decl(selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = css.match(new RegExp(`(?:^|[\\s}])${esc}\\s*\\{([^}]*)\\}`))
  expect(m, selector).not.toBeNull()
  return m![1].replace(/\s+/g, ' ').trim()
}

describe('.minutes-md 강등 머리 클래스', () => {
  it.each([['h1', 'md-h1'], ['h2', 'md-h2'], ['h3', 'md-h3']])('%s 와 .%s 의 선언이 같다', (tag, cls) => {
    expect(decl(`.minutes-md .${cls}`)).toBe(decl(`.minutes-md ${tag}`))
  })
  it('h4~h6 은 한 규칙이라 강등된 수준 4~6 도 같은 모양(클래스 불필요)', () => {
    expect(css).toContain('.minutes-md h4, .minutes-md h5, .minutes-md h6 {')
  })
})
