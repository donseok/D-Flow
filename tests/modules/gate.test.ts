// requireModule·requireSessionModule·moduleState·목록 두 함수(스펙 §4.1·§4.2, 판정 P1·P2·P10·P13).
// 과제 3 뒤에는 tests/setup/module-gate.ts 가 '@/lib/modules/gate' 를 전역 mock 한다 — 여기서는 importActual 로 진짜를 쓴다.
import { beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ getProjectConfig: vi.fn(), effectiveModules: vi.fn(), getActor: vi.fn() }))
vi.mock('@/lib/settings/projectConfig', () => ({ getProjectConfig: m.getProjectConfig }))
vi.mock('@/lib/modules/effective', () => ({ effectiveModules: m.effectiveModules }))
vi.mock('@/lib/authz', () => ({ getActor: m.getActor }))
import { ERR_MODULE_DISABLED } from '@/lib/authz/errors'
import { ConfigKeyError, ConfigUnavailableError } from '@/lib/settings/errors'
import type { ModuleId } from '@/lib/modules/defaults'
import { makeActor } from '../fixtures/actor'
const { requireModule, requireSessionModule, moduleState, projectsWithModule, workspacesWithModule } =
  await vi.importActual<typeof import('@/lib/modules/gate')>('@/lib/modules/gate')

const PID = '00000000-0000-0000-7e57-000000001401', WID = '00000000-0000-0000-7e57-000000001402'
const client = { from: vi.fn() }
const eff = (...ids: ModuleId[]) => new Set<ModuleId>(['dashboard', 'wbs', 'members', 'settings', ...ids])
beforeEach(() => {
  vi.clearAllMocks()
  m.getProjectConfig.mockResolvedValue({ projectId: PID, workspaceId: WID })
  m.effectiveModules.mockResolvedValue(eff('issues', 'minutes'))
})

describe('requireModule', () => {
  it('{ projectId } 면 해석기의 workspaceId 로 effectiveModules 를 부르고 client 를 둘 다에 넘긴다(E12)', async () => {
    expect(await requireModule({ projectId: PID }, 'issues', { client })).toEqual({ ok: true })
    expect(m.getProjectConfig).toHaveBeenCalledWith(PID, { client })
    expect(m.effectiveModules).toHaveBeenCalledWith({ workspaceId: WID, projectId: PID }, { client })
  })
  it('{ workspaceId } 면 프로젝트 해석기를 부르지 않는다', async () => {
    expect(await requireModule({ workspaceId: WID }, 'minutes')).toEqual({ ok: true })
    expect(m.getProjectConfig).not.toHaveBeenCalled()
    expect(m.effectiveModules).toHaveBeenCalledWith({ workspaceId: WID }, { client: undefined })
  })
  it('꺼짐은 ERR_MODULE_DISABLED — 로그를 남기지 않는다(요청마다 쌓이지 않게)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await requireModule({ projectId: PID }, 'wiki')).toEqual({ ok: false, error: ERR_MODULE_DISABLED })
    expect(err).not.toHaveBeenCalled()
  })
  it('목록은 전부 유효해야 통과한다(D18)', async () => {
    expect(await requireModule({ projectId: PID }, ['issues', 'minutes'])).toEqual({ ok: true })
    expect(await requireModule({ projectId: PID }, ['issues', 'wiki'])).toEqual({ ok: false, error: ERR_MODULE_DISABLED })
  })
  it('요청이 전부 core 면 설정을 읽지 않고 통과한다(P2 — 설정 조회 실패가 core 화면의 오류 상태를 404 로 덮지 않는다)', async () => {
    m.getProjectConfig.mockRejectedValue(new ConfigUnavailableError('down'))
    expect(await requireModule({ projectId: PID }, 'dashboard')).toEqual({ ok: true })
    expect(await requireModule({ projectId: PID }, ['wbs', 'settings'])).toEqual({ ok: true })
    expect(m.getProjectConfig).not.toHaveBeenCalled(); expect(m.effectiveModules).not.toHaveBeenCalled()
  })
  it.each([
    ['설정 행 없음', new ConfigUnavailableError('프로젝트 설정 행이 없습니다')],
    ['손상 키', new ConfigKeyError('CONFIG_INVALID', 'modules.enabled')],
    ['임의 예외', new Error('boom')],
  ])('예외(%s)는 [requireModule] 로그 뒤 닫힌다(fail-closed)', async (_n, e) => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    m.effectiveModules.mockRejectedValue(e)
    expect(await requireModule({ projectId: PID }, 'issues')).toEqual({ ok: false, error: ERR_MODULE_DISABLED })
    expect(err.mock.calls[0][0]).toBe('[requireModule]')
  })
  it.each([
    ['동적 사용', { digest: 'DYNAMIC_SERVER_USAGE' }],
    ['notFound', { digest: 'NEXT_HTTP_ERROR_FALLBACK;404' }],
    ['redirect', { digest: 'NEXT_REDIRECT;replace;/login;307;' }],
  ])('Next 제어 흐름 신호(%s)는 삼키지 않고 다시 던진다 — cause 안에 든 것도', async (_n, sig) => {
    const signal = Object.assign(new Error('signal'), sig)
    m.getProjectConfig.mockRejectedValueOnce(signal)
    await expect(requireModule({ projectId: PID }, 'issues')).rejects.toBe(signal)
    m.getProjectConfig.mockRejectedValueOnce(new ConfigUnavailableError('wrapped', { cause: signal }))
    await expect(requireModule({ projectId: PID }, 'issues')).rejects.toBe(signal)
  })
  it('빈 목록은 프로그래밍 오류로 던진다(통과로 두지 않는다)', async () => {
    await expect(requireModule({ projectId: PID }, [])).rejects.toThrow('[requireModule]')
  })
})

