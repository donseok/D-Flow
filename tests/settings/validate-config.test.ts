// 교차 불변식(개정 §2.7.2, 스펙 §3.6 교차 열) — parse 뒤 저장 직전에 돈다. 선행 조회는 SUB-ACT·스텁 행을 뺀다(0012 ① 과 같은 규칙).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { allowedAndAvailable, loadProjectValidateDeps, validateProjectConfig, validateWorkspaceConfig, workspaceAllowed, workspaceAllowedOrNone } from '@/lib/settings/validateConfig'
import { ConfigKeyError, ConfigUnavailableError } from '@/lib/settings/errors'
import type { ProjectConfig } from '@/lib/settings/projectConfig'
import type { WorkspaceConfig } from '@/lib/settings/workspaceConfig'

const deps = { treeMaxDepth: 2, teamCodes: ['DEV', 'PMO'], allowed: ['kanban', 'meetings', 'wiki', 'minutes'] as const, prevEnabled: ['kanban'] as const }
const WID = '00000000-0000-4000-8000-00000000bb01'
const OTHER = '00000000-0000-4000-8000-00000000bb02'

describe('validateProjectConfig', () => {
  it('단계 이름 수 < 트리 깊이+1 이면 거부, 빈 트리는 통과', () => {
    expect(validateProjectConfig({ 'core.level_labels': ['A', 'B'] }, deps)).toEqual({ ok: false, fieldErrors: [{ key: 'core.level_labels', message: '기존 WBS 에 깊이 3단 항목이 있어 2단으로 줄일 수 없습니다.' }] })
    expect(validateProjectConfig({ 'core.level_labels': ['A', 'B', 'C'] }, deps)).toEqual({ ok: true })
    expect(validateProjectConfig({ 'core.level_labels': ['A'] }, { ...deps, treeMaxDepth: null })).toEqual({ ok: true })
  })
  it('엑셀 양식의 teamColumns 는 팀 코드 안, * 는 뺀다. null 은 통과', () => {
    const profile = (codes: string[]) => ({ version: 1, sheetName: 'S', holidaySheetName: null, headerRow: 0, hierarchy: { kind: 'outline', column: 0 },
      logical: { extraAxis: null, code: null, name: 1, deliverable: null, start: null, end: null, weight: null, actualPct: null },
      teamColumns: codes.map((c, i) => [i + 2, c] as [number, string]), ownerMarks: {} })
    expect(validateProjectConfig({ 'wbs.excel_profile': profile(['DEV', '*']) }, deps)).toEqual({ ok: true })
    const r = validateProjectConfig({ 'wbs.excel_profile': profile(['DEV', 'QA']) }, deps)
    expect(r).toEqual({ ok: false, fieldErrors: [{ key: 'wbs.excel_profile', message: '양식의 팀 열이 프로젝트 팀에 없습니다: QA' }] })
    expect(validateProjectConfig({ 'wbs.excel_profile': null }, deps)).toEqual({ ok: true })
  })
  it('modules.enabled 는 checkEnabledModules 로 — 새 id 의 허용·requires 닫힘', () => {
    expect(validateProjectConfig({ 'modules.enabled': ['kanban', 'meetings'] }, deps)).toEqual({ ok: true })
    const r = validateProjectConfig({ 'modules.enabled': ['kanban', 'issues'] }, deps)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.fieldErrors[0]).toMatchObject({ key: 'modules.enabled', message: expect.stringContaining('issues') })
    // wiki 는 allowed 에 minutes 가 있어 닫힘 통과
    expect(validateProjectConfig({ 'modules.enabled': ['wiki'] }, deps)).toEqual({ ok: true })
    expect(validateProjectConfig({ 'modules.enabled': ['wiki'] }, { ...deps, allowed: ['wiki'] }).ok).toBe(false)
  })
  it('여러 키의 실패를 모두 싣는다(부분 저장 없음 — 한 번에 보인다)', () => {
    const r = validateProjectConfig({ 'core.level_labels': ['A'], 'modules.enabled': ['issues'] }, deps)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.fieldErrors.map((f) => f.key)).toEqual(['core.level_labels', 'modules.enabled'])
  })
})

describe('validateWorkspaceConfig', () => {
  it('branding.logo 의 경로는 자기 워크스페이스여야 한다', () => {
    const mine = { full: `ws/${WID}/branding/full-0123456789abcdef.png`, full_dark: null, mark: null }
    expect(validateWorkspaceConfig({ 'branding.logo': mine }, { workspaceId: WID })).toEqual({ ok: true })
    const theirs = { ...mine, mark: `ws/${OTHER}/branding/mark-0123456789abcdef.webp` }
    expect(validateWorkspaceConfig({ 'branding.logo': theirs }, { workspaceId: WID })).toEqual({ ok: false, fieldErrors: [{ key: 'branding.logo', message: 'mark: 다른 워크스페이스의 경로입니다.' }] })
    expect(validateWorkspaceConfig({ 'ai.enabled': false }, { workspaceId: WID })).toEqual({ ok: true })
  })
})

