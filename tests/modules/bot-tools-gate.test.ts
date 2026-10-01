import { afterEach, describe, expect, it, vi } from 'vitest'
import { moduleSetFor, moduleState, projectsWithModule, requireModule, requireSessionModule, workspacesWithModule } from '@/lib/modules/gate'
import { MODULE_IDS, type ModuleId } from '@/lib/modules/defaults'
import { createChatToolRegistry, type ChatTool } from '@/lib/ai/chat/registry'
import { ChatToolGateUnavailableError, gateChatTools } from '@/lib/ai/chat/tool-modules'
import { ConfigUnavailableError } from '@/lib/settings/errors'
import { BOT_READ_CAPABILITIES, type BotReadCapability } from '@/lib/ai/tools/types'

const P1 = 'p-1', P2 = 'p-2', W = 'w-1'
const tool = (name: string, capability: BotReadCapability): ChatTool => ({
  name, requiredCapability: capability,
  execute: vi.fn(async (...args: unknown[]) => ({ ok: true, result: args[1] })),
}) as unknown as ChatTool
const registry = () => createChatToolRegistry([
  tool('find_wbs_items', 'wbs:read'), tool('get_weekly_sheet', 'weekly:read'),
  tool('compare_weekly_sheets', 'weekly:read'), tool('search_minutes', 'minutes:read'),
])
const ALL = new Set<ModuleId>(MODULE_IDS)
const without = (...disabled: ModuleId[]) => new Set<ModuleId>(MODULE_IDS.filter((module) => !disabled.includes(module)))
const input = (projectId: string | null) => ({
  projectId, allowedProjectIds: [P1, P2], workspaceIds: [W], capabilities: [...BOT_READ_CAPABILITIES],
})
afterEach(() => {
  for (const fn of [requireModule, requireSessionModule, moduleState, moduleSetFor, projectsWithModule, workspacesWithModule]) vi.mocked(fn).mockReset()
})

describe('프로젝트 문맥의 봇 도구', () => {
  it('weekly 가 꺼지면 주간 도구 둘과 weekly:read 를 뺀다', async () => {
    vi.mocked(moduleSetFor).mockResolvedValue(without('weekly'))
    const gated = await gateChatTools(registry(), input(P1))
    expect(gated.registry.names()).toEqual(['find_wbs_items', 'search_minutes'])
    expect(gated.capabilities).not.toContain('weekly:read')
    expect(gated.capabilities).toEqual(expect.arrayContaining(['wbs:read', 'minutes:read']))
    expect(moduleSetFor).toHaveBeenCalledTimes(1)
    expect(moduleSetFor).toHaveBeenCalledWith({ projectId: P1 })
  })

  it('chatbot 이 꺼지면 도구와 capability 를 모두 뺀다', async () => {
    vi.mocked(moduleSetFor).mockResolvedValue(without('chatbot'))
    const gated = await gateChatTools(registry(), input(P1))
    expect(gated.registry.names()).toEqual([])
    expect(gated.capabilities).toEqual([])
  })
})

