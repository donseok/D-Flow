import { describe, it, expect } from 'vitest'
import { canSee, manualChapter, manualChapters, visibleChapters } from '@/lib/manual/chapters'
import { MANUAL_AUDIENCES, audienceRank } from '@/lib/manual/parse'

describe('canSee', () => {
  it('보는 사람 등급이 장 등급 이상일 때만 보인다(4×4)', () => {
    const want = [
      // 장:        member projectAdmin workspaceAdmin platformAdmin
      /* member */ [true, false, false, false],
      /* projectAdmin */ [true, true, false, false],
      /* workspaceAdmin */ [true, true, true, false],
      /* platformAdmin */ [true, true, true, true],
    ]
    MANUAL_AUDIENCES.forEach((viewer, i) => {
      MANUAL_AUDIENCES.forEach((chapter, j) => {
        expect(canSee(viewer, chapter), `${viewer} → ${chapter}`).toBe(want[i][j])
      })
    })
  })
})

describe('manualChapter', () => {
  it('slug 로 찾고, 없으면 undefined', () => {
    expect(manualChapter('getting-started')).toMatchObject({ slug: 'getting-started', audience: 'member' })
    expect(manualChapter('faq')?.slug).toBe('faq')
    expect(manualChapter('없는-장')).toBeUndefined()
    expect(manualChapter('')).toBeUndefined()
  })
})

describe('manualChapters·visibleChapters', () => {
  it('장은 order 오름차순이다', () => {
    const orders = manualChapters().map((c) => c.order)
    expect(orders).toEqual([...orders].sort((a, b) => a - b))
  })
  it('멤버에게는 멤버용 장(맛보기 둘 포함)만 보이고 순서를 지킨다', () => {
    const v = visibleChapters('member')
    expect(v.map((c) => c.slug)).toEqual(expect.arrayContaining(['getting-started', 'faq']))
    for (const c of v) expect(c.audience).toBe('member')
    expect(v.map((c) => c.order)).toEqual([...v.map((c) => c.order)].sort((a, b) => a - b))
  })
  it('등급이 오를수록 보이는 장이 줄지 않고, 플랫폼 관리자는 전부 본다', () => {
    const counts = MANUAL_AUDIENCES.map((a) => visibleChapters(a).length)
    expect(counts).toEqual([...counts].sort((a, b) => a - b))
    expect(visibleChapters('platformAdmin')).toHaveLength(manualChapters().length)
  })
  it('보이는 장은 모두 보는 사람 등급 이하다', () => {
    for (const viewer of MANUAL_AUDIENCES) {
      for (const c of visibleChapters(viewer)) expect(audienceRank(c.audience)).toBeLessThanOrEqual(audienceRank(viewer))
    }
  })
})
