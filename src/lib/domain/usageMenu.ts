import type { DictKey } from '@/lib/i18n/dict'
import type { NavItemId } from '@/lib/nav/ids'
import { parseScopePath, projectSegmentModule } from '@/lib/nav/active'
import { MODULES } from '@/lib/modules/registry'

/**
 * 사용 현황 집계의 메뉴 정본 목록.
 * 사이드바(projectMenu)와 전역 링크를 반영하되 **메뉴에서 내린 화면도 남긴다** — 이 목록은
 * 현재 메뉴가 아니라 과거 사용 이벤트를 읽는 사전이라, 지우면 지난 기록이 이름을 잃는다.
 * (admin-accounts·wiki 가 그런 항목이다. '고아 엔트리'로 보고 정리하지 말 것.)
 * 여기 없는 경로는 'unknown' 으로
 * 모이며 가까운 메뉴로 추측해 붙이지 않는다(리포의 "모르면 unknown" 관례).
 * labelKey 가 null 인 항목은 i18n 사전이 없는 /admin/* 이다 — 관리자 화면은 한국어 하드코딩.
 * 경로 → 키 판정은 내비 레지스트리·모듈 레지스트리에서 파생한다(SP3b D27 — 경로 표를 손으로 늘리지 않는다).
 * 'projects' 키의 옛 의미('/projects = 홈')는 라벨만 '전체 프로젝트' 로 바뀌었다 — 홈은 새 키 'ws-home'.
 */
export interface UsageMenu {
  key: string
  labelKey: DictKey | null
  fallback: string
}

export const USAGE_MENUS: readonly UsageMenu[] = [
  { key: 'ws-home', labelKey: 'nav.home', fallback: '홈' },
  { key: 'my-work', labelKey: 'nav.myWork', fallback: '내 업무' },
  { key: 'dashboard', labelKey: 'nav.dashboard', fallback: '대시보드' },
  { key: 'wbs', labelKey: 'nav.wbsGantt', fallback: 'WBS · 간트' },
  { key: 'kanban', labelKey: 'nav.kanban', fallback: '칸반 보드' },
  { key: 'meetings', labelKey: 'nav.meetings', fallback: '회의일정' },
  { key: 'weekly', labelKey: 'nav.weekly', fallback: '주간업무' },
  { key: 'issues', labelKey: 'nav.issues', fallback: '이슈관리' },
  { key: 'wiki', labelKey: 'nav.wiki', fallback: '프로젝트 Wiki' },
  { key: 'announcements', labelKey: 'nav.announcements', fallback: '공지사항' },
  { key: 'members', labelKey: 'nav.members', fallback: '멤버' },
  { key: 'attendance', labelKey: 'nav.attendance', fallback: '근태현황' },
  { key: 'agents', labelKey: 'nav.projectAgents', fallback: '에이전트' },
  { key: 'settings', labelKey: 'nav.settings', fallback: '설정' },
  { key: 'my-meetings', labelKey: 'nav.myMeetings', fallback: '내 회의' },
  { key: 'minutes', labelKey: 'nav.minutes', fallback: '회의록' },
  { key: 'projects', labelKey: 'nav.allProjects', fallback: '전체 프로젝트' },
  { key: 'usage', labelKey: 'nav.usage', fallback: '사용 현황' },
  { key: 'portfolio', labelKey: 'nav.portfolio', fallback: '포트폴리오' },
  { key: 'seatmap', labelKey: 'nav.agents', fallback: '전체 스튜디오' },
  { key: 'admin-accounts', labelKey: null, fallback: '계정 관리' },
  { key: 'admin-teams', labelKey: null, fallback: '팀 관리' },
  { key: 'admin-llm', labelKey: null, fallback: 'LLM 설정' },
  { key: 'unknown', labelKey: null, fallback: '기타' },
] as const

