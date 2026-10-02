// effectiveModules(개정 §2.7.1·§2.11 ③) — 세 구성으로 describe.each. 해석기는 mock, env 플래그는 켠 상태에서 시작한다.
import { CAL_FIELDS_UTC_SUN } from '../helpers/calendarFixture'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ getWorkspaceConfig: vi.fn(), getProjectConfig: vi.fn() }))
vi.mock('@/lib/settings/workspaceConfig', () => ({ getWorkspaceConfig: mocks.getWorkspaceConfig }))
vi.mock('@/lib/settings/projectConfig', () => ({ getProjectConfig: mocks.getProjectConfig }))
import { effectiveModules } from '@/lib/modules/effective'
import { moduleKeyRule } from '@/lib/modules/saveRule'
import { defineSetting } from '@/lib/settings/def'
import { WORKSPACE_SETTINGS, PROJECT_SETTINGS } from '@/lib/settings/registry'
import type { ModuleId } from '@/lib/modules/defaults'
import { SYNTHETIC_CONFIGS } from '../fixtures/synthetic/configs'
import { ConfigUnavailableError } from '@/lib/settings/errors'

const WID = 'ws-a', PID = 'p-a'
const wsCfg = (allowed: ModuleId[], ai = true) => ({
  workspaceId: WID, revision: 1, schemaVersion: 1, schemaAhead: false, unknownKeys: [], ...CAL_FIELDS_UTC_SUN,
  keys: { 'modules.allowed': { status: 'set', value: allowed }, 'ai.enabled': { status: 'set', value: ai } },
})
const pCfg = (enabled: ModuleId[]) => ({
  projectId: PID, workspaceId: WID, revision: 1, schemaVersion: 1, schemaAhead: false, unknownKeys: [], holidays: [], ...CAL_FIELDS_UTC_SUN, areas: { weekly_section: [], issue_area: [] }, teams: [],
  keys: { 'modules.enabled': { status: 'set', value: enabled } },
})
const saved = { ...process.env }
beforeEach(() => {
  mocks.getWorkspaceConfig.mockReset(); mocks.getProjectConfig.mockReset()
  process.env.WIKI_SERVICE_ENABLED = 'true'; process.env.CHAT_V2_ENABLED = 'true'; process.env.MINUTES_API_ENABLED = 'true'
})
afterEach(() => { process.env = { ...saved } })
const sorted = (s: ReadonlySet<string>) => [...s].sort()

describe.each(SYNTHETIC_CONFIGS)('구성 $id', (c) => {
  it('core 없이 저장한 enabled 로도 core 가 유효하다(③-1). allowed 에 core 가 없어도 kanban·agents 가 살아남는다(③-2)', async () => {
    mocks.getWorkspaceConfig.mockResolvedValue(wsCfg(c.workspace['modules.allowed'], c.workspace['ai.enabled'] ?? true))
    mocks.getProjectConfig.mockResolvedValue(pCfg(c.project['modules.enabled']))
    const eff = await effectiveModules({ workspaceId: WID, projectId: PID })
    for (const core of ['dashboard', 'wbs', 'members', 'settings']) expect(eff.has(core as ModuleId), core).toBe(true)
    const expectOptional = c.project['modules.enabled']
      .filter((id) => c.workspace['modules.allowed'].includes(id))
      .filter((id) => (c.workspace['ai.enabled'] ?? true) || !['wiki', 'chatbot'].includes(id))
      .filter((id) => id !== 'wiki' || c.workspace['modules.allowed'].includes('minutes'))
    for (const id of expectOptional) expect(eff.has(id), id).toBe(true)
    const wsLayer = c.workspace['modules.allowed'].filter((id) => ['minutes', 'minutes_integration', 'portfolio', 'usage'].includes(id))
    for (const id of wsLayer) expect(eff.has(id), id).toBe(true)
    expect(mocks.getProjectConfig).toHaveBeenCalledWith(PID, { client: undefined })
  })
})

