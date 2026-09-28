// navFor(스펙 §4.5, 개정 §5.3.5) — 순수 함수의 조합 테스트. SP3b 가 셸 소비 케이스를 같은 파일에 덧붙인다(스펙 §10.1) —
// 이 파일의 describe 는 '순수 함수' 로 묶어 둔다. effective 는 진짜 effectiveModules 를 해석기 mock 위에서 돌려 얻는다(effective.test 와 같은 꼴).
import { readFileSync } from 'node:fs'
import * as icons from 'lucide-react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ getWorkspaceConfig: vi.fn(), getProjectConfig: vi.fn() }))
vi.mock('@/lib/settings/workspaceConfig', () => ({ getWorkspaceConfig: mocks.getWorkspaceConfig }))
vi.mock('@/lib/settings/projectConfig', () => ({ getProjectConfig: mocks.getProjectConfig }))
import { effectiveModules } from '@/lib/modules/effective'
import { MODULES } from '@/lib/modules/registry'
import type { ModuleId } from '@/lib/modules/defaults'
import { NAV_GROUP_OF, NAV_ITEM_IDS, type NavItemId } from '@/lib/nav/ids'
import { NAV_GROUPS, NAV_NEEDS, SHELL_NAV, navFor, type NavCaps, type NavGroup } from '@/lib/nav/registry'
import { SYNTHETIC_CONFIGS } from '../fixtures/synthetic/configs'

const WID = 'ws-a', PID = 'p-a'
const NONE: NavCaps = { isPlatformAdmin: false, isWorkspaceAdmin: false, isProjectAdmin: false, canViewUsage: false, canViewPortfolio: false, canCreateProject: false }
const ALL: NavCaps = { isPlatformAdmin: true, isWorkspaceAdmin: true, isProjectAdmin: true, canViewUsage: true, canViewPortfolio: true, canCreateProject: true }
const EMPTY_MENU = { order: [] as NavItemId[], labels: {} }
const CORE = new Set<ModuleId>(['dashboard', 'wbs', 'members', 'settings'])
const ids = (m: NavGroup[]) => m.flatMap((g) => g.items.map((i) => i.id))
const groups = (m: NavGroup[]) => m.map((g) => g.group)
const moduleNav = MODULES.flatMap((m) => [m.nav?.project, m.nav?.workspace].filter((e): e is NonNullable<typeof e> => !!e).map((e) => ({ e, module: m.id })))
const saved = { ...process.env }
beforeEach(() => {
  mocks.getWorkspaceConfig.mockReset(); mocks.getProjectConfig.mockReset()
  process.env.WIKI_SERVICE_ENABLED = 'true'; process.env.CHAT_V2_ENABLED = 'true'; process.env.MINUTES_API_ENABLED = 'true'
})
afterEach(() => { process.env = { ...saved } })

describe('navFor — 순수 함수: 레지스트리 전수 대조', () => {
  it('셸 8 ∪ 모듈 nav 16 = NAV_ITEM_IDS 24, 중복 없음, 그룹·층 일치', () => {
    const all = [...SHELL_NAV.map((s) => s.id), ...moduleNav.map((x) => x.e.id)]
    expect(all).toHaveLength(24)
    expect(new Set(all).size).toBe(24)
    expect([...all].sort()).toEqual([...NAV_ITEM_IDS].sort())
    for (const s of SHELL_NAV) { expect(s.group).toBe(NAV_GROUP_OF[s.id]); expect(s.id.startsWith(s.scope === 'workspace' ? 'ws.' : 'p.'), s.id).toBe(true) }
    for (const { e } of moduleNav) expect(e.group, e.id).toBe(NAV_GROUP_OF[e.id])
    for (const k of Object.keys(NAV_NEEDS)) expect(moduleNav.map((x) => x.e.id), k).toContain(k)
    expect(NAV_GROUPS).toEqual(['ws.main', 'ws.shared', 'ws.ops', 'ws.platform', 'p.overview', 'p.plan', 'p.collab', 'p.team', 'p.settings'])
  })
  it('그룹 안 order 가 유일하다 — 층마다', () => {
    for (const scope of ['workspace', 'project'] as const) {
      const entries = [...SHELL_NAV.filter((s) => s.scope === scope), ...MODULES.flatMap((m) => (m.nav?.[scope] ? [m.nav[scope]!] : []))]
      for (const g of NAV_GROUPS) {
        const orders = entries.filter((e) => e.group === g).map((e) => e.order)
        expect(new Set(orders).size, `${scope} ${g}`).toBe(orders.length)
      }
    }
  })
  it('아이콘 이름이 lucide-react 의 컴포넌트다(SP3b 의 이름 → 컴포넌트 표와 어긋남을 일찍 잡는다)', () => {
    for (const e of [...SHELL_NAV, ...moduleNav.map((x) => x.e)]) expect((icons as Record<string, unknown>)[e.icon], `${e.id} ${e.icon}`).toBeDefined()
  })
})