describe('프로젝트 문맥이 없는 봇 도구', () => {
  it('꺼진 프로젝트를 그 도구의 조회 범위에서 뺀다', async () => {
    vi.mocked(moduleSetFor).mockImplementation(async (scope) => 'projectId' in scope && scope.projectId === P2 ? without('weekly') : ALL)
    const gated = await gateChatTools(registry(), input(null))
    const weekly = await gated.registry.get('get_weekly_sheet')!.execute({}, { allowedProjectIds: [P1, P2], workspaceIds: [W] } as never)
    expect(weekly).toMatchObject({ ok: true, result: { allowedProjectIds: [P1] } })
    const wbs = await gated.registry.get('find_wbs_items')!.execute({}, { allowedProjectIds: [P1, P2] } as never)
    expect(wbs).toMatchObject({ ok: true, result: { allowedProjectIds: [P1, P2] } })
  })

  it('켜진 프로젝트가 없으면 도구와 capability 도 뺀다', async () => {
    vi.mocked(moduleSetFor).mockImplementation(async (scope) => 'projectId' in scope ? without('weekly') : ALL)
    const gated = await gateChatTools(registry(), input(null))
    expect(gated.registry.names()).not.toContain('get_weekly_sheet')
    expect(gated.capabilities).not.toContain('weekly:read')
  })

  it('회의록 도구는 워크스페이스로 판정한다', async () => {
    vi.mocked(moduleSetFor).mockImplementation(async (scope) => 'workspaceId' in scope ? without('minutes') : ALL)
    const gated = await gateChatTools(registry(), input(null))
    expect(gated.registry.names()).not.toContain('search_minutes')
    expect(gated.registry.names()).toContain('find_wbs_items')
  })

  it('chatbot 이 꺼진 프로젝트는 어떤 도구의 조회 범위에도 남지 않는다', async () => {
    // 라우트는 `requireSessionModule(…, 'chatbot')` 로 시작하지만 `scope.projectId` 가 null 인 갈래(화면 문맥에 프로젝트가
    // 없는 전체 질문)는 `allowedProjectIds` 안에 **챗봇이 꺼진 프로젝트를 그대로** 품고 온다. 그 갈래를 메우는 것이
    // `enabledIds` 의 `enabled.has('chatbot')` 절이다 — 도구 소스는 RLS/스코프가 아니라 narrowed() 가 넘긴 목록으로 본다.
    vi.mocked(moduleSetFor).mockImplementation(async (scope) => (
      'projectId' in scope && scope.projectId === P2 ? without('chatbot') : ALL
    ))
    const gated = await gateChatTools(registry(), input(null))
    const weekly = await gated.registry.get('get_weekly_sheet')!.execute({}, { allowedProjectIds: [P1, P2] } as never)
    expect(weekly).toMatchObject({ ok: true, result: { allowedProjectIds: [P1] } })
    const wbs = await gated.registry.get('find_wbs_items')!.execute({}, { allowedProjectIds: [P1, P2] } as never)
    expect(wbs).toMatchObject({ ok: true, result: { allowedProjectIds: [P1] } })
  })

  it('프로젝트 문맥이 없어도 설정을 스코프당 한 번만 읽는다 — 도구마다 다시 읽지 않는다', async () => {
    // 브리프 첫 문장("모듈마다 다시 읽지 않도록")이 참인 형태는 스코프당 한 번이다.
    // 프로젝트 문맥 쪽은 toHaveBeenCalledTimes(1) 로 고정돼 있는데 이 갈래는 그게 없다 — 모듈 N × 스코프 M 으로 늘어난다.
    vi.mocked(moduleSetFor).mockResolvedValue(ALL)
    await gateChatTools(registry(), input(null))
    expect(moduleSetFor).toHaveBeenCalledTimes(input(null).allowedProjectIds.length + input(null).workspaceIds.length)
  })

  it('[X2] 워크스페이스 모듈 설정을 못 읽으면 좁히지 않고 던진다 — 그 워크스페이스만 빠지고 그 안 프로젝트가 남으면 팀 가시 범위의 전제가 깨진다', async () => {
    const down = new ConfigUnavailableError('down')
    vi.mocked(moduleSetFor).mockImplementation(async (scope, opts) => {
      if ('workspaceId' in scope) { expect(opts).toEqual({ strict: true }); throw down }
      return ALL
    })
    const err = await gateChatTools(registry(), input(null)).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ChatToolGateUnavailableError)
    expect((err as ChatToolGateUnavailableError).code).toBe('MODULES_UNAVAILABLE')
    expect((err as Error).cause).toBe(down)
  })

  it('[X2] 프로젝트 설정 실패는 그대로 그 프로젝트만 닫는다(core) — 범위가 줄 뿐 전제는 깨지지 않는다', async () => {
    vi.mocked(moduleSetFor).mockImplementation(async (scope) => (
      'projectId' in scope && scope.projectId === P2 ? new Set<ModuleId>(['dashboard', 'wbs', 'members', 'settings']) : ALL
    ))
    const gated = await gateChatTools(registry(), input(null))
    const wbs = await gated.registry.get('find_wbs_items')!.execute({}, { allowedProjectIds: [P1, P2] } as never)
    expect(wbs).toMatchObject({ ok: true, result: { allowedProjectIds: [P1], workspaceIds: [W] } })
    expect(moduleSetFor).toHaveBeenCalledWith({ projectId: P2 })
  })

  it('설정 판정이 실패하면(core 만 반환) 도구 0·capability 0 으로 닫힌다 — 챗봇이 꺼진 것과 같은 결론이다', async () => {
    // T23-m2 — `moduleSetFor` 실패는 `CORE` 만 돌려주고 CORE 에 `chatbot` 이 없다. 즉 "판정 실패" 와 "chatbot 꺼짐" 이
    // **같은 결과**(빈 집합)로 번역된다. fail-closed 라 의도된 방향이고 고치지 않는다. 다만 두 경우의 의미가 다르다
    // (설정 장애는 전역이고 잠깐이다) — 어느 날 판별이 필요해질 때를 위해 "닫힘" 을 여기서 박아 둔다.
    vi.mocked(moduleSetFor).mockResolvedValue(new Set<ModuleId>(['dashboard', 'wbs', 'members', 'settings']))
    const gated = await gateChatTools(registry(), input(P1))
    expect(gated.registry.names()).toEqual([])
    expect(gated.capabilities).toEqual([])
  })
})
