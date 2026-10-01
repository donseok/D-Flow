import { describe, expect, it } from 'vitest'
import { levelBadgeText, levelBadgeClass } from '@/components/wbs/shared'

const LEGACY_3 = ['Phase', 'Task', 'Activity']
describe('levelBadge (§4.4 depth 기반)', () => {
  it('단계 배지는 프로젝트 라벨 원문 — 옛 축약(PHASE·TASK·ACT)은 없다(SP4 §4.8)', () => {
    expect(levelBadgeText(0, false, LEGACY_3)).toBe('Phase')
    expect(levelBadgeText(1, false, LEGACY_3)).toBe('Task')
    expect(levelBadgeText(2, false, LEGACY_3)).toBe('Activity')
    expect(levelBadgeText(2, true, LEGACY_3)).toBe('SUB-ACT')
  })
  it('라벨이 프로토타입 이름이어도 그 글자 그대로', () => {
    expect(levelBadgeText(0, false, ['constructor', 'toString'])).toBe('constructor')
  })
  it('라벨 밖 깊이는 N단 폴백', () => {
    expect(levelBadgeText(3, false, LEGACY_3)).toBe('4단')
    expect(levelBadgeText(0, false, ['단계', '기능'])).toBe('단계')
  })
  it('색상은 depth 기반, sub는 별도', () => {
    expect(levelBadgeClass(0, false)).toContain('brand')
    expect(levelBadgeClass(2, true)).toContain('surface-2')
  })
})
