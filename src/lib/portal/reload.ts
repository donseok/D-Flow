'use client'

/** 개인 숨김은 서버가 위젯·로더를 생략한다. 저장 이후 현재 URL을 다시 읽어 표시와 저장값을 일치시킨다. */
export function reloadPortalPage(): void {
  window.location.reload()
}
