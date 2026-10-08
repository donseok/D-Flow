import { describe, expect, it } from 'vitest'
import * as engine from '@/lib/report/engine/paginate'
import { sheetLineText } from '@/lib/report/sheetNarrative'
import type { NarrativeGroup } from '@/lib/report/narrative'

describe('engine/paginate (정본 §4.3 이동)', () => {
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

// 아래는 옛 주간 렌더러 테스트에 있던 분할 규칙 케이스다 — 함수는 engine/paginate 가 정본이라 여기로 옮겼다.
const { capItems, lineCost, paginateGroups, paginateLines } = engine

describe('capItems', () => {
  it('max 이하는 그대로', () => expect(capItems(['a', 'b'], 3)).toEqual(['a', 'b']))
  it('정확히 max건이면 "외 N건" 없이 전부', () =>
    expect(capItems(['a', 'b', 'c'], 3)).toEqual(['a', 'b', 'c']))
  it('초과분은 max건 표시 + "외 N건" 줄 추가(시트 경로와 동일 규칙)', () =>
    expect(capItems(['a', 'b', 'c', 'd'], 3)).toEqual(['a', 'b', 'c', '외 1건']))
})

describe('lineCost', () => {
  it('짧은 텍스트는 1줄', () => expect(lineCost('항목')).toBe(1))
  it('전각 26자 초과는 줄바꿈으로 2줄', () => expect(lineCost('가'.repeat(27))).toBe(2))
  it('영문·숫자는 반각(전각의 절반)으로 계산', () => expect(lineCost('a'.repeat(52))).toBe(1))
})

describe('paginateGroups', () => {
  const g = (phase: string, n: number, prefix = '항목'): NarrativeGroup =>
    ({ phase, num: 1, items: Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`) })

  it('예산 이내면 1페이지에 전부', () => {
    const pages = paginateGroups([g('P1', 3), g('P2', 4)], 15)
    expect(pages).toHaveLength(1)
    expect(pages[0].map(x => x.phase)).toEqual(['P1', 'P2'])
  })
  it('그룹 사이 빈 줄 1줄도 예산에 포함', () => {
    // P1(1+7=8) + 빈줄(1) + P2(1+6=7) = 16 > 15 → 2페이지
    const pages = paginateGroups([g('P1', 7), g('P2', 6)], 15)
    expect(pages).toHaveLength(2)
    expect(pages[1][0].phase).toBe('P2')
    expect(pages[1][0].items).toHaveLength(6) // 통째 이월(분할 없음)
  })
  it('한 페이지를 넘는 그룹만 항목 단위로 쪼개고 "(계속)" 헤더로 잇는다', () => {
    const pages = paginateGroups([g('실행', 20)], 15)
    expect(pages).toHaveLength(2)
    expect(pages[0][0].items).toHaveLength(14)              // 헤더1 + 항목14 = 15줄
    expect(pages[1][0].phase).toBe('실행 (계속)')
    expect(pages[1][0].items).toHaveLength(6)
    const all = pages.flat().flatMap(x => x.items)
    expect(all).toHaveLength(20)                            // 항목 유실 없음
    expect(new Set(all).size).toBe(20)
  })
  it('줄바꿈되는 긴 항목은 2줄로 계산되어 더 일찍 분할', () => {
    const long = '현황 파악 (As-Is 프로세스, 시스템 현황, 조직 구성 등) 상세 분석' // 전각 26자 초과 → 2줄
    const pages = paginateGroups([{ phase: 'P', num: 1, items: Array.from({ length: 10 }, () => long) }], 15)
    // 헤더1 + 2줄×7 = 15 → 페이지당 7개
    expect(pages[0][0].items).toHaveLength(7)
    expect(pages).toHaveLength(2)
  })
  it('num은 분할·이월 후에도 원본 그룹 값 유지', () => {
    const pages = paginateGroups([{ ...g('실행', 20), num: 3 }], 15)
    expect(pages.flat().every(x => x.num === 3)).toBe(true)
  })
  it('빈 입력은 빈 1페이지', () => expect(paginateGroups([], 15)).toEqual([[]]))
  it('예산을 단독 초과하는 마지막 항목이 빈 "(계속)" 페이지를 남기지 않음', () => {
    const huge = '가'.repeat(390) // lineCost 15 초과
    const pages = paginateGroups([{ phase: '실행', num: 1, items: [huge] }], 15)
    expect(pages).toHaveLength(1)                       // 유령 페이지 없음
    expect(pages.flat().every(x => x.items.length > 0 || x.phase === '실행')).toBe(true)
    expect(pages.flat().filter(x => x.phase.includes('(계속)') && x.items.length === 0)).toHaveLength(0)
    // 뒤에 그룹이 이어져도 빈 '(계속)' 헤더가 끼지 않는다
    const pages2 = paginateGroups([{ phase: '실행', num: 1, items: [huge] }, g('구축', 2)], 15)
    expect(pages2.flat().filter(x => x.items.length === 0)).toHaveLength(0)
  })
  it('담당 헤더("- X")가 페이지 끝에 홀로 남지 않고 상세와 함께 다음 페이지로 이월', () => {
    // 헤더1 + 항목13 = 14줄 사용 → 15번째 줄에 '- FCT' 헤더만 남는 상황
    const items = [...Array.from({ length: 13 }, (_, i) => `항목${i + 1}`), '- FCT', '. 상세A', '. 상세B']
    const pages = paginateGroups([{ phase: 'P', num: 1, items }], 15)
    expect(pages).toHaveLength(2)
    expect(pages[0][0].items.at(-1)).toBe('항목13')                 // 헤더가 끝에 홀로 남지 않음
    expect(pages[1][0].items).toEqual(['- FCT', '. 상세A', '. 상세B'])
  })
  it('상세(".") 중간에서 끊기면 다음 페이지에 담당 헤더를 "(계속)"으로 반복', () => {
    const items = ['- FCT', ...Array.from({ length: 20 }, (_, i) => `. 상세${i + 1}`)]
    const pages = paginateGroups([{ phase: 'P', num: 1, items }], 15)
    expect(pages).toHaveLength(2)
    expect(pages[1][0].items[0]).toBe('- FCT (계속)')
    // 원본 상세 20건 전부 보존
    const details = pages.flat().flatMap(x => x.items).filter(s => s.startsWith('. '))
    expect(details).toHaveLength(20)
  })

  it('시트 포매터(sheetLineText) 주입 시에도 분할 규칙이 동일하게 적용된다', () => {
    const pages = paginateGroups([g('[FIN] 모듈A', 20)], 15, sheetLineText)
    expect(pages).toHaveLength(2)
    expect(pages[0][0].items).toHaveLength(14)
    expect(pages[1][0].phase).toBe('[FIN] 모듈A (계속)')
    expect(pages[1][0].items).toHaveLength(6)
    const all = pages.flat().flatMap(x => x.items)
    expect(all).toHaveLength(20)
  })
})

describe('paginateLines', () => {
  it('예산 이내면 1페이지에 전부', () => {
    expect(paginateLines(['a', 'b', 'c'], 6)).toEqual([['a', 'b', 'c']])
  })
  it('빈 목록은 빈 1페이지', () => expect(paginateLines([], 6)).toEqual([[]]))
  it('예산 초과분은 다음 페이지로, 항목 유실·캡 없음(외 N건 없음)', () => {
    const lines = Array.from({ length: 8 }, (_, i) => `이슈${i + 1}`) // 각 1줄, 예산 6
    const pages = paginateLines(lines, 6)
    expect(pages).toHaveLength(2)
    expect(pages[0]).toHaveLength(6)
    expect(pages[1]).toHaveLength(2)
    const all = pages.flat()
    expect(all).toEqual(lines)                         // 순서·전량 보존
    expect(all.some(l => l.startsWith('외 '))).toBe(false)
  })
  it('줄바꿈되는 긴 줄은 2줄로 계산되어 더 일찍 분할', () => {
    const long = '가'.repeat(27) // lineCost 2
    const pages = paginateLines([long, long, long, long], 6) // 2+2+2=6, 4번째는 다음 페이지
    expect(pages).toHaveLength(2)
    expect(pages[0]).toHaveLength(3)
    expect(pages[1]).toHaveLength(1)
  })
  it('예산을 단독 초과하는 한 줄도 잘리지 않고 자기 페이지에', () => {
    const huge = '가'.repeat(200)
    expect(paginateLines([huge], 6)).toEqual([[huge]])
  })
})
