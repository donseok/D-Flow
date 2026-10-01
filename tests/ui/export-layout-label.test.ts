import { describe, expect, it } from 'vitest'
import { exportLayoutLabel } from '@/components/settings/exportLayout'
import { t } from '@/lib/i18n/dict'

const ko = (k: Parameters<typeof t>[1]) => t('ko', k)
describe('exportLayoutLabel — 내보내기 버튼 옆 표기(D48 — 조용한 대체가 아니다)', () => {
  it('표준 양식', () => {
    expect(exportLayoutLabel({ kind: 'standard' }, ko)).toBe('표준 양식(프로젝트 팀·단계로 생성)')
  })
  it('저장된 양식 — 날짜, 날짜를 모르면 그 사실', () => {
    expect(exportLayoutLabel({ kind: 'saved', savedAt: '2026-09-30' }, ko)).toBe('저장된 양식(임포트 마법사, 2026-09-30)')
    expect(exportLayoutLabel({ kind: 'saved', savedAt: null }, ko)).toBe('저장된 양식(임포트 마법사, 저장일 미상)')
  })
})
