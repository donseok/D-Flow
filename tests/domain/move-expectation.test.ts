// 순서 이동의 기대값(SPU1) — 서버(moveWbsItem)가 고르는 이웃과 같은 규칙이어야 거짓 충돌이 없다: 같은 부모, sort_order → id.
import { describe, expect, it } from 'vitest'
import { moveExpectation } from '@/lib/wbs/moveExpectation'

const row = (id: string, sortOrder: number, parentId: string | null = 'p') => ({ id, parentId, sortOrder })

describe('moveExpectation', () => {
  const all = [row('c', 3), row('a', 1), row('b', 2), row('x', 2, 'other'), row('root', 1, null)]

  it('같은 부모의 sort_order 이웃을 싣는다 — 받은 순서(화면 정렬)와 무관하다', () => {
    expect(moveExpectation(row('b', 2), all, 'up')).toEqual({ parentId: 'p', sortOrder: 2, neighborId: 'a' })
    expect(moveExpectation(row('b', 2), all, 'down')).toEqual({ parentId: 'p', sortOrder: 2, neighborId: 'c' })
  })

  it('경계는 null — 서버도 이웃이 없어야 맞다', () => {
    expect(moveExpectation(row('a', 1), all, 'up').neighborId).toBeNull()
    expect(moveExpectation(row('c', 3), all, 'down').neighborId).toBeNull()
    expect(moveExpectation(row('root', 1, null), all, 'down')).toEqual({ parentId: null, sortOrder: 1, neighborId: null })
  })

  it('같은 sort_order 는 id 로 가른다(서버의 2차 정렬과 같다)', () => {
    const tied = [row('b', 1), row('a', 1), row('c', 1)]
    expect(moveExpectation(row('b', 1), tied, 'up').neighborId).toBe('a')
    expect(moveExpectation(row('b', 1), tied, 'down').neighborId).toBe('c')
  })

  it('형제 목록에 그 항목이 없으면 이웃을 싣지 않는다 — 서버는 부모·sort_order 만 대조한다', () => {
    expect(moveExpectation(row('b', 2), [], 'up')).toEqual({ parentId: 'p', sortOrder: 2 })
  })
})
