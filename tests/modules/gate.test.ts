// requireModule·requireSessionModule·moduleState·목록 두 함수(스펙 §4.1·§4.2, 판정 P1·P2·P10·P13).
// 과제 3 뒤에는 tests/setup/module-gate.ts 가 '@/lib/modules/gate' 를 전역 mock 한다 — 여기서는 importActual 로 진짜를 쓴다.
import { beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ getProjectConfig: vi.fn(), effectiveModules: vi.fn(), effectiveModulesMany: vi.fn(), getActor: vi.fn() }))
vi.mock('@/lib/settings/projectConfig', () => ({ getProjectConfig: m.getProjectConfig }))
vi.mock('@/lib/modules/effective', () => ({ effectiveModules: m.effectiveModules }))
vi.mock('@/lib/modules/effectiveMany', () => ({ effectiveModulesMany: m.effectiveModulesMany }))
vi.mock('@/lib/authz', () => ({ getActor: m.getActor }))
import { ERR_MODULE_DISABLED } from '@/lib/authz/errors'
import { ConfigKeyError, ConfigUnavailableError } from '@/lib/settings/errors'
import type { ModuleId } from '@/lib/modules/defaults'
const { requireModule, requireSessionModule, moduleState, moduleSetFor, projectsWithModule, workspacesWithModule } =
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
  it('{ projectId } 면 해석기의 workspaceId 로 effectiveModules 를 부르고 client 를 둘 다에 넘긴다(E12) — 읽은 프로젝트 설정을 넘겨 다시 읽지 않는다(P27)', async () => {
    expect(await requireModule({ projectId: PID }, 'issues', { client })).toEqual({ ok: true })
    expect(m.getProjectConfig).toHaveBeenCalledWith(PID, { client })
    expect(m.effectiveModules).toHaveBeenCalledWith({ workspaceId: WID, projectId: PID }, { client, projectConfig: { projectId: PID, workspaceId: WID } })   // P27 — 읽은 설정을 넘긴다
    expect(m.getProjectConfig).toHaveBeenCalledTimes(1)
  })
  it('{ workspaceId } 면 프로젝트 해석기를 부르지 않는다. client 는 해석기에 그대로 넘긴다', async () => {
    expect(await requireModule({ workspaceId: WID }, 'minutes')).toEqual({ ok: true })
    expect(m.getProjectConfig).not.toHaveBeenCalled()
    expect(m.effectiveModules).toHaveBeenCalledWith({ workspaceId: WID }, { client: undefined })
    expect(await requireModule({ workspaceId: WID }, 'minutes', { client })).toEqual({ ok: true })
    expect(m.effectiveModules).toHaveBeenLastCalledWith({ workspaceId: WID }, { client })
  })
  it('꺼짐은 ERR_MODULE_DISABLED — 로그를 남기지 않는다(요청마다 쌓이지 않게)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await requireModule({ projectId: PID }, 'wiki')).toEqual({ ok: false, error: ERR_MODULE_DISABLED, code: 'module_disabled' })
    expect(err).not.toHaveBeenCalled()
  })
  it('목록은 전부 유효해야 통과한다(D18)', async () => {
    expect(await requireModule({ projectId: PID }, ['issues', 'minutes'])).toEqual({ ok: true })
    expect(await requireModule({ projectId: PID }, ['issues', 'wiki'])).toEqual({ ok: false, error: ERR_MODULE_DISABLED, code: 'module_disabled' })
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
    expect(await requireModule({ projectId: PID }, 'issues')).toEqual({ ok: false, error: ERR_MODULE_DISABLED, code: 'module_disabled' })
    expect(err.mock.calls[0][0]).toBe('[requireModule]')
    expect(err.mock.calls[0], '판정 범위를 로그에 싣는다(F2-3)').toContain(JSON.stringify({ projectId: PID }))
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
  it('projectId 가 있으면 그 프로젝트로 — 프로젝트에서 끈 모듈이면 거부한다(관문 우회 회귀를 문다)', async () => {
    expect(await requireSessionModule(PID, 'issues')).toEqual({ ok: true })
    expect(m.getActor).not.toHaveBeenCalled()
    expect(m.getProjectConfig).toHaveBeenCalledWith(PID, { client: undefined })
    expect(m.effectiveModules).toHaveBeenCalledWith({ workspaceId: WID, projectId: PID }, expect.objectContaining({ client: undefined }))
    m.effectiveModules.mockResolvedValueOnce(eff())
    expect(await requireSessionModule(PID, 'issues')).toEqual({ ok: false, error: ERR_MODULE_DISABLED, code: 'module_disabled' })
  })
  // 옮김(SP7 — resolveSoleWorkspaceId 삭제): '없으면 행위자의 유일 워크스페이스로'(통과)·'소속 0개/2개면 닫는다(R15)'·'비로그인·권한 조회 실패는 닫는다'.
  // 범위 없는 판정은 이제 행위자의 소속을 보지 않는다 — 소속이 몇 개든·로그인했든 core 가 아니면 닫힌다(예전 통과 한 갈래가 닫힘으로 좁아졌다).
  // 워크스페이스 범위의 통과는 requireModule({ workspaceId })(위 describe)와 requireScopedSessionModule(tests/modules/scoped-session.test.ts)이 본다.
  it.each([
    ['소속 1개', new Map([[WID, 'member']])],
    ['소속 0개', new Map()],
    ['소속 2개', new Map([[WID, 'member'], ['00000000-0000-0000-7e57-000000001403', 'admin']])],
  ])('projectId 가 없으면 닫는다 — %s 여도 소속에서 워크스페이스를 짐작하지 않는다(R15)', async (_n, roles) => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    m.getActor.mockResolvedValue({ userId: 'u1', workspaceRoles: roles })
    expect(await requireSessionModule(null, 'minutes')).toEqual({ ok: false, error: ERR_MODULE_DISABLED, code: 'module_disabled' })
    expect(await requireSessionModule(null, ['wbs', 'minutes'])).toEqual({ ok: false, error: ERR_MODULE_DISABLED, code: 'module_disabled' })
    expect(m.effectiveModules).not.toHaveBeenCalled()
    expect(m.getActor).not.toHaveBeenCalled()          // 행위자를 읽지도 않는다
  })
  it('core 만 물으면 범위 없이도 통과한다 — 설정도 행위자도 읽지 않는다', async () => {
    expect(await requireSessionModule(null, 'wbs')).toEqual({ ok: true })
    expect(await requireSessionModule(null, ['dashboard', 'settings'])).toEqual({ ok: true })
    expect(m.getActor).not.toHaveBeenCalled()
    expect(m.effectiveModules).not.toHaveBeenCalled()
  })
})