describe('loadProjectValidateDeps', () => {
  const savedEnv = { ...process.env }
  afterEach(() => { process.env = { ...savedEnv } })
  const cfg = {
    projectId: 'p', workspaceId: WID, keys: { 'modules.enabled': { status: 'set', value: ['kanban'] } },
    teams: [{ code: 'DEV', active: true }, { code: 'OLD', active: false }, { code: 'PMO', active: true }],
  } as unknown as ProjectConfig
  const ws = { keys: { 'modules.allowed': { status: 'set', value: ['kanban', 'wiki', 'minutes_integration'] } } } as unknown as WorkspaceConfig
  const client = (rows: unknown, error: { message: string } | null = null) => {
    const filters: string[] = []
    const b: Record<string, unknown> = {}
    b.from = () => b; b.select = () => b
    b.eq = (c: string, v: unknown) => { filters.push(`${c}=${v}`); return b }
    b.is = (c: string, v: unknown) => { filters.push(`${c} is ${v}`); return b }
    b.then = (res: (x: unknown) => void) => res({ data: rows, error })
    return { client: b as never, filters }
  }
  it('wbs 행에서 SUB-ACT·스텁을 빼고 깊이를 세고, 활성 팀 코드와 워크스페이스 허용(env 무관 — 스펙 §4.1)을 싣는다', async () => {
    process.env.WIKI_SERVICE_ENABLED = 'true'; delete process.env.MINUTES_API_ENABLED
    const { client, filters } = client_([{ id: 'a', parent_id: null }, { id: 'b', parent_id: 'a' }, { id: 'c', parent_id: 'b' }])
    const d = await loadProjectValidateDeps(client, cfg, ws)
    expect(d.treeMaxDepth).toBe(2)
    expect(filters).toEqual(['project_id=p', 'is_owner_split=false', 'stub_for is null'])
    expect(d.teamCodes).toEqual(['DEV', 'PMO'])
    expect(d.allowed).toEqual(['kanban', 'wiki', 'minutes_integration'])     // env 로 꺼진 minutes_integration 도 허용이면 싣는다
    expect(d.prevEnabled).toEqual(['kanban'])
    expect(allowedAndAvailable(ws)).toEqual(['kanban', 'wiki'])               // 소유 모듈 규칙 전용 — env 를 본다
  })
  it('플래그가 꺼져도 저장 검사의 허용 목록은 같다 — env 는 소유 모듈 규칙(allowedAndAvailable)만 좁힌다(FN-1)', async () => {
    delete process.env.WIKI_SERVICE_ENABLED; delete process.env.MINUTES_API_ENABLED
    const { client } = client_([])
    expect((await loadProjectValidateDeps(client, cfg, ws)).allowed).toEqual(['kanban', 'wiki', 'minutes_integration'])
    expect(workspaceAllowed(ws)).toEqual(['kanban', 'wiki', 'minutes_integration'])
    expect(allowedAndAvailable(ws)).toEqual(['kanban'])
    // 플래그 꺼짐 + 허용된 wiki 를 새로 켜는 저장은 교차 검사를 지난다(minutes 는 워크스페이스 층 허용)
    expect(validateProjectConfig({ 'modules.enabled': ['kanban', 'wiki'] }, { ...deps, allowed: workspaceAllowed({ keys: { 'modules.allowed': { status: 'set', value: ['kanban', 'wiki', 'minutes'] } } } as unknown as WorkspaceConfig) }))
      .toEqual({ ok: true })
  })
  it('workspaceAllowed 는 손상이면 ConfigKeyError, workspaceAllowedOrNone 은 로그 한 줄 + [](fail-closed)', () => {
    const broken = { workspaceId: WID, keys: { 'modules.allowed': { status: 'invalid', error: 'x' } } } as unknown as WorkspaceConfig
    expect(() => workspaceAllowed(broken)).toThrow(ConfigKeyError)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(workspaceAllowedOrNone(broken)).toEqual([])
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })
  it('조회 실패는 throw — 검증 불가를 통과로 위장하지 않는다', async () => {
    const { client } = client_(null, { message: 'down' })
    await expect(loadProjectValidateDeps(client, cfg, ws)).rejects.toBeInstanceOf(ConfigUnavailableError)
  })
  it('modules.enabled 가 invalid 면 prevEnabled 는 [](전부 새 id 로 본다)', async () => {
    const bad = { ...cfg, keys: { 'modules.enabled': { status: 'invalid', error: 'x' } } } as unknown as ProjectConfig
    const { client } = client_([])
    expect((await loadProjectValidateDeps(client, bad, ws)).prevEnabled).toEqual([])
  })
  function client_(rows: unknown, error: { message: string } | null = null) { return client(rows, error) }
})