/** 항목 id → 사용 현황 키(D27) — 기존 키를 그대로 써 과거 집계와 이어진다. 새 키는 ws-home·my-work 둘. 표에 없는 id 는 타입 오류 */
export const USAGE_KEY_OF: Readonly<Record<NavItemId, string>> = {
  'ws.home': 'ws-home', 'ws.my_work': 'my-work', 'ws.projects': 'projects',
  'ws.meetings': 'my-meetings', 'ws.minutes': 'minutes', 'ws.agents': 'seatmap',
  'ws.portfolio': 'portfolio', 'ws.usage': 'usage', 'ws.members': 'admin-accounts', 'ws.teams': 'admin-teams', 'ws.settings': 'settings',
  'ws.workspaces': 'unknown', 'ws.llm': 'admin-llm', 'ws.ui_states': 'unknown',                  // 플랫폼 진단 화면 — 집계 키를 늘리지 않는다(새 키는 둘뿐, 스펙 §5.7)
  'p.dashboard': 'dashboard', 'p.wbs': 'wbs', 'p.issues': 'issues', 'p.weekly': 'weekly',
  'p.meetings': 'meetings', 'p.wiki': 'wiki', 'p.announcements': 'announcements',
  'p.members': 'members', 'p.attendance': 'attendance', 'p.agents': 'agents', 'p.settings': 'settings',
}
/** 워크스페이스 경로의 첫 조각 → 항목 id(SHELL_NAV·모듈 nav.workspace 의 segment 에서 파생) */
const WS_SEGMENT: ReadonlyMap<string, NavItemId> = new Map<string, NavItemId>([
  ['', 'ws.home'], ['my-work', 'ws.my_work'], ['projects', 'ws.projects'], ['settings', 'ws.settings'],
  ...MODULES.flatMap((m) => (m.nav?.workspace ? [[m.nav.workspace.segment.split('/')[0], m.nav.workspace.id] as [string, NavItemId]] : [])),
])
/** 옛 전역 경로(역사 데이터) — 새 경로와 같은 키를 낸다. 영구 표(route-literals 영구 항목) */
const LEGACY_KEY: ReadonlyArray<readonly [string, string]> = [
  ['/projects', 'projects'], ['/meetings', 'my-meetings'], ['/minutes', 'minutes'], ['/usage', 'usage'], ['/portfolio', 'portfolio'],
  ['/agents', 'seatmap'], ['/admin/accounts', 'admin-accounts'], ['/admin/teams', 'admin-teams'], ['/admin/llm-config', 'admin-llm'],
]

/** 쿼리스트링·해시·끝 슬래시를 제거한 경로. */
function bare(pathname: string): string {
  const p = pathname.split('?')[0].split('#')[0]
  return p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p
}

/**
 * 경로 → 메뉴 키. 모르면 'unknown'(추측 금지). 새 경로(/w/<s>/…·/p/<id>/…)는 레지스트리에서 파생하고, 옛 전역 경로는 역사 표로 읽는다.
 * 내비 항목을 더하고 USAGE_KEY_OF 를 안 고치면 타입이 깨진다.
 */
export function resolveMenuKey(pathname: string): string {
  const p = bare(pathname)
  const scope = parseScopePath(p)
  if (scope?.scope === 'project') {
    const owner = projectSegmentModule(scope.rest[0] ?? '')
    if (!owner) return 'unknown'
    const navId = MODULES.find((m) => m.id === owner)?.nav?.project?.id
    return navId ? USAGE_KEY_OF[navId] : USAGE_MENUS.some((m) => m.key === owner) ? owner : 'unknown'   // nav 없는 칸반 = 'kanban'
  }
  if (scope?.scope === 'workspace') {
    const seg = scope.rest[0] ?? ''
    const id = seg === 'admin'
      ? (scope.rest[1] === 'teams' ? 'ws.teams' : scope.rest[1] === 'accounts' ? 'ws.members' : undefined)
      : WS_SEGMENT.get(seg)
    return id ? USAGE_KEY_OF[id] : 'unknown'
  }
  for (const [prefix, key] of LEGACY_KEY) if (p === prefix || p.startsWith(prefix + '/')) return key
  return 'unknown'
}

/** 저장용 경로 — UUID 를 ':id' 로 접고 200자로 자른다(카디널리티·행 크기 제한). */
export function normalizeUsagePath(pathname: string): string {
  return bare(pathname)
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
    .slice(0, 200)
}

/** 프로젝트 스코프 경로의 프로젝트 id. 전역 경로면 null. */
export function extractProjectId(pathname: string): string | null {
  const m = bare(pathname).match(
    /^\/p\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i,
  )
  return m ? m[1] : null
}

/** 메뉴 키의 표시 라벨. 정의에 없는 키는 키 자체를 돌려준다(임의 한국어 생성 금지). */
export function menuLabel(key: string, translate: (k: DictKey) => string): string {
  const m = USAGE_MENUS.find(x => x.key === key)
  if (!m) return key
  return m.labelKey ? translate(m.labelKey) : m.fallback
}
