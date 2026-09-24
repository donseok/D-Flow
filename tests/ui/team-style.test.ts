import { describe, it, expect } from 'vitest'
import { teamStyle } from '@/components/wbs/shared'

const SLOTS = ['text-team-1', 'text-team-2', 'text-team-3', 'text-team-4', 'text-team-5']

describe('teamStyle — 팀 코드 무관 순번 팔레트', () => {
  it('임의 팀 코드도 팔레트 색을 받는다(중립 회색으로 떨어지지 않는다)', () => {
    for (const code of ['운영', 'Alpha', '생산', 'QA']) expect(SLOTS).toContain(teamStyle(code).fg)
  })
  it('같은 코드는 항상 같은 색', () => { expect(teamStyle('Alpha')).toEqual(teamStyle('Alpha')) })
  it('fg 와 bar 슬롯이 짝이 맞다', () => {
    const s = teamStyle('운영')
    expect(s.bar).toBe(s.fg.replace('text-', 'bg-'))
  })
  it('chip 도 같은 슬롯의 weak 배경 + 글자색이다', () => {
    const s = teamStyle('운영')
    expect(s.chip).toBe(`${s.bar}-weak ${s.fg}`)
  })
})