describe('requireSessionModule — 대상 행이 없는 세션 판정(P13)', () => {
  it('projectId 가 있으면 그 프로젝트로', async () => {
    expect(await requireSessionModule(PID, 'issues')).toEqual({ ok: true })
    expect(m.getActor).not.toHaveBeenCalled()
  })
  it('없으면 행위자의 유일 워크스페이스로', async () => {
    m.getActor.mockResolvedValue(makeActor({ userId: 'u1', workspaceRoles: new Map([[WID, 'member']]) }))
    expect(await requireSessionModule(null, 'minutes')).toEqual({ ok: true })
    expect(m.effectiveModules).toHaveBeenCalledWith({ workspaceId: WID }, { client: undefined })
  })
  it.each([
    ['소속 0개', new Map()],
    ['소속 2개', new Map([[WID, 'member'], ['00000000-0000-0000-7e57-000000001403', 'admin']])],
  ])('%s 면 닫는다(R15)', async (_n, roles) => {
    m.getActor.mockResolvedValue(makeActor({ userId: 'u1', workspaceRoles: roles as Map<string, 'admin' | 'member'> }))
    expect(await requireSessionModule(null, 'minutes')).toEqual({ ok: false, error: ERR_MODULE_DISABLED })
    expect(m.effectiveModules).not.toHaveBeenCalled()
  })
  it('비로그인·권한 조회 실패는 닫는다. core 만 물으면 행위자를 읽지 않고 통과한다', async () => {
    m.getActor.mockResolvedValueOnce(null)
    expect(await requireSessionModule(null, 'minutes')).toEqual({ ok: false, error: ERR_MODULE_DISABLED })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    m.getActor.mockRejectedValueOnce(new Error('lookup'))
    expect(await requireSessionModule(null, 'minutes')).toEqual({ ok: false, error: ERR_MODULE_DISABLED })
    m.getActor.mockClear()
    expect(await requireSessionModule(null, 'wbs')).toEqual({ ok: true })
    expect(m.getActor).not.toHaveBeenCalled()
  })
})

describe('moduleState — 워커 3값(P10)', () => {
  it("켜짐 'on', 꺼짐 'off', 설정 없음·손상 'unknown', 그 밖의 예외는 던진다", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await moduleState({ projectId: PID }, 'issues', { client })).toBe('on')
    expect(await moduleState({ projectId: PID }, 'wiki', { client })).toBe('off')
    m.getProjectConfig.mockRejectedValueOnce(new ConfigUnavailableError('none'))
    expect(await moduleState({ projectId: PID }, 'issues', { client })).toBe('unknown')
    m.effectiveModules.mockRejectedValueOnce(new ConfigKeyError('CONFIG_INVALID', 'modules.allowed'))
    expect(await moduleState({ projectId: PID }, 'issues', { client })).toBe('unknown')
    m.effectiveModules.mockRejectedValueOnce(new Error('bug'))
    await expect(moduleState({ projectId: PID }, 'issues', { client })).rejects.toThrow('bug')
  })
})

describe('목록형(스펙 §4.2 첫 문단)', () => {
  it('projectsWithModule — 유효한 프로젝트만, 입력 순서, 중복 제거. 판정 실패는 뺀다', async () => {
    const P2 = '00000000-0000-0000-7e57-000000001404', P3 = '00000000-0000-0000-7e57-000000001405'
    m.getProjectConfig.mockImplementation(async (pid: string) => {
      if (pid === P3) throw new ConfigUnavailableError('x')
      return { projectId: pid, workspaceId: WID }
    })
    m.effectiveModules.mockImplementation(async (s: { projectId?: string }) => (s.projectId === P2 ? eff() : eff('agents')))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await projectsWithModule([PID, P2, P3, PID], 'agents', { client })).toEqual([PID])
  })
  it('workspacesWithModule', async () => {
    const W2 = '00000000-0000-0000-7e57-000000001406'
    m.effectiveModules.mockImplementation(async (s: { workspaceId: string }) => (s.workspaceId === W2 ? eff('minutes_integration') : eff()))
    expect(await workspacesWithModule([WID, W2], 'minutes_integration', { client })).toEqual([W2])
  })
})