describe.each(SYNTHETIC_CONFIGS)('navFor — 순수 함수: 합성 구성 $id', (c) => {
  const wsCfg = { workspaceId: WID, revision: 1, schemaVersion: 1, schemaAhead: false, unknownKeys: [],
    keys: { 'modules.allowed': { status: 'set', value: c.workspace['modules.allowed'] }, 'ai.enabled': { status: 'set', value: c.workspace['ai.enabled'] ?? true } } }
  const pCfg = { projectId: PID, workspaceId: WID, revision: 1, schemaVersion: 1, schemaAhead: false, unknownKeys: [], areas: { weekly_section: [], issue_area: [] }, teams: [],
    keys: { 'modules.enabled': { status: 'set', value: c.project['modules.enabled'] } } }
  it('프로젝트 층 — 꺼진 모듈의 항목이 없고 core 항목은 늘 있다', async () => {
    mocks.getWorkspaceConfig.mockResolvedValue(wsCfg); mocks.getProjectConfig.mockResolvedValue(pCfg)
    const effective = await effectiveModules({ workspaceId: WID, projectId: PID })
    const got = ids(navFor({ scope: 'project', base: `/p/${PID}`, effective, caps: ALL, menu: EMPTY_MENU }))
    const expected = MODULES.filter((m) => m.nav?.project && effective.has(m.id)).map((m) => m.nav!.project!.id)
    expect([...got].sort()).toEqual([...expected].sort())
    for (const core of ['p.dashboard', 'p.wbs', 'p.members', 'p.settings'] as const) expect(got).toContain(core)
    if (c.id === 'research') for (const off of ['p.announcements', 'p.attendance', 'p.agents'] as const) expect(got).not.toContain(off)
    if (c.id === 'construction') expect(got).not.toContain('p.wiki')           // ai.enabled=false
  })
  it('워크스페이스 층 — 허용 ∩ env 만 본다(프로젝트 토글과 무관)', async () => {
    mocks.getWorkspaceConfig.mockResolvedValue(wsCfg)
    const effective = await effectiveModules({ workspaceId: WID })
    const got = ids(navFor({ scope: 'workspace', base: '/w/acme', effective, caps: ALL, menu: EMPTY_MENU }))
    for (const m of ['meetings', 'minutes', 'agents', 'portfolio', 'usage'] as const) {
      const id = MODULES.find((x) => x.id === m)!.nav!.workspace!.id
      expect(got.includes(id), `${c.id} ${id}`).toBe(effective.has(m))
    }
    for (const shell of ['ws.home', 'ws.my_work', 'ws.projects', 'ws.members', 'ws.teams', 'ws.settings', 'ws.llm', 'ws.ui_states'] as const) expect(got).toContain(shell)
  })
})

describe('navFor — 순수 함수: caps', () => {
  const full = new Set<ModuleId>([...CORE, 'meetings', 'minutes', 'agents', 'portfolio', 'usage'])
  it('caps 가 하나도 없으면 운영·플랫폼 그룹이 통째로 없다(빈 그룹은 내지 않는다)', () => {
    const m = navFor({ scope: 'workspace', base: '/w/acme', effective: full, caps: NONE, menu: EMPTY_MENU })
    expect(groups(m)).toEqual(['ws.main', 'ws.shared'])
  })
  it('포트폴리오는 모듈 ∧ canViewPortfolio 둘 다 필요하다', () => {
    const base = { scope: 'workspace' as const, base: '/w/acme', menu: EMPTY_MENU }
    expect(ids(navFor({ ...base, effective: full, caps: { ...NONE, canViewPortfolio: true } }))).toContain('ws.portfolio')
    expect(ids(navFor({ ...base, effective: CORE, caps: { ...NONE, canViewPortfolio: true } }))).not.toContain('ws.portfolio')
    expect(ids(navFor({ ...base, effective: full, caps: NONE }))).not.toContain('ws.portfolio')
  })
  it('isWorkspaceAdmin 은 멤버·팀·설정을, isPlatformAdmin 은 플랫폼 그룹을 연다', () => {
    const m = navFor({ scope: 'workspace', base: '/w/acme', effective: CORE, caps: { ...NONE, isWorkspaceAdmin: true, isPlatformAdmin: true }, menu: EMPTY_MENU })
    expect(m.find((g) => g.group === 'ws.ops')!.items.map((i) => i.id)).toEqual(['ws.members', 'ws.teams', 'ws.settings'])
    expect(m.find((g) => g.group === 'ws.platform')!.items.map((i) => i.id)).toEqual(['ws.llm', 'ws.ui_states'])
  })
  it('항상 보이는 항목 — effective = core 만·caps 없음이면 ws.main 셋과 p.dashboard·p.wbs·p.members. isProjectAdmin 이면 p.settings', () => {
    expect(ids(navFor({ scope: 'workspace', base: '/w/acme', effective: CORE, caps: NONE, menu: EMPTY_MENU }))).toEqual(['ws.home', 'ws.my_work', 'ws.projects'])
    expect(ids(navFor({ scope: 'project', base: '/p/P', effective: CORE, caps: NONE, menu: EMPTY_MENU }))).toEqual(['p.dashboard', 'p.wbs', 'p.members'])
    expect(ids(navFor({ scope: 'project', base: '/p/P', effective: CORE, caps: { ...NONE, isProjectAdmin: true }, menu: EMPTY_MENU }))).toContain('p.settings')
  })
})

