// 셸(src/components/app/**)의 화면 문구 — 컴포넌트에 박혀 있던 한국어 리터럴을 옮긴 것이다(ko 글자는 옮기기 전 그대로).
// 모음에는 adminUi 가 펼쳐 싣는다.
export const shellUiKo = {
  // app/(app)/layout.tsx — 건너뛰기 링크
  'shell.skipToMain': '본문 바로가기',
  // AccountMenu.tsx
  'shell.account.guest': '게스트',
  'shell.account.menuLabel': '{name} — 계정 메뉴',
  'shell.account.dialog': '계정',
  'shell.account.mine': '내 계정',
  // AppShell.tsx
  'shell.configDegraded': '설정을 불러오지 못해 메뉴 일부를 숨겼습니다.',
  'shell.openSettings': '설정 열기',
  // ContextBreadcrumb.tsx
  'shell.crumb.label': '현재 위치',
  // DegradedNotice.tsx
  'shell.degraded.title': '일부 정보를 불러오지 못했습니다',
  'shell.degraded.both': '권한과 프로젝트 목록을 읽지 못해 메뉴·목록이 실제와 다르게 보일 수 있습니다. 계정이나 데이터가 바뀐 것이 아니니 잠시 뒤 새로고침하세요. 계속되면 관리자에게 알려 주세요.',
  'shell.degraded.actor': '권한 정보를 읽지 못해 메뉴·목록이 실제와 다르게 보일 수 있습니다. 계정이나 데이터가 바뀐 것이 아니니 잠시 뒤 새로고침하세요. 계속되면 관리자에게 알려 주세요.',
  'shell.degraded.projects': '프로젝트 목록을 읽지 못해 메뉴·목록이 실제와 다르게 보일 수 있습니다. 계정이나 데이터가 바뀐 것이 아니니 잠시 뒤 새로고침하세요. 계속되면 관리자에게 알려 주세요.',
  // GlobalBar.tsx
  'shell.bar.openMenu': '메뉴 열기',
  'shell.bar.home': '{name} 홈',
  'shell.bar.scopeMenu': '{name} — 메뉴 열기',
  'shell.bar.searchAria': '전역 검색 (⌘K)',
  'shell.bar.searchHint': '제목 검색...',
  'shell.bar.searchTitle': '제목 검색',
  // MobileNavDrawer.tsx · ProjectNav.tsx
  'shell.drawer.label': '메뉴',
  'shell.drawer.close': '메뉴 닫기',
  'shell.workspaceHome': '워크스페이스 홈',
  // NavList.tsx
  'shell.sidebar.toggle': '사이드바 접기·펼치기',
  'shell.sidebar.collapse': '사이드바 접기',
  'shell.sidebar.expand': '사이드바 펼치기',
  'shell.sidebar.fold': '접기',
  // PresenceStrip.tsx
  'shell.presence.title': '함께 보는 중: {names}',
  'shell.presence.me': '{name} (나)',
  // ProjectSwitcher.tsx
  'shell.status.ready': '준비',
  'shell.status.active': '진행',
  'shell.status.done': '완료',
  'shell.status.overdue': '지연',
  'shell.status.unknown': '확인 불가',
  'shell.switcher.degraded': '설정을 불러오지 못해 개요를 열었습니다',
  'shell.switcher.favorites': '즐겨찾기',
  'shell.switcher.recent': '최근 방문',
  'shell.switcher.all': '전체',
  'shell.switcher.cannotOpen': '이 프로젝트를 열 수 없습니다',
  'shell.switcher.fallback': '이 프로젝트에서는 {module} 사용하지 않아 개요를 열었습니다.',
  'shell.switcher.label': '프로젝트 전환',
  'shell.switcher.noMatch': '일치하는 프로젝트가 없습니다',
  // WorkspaceSwitcher.tsx
  'shell.ws.viewingAsAdmin': '플랫폼 관리자로 보는 중',
} as const
