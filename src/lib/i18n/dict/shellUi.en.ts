// shellUi 영어 사전 — ko 파일과 물리 분리(웹팩이 En 을 클라이언트 공통 청크에 싣지 않도록).
// 키 패리티는 import type 으로만 강제한다 — 값 import 를 넣으면 분리가 무효가 된다.
import type { shellUiKo } from './shellUi'

export const shellUiEn: Record<keyof typeof shellUiKo, string> = {
  // app/(app)/layout.tsx — 건너뛰기 링크
  'shell.skipToMain': 'Skip to main content',
  // AccountMenu.tsx
  'shell.account.guest': 'Guest',
  'shell.account.menuLabel': '{name} — account menu',
  'shell.account.dialog': 'Account',
  'shell.account.mine': 'My account',
  // AppShell.tsx
  'shell.configDegraded': 'Settings could not be loaded, so part of the menu is hidden.',
  'shell.openSettings': 'Open settings',
  // ContextBreadcrumb.tsx
  'shell.crumb.label': 'Current location',
  // DegradedNotice.tsx
  'shell.degraded.title': 'Some information could not be loaded',
  'shell.degraded.both': 'Permissions and the project list could not be read, so menus and lists may differ from the actual state. Your account and data have not changed — refresh shortly. If this continues, contact an admin.',
  'shell.degraded.actor': 'Permissions could not be read, so menus and lists may differ from the actual state. Your account and data have not changed — refresh shortly. If this continues, contact an admin.',
  'shell.degraded.projects': 'The project list could not be read, so menus and lists may differ from the actual state. Your account and data have not changed — refresh shortly. If this continues, contact an admin.',
  // GlobalBar.tsx
  'shell.bar.openMenu': 'Open menu',
  'shell.bar.home': '{name} home',
  'shell.bar.scopeMenu': '{name} — open menu',
  'shell.bar.searchAria': 'Global search (⌘K)',
  'shell.bar.searchHint': 'Search titles…',
  'shell.bar.searchTitle': 'Search titles',
  // MobileNavDrawer.tsx · ProjectNav.tsx
  'shell.drawer.label': 'Menu',
  'shell.drawer.close': 'Close menu',
  'shell.workspaceHome': 'Workspace home',
  // NavList.tsx
  'shell.sidebar.toggle': 'Collapse or expand sidebar',
  'shell.sidebar.collapse': 'Collapse sidebar',
  'shell.sidebar.expand': 'Expand sidebar',
  'shell.sidebar.fold': 'Collapse',
  // PresenceStrip.tsx
  'shell.presence.title': 'Viewing now: {names}',
  'shell.presence.me': '{name} (me)',
  // ProjectSwitcher.tsx
  'shell.status.ready': 'Ready',
  'shell.status.active': 'Active',
  'shell.status.done': 'Done',
  'shell.status.overdue': 'Overdue',
  'shell.status.unknown': 'Unknown',
  'shell.switcher.degraded': 'Settings could not be loaded, so the overview was opened',
  'shell.switcher.favorites': 'Favorites',
  'shell.switcher.recent': 'Recently visited',
  'shell.switcher.all': 'All',
  'shell.switcher.cannotOpen': 'This project cannot be opened',
  'shell.switcher.fallback': 'This project does not use {module}, so the overview was opened.',
  'shell.switcher.label': 'Switch project',
  'shell.switcher.noMatch': 'No matching projects',
  // WorkspaceSwitcher.tsx
  'shell.ws.viewingAsAdmin': 'Viewing as platform admin',
}
