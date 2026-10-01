/**
 * 모듈 레지스트리(정본 §3.2.1·§3.2.2) — 정적 매니페스트 17개. 이벤트 버스·DI·동적 import 없음. 필드는 정확히 10개.
 * 모듈 → 설정은 값 import(설정 정의를 settings 필드가 참조), 설정 → 모듈은 타입만(ModuleId 는 잎 파일 defaults.ts).
 * envAvailable 은 flags.ts 술어만 부른다 — 이 파일은 env 를 직접 읽지 않는다(tests/modules/registry.test.ts).
 */
import type { BotDomain } from '@/lib/ai/chat/protocol'
import type { NavEntry } from '@/lib/nav/ids'
import { PROJECT_SETTINGS, WORKSPACE_SETTINGS, assertRegistry, type SettingDef } from '@/lib/settings/registry'
import { CORE_MODULES, MODULE_IDS, type ModuleId } from './defaults'
import { chatV2Enabled, minutesApiEnabled, wikiServiceEnabled } from './flags'
import { closeRequires } from './closure'

export interface ModuleDef {
  id: ModuleId
  core: boolean                              // true = 늘 effective. allowed/enabled 로 끌 수 없다
  scope: 'project' | 'workspace' | 'both'
  nav: { project?: NavEntry; workspace?: NavEntry } | null   // null = 메뉴 없음(개정 §5.3.5 형태)
  routePrefixes: readonly string[]           // 세그먼트 패턴. 페이지 관문(Phase B)이 모듈을 정할 때 쓴다
  apiPrefixes: readonly string[]             // 라우트 파일 경로 접두. 열거 게이트가 대조한다
  requires: readonly ModuleId[]              // 닫힘 규칙. 순환은 assertModules 가 막는다
  envAvailable: () => boolean                // 배포 가용 — flags.ts 술어만. LLM 존재는 여기 아님(hasLLM 은 호출 시점)
  botDomains: readonly BotDomain[]
  settings: readonly SettingDef[]            // 소유 설정 키
}

const settingsOf = (id: ModuleId): SettingDef[] => [...WORKSPACE_SETTINGS, ...PROJECT_SETTINGS].filter((d) => d.module === id)
const always = () => true

