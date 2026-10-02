// 팀 화면 색 슬롯(SP4 D3·P1) — 저장 색이 팔레트의 i 번째면 category-(i+1), 아니면 팀 id 해시. code 로 찾을 때 목록 밖은 중립.
import { describe, expect, it } from 'vitest'
import { CATEGORY_SLOTS, NEUTRAL_SLOT, TEAM_PALETTE, pickTeamColor, teamSlot, teamSlotFor, teamSlotIndex } from '@/lib/domain/teamColor'

const id = (n: number) => `00000000-0000-0000-7e57-000000001a${n.toString(16).padStart(2, '0')}`

describe('teamSlot — 팔레트 자리 → category-N', () => {
  it('팔레트의 i 번째 색이면 category-(i+1) — 생성 순 다섯 팀이 서로 다르다', () => {
    expect(TEAM_PALETTE.map((color, i) => teamSlot({ id: id(i), color }).fg))
      .toEqual(['text-category-1', 'text-category-2', 'text-category-3', 'text-category-4', 'text-category-5'])
  })
  it('여섯째 팀(pickTeamColor(5))은 첫 팀과 같은 슬롯 — 배정이 순환한다', () => {
    expect(teamSlot({ id: id(6), color: pickTeamColor(5) })).toEqual(teamSlot({ id: id(1), color: pickTeamColor(0) }))
  })
  it('[RF1] 저장 색이 대문자·앞뒤 공백이어도 팔레트 자리를 찾는다', () => {
    expect(teamSlotIndex({ id: id(7), color: ' #4F46E5 ' })).toBe(1)
  })
  it('팔레트 밖 색(DB 기본값 #6b7280 포함)은 id 해시 — 같은 id 는 늘 같고 1~8 안, 한 슬롯으로 몰리지 않는다', () => {
    const a = teamSlotIndex({ id: id(8), color: '#6b7280' })
    expect(a).toBe(teamSlotIndex({ id: id(8), color: '#123456' }))
    expect(a).toBeGreaterThanOrEqual(1)
    expect(a).toBeLessThanOrEqual(8)
    expect(new Set(Array.from({ length: 16 }, (_, n) => teamSlotIndex({ id: id(16 + n), color: '#6b7280' }))).size).toBeGreaterThan(4)
  })
  it('클래스는 리터럴 여덟 벌(Tailwind JIT) — fg·bar·chip 이 같은 번호', () => {
    expect(CATEGORY_SLOTS).toHaveLength(8)
    CATEGORY_SLOTS.forEach((s, i) => expect(s).toEqual({
      fg: `text-category-${i + 1}`, bar: `bg-category-${i + 1}`, chip: `bg-category-${i + 1}-weak text-category-${i + 1}`,
    }))
  })
})

describe('teamSlotFor — code 로 찾기', () => {
  const teams = [{ id: id(10), code: 'RES', color: TEAM_PALETTE[1] }, { id: id(11), code: 'OPS', color: '#6b7280' }]
  it('목록 안이면 그 팀의 슬롯', () => {
    expect(teamSlotFor('RES', teams)).toEqual(CATEGORY_SLOTS[1])
    expect(teamSlotFor('OPS', teams)).toEqual(teamSlot(teams[1]))
  })
  it('[RF1] 목록 밖 code·빈 목록은 중립 — 슬롯을 지어내지 않는다', () => {
    expect(teamSlotFor('CIV', teams)).toBe(NEUTRAL_SLOT)
    expect(teamSlotFor('RES', [])).toBe(NEUTRAL_SLOT)
    expect(NEUTRAL_SLOT).toEqual({ fg: 'text-neutral', bar: 'bg-neutral', chip: 'bg-neutral-weak text-neutral' })
  })
  it('code 는 정확히 대조한다(담당·필터와 같은 규칙) — 대소문자가 다르면 다른 팀', () => {
    expect(teamSlotFor('res', teams)).toBe(NEUTRAL_SLOT)
  })
})
