/**
 * 메뉴 모델(개정 §5.3.5, 스펙 §4.5) — 순수. 권한은 판정하지 않고 caps 로 받는다(판정은 domain/authz·authz/** 두 곳 규칙).
 * 모듈 항목 = 레지스트리의 nav(그 층의 모듈이 effective 에 있고 NAV_NEEDS 의 caps 를 가질 때), 셸 항목 = SHELL_NAV(needs 가 null 이거나 caps[needs]).
 * 그룹 안 순서 = navigation.menu.order(적힌 것이 적힌 순서로 앞, 나머지는 레지스트리 order), 라벨 = labels(없으면 { key }).
 * 빈 그룹은 내지 않는다. 그룹 순서는 NAV_GROUPS. href = base + '/' + segment('' 면 base, '/' 로 시작하면 절대 경로 — 플랫폼 항목 셋).
 * 숨김 설정은 없다 — 항목이 사라지는 길은 모듈 비활성과 caps 뿐이고 모듈 비활성은 requireModule 이 서버에서 막는다(메뉴와 서버 판정이 같은 원천).
 * 소비(Sidebar·HeaderChrome·모바일 드로어·브레드크럼·⌘K·사용 현황 키·봇 경로)는 SP3b 다(스펙 §10). p.agents 처럼 href ≠ 활성 접두인 항목의
 * 활성 판정은 소비처가 segment 첫 조각으로 파생한다.
 */
import type { DictKey } from '@/lib/i18n/dict'
import type { ModuleId } from '@/lib/modules/defaults'
import { MODULES } from '@/lib/modules/registry'
import type { NavMenuSetting } from '@/lib/settings/registry'
import type { NavEntry, NavGroupId, NavItemId } from './ids'

export type { NavEntry, NavGroupId, NavItemId } from './ids'

export interface NavCaps {
  isPlatformAdmin: boolean; isWorkspaceAdmin: boolean; isProjectAdmin: boolean
  canViewUsage: boolean; canViewPortfolio: boolean; canCreateProject: boolean
}
export type NavScope = 'workspace' | 'project'
export type ShellNavEntry = NavEntry & { scope: NavScope; needs: keyof NavCaps | null }
export interface NavItem { id: NavItemId; href: string; label: string | { key: DictKey }; icon: string }
export interface NavGroup { group: NavGroupId; items: NavItem[] }

export const NAV_GROUPS: readonly NavGroupId[] = ['ws.main', 'ws.shared', 'ws.ops', 'ws.platform', 'p.overview', 'p.plan', 'p.collab', 'p.team', 'p.settings']

/** 모듈 밖 셸 항목 — 전부 워크스페이스 층(프로젝트 층의 p.settings 는 core 모듈 settings 의 nav). ws.ops 는 모듈 항목(10·20) 뒤 30·40·50 */
export const SHELL_NAV: readonly ShellNavEntry[] = [
  { id: 'ws.home', labelKey: 'nav.home', icon: 'LayoutGrid', segment: '', group: 'ws.main', order: 10, scope: 'workspace', needs: null },
  { id: 'ws.my_work', labelKey: 'nav.myWork', icon: 'ListChecks', segment: 'my-work', group: 'ws.main', order: 20, scope: 'workspace', needs: null },
  { id: 'ws.projects', labelKey: 'nav.allProjects', icon: 'FolderOpen', segment: 'projects', group: 'ws.main', order: 30, scope: 'workspace', needs: null },
  { id: 'ws.members', labelKey: 'nav.wsMembers', icon: 'UserCog', segment: 'admin/accounts', group: 'ws.ops', order: 30, scope: 'workspace', needs: 'isWorkspaceAdmin' },
  { id: 'ws.teams', labelKey: 'nav.wsTeams', icon: 'Users', segment: 'admin/teams', group: 'ws.ops', order: 40, scope: 'workspace', needs: 'isWorkspaceAdmin' },
  { id: 'ws.settings', labelKey: 'nav.settings', icon: 'Settings', segment: 'settings', group: 'ws.ops', order: 50, scope: 'workspace', needs: 'isWorkspaceAdmin' },
  // 워크스페이스 목록·생성(개정 §5.3.2) — 아이콘은 표(navIcons)에 이미 있는 이름을 쓴다(프로젝트 층의 개요와 같은 그림이지만 워크스페이스 층 메뉴에는 하나뿐이다)
  { id: 'ws.workspaces', labelKey: 'nav.workspaces', icon: 'LayoutDashboard', segment: '/admin/workspaces', group: 'ws.platform', order: 5, scope: 'workspace', needs: 'isPlatformAdmin' },
  { id: 'ws.llm', labelKey: 'nav.llm', icon: 'Cpu', segment: '/admin/llm-config', group: 'ws.platform', order: 10, scope: 'workspace', needs: 'isPlatformAdmin' },
  { id: 'ws.ui_states', labelKey: 'nav.uiStates', icon: 'SwatchBook', segment: '/admin/ui-states', group: 'ws.platform', order: 20, scope: 'workspace', needs: 'isPlatformAdmin' },
]

/** 모듈 항목의 caps — NavEntry 에 필드를 더하지 않고 여기 둔다(스펙 §4.5) */
export const NAV_NEEDS: Readonly<Partial<Record<NavItemId, keyof NavCaps>>> = {
  'ws.portfolio': 'canViewPortfolio', 'ws.usage': 'canViewUsage', 'p.settings': 'isProjectAdmin',
}

function hrefOf(base: string, segment: string): string {
  if (segment.startsWith('/')) return segment
  return segment ? `${base}/${segment}` : base
}

export function navFor(input: { scope: NavScope; base: string; effective: ReadonlySet<ModuleId>; caps: NavCaps; menu: NavMenuSetting }): NavGroup[] {
  const { scope, base, effective, caps, menu } = input
  const allowedByCaps = (id: NavItemId) => { const need = NAV_NEEDS[id]; return !need || caps[need] }
  const visible: NavEntry[] = [
    ...MODULES.flatMap((m) => {
      const e = m.nav?.[scope]
      return e && effective.has(m.id) && allowedByCaps(e.id) ? [e] : []
    }),
    ...SHELL_NAV.filter((s) => s.scope === scope && (s.needs === null || caps[s.needs])),
  ]
  const rank = new Map<NavItemId, number>(menu.order.map((id, i) => [id, i]))
  const out: NavGroup[] = []
  for (const group of NAV_GROUPS) {
    const items = visible.filter((e) => e.group === group).sort((a, b) => {
      const ra = rank.get(a.id), rb = rank.get(b.id)
      if (ra !== undefined && rb !== undefined) return ra - rb
      if (ra !== undefined) return -1
      if (rb !== undefined) return 1
      return a.order - b.order
    })
    if (items.length === 0) continue
    out.push({ group, items: items.map((e) => ({ id: e.id, href: hrefOf(base, e.segment), label: menu.labels[e.id] ?? { key: e.labelKey }, icon: e.icon })) })
  }
  return out
}
