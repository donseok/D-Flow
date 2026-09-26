import { describe, it, expect } from 'vitest'
import { pagePresenceTopic, weeklyPresenceTopic, PRESENCE_TOPIC_RE } from '@/lib/domain/presenceTopics'

const P = '22222222-2222-4222-8222-222222222222'
const R = '33333333-3333-4333-8333-333333333333'

describe('presenceTopics', () => {
  it('페이지 presence 토픽 형식', () => {
    const t = pagePresenceTopic(P, 'wbs-sheet')
    expect(t).toBe(`project-${P}-presence-wbs-sheet`)
    const m = PRESENCE_TOPIC_RE.exec(t)
    expect(m).not.toBeNull()
    expect(m?.[1]).toBe(P)
  })
  it('주간 보고 presence 토픽 형식', () => {
    const t = weeklyPresenceTopic(P, R)
    expect(t).toBe(`project-${P}-weekly-${R}-presence`)
    const m = PRESENCE_TOPIC_RE.exec(t)
    expect(m).not.toBeNull()
    expect(m?.[1]).toBe(P)
  })
  it('pageKey 가 규칙을 벗어나면 throw', () => {
    expect(() => pagePresenceTopic(P, '')).toThrow()
    expect(() => pagePresenceTopic(P, 'a'.repeat(41))).toThrow()
    expect(() => pagePresenceTopic(P, 'Not_Valid!')).toThrow()
  })
  it('pid·reportId 가 uuid 아니면 throw', () => {
    expect(() => pagePresenceTopic('not-a-uuid', 'wbs-sheet')).toThrow()
    expect(() => weeklyPresenceTopic('not-a-uuid', R)).toThrow()
    expect(() => weeklyPresenceTopic(P, 'not-a-uuid')).toThrow()
  })
  it('브로드캐스트 토픽(project-<pid>-wbs)은 매치하지 않는다', () => {
    expect(PRESENCE_TOPIC_RE.test(`project-${P}-wbs`)).toBe(false)
  })
})
