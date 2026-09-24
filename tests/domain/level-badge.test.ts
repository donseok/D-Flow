import { describe, expect, it } from 'vitest'
import { levelBadgeText, levelBadgeClass } from '@/components/wbs/shared'

const LEGACY_3 = ['Phase', 'Task', 'Activity']
describe('levelBadge (§4.4 depth 기반)', () => {
  it('레거시 3단 라벨(Phase·Task·Activity)에서 현행 배지 텍스트를 재현한다(회귀 0)', () => {
    expect(levelBadgeText(0, false, LEGACY_3)).toBe('PHASE')   // 현행 대문자 표기 유지
    expect(levelBadgeText(1, false, LEGACY_3)).toBe('TASK')
    expect(levelBadgeText(2, false, LEGACY_3)).toBe('ACT')     // 'Activity'→'ACT' 축약 규칙 유지
    expect(levelBadgeText(2, true, LEGACY_3)).toBe('SUB-ACT')
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
