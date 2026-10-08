import { describe, expect, it } from 'vitest'
import { activeNavItem, parseScopePath, projectSegmentModule } from '@/lib/nav/active'
import { navFor, type NavCaps } from '@/lib/nav/registry'
import { MODULE_IDS, type ModuleId } from '@/lib/modules/defaults'

const ALL: ReadonlySet<ModuleId> = new Set(MODULE_IDS)
const CAPS: NavCaps = { isPlatformAdmin: true, isWorkspaceAdmin: true, isProjectAdmin: true, canViewUsage: true, canViewPortfolio: true, canCreateProject: true }
const MENU = { order: [], labels: {} }
const ws = navFor({ scope: 'workspace', base: '/w/acme', effective: ALL, caps: CAPS, menu: MENU })
const pj = navFor({ scope: 'project', base: '/p/p1', effective: ALL, caps: CAPS, menu: MENU })

describe('parseScopePath', () => {
  it('범위·키·나머지 조각', () => {
    expect(parseScopePath('/w/acme/minutes/x?y=1')).toEqual({ scope: 'workspace', key: 'acme', base: '/w/acme', rest: ['minutes', 'x'] })
    expect(parseScopePath('/p/p1')).toEqual({ scope: 'project', key: 'p1', base: '/p/p1', rest: [] })
    expect(parseScopePath('/admin/llm-config')).toBeNull()
  })
})

describe('activeNavItem — 활성 항목은 하나(aria-current 근거)', () => {
  it('워크스페이스: 홈·조각·하위 경로(회의록 상세)', () => {
    expect(activeNavItem('/w/acme', ws)).toBe('ws.home')
    expect(activeNavItem('/w/acme/my-work?kind=issue', ws)).toBe('ws.my_work')
    expect(activeNavItem('/w/acme/minutes/00000000-0000-0000-7e57-000000001621', ws)).toBe('ws.minutes')
    expect(activeNavItem('/w/acme/admin/accounts', ws)).toBe('ws.members')
    expect(activeNavItem('/w/acme/admin/teams', ws)).toBe('ws.teams')
  })
  it('조각 둘인 항목은 전체 조각으로 가른다 — admin/accounts·admin/teams 의 첫 조각(admin)만으로는 고르지 않는다', () => {
    expect(activeNavItem('/w/acme/admin/teams/x', ws)).toBe('ws.teams')
    expect(activeNavItem('/w/acme/admin/accounts?project=p1', ws)).toBe('ws.members')
    expect(activeNavItem('/w/acme/admin', ws)).toBeNull()
  })
  it('프로젝트: 슬래시 조각(agents/office → agents, D31), routePrefixes 대응(gantt·import → p.wbs), 위키 주제 → p.wiki', () => {
    expect(activeNavItem('/p/p1/agents', pj)).toBe('p.agents')
    expect(activeNavItem('/p/p1/agents/office', pj)).toBe('p.agents')
    expect(activeNavItem('/p/p1/gantt', pj)).toBe('p.wbs')
    expect(activeNavItem('/p/p1/import', pj)).toBe('p.wbs')
    expect(activeNavItem('/p/p1/wiki/topics/t1', pj)).toBe('p.wiki')
    expect(activeNavItem('/p/p1/dashboard', pj)).toBe('p.dashboard')
  })
  it('내비에 없는 경로·범위 밖은 null(칸반은 nav 가 없다, 계정 등 (global) 경로는 활성 없음)', () => {
    expect(activeNavItem('/p/p1/kanban', pj)).toBeNull()
    expect(activeNavItem('/account', ws)).toBeNull()
    expect(activeNavItem('/admin', ws)).toBeNull()
    expect(activeNavItem('/admin/llm-configs', ws)).toBeNull()                    // 접두는 조각 경계까지
    expect(activeNavItem('/w/acme/nope', ws)).toBeNull()
  })
  it('플랫폼 운영 두 화면 — 절대 경로 항목은 범위 밖 경로의 접두로 고른다(/admin/llm-config·/admin/ui-states)', () => {
    expect(activeNavItem('/admin/llm-config', ws)).toBe('ws.llm')
    expect(activeNavItem('/admin/ui-states', ws)).toBe('ws.ui_states')
    expect(activeNavItem('/admin/ui-states?x=1', ws)).toBe('ws.ui_states')
    expect(activeNavItem('/admin/llm-config/x', ws)).toBe('ws.llm')
    // 플랫폼 관리자가 아니면 그 항목이 내비에 없다 → 고를 것이 없다(추측하지 않는다)
    const member = navFor({ scope: 'workspace', base: '/w/acme', effective: ALL, caps: { ...CAPS, isPlatformAdmin: false }, menu: MENU })
    expect(activeNavItem('/admin/llm-config', member)).toBeNull()
    // 범위 안 경로는 절대 경로 항목을 고르지 않는다
    expect(activeNavItem('/w/acme/admin/llm-config', ws)).toBeNull()
  })
  it('모듈이 꺼져 항목이 없으면 null(추측하지 않는다)', () => {
    const off = navFor({ scope: 'project', base: '/p/p1', effective: new Set<ModuleId>(['dashboard', 'wbs', 'members', 'settings']), caps: CAPS, menu: MENU })
    expect(activeNavItem('/p/p1/issues', off)).toBeNull()
  })
})

describe('projectSegmentModule', () => {
  it('routePrefixes 로 소유 모듈', () => {
    expect(projectSegmentModule('gantt')).toBe('wbs')
    expect(projectSegmentModule('kanban')).toBe('kanban')
    expect(projectSegmentModule('agents')).toBe('agents')
    expect(projectSegmentModule('nope')).toBeNull()
  })
})
