// scripts/lib/rls-scope.mjs — "개방 읽기" 판정(순수). tests/rls/schema-invariants.test.ts 가 pg_policies.qual 에 쓴다.
// tests/rls 는 vitest.config.rls.ts(DB 필요)로만 돈다 — 이 판정 로직은 DB 없이도 tests/scripts 로 고정할 수 있게
// 여기 순수 모듈로 뽑았다(리뷰 라운드 1 — auth.uid() 단독 존재를 스코프로 오인하는 사례의 회귀 테스트용).
//
// 함수 호출 마커(accessible_project_ids 등)는 인자가 항상 그 행의 워크스페이스·프로젝트 id 라 존재만으로
// 스코프가 있다고 봐도 안전하다 — 그 함수들 자체가 "내가 접근 가능한 범위"를 반환하는 SECURITY DEFINER 판정이다.
// auth.uid() 는 다르다: `auth.uid() is not null`(로그인만 했으면 통과)도 이 문자열을 포함하지만 그 행의
// 소유자와 비교하지 않는다 — 실제 비교(대입)일 때만 스코프로 인정한다.
export const CALL_SCOPE_MARKERS = [
  'accessible_project_ids', 'my_workspace_ids', 'is_ws_member', 'is_ws_admin', 'can_read_project',
  'is_project_member', 'is_project_admin', 'is_superuser', 'can_attach', 'can_edit_issue',
]

// 어느 쪽이든(좌변·우변) auth.uid() 가 '=' 로 무언가와 비교되는 형태만 스코프로 인정한다.
const AUTH_UID_COMPARISON = /(=\s*auth\.uid\(\))|(\bauth\.uid\(\)\s*=)/

/** qual(정책 본문 텍스트) 이 스코프가 있는가 — 'true'(항상 열림) 판정은 호출부가 별도로 한다. */
export function isScopedQual(qual) {
  const text = String(qual ?? '')
  if (CALL_SCOPE_MARKERS.some((m) => text.includes(m))) return true
  return AUTH_UID_COMPARISON.test(text)
}
