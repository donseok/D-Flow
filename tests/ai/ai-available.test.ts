// aiAvailable(D17, 정본 §5.4.5, 판정 P9) — 세 조건의 조합, 스코프 네 모양, hasLLM 거짓이면 읽지 않음, 실패는 false + 로그.
// 전역 셋업이 이 모듈을 mock 하므로 진짜는 importActual 로 쓴다.
import { beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ hasLLM: vi.fn(), getWorkspaceConfig: vi.fn(), getProjectConfig: vi.fn(), effectiveModules: vi.fn(), getActor: vi.fn(), createServerClient: vi.fn() }))
vi.mock('@/lib/ai/provider', () => ({ hasLLM: m.hasLLM }))
vi.mock('@/lib/settings/workspaceConfig', () => ({ getWorkspaceConfig: m.getWorkspaceConfig }))
vi.mock('@/lib/settings/projectConfig', () => ({ getProjectConfig: m.getProjectConfig }))
vi.mock('@/lib/modules/effective', () => ({ effectiveModules: m.effectiveModules }))
vi.mock('@/lib/authz', () => ({ getActor: m.getActor }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: m.createServerClient }))
import { makeActor } from '../fixtures/actor'
const { aiAvailable } = await vi.importActual<typeof import('@/lib/modules/aiAvailable')>('@/lib/modules/aiAvailable')

const WID = '00000000-0000-0000-7e57-000000001411', PID = '00000000-0000-0000-7e57-000000001412', MID = '00000000-0000-0000-7e57-000000001413'
const ws = (ai: boolean) => ({ workspaceId: WID, keys: { 'ai.enabled': { status: 'set', value: ai } } })
const client = { from: vi.fn() }
beforeEach(() => {
  vi.clearAllMocks()
  m.hasLLM.mockReturnValue(true)
  m.getWorkspaceConfig.mockResolvedValue(ws(true))
  m.getProjectConfig.mockResolvedValue({ projectId: PID, workspaceId: WID })
  m.effectiveModules.mockResolvedValue(new Set(['weekly', 'issues']))
})

describe('aiAvailable — 조합', () => {
  it.each([
    [true, true, 'weekly', true], [true, true, 'wiki', false], [true, false, 'weekly', false], [true, false, undefined, false],
    [false, true, 'weekly', false], [false, false, undefined, false], [true, true, undefined, true], [false, true, undefined, false],
  ] as const)('hasLLM=%s ai.enabled=%s module=%s → %s', async (llm, ai, module, expected) => {
    m.hasLLM.mockReturnValue(llm); m.getWorkspaceConfig.mockResolvedValue(ws(ai))
    expect(await aiAvailable({ workspaceId: WID, projectId: PID }, { module })).toBe(expected)
  })
  it('hasLLM 이 거짓이면 설정을 하나도 읽지 않는다(키 없는 배포의 비용 0)', async () => {
    m.hasLLM.mockReturnValue(false)
    expect(await aiAvailable({ projectId: PID }, { module: 'weekly' })).toBe(false)
    expect(m.getWorkspaceConfig).not.toHaveBeenCalled(); expect(m.getProjectConfig).not.toHaveBeenCalled(); expect(m.effectiveModules).not.toHaveBeenCalled()
  })
  it('module 이 없으면 effectiveModules 를 부르지 않는다(주간 브리핑 — 모듈 없는 AI)', async () => {
    expect(await aiAvailable({ workspaceId: WID })).toBe(true)
    expect(m.effectiveModules).not.toHaveBeenCalled()
  })
  it('판정 실패는 false 와 [aiAvailable] 로그(결정형 폴백 — 표시=로깅)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    m.getWorkspaceConfig.mockRejectedValue(new Error('down'))
    expect(await aiAvailable({ workspaceId: WID }, { module: 'weekly' })).toBe(false)
    expect(err.mock.calls[0][0]).toBe('[aiAvailable]')
  })
})

describe('aiAvailable — 스코프 네 모양', () => {
  it('{ projectId } — 해석기의 workspaceId 로, client 를 넘긴다 — 읽은 프로젝트 설정도 넘겨 다시 읽지 않는다(P27)', async () => {
    expect(await aiAvailable({ projectId: PID }, { module: 'issues', client })).toBe(true)
    expect(m.getProjectConfig).toHaveBeenCalledWith(PID, { client })
    expect(m.getWorkspaceConfig).toHaveBeenCalledWith(WID, { client })
    expect(m.effectiveModules).toHaveBeenCalledWith({ workspaceId: WID, projectId: PID }, { client, projectConfig: { projectId: PID, workspaceId: WID } })
    expect(m.getProjectConfig).toHaveBeenCalledTimes(1)
  })
  it('{ minuteId } — 회의록 행의 워크스페이스·프로젝트(넘긴 client 로 읽는다)', async () => {
    const row = { workspace_id: WID, project_id: null }
    const b: Record<string, unknown> = {}; b.select = () => b; b.eq = () => b; b.maybeSingle = async () => ({ data: row, error: null })
    const c = { from: vi.fn(() => b) }
    m.effectiveModules.mockResolvedValue(new Set(['minutes']))
    expect(await aiAvailable({ minuteId: MID }, { module: 'minutes', client: c as never })).toBe(true)   // 가짜 클라이언트 — ConfigReadClient 가 아니다(TS2322)
    expect(c.from).toHaveBeenCalledWith('minutes')
    expect(m.effectiveModules).toHaveBeenCalledWith({ workspaceId: WID }, { client: c })
  })
  it('{ minuteId } 행이 없으면 false', async () => {
    const b: Record<string, unknown> = {}; b.select = () => b; b.eq = () => b; b.maybeSingle = async () => ({ data: null, error: null })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await aiAvailable({ minuteId: MID }, { module: 'minutes', client: { from: () => b } as never })).toBe(false)
  })
  it('null — 세션 행위자의 유일 워크스페이스, 없거나 둘 이상이면 false', async () => {
    m.getActor.mockResolvedValueOnce(makeActor({ userId: 'u', workspaceRoles: new Map([[WID, 'member']]) }))
    m.effectiveModules.mockResolvedValue(new Set(['chatbot']))
    expect(await aiAvailable(null, { module: 'chatbot' })).toBe(true)
    m.getActor.mockResolvedValueOnce(makeActor({ userId: 'u', workspaceRoles: new Map() }))
    expect(await aiAvailable(null, { module: 'chatbot' })).toBe(false)
  })
})
