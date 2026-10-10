'use client'

/** 홈 구성(위젯·순서·크기)·프로젝트 보기는 서버 렌더에, 즐겨찾기는 셸에 반영된다. 저장 뒤 현재 URL을 다시 읽어 서버 표시와 저장값을 맞춘다. */
export function reloadPortalPage(): void {
  window.location.reload()
}