describe('navFor — 순수 함수: navigation.menu', () => {
  const eff = new Set<ModuleId>([...CORE, 'issues', 'weekly', 'meetings', 'wiki', 'announcements'])
  const plan = (m: NavGroup[]) => m.find((g) => g.group === 'p.plan')!.items.map((i) => i.id)
  it('그룹 안 순서만 바꾼다 — 적힌 것이 적힌 순서로 앞, 나머지는 레지스트리 순서. 다른 그룹 id 는 그룹을 옮기지 않는다', () => {
    const m = navFor({ scope: 'project', base: '/p/P', effective: eff, caps: NONE, menu: { order: ['p.weekly', 'ws.home', 'p.wiki', 'p.wbs'], labels: {} } })
    expect(plan(m)).toEqual(['p.weekly', 'p.wbs', 'p.issues'])
    expect(groups(m)).toEqual(['p.overview', 'p.plan', 'p.collab', 'p.team'])
    expect(m.find((g) => g.group === 'p.collab')!.items.map((i) => i.id)).toEqual(['p.wiki', 'p.meetings', 'p.announcements'])
  })
  it('보이지 않는 id 는 무시한다', () => {
    const m = navFor({ scope: 'project', base: '/p/P', effective: CORE, caps: NONE, menu: { order: ['p.issues', 'p.wbs'], labels: {} } })
    expect(plan(m)).toEqual(['p.wbs'])
  })
  it('labels 는 문자열로 덮고, 없으면 { key }', () => {
    const m = navFor({ scope: 'project', base: '/p/P', effective: eff, caps: NONE, menu: { order: [], labels: { 'p.issues': '이슈' } } })
    const items = m.flatMap((g) => g.items)
    expect(items.find((i) => i.id === 'p.issues')!.label).toBe('이슈')
    expect(items.find((i) => i.id === 'p.wbs')!.label).toEqual({ key: 'nav.wbsGantt' })
  })
})

describe('navFor — 순수 함수: href·순수성', () => {
  it('프로젝트 층 base 뒤 segment, 조각에 / 가 든 p.agents, 워크스페이스 홈 = base, 플랫폼 항목 = 절대 경로', () => {
    const p = navFor({ scope: 'project', base: '/p/P', effective: new Set<ModuleId>([...CORE, 'agents']), caps: NONE, menu: EMPTY_MENU }).flatMap((g) => g.items)
    expect(p.find((i) => i.id === 'p.agents')!.href).toBe('/p/P/agents/office')
    expect(p.find((i) => i.id === 'p.dashboard')!.href).toBe('/p/P/dashboard')
    const w = navFor({ scope: 'workspace', base: '/w/acme', effective: CORE, caps: ALL, menu: EMPTY_MENU }).flatMap((g) => g.items)
    expect(w.find((i) => i.id === 'ws.home')!.href).toBe('/w/acme')
    expect(w.find((i) => i.id === 'ws.members')!.href).toBe('/w/acme/admin/accounts')
    expect(w.find((i) => i.id === 'ws.llm')!.href).toBe('/admin/llm-config')
  })
  it('같은 입력 두 번이면 같은 결과, 얼린 입력도 받는다', () => {
    const input = Object.freeze({ scope: 'project' as const, base: '/p/P', effective: CORE, caps: Object.freeze({ ...NONE }), menu: Object.freeze({ order: Object.freeze(['p.wbs']) as unknown as NavItemId[], labels: Object.freeze({}) }) })
    expect(navFor(input)).toEqual(navFor(input))
  })
  it('import 방향 — 순수(해석기·supabase·authz 를 import 하지 않고, 설정 레지스트리는 타입만)', () => {
    const text = readFileSync('src/lib/nav/registry.ts', 'utf8')
    expect(text).not.toMatch(/from '@\/lib\/(supabase|authz)/)
    expect(text).not.toMatch(/from '@\/lib\/settings\/(projectConfig|workspaceConfig)'/)
    expect(text).toMatch(/import type \{[^}]*NavMenuSetting[^}]*\} from '@\/lib\/settings\/registry'/)
  })
})
