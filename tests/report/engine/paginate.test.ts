import { describe, expect, it } from 'vitest'
import * as engine from '@/lib/report/engine/paginate'
import * as fill from '@/lib/report/templateFill'
import type { NarrativeGroup } from '@/lib/report/narrative'

describe('engine/paginate (정본 §4.3 이동)', () => {
  it('templateFill 은 같은 함수를 재수출한다', () => {
    expect(fill.capItems).toBe(engine.capItems)
    expect(fill.lineCost).toBe(engine.lineCost)
    expect(fill.paginateGroups).toBe(engine.paginateGroups)
    expect(fill.paginateLines).toBe(engine.paginateLines)
  })

  it('전각 26자 기준과 반각, 빈 페이지, 외 N건', () => {
    expect(engine.lineCost('가'.repeat(26))).toBe(1)
    expect(engine.lineCost('가'.repeat(27))).toBe(2)
    expect(engine.lineCost('a'.repeat(52))).toBe(1)
    expect(engine.lineCost('a'.repeat(53))).toBe(2)
    expect(engine.capItems(['a', 'b', 'c', 'd'], 3)).toEqual(['a', 'b', 'c', '외 1건'])
    expect(engine.paginateGroups([], 15)).toEqual([[]])
    expect(engine.paginateLines([], 6)).toEqual([[]])
  })

  it('예산을 넘는 그룹은 (계속) 으로 잇고 항목을 잃지 않는다', () => {
    const group: NarrativeGroup = {
      phase: '실행',
      num: 2,
      items: Array.from({ length: 20 }, (_, i) => `항목${i + 1}`),
    }
    const pages = engine.paginateGroups([group], 15)
    expect(pages.length).toBeGreaterThan(1)
    expect(pages[1][0].phase).toContain('(계속)')
    expect(pages[1][0].num).toBe(2)
    const items = pages.flatMap(page => page.flatMap(g => g.items))
    expect(items).toEqual(group.items)
  })
})