// 아이콘 이름은 Sidebar.tsx 의 lucide 컴포넌트 이름과 같다 — navFor 소비처(SP3b)가 이름 → 컴포넌트 표를 갖는다
export const MODULES: readonly ModuleDef[] = [
  { id: 'dashboard', core: true, scope: 'project', requires: [], envAvailable: always, botDomains: ['dashboard'], settings: settingsOf('dashboard'),
    nav: { project: { id: 'p.dashboard', labelKey: 'nav.dashboard', icon: 'LayoutDashboard', segment: 'dashboard', group: 'p.overview', order: 10 } },
    routePrefixes: ['/p/[projectId]/dashboard'], apiPrefixes: [] },
  { id: 'wbs', core: true, scope: 'project', requires: [], envAvailable: always, botDomains: ['wbs'], settings: settingsOf('wbs'),
    nav: { project: { id: 'p.wbs', labelKey: 'nav.wbsGantt', icon: 'ListTree', segment: 'wbs', group: 'p.plan', order: 10 } },
    routePrefixes: ['/p/[projectId]/wbs', '/p/[projectId]/gantt', '/p/[projectId]/import'], apiPrefixes: ['/api/export', '/api/import'] },
  { id: 'members', core: true, scope: 'project', requires: [], envAvailable: always, botDomains: ['members'], settings: settingsOf('members'),
    nav: { project: { id: 'p.members', labelKey: 'nav.members', icon: 'Users', segment: 'members', group: 'p.team', order: 10 } },
    routePrefixes: ['/p/[projectId]/members'], apiPrefixes: [] },
  { id: 'settings', core: true, scope: 'project', requires: [], envAvailable: always, botDomains: ['settings'], settings: settingsOf('settings'),
    nav: { project: { id: 'p.settings', labelKey: 'nav.settings', icon: 'Settings', segment: 'settings', group: 'p.settings', order: 10 } },
    routePrefixes: ['/p/[projectId]/settings'], apiPrefixes: [] },
  { id: 'kanban', core: false, scope: 'project', requires: ['wbs'], envAvailable: always, botDomains: ['kanban'], settings: settingsOf('kanban'),
    nav: null, routePrefixes: ['/p/[projectId]/kanban'], apiPrefixes: [] },
  { id: 'meetings', core: false, scope: 'both', requires: [], envAvailable: always, botDomains: ['meetings'], settings: settingsOf('meetings'),
    nav: { project: { id: 'p.meetings', labelKey: 'nav.meetings', icon: 'CalendarClock', segment: 'meetings', group: 'p.collab', order: 10 },
      workspace: { id: 'ws.meetings', labelKey: 'nav.myMeetings', icon: 'CalendarClock', segment: 'meetings', group: 'ws.shared', order: 10 } },
    routePrefixes: ['/p/[projectId]/meetings', '/w/[slug]/meetings'], apiPrefixes: [] },
  { id: 'weekly', core: false, scope: 'project', requires: [], envAvailable: always, botDomains: ['weekly'], settings: settingsOf('weekly'),
    nav: { project: { id: 'p.weekly', labelKey: 'nav.weekly', icon: 'NotebookPen', segment: 'weekly', group: 'p.plan', order: 30 } },
    routePrefixes: ['/p/[projectId]/weekly'], apiPrefixes: ['/api/report'] },
  { id: 'issues', core: false, scope: 'project', requires: [], envAvailable: always, botDomains: ['issues'], settings: settingsOf('issues'),
    nav: { project: { id: 'p.issues', labelKey: 'nav.issues', icon: 'CircleAlert', segment: 'issues', group: 'p.plan', order: 20 } },
    routePrefixes: ['/p/[projectId]/issues'], apiPrefixes: ['/api/issue-analysis'] },   // 스펙 E16 — SP5 가 issue_analysis 모듈로 옮긴다
  { id: 'wiki', core: false, scope: 'project', requires: ['minutes'], envAvailable: () => wikiServiceEnabled(), botDomains: ['wiki'], settings: settingsOf('wiki'),
    nav: { project: { id: 'p.wiki', labelKey: 'nav.wiki', icon: 'BookOpenText', segment: 'wiki', group: 'p.collab', order: 20 } },
    routePrefixes: ['/p/[projectId]/wiki'], apiPrefixes: ['/api/wiki'] },
  { id: 'announcements', core: false, scope: 'project', requires: [], envAvailable: always, botDomains: ['announcements'], settings: settingsOf('announcements'),
    nav: { project: { id: 'p.announcements', labelKey: 'nav.announcements', icon: 'Megaphone', segment: 'announcements', group: 'p.collab', order: 30 } },
    routePrefixes: ['/p/[projectId]/announcements'], apiPrefixes: [] },
  { id: 'attendance', core: false, scope: 'project', requires: [], envAvailable: always, botDomains: ['attendance'], settings: settingsOf('attendance'),
    nav: { project: { id: 'p.attendance', labelKey: 'nav.attendance', icon: 'CalendarCheck', segment: 'attendance', group: 'p.team', order: 20 } },
    routePrefixes: ['/p/[projectId]/attendance'], apiPrefixes: [] },
  { id: 'agents', core: false, scope: 'both', requires: ['wbs'], envAvailable: always, botDomains: [], settings: settingsOf('agents'),
    nav: { project: { id: 'p.agents', labelKey: 'nav.projectAgents', icon: 'Bot', segment: 'agents/office', group: 'p.team', order: 30 },
      workspace: { id: 'ws.agents', labelKey: 'nav.agents', icon: 'Bot', segment: 'agents', group: 'ws.shared', order: 30 } },
    routePrefixes: ['/p/[projectId]/agents', '/w/[slug]/agents'], apiPrefixes: ['/api/v1/agent', '/api/v1/wbs'] },
  { id: 'minutes', core: false, scope: 'workspace', requires: [], envAvailable: always, botDomains: ['minutes'], settings: settingsOf('minutes'),
    nav: { workspace: { id: 'ws.minutes', labelKey: 'nav.minutes', icon: 'FileText', segment: 'minutes', group: 'ws.shared', order: 20 } },
    routePrefixes: ['/w/[slug]/minutes'], apiPrefixes: ['/api/minutes'] },
  { id: 'minutes_integration', core: false, scope: 'workspace', requires: ['minutes'], envAvailable: () => minutesApiEnabled(), botDomains: [], settings: settingsOf('minutes_integration'),
    nav: null, routePrefixes: [], apiPrefixes: ['/api/v1/minutes'] },
  { id: 'chatbot', core: false, scope: 'both', requires: [], envAvailable: () => chatV2Enabled(), botDomains: [], settings: settingsOf('chatbot'),
    nav: null, routePrefixes: [], apiPrefixes: ['/api/chat', '/api/cron/ai-index'] },
  { id: 'portfolio', core: false, scope: 'workspace', requires: [], envAvailable: always, botDomains: [], settings: settingsOf('portfolio'),
    nav: { workspace: { id: 'ws.portfolio', labelKey: 'nav.portfolio', icon: 'Briefcase', segment: 'portfolio', group: 'ws.ops', order: 10 } },
    routePrefixes: ['/portfolio'], apiPrefixes: [] },
  { id: 'usage', core: false, scope: 'workspace', requires: [], envAvailable: always, botDomains: [], settings: settingsOf('usage'),
    nav: { workspace: { id: 'ws.usage', labelKey: 'nav.usage', icon: 'BarChart3', segment: 'usage', group: 'ws.ops', order: 20 } },
    routePrefixes: ['/usage'], apiPrefixes: ['/api/track'] },
]

