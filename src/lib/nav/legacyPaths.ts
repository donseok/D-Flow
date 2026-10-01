// 옛 정보 구조(IA)의 경로 — SP3a 설정 화면이 새로 쓴 옛 경로를 한 곳에 모은다. SP3b UI-2 가 워크스페이스 경로(/w/<slug>/…)로
// 옮길 때 이 상수 하나만 바꾸면 되게 한다(SP3b 스펙 §2.4 알림 13). 새 경로는 nav/registry.ts 가 낸다 — 이 파일은 옛 것만.
export const LEGACY_PATHS = Object.freeze({
  /** 프로젝트 목록(옛 홈). 워크스페이스 설정의 비관리자 리디렉트 대상 */
  projects: '/projects',
  /** 공용 팀 관리(플랫폼 관리자 전용). 워크스페이스 설정 '초대' 범주의 안내 링크 */
  adminTeams: '/admin/teams',
} as const)
