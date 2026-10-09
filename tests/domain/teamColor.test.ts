// 팀 화면 색 슬롯(SP4 D3·P1) — 저장 색이 팔레트의 i 번째면 category-(i+1), 아니면 팀 id 해시. code 로 찾을 때 목록 밖은 중립.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CATEGORY_SLOTS, NEUTRAL_SLOT, TEAM_PALETTE, TEAM_SLOT_COUNT, pickTeamColor, teamColorOfSlot, teamSlot, teamSlotFor, teamSlotIndex } from '@/lib/domain/teamColor'

const id = (n: number) => `00000000-0000-0000-7e57-000000001a${n.toString(16).padStart(2, '0')}`

describe('teamSlot — 팔레트 자리 → category-N', () => {
  it('팔레트의 i 번째 색이면 category-(i+1) — 생성 순 여덟 팀이 서로 다르다', () => {
    expect(TEAM_PALETTE.map((color, i) => teamSlot({ id: id(i), color }).fg))
      .toEqual(['text-category-1', 'text-category-2', 'text-category-3', 'text-category-4', 'text-category-5', 'text-category-6', 'text-category-7', 'text-category-8'])
  })
  it('자동 배정은 여덟 색을 돈다 — 여섯째~여덟째 팀이 앞 팀과 겹치지 않고, 아홉째(pickTeamColor(8))부터 첫 팀과 같은 슬롯', () => {
    expect(new Set(Array.from({ length: 8 }, (_, n) => teamSlotIndex({ id: id(n), color: pickTeamColor(n) }))).size).toBe(8)
    expect(teamSlotIndex({ id: id(6), color: pickTeamColor(5) })).toBe(6)
    expect(teamSlot({ id: id(9), color: pickTeamColor(8) })).toEqual(teamSlot({ id: id(1), color: pickTeamColor(0) }))
    expect(pickTeamColor(-1)).toBe(TEAM_PALETTE[7])   // 음수 순번도 팔레트 안
  })
  it('팔레트 값은 소문자 hex 여덟 개이고 서로 다르다 — 슬롯 수 = 화면 슬롯(CATEGORY_SLOTS) 수', () => {
    expect(TEAM_SLOT_COUNT).toBe(CATEGORY_SLOTS.length)
    expect(new Set(TEAM_PALETTE).size).toBe(8)
    for (const hex of TEAM_PALETTE) expect(hex).toMatch(/^#[0-9a-f]{6}$/)
  })
  it('팔레트의 i 번째 값 = 테마 토큰 --color-category-(i+1) 의 라이트 값 — 저장 색과 화면 슬롯이 같은 색이다', () => {
    const css = readFileSync('src/app/globals.css', 'utf8')
    TEAM_PALETTE.forEach((hex, i) => {
      // 첫 선언이 라이트 값이다(다크·강제 라이트 블록은 그 뒤)
      const m = new RegExp(`--color-category-${i + 1}:\\s*(#[0-9A-Fa-f]{6})`).exec(css)
      expect(m?.[1].toLowerCase(), `category-${i + 1}`).toBe(hex)
    })
  })
  it('색 선택 — 슬롯 번호(1~8)를 저장 hex 로, 저장한 hex 는 같은 슬롯으로 되돌아온다(왕복). 범위 밖·정수가 아닌 값은 null', () => {
    for (let slot = 1; slot <= 8; slot++) {
      const hex = teamColorOfSlot(slot)!
      expect(teamSlotIndex({ id: id(40), color: hex })).toBe(slot)
    }
    for (const bad of [0, 9, -1, 1.5, Number.NaN, '3', null, undefined, '#4f46e5']) expect(teamColorOfSlot(bad)).toBeNull()
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