const BY_ID = new Map(MODULES.map((m) => [m.id, m]))
export function moduleDef(id: ModuleId): ModuleDef {
  const m = BY_ID.get(id)
  if (!m) throw new Error(`모듈 레지스트리: 모르는 모듈 ${String(id)}`)
  return m
}
export const CORE: ReadonlySet<ModuleId> = new Set(MODULES.filter((m) => m.core).map((m) => m.id))

/** 경로 이동(SP3b) 전의 전역 경로 — 페이지 관문이 워크스페이스 층 모듈을 찾는 표. SP3b 가 /w/[slug]/* 로 옮기며 지운다 */
export const LEGACY_GLOBAL_PREFIXES = {
  '/portfolio': 'portfolio', '/usage': 'usage',
} as const satisfies Record<string, ModuleId>

/** 적재 단언(개정 §2.7.1) — 목록 = MODULE_IDS, core 는 requires: []·envAvailable 상수 true, requires 는 등록 id 이고 순환 없음,
 *  nav 항목의 층이 scope 와 맞음, 설정 14키가 소유 모듈에 한 번씩. 설정 레지스트리의 모듈 소속도 여기서 본다(컨트롤러 판정). */
export function assertModules(): void {
  const ids = MODULES.map((m) => m.id)
  if (ids.join(',') !== MODULE_IDS.join(',')) throw new Error('모듈 레지스트리: 목록이 MODULE_IDS 와 다르다')
  for (const m of MODULES) {
    if (m.core !== CORE_MODULES.includes(m.id)) throw new Error(`모듈 레지스트리: core 표시가 CORE_MODULES 와 다르다 ${m.id}`)
    if (m.core && m.requires.length) throw new Error(`모듈 레지스트리: core 모듈은 requires 가 비어야 한다 ${m.id}`)
    if (m.core && m.envAvailable !== always) throw new Error(`모듈 레지스트리: core 모듈의 envAvailable 은 상수 true 다 ${m.id}`)
    for (const r of m.requires) if (!BY_ID.has(r)) throw new Error(`모듈 레지스트리: requires 에 모르는 모듈 ${r} (${m.id})`)
    if (m.nav?.project && m.scope === 'workspace') throw new Error(`모듈 레지스트리: workspace 모듈에 project nav ${m.id}`)
    if (m.nav?.workspace && m.scope === 'project') throw new Error(`모듈 레지스트리: project 모듈에 workspace nav ${m.id}`)
  }
  // 순환: 전체 집합을 닫아도 아무것도 빠지지 않아야 한다. 자기 참조·상호 참조는 모두 여기서 빠진다
  const all = new Set(ids)
  if (closeRequires(all, (id) => moduleDef(id).requires).size !== all.size) throw new Error('모듈 레지스트리: requires 가 순환하거나 닫히지 않는다')
  const owned = MODULES.flatMap((m) => m.settings.map((s) => s.key))
  const declared = [...WORKSPACE_SETTINGS, ...PROJECT_SETTINGS].map((d) => d.key)
  if (owned.length !== declared.length || declared.some((k) => !owned.includes(k))) throw new Error('모듈 레지스트리: 설정 키의 소유가 어긋난다')
  assertRegistry({ moduleIds: MODULE_IDS })
}

assertModules()
