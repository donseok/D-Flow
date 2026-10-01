import { describe, expect, it } from 'vitest'
import { compareMyWork, decodeCursor, encodeCursor, mergeMyWork, openLeafIds, type MyWorkRow } from '@/lib/portal/myWork'

const r = (kind: MyWorkRow['kind'], id: string, due: string | null): MyWorkRow => ({ kind, id, due, title: id, projectId: 'p', projectName: 'P', overdueDays: null, status: 's', href: '/x' })

describe('내 업무 병합 규칙(§5.9)', () => {
  it('기한 오름차순, 기한 없음은 뒤, 같은 기한은 종류 순서(wbs·issue·approval·meeting) → id', () => {
    const rows = [r('meeting', 'm1', '2026-10-02'), r('wbs', 'w2', null), r('issue', 'i1', '2026-10-01'), r('wbs', 'w1', '2026-10-02')].sort(compareMyWork)
    expect(rows.map((x) => x.id)).toEqual(['i1', 'w1', 'm1', 'w2'])
  })
  it('커서 왕복·잘못된 커서는 처음부터', () => {
    const c = encodeCursor(r('issue', 'i9', null))
    expect(decodeCursor(c)).toEqual([null, 'issue', 'i9'])
    expect(decodeCursor('garbage')).toBeNull()
    expect(decodeCursor(null)).toBeNull()
    expect(decodeCursor(Buffer.from(JSON.stringify([1, 'issue', 'x'])).toString('base64url'))).toBeNull()
    expect(decodeCursor(Buffer.from(JSON.stringify([null, 'nope', 'x'])).toString('base64url'))).toBeNull()
  })
  it('원천 셋을 합쳐 커서 뒤 limit 행, 다음 커서는 마지막 행', () => {
    const a = [r('wbs', 'w1', '2026-10-01'), r('wbs', 'w2', '2026-10-03')]
    const b = [r('issue', 'i1', '2026-10-02'), r('issue', 'i2', null)]
    const p1 = mergeMyWork([a, b], null, 2)
    expect(p1.rows.map((x) => x.id)).toEqual(['w1', 'i1'])
    const p2 = mergeMyWork([a, b], p1.nextCursor, 2)
    expect(p2.rows.map((x) => x.id)).toEqual(['w2', 'i2'])
    expect(p2.nextCursor).toBeNull()                                                   // 마지막 쪽이 꽉 차도 빈 다음 쪽을 내지 않는다
    expect(mergeMyWork([a, b], encodeCursor(p2.rows[1]), 2)).toEqual({ rows: [], nextCursor: null })
  })
  it('WBS 미완료 = actual_pct null 이거나 100 미만, 리프(자식 없음)만', () => {
    const items = [{ id: 'a', actual_pct: null }, { id: 'b', actual_pct: 100 }, { id: 'c', actual_pct: 40 }, { id: 'd', actual_pct: 99.9 }]
    expect([...openLeafIds(items, new Set(['c']))].sort()).toEqual(['a', 'd'])
  })
})