// 삭제(SP7): 'requireSessionModule — 신호: 행위자 조회의 Next 제어 흐름 신호는 다시 던진다(F2-2)' — 행위자 조회가 없어졌다. projectId 갈래의 신호 전파는
// requireModule 의 신호 케이스가 본다.

describe('moduleState — 워커 3값(P10)', () => {
  it("켜짐 'on', 꺼짐 'off', 설정 없음·손상 'unknown', 그 밖의 예외는 던진다", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await moduleState({ projectId: PID }, 'issues', { client })).toBe('on')
    expect(m.getProjectConfig).toHaveBeenCalledWith(PID, { client })
    expect(m.effectiveModules).toHaveBeenCalledWith({ workspaceId: WID, projectId: PID }, expect.objectContaining({ client }))
    expect(await moduleState({ projectId: PID }, 'wiki', { client })).toBe('off')
    m.getProjectConfig.mockRejectedValueOnce(new ConfigUnavailableError('none'))
    expect(await moduleState({ projectId: PID }, 'issues', { client })).toBe('unknown')
    m.effectiveModules.mockRejectedValueOnce(new ConfigKeyError('CONFIG_INVALID', 'modules.allowed'))
    expect(await moduleState({ projectId: PID }, 'issues', { client })).toBe('unknown')
    m.effectiveModules.mockRejectedValueOnce(new Error('bug'))
    await expect(moduleState({ projectId: PID }, 'issues', { client })).rejects.toThrow('bug')
  })
  it("요청이 전부 core 면 설정을 읽지 않고 'on'(F2-2 — P2 와 같은 단락)", async () => {
    m.getProjectConfig.mockRejectedValue(new ConfigUnavailableError('down'))
    expect(await moduleState({ projectId: PID }, 'wbs', { client })).toBe('on')
    expect(m.getProjectConfig).not.toHaveBeenCalled(); expect(m.effectiveModules).not.toHaveBeenCalled()
  })
})