describe('effectiveModules — 경계', () => {
  it('allowed 를 좁히면 저장값(enabled)은 그대로여도 유효 집합에서 빠진다(③-3)', async () => {
    mocks.getWorkspaceConfig.mockResolvedValue(wsCfg(['meetings']))
    mocks.getProjectConfig.mockResolvedValue(pCfg(['kanban', 'meetings', 'issues']))
    expect(sorted(await effectiveModules({ workspaceId: WID, projectId: PID }))).toEqual(['dashboard', 'meetings', 'members', 'settings', 'wbs'])
  })
  it('ai.enabled=false 면 wiki·chatbot 이 빠진다. 워크스페이스 층만 부르면 프로젝트 토글 모듈은 전부 통과', async () => {
    mocks.getWorkspaceConfig.mockResolvedValue(wsCfg(['wiki', 'chatbot', 'minutes', 'kanban'], false))
    expect(sorted(await effectiveModules({ workspaceId: WID }))).toEqual(['dashboard', 'kanban', 'members', 'minutes', 'settings', 'wbs'])
    expect(mocks.getProjectConfig).not.toHaveBeenCalled()
  })
  it('env 가 꺼진 모듈은 두 층이 켜져도 빠지고, requires 가 빠진 모듈도 빠진다(wiki→minutes, minutes_integration→minutes)', async () => {
    delete process.env.WIKI_SERVICE_ENABLED
    mocks.getWorkspaceConfig.mockResolvedValue(wsCfg(['wiki', 'minutes_integration', 'chatbot']))
    mocks.getProjectConfig.mockResolvedValue(pCfg(['wiki', 'chatbot']))
    expect(sorted(await effectiveModules({ workspaceId: WID, projectId: PID }))).toEqual(['chatbot', 'dashboard', 'members', 'settings', 'wbs'])
  })
  it('해석기 실패·손상은 그대로 throw 한다(requireModule 이 닫는다) — 켜진 것으로 위장하지 않는다', async () => {
    mocks.getWorkspaceConfig.mockRejectedValue(new Error('CONFIG_UNAVAILABLE'))
    await expect(effectiveModules({ workspaceId: WID })).rejects.toThrow('CONFIG_UNAVAILABLE')
    mocks.getWorkspaceConfig.mockResolvedValue({ ...wsCfg([]), keys: { 'modules.allowed': { status: 'invalid', error: 'x' }, 'ai.enabled': { status: 'set', value: true } } })
    await expect(effectiveModules({ workspaceId: WID })).rejects.toMatchObject({ code: 'CONFIG_INVALID' })
  })
  it('client 를 넘기면 두 해석기에 그대로 전달한다', async () => {
    const client = { from: vi.fn() }
    mocks.getWorkspaceConfig.mockResolvedValue(wsCfg([])); mocks.getProjectConfig.mockResolvedValue(pCfg([]))
    await effectiveModules({ workspaceId: WID, projectId: PID }, { client })
    expect(mocks.getWorkspaceConfig).toHaveBeenCalledWith(WID, { client })
    expect(mocks.getProjectConfig).toHaveBeenCalledWith(PID, { client })
  })
})

describe('꺼진 모듈의 준비 설정(③-4) — 비core 소유 픽스처 키로 본다(SP3a 등록 키는 전부 core 소유)', () => {
  const fixture = defineSetting<'issues.severities', string[]>({
    key: 'issues.severities', scope: 'project', module: 'issues', default: [], parse: (raw) => (Array.isArray(raw) ? { ok: true, value: raw as string[] } : { ok: false, error: 'x' }),
    widget: { kind: 'vocab' }, editor: 'project_admin', apply: 'immediate', impact: ['guarded'], sql: null,
  })
  it('허용된 꺼진 모듈의 키는 prepared(저장 허용), 허용 밖은 not_allowed(거부)', () => {
    expect([...WORKSPACE_SETTINGS, ...PROJECT_SETTINGS].some((d) => (d.key as string) === fixture.key)).toBe(false)
    expect(moduleKeyRule({ module: fixture.module, allowed: new Set(['issues']), enabled: new Set() })).toBe('prepared')
    expect(moduleKeyRule({ module: fixture.module, allowed: new Set(['kanban']), enabled: new Set() })).toBe('not_allowed')
    expect(moduleKeyRule({ module: fixture.module, allowed: new Set(['issues']), enabled: new Set(['issues']) })).toBe('always')
  })
})

describe('프로젝트의 워크스페이스가 정본이다(Phase A 최종 리뷰 CR-5)', () => {
  it('넘긴 workspaceId 가 프로젝트 설정의 것과 다르면 ConfigUnavailableError', async () => {
    mocks.getWorkspaceConfig.mockResolvedValue(wsCfg(['kanban']))
    mocks.getProjectConfig.mockResolvedValue({ ...pCfg(['kanban']), workspaceId: 'ws-other' })
    await expect(effectiveModules({ workspaceId: WID, projectId: PID })).rejects.toBeInstanceOf(ConfigUnavailableError)
  })
})

describe('이미 읽은 프로젝트 설정을 받으면 다시 읽지 않는다(P27 — 관문 1회 = 2왕복)', () => {
  it('projectConfig 를 넘기면 getProjectConfig 를 부르지 않고 그 값으로 판정한다', async () => {
    mocks.getWorkspaceConfig.mockResolvedValue(wsCfg(['kanban', 'issues']))
    const eff = await effectiveModules({ workspaceId: WID, projectId: PID }, { projectConfig: pCfg(['issues']) as never })
    expect(eff.has('issues')).toBe(true); expect(eff.has('kanban')).toBe(false)
    expect(mocks.getProjectConfig).not.toHaveBeenCalled()
  })
  it.each([
    ['다른 워크스페이스', { workspaceId: 'ws-other' }],
    ['다른 프로젝트', { projectId: 'p-other' }],
  ])('넘긴 projectConfig 가 scope 와 어긋나면(%s) ConfigUnavailableError — CR-5 가 받은 값에도 선다', async (_n, over) => {
    mocks.getWorkspaceConfig.mockResolvedValue(wsCfg(['kanban']))
    await expect(effectiveModules({ workspaceId: WID, projectId: PID }, { projectConfig: { ...pCfg(['kanban']), ...over } as never }))
      .rejects.toBeInstanceOf(ConfigUnavailableError)
  })
  it('projectId 없이 projectConfig 만 넘기면 던진다(F4-1 — 프로젝트 토글과 CR-5 검사를 조용히 건너뛰지 않는다)', async () => {
    mocks.getWorkspaceConfig.mockResolvedValue(wsCfg(['kanban']))
    await expect(effectiveModules({ workspaceId: WID }, { projectConfig: pCfg(['kanban']) as never }))
      .rejects.toThrow('[effectiveModules] projectConfig 는 projectId 와 함께')
  })
})
