import { describe, expect, it } from 'vitest'
import { isScopedQual } from '../../scripts/lib/rls-scope.mjs'

describe('isScopedQual — auth.uid() 단독 존재는 스코프가 아니다(리뷰 라운드 1)', () => {
  it("'auth.uid() is not null' 은 스코프 없음으로 판정한다(로그인만 확인, 행 소유자 비교 아님)", () => {
    expect(isScopedQual('auth.uid() is not null')).toBe(false)
  })
  it("'created_by = auth.uid()' 는 스코프로 인정한다(행 소유자 비교)", () => {
    expect(isScopedQual('created_by = auth.uid()')).toBe(true)
  })
  it("'auth.uid() = owner_id' 도 순서 무관하게 인정한다", () => {
    expect(isScopedQual('auth.uid() = owner_id')).toBe(true)
  })
  it('함수 호출 마커(accessible_project_ids 등)는 그대로 스코프로 인정한다', () => {
    expect(isScopedQual('(project_id IN ( SELECT accessible_project_ids() AS accessible_project_ids))')).toBe(true)
    expect(isScopedQual('public.is_ws_member(workspace_id)')).toBe(true)
  })
  it('마커가 하나도 없으면 스코프 없음', () => {
    expect(isScopedQual('true')).toBe(false)
    expect(isScopedQual(null)).toBe(false)
  })
})