describe('moduleSetFor — 한 스코프에서 여러 모듈을 볼 때 설정을 한 번 읽는다', () => {
  it('유효 집합과 client 를 그대로 넘긴다', async () => {
    expect(await moduleSetFor({ projectId: PID }, { client })).toEqual(eff('issues', 'minutes'))
    expect(m.getProjectConfig).toHaveBeenCalledWith(PID, { client })
    expect(m.effectiveModules).toHaveBeenCalledWith({ workspaceId: WID, projectId: PID }, {
      client, projectConfig: { projectId: PID, workspaceId: WID },
    })
  })

  it('설정 조회가 실패하면 로그를 남기고 core 만 돌려준다', async () => {
    m.effectiveModules.mockRejectedValue(new ConfigUnavailableError('down'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await moduleSetFor({ workspaceId: WID })).toEqual(eff())
    expect(error).toHaveBeenCalledWith('[moduleSetFor]', 'down')
    error.mockRestore()
  })

  it('[X2] strict 면 로그를 남긴 뒤 그 오류를 다시 던진다 — core 로 닫지 않는다(봇 도구의 워크스페이스 범위)', async () => {
    const down = new ConfigUnavailableError('down')
    m.effectiveModules.mockRejectedValue(down)
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(moduleSetFor({ workspaceId: WID }, { strict: true })).rejects.toBe(down)
    expect(error).toHaveBeenCalledWith('[moduleSetFor]', 'down')
    expect(await moduleSetFor({ workspaceId: WID }, { strict: false })).toEqual(eff())
    error.mockRestore()
  })

  it('Next 제어 흐름 신호는 삼키지 않고 다시 던진다 — requireModule 과 같은 닫힘의 절반이다', async () => {
    // 신호(dynamic 사용·notFound·redirect)를 삼키면 core 만 허용한 뒤 **성공한 것처럼** 넘어간다 — 호출부가
    // 404 를 내야 할 자리에 도구 목록만 비어 있는 200 이 나온다.
    for (const digest of ['DYNAMIC_SERVER_USAGE', 'NEXT_HTTP_ERROR_FALLBACK;404', 'NEXT_REDIRECT;replace;/login;307;']) {
      const signal = Object.assign(new Error('signal'), { digest })
      m.effectiveModules.mockRejectedValueOnce(signal)
      await expect(moduleSetFor({ workspaceId: WID })).rejects.toBe(signal)
      m.effectiveModules.mockRejectedValueOnce(new ConfigUnavailableError('wrapped', { cause: signal }))
      await expect(moduleSetFor({ workspaceId: WID })).rejects.toBe(signal)
    }
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
    // 세션 없는 경로(워커·v1·회의록 API)가 넘긴 client 가 프로젝트마다 해석기까지 간다
    for (const pid of [PID, P2, P3]) expect(m.getProjectConfig).toHaveBeenCalledWith(pid, { client })
    for (const pid of [PID, P2]) expect(m.effectiveModules).toHaveBeenCalledWith({ workspaceId: WID, projectId: pid }, expect.objectContaining({ client }))
  })
  // SP7 — 워크스페이스를 받으면 프로젝트마다 설정을 읽지 않고 한 번에 판정한다(에이전트 API 의 me·work/mine·watch)
  it('projectsWithModule({ workspaceId }) — effectiveModulesMany 한 번, 프로젝트별 해석기는 부르지 않는다. 입력 순서·중복 제거, 실패·미포함은 뺀다', async () => {
    const P2 = '00000000-0000-0000-7e57-000000001404', P3 = '00000000-0000-0000-7e57-000000001405', P4 = '00000000-0000-0000-7e57-000000001407'
    // P2: agents 꺼짐 · P3: 판정 실패(failed — sets 에 없다) · P4: 켜짐
    m.effectiveModulesMany.mockResolvedValue({ sets: new Map([[PID, eff('agents')], [P2, eff('issues')], [P4, eff('agents', 'issues')]]), failed: [P3] })
    expect(await projectsWithModule([P4, PID, P2, P3, PID], 'agents', { client, workspaceId: WID })).toEqual([P4, PID])
    expect(m.effectiveModulesMany).toHaveBeenCalledTimes(1)
    expect(m.effectiveModulesMany).toHaveBeenCalledWith(WID, [P4, PID, P2, P3], { client })
    expect(m.getProjectConfig).not.toHaveBeenCalled()
    expect(m.effectiveModules).not.toHaveBeenCalled()
    // 목록은 전부 유효해야 한다(D18)
    expect(await projectsWithModule([P4, PID], ['agents', 'issues'], { client, workspaceId: WID })).toEqual([P4])
  })
  it('projectsWithModule({ workspaceId }) — 워크스페이스 설정을 읽지 못하면 전부 뺀다(fail-closed, 로그). 빈 입력·core 는 읽지 않는다. Next 신호는 다시 던진다', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    m.effectiveModulesMany.mockRejectedValueOnce(new ConfigUnavailableError('down'))
    expect(await projectsWithModule([PID], 'agents', { client, workspaceId: WID })).toEqual([])
    expect(err).toHaveBeenCalledWith('[projectsWithModule]', 'agents', JSON.stringify({ workspaceId: WID }), expect.stringContaining('down'))
    m.effectiveModulesMany.mockClear()
    expect(await projectsWithModule([], 'agents', { client, workspaceId: WID })).toEqual([])
    expect(await projectsWithModule([PID, PID], 'wbs', { client, workspaceId: WID })).toEqual([PID])
    expect(m.effectiveModulesMany).not.toHaveBeenCalled()
    const signal = Object.assign(new Error('s'), { digest: 'DYNAMIC_SERVER_USAGE' })
    m.effectiveModulesMany.mockRejectedValueOnce(signal)
    await expect(projectsWithModule([PID], 'agents', { client, workspaceId: WID })).rejects.toBe(signal)
    await expect(projectsWithModule([PID], [], { client, workspaceId: WID })).rejects.toThrow('[projectsWithModule]')
  })
  it('workspacesWithModule', async () => {
    const W2 = '00000000-0000-0000-7e57-000000001406'
    m.effectiveModules.mockImplementation(async (s: { workspaceId: string }) => (s.workspaceId === W2 ? eff('minutes_integration') : eff()))
    expect(await workspacesWithModule([WID, W2], 'minutes_integration', { client })).toEqual([W2])
    for (const w of [WID, W2]) expect(m.effectiveModules).toHaveBeenCalledWith({ workspaceId: w }, { client })
  })
})
