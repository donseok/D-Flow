import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('저장 중 표시는 상태색과 분리한다', () => {
  it('카드 스피너와 보드 저장 안내는 중립색', () => {
    const lines = ['KanbanCard', 'KanbanBoard'].flatMap(name => readFileSync(`src/components/kanban/${name}.tsx`, 'utf8').split('\n').filter(l => l.includes('kanban.saving')))
    expect(lines).toHaveLength(2)
    for (const line of lines) {
      expect(line).toContain('text-fg-muted')
      expect(line).not.toMatch(/\b(?:text|bg)-(?:done|delayed|pending|danger|success|warning|brand|action)\b/)
    }
  })
})
