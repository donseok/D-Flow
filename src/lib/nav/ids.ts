// 내비 항목의 안정 id(스펙 §4.5 — 24개)와 그룹. navigation.menu 의 parse 가 이 목록으로 검증한다. 메뉴 모델(navFor)·셸 항목(SHELL_NAV)은
// Phase B 의 src/lib/nav/registry.ts 다 — 그 파일이 이 타입을 다시 내보낸다. 순수 모듈.
import type { DictKey } from '@/lib/i18n/dict'

export type NavGroupId = 'ws.main' | 'ws.shared' | 'ws.ops' | 'ws.platform' | 'p.overview' | 'p.plan' | 'p.collab' | 'p.team' | 'p.settings'

export const NAV_ITEM_IDS = [
  'ws.home', 'ws.my_work', 'ws.projects',
  'ws.meetings', 'ws.minutes', 'ws.agents',
  'ws.portfolio', 'ws.usage', 'ws.members', 'ws.teams', 'ws.settings',
  'ws.llm', 'ws.ui_states',
  'p.dashboard',
  'p.wbs', 'p.issues', 'p.weekly',
  'p.meetings', 'p.wiki', 'p.announcements',
  'p.members', 'p.attendance', 'p.agents',
  'p.settings',
] as const
export type NavItemId = (typeof NAV_ITEM_IDS)[number]

export const NAV_GROUP_OF: Readonly<Record<NavItemId, NavGroupId>> = {
  'ws.home': 'ws.main', 'ws.my_work': 'ws.main', 'ws.projects': 'ws.main',
  'ws.meetings': 'ws.shared', 'ws.minutes': 'ws.shared', 'ws.agents': 'ws.shared',
  'ws.portfolio': 'ws.ops', 'ws.usage': 'ws.ops', 'ws.members': 'ws.ops', 'ws.teams': 'ws.ops', 'ws.settings': 'ws.ops',
  'ws.llm': 'ws.platform', 'ws.ui_states': 'ws.platform',
  'p.dashboard': 'p.overview',
  'p.wbs': 'p.plan', 'p.issues': 'p.plan', 'p.weekly': 'p.plan',
  'p.meetings': 'p.collab', 'p.wiki': 'p.collab', 'p.announcements': 'p.collab',
  'p.members': 'p.team', 'p.attendance': 'p.team', 'p.agents': 'p.team',
  'p.settings': 'p.settings',
}

/** 개정 §5.3.5 의 NavEntry — 모듈 레지스트리의 nav 필드와 SHELL_NAV(Phase B)가 쓴다 */
export interface NavEntry {
  id: NavItemId
  labelKey: DictKey
  icon: string
  /** 경로 조각. 브레드크럼·사용 현황 키·봇 딥링크가 같은 값을 쓴다 */
  segment: string
  group: NavGroupId
  order: number
}

const ID_SET: ReadonlySet<string> = new Set(NAV_ITEM_IDS)
export function isNavItemId(x: unknown): x is NavItemId {
  return typeof x === 'string' && ID_SET.has(x)
}
