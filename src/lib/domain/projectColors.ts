/** 프로젝트 id → 결정적 점 색 클래스(포트폴리오·내 회의). 정렬된 프로젝트 id 목록 기준 인덱스 순환 —
 *  같은 데이터면 세션·리렌더와 무관하게 같은 색. 색은 분류 토큰(category-1~8)이다(SP5 B2 — D39) */
export const PROJECT_DOT_CLASSES = [
  'bg-category-1', 'bg-category-2', 'bg-category-3', 'bg-category-4',
  'bg-category-5', 'bg-category-6', 'bg-category-7', 'bg-category-8',
] as const

export function projectColorClass(projectIds: readonly string[], projectId: string): string {
  const sorted = [...projectIds].sort()
  const idx = sorted.indexOf(projectId)
  return PROJECT_DOT_CLASSES[(idx < 0 ? 0 : idx) % PROJECT_DOT_CLASSES.length]
}
