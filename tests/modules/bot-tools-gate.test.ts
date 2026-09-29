import { afterEach, describe, expect, it, vi } from 'vitest'
import { moduleSetFor, moduleState, projectsWithModule, requireModule, requireSessionModule, workspacesWithModule } from '@/lib/modules/gate'
import { MODULE_IDS, type ModuleId } from '@/lib/modules/defaults'
import { createChatToolRegistry, type ChatTool } from '@/lib/ai/chat/registry'
import { gateChatTools } from '@/lib/ai/chat/tool-modules'
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
})
