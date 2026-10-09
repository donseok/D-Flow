// searchUi 영어 사전 — ko 파일과 물리 분리(웹팩이 En 을 클라이언트 공통 청크에 싣지 않도록).
// 키 패리티는 import type 으로만 강제한다 — 값 import 를 넣으면 분리가 무효가 된다.
import type { searchUiKo } from './searchUi'

export const searchUiEn: Record<keyof typeof searchUiKo, string> = {
  'search.sub.project': 'Project',
  'search.sub.workspace': 'Workspace',
  'search.sub.settings': 'Settings',
  'search.sub.go': 'Go to',
  'search.sub.wbs': 'WBS task',
  'search.err.requestFailed': 'Could not send the search request. Check your connection.',
  'search.dialogAria': 'Global ⌘K title search',
  'search.placeholderProject': 'Search titles (menus, task names and codes in this project)...',
  'search.placeholderWorkspace': 'Search titles (menus, project names)...',
  'search.inputAria': 'Title search query',
  'search.clearInput': 'Clear input',
  'search.scopeLabel': 'Scope:',
  'search.scopeCurrentProject': 'Current project',
  'search.scopeWorkspace': 'Whole workspace',
  'search.titleOnly': 'Titles only',
  'search.err.failedTitle': 'Search failed',
  'search.err.notEmptySuffix': ' This does not mean there are no results.',
  'search.retry': 'Try again',
  'search.err.deniedTitle': 'You cannot search in this scope',
  'search.emptyTitle': 'No titles match ‘{q}’',
  'search.emptyDetailProject': 'Searched task names and codes in the current project.',
  'search.emptyDetailWorkspace': 'Searched project names in this workspace.',
  'search.hintMove': '↑↓ Move',
  'search.hintSelect': '↵ Select',
  'search.hintClose': 'ESC Close',
  'search.footer': '{product} Search v1',
}
