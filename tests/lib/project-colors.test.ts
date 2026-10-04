import { describe, expect, it } from 'vitest'
import { PROJECT_DOT_CLASSES, projectColorClass } from '@/lib/domain/projectColors'

describe('projectColorClass', () => {
  const ids = ['b', 'a', 'c']
  it('정렬 기준 인덱스로 결정적이다 — 입력 순서와 무관', () => {
    expect(projectColorClass(ids, 'a')).toBe(PROJECT_DOT_CLASSES[0])
    expect(projectColorClass(['a', 'b', 'c'], 'a')).toBe(PROJECT_DOT_CLASSES[0])
    expect(projectColorClass(ids, 'b')).toBe(PROJECT_DOT_CLASSES[1])
  })
  it('팔레트 초과는 순환한다', () => {
    const many = Array.from({ length: 8 }, (_, i) => `p${i}`)
    expect(projectColorClass(many, 'p6')).toBe(PROJECT_DOT_CLASSES[6 % PROJECT_DOT_CLASSES.length])
  })
  it('색은 분류 토큰(category-1~8)뿐이다 — 원색 팔레트가 없다(SP5 B2 — D39)', () => {
    expect(PROJECT_DOT_CLASSES.every((c) => /^bg-category-[1-8]$/.test(c))).toBe(true)
  })
  it('목록 밖 id 는 첫 색으로 폴백한다(크래시 금지)', () => {
    expect(projectColorClass(ids, 'zzz')).toBe(PROJECT_DOT_CLASSES[0])
  })
})
