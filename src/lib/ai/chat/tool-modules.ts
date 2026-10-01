/** 봇 도구의 capability 도메인을 모듈에 연결해, 꺼진 모듈의 도구와 범위를 제거한다. */
import { unstable_rethrow } from 'next/navigation'
import { moduleSetFor } from '@/lib/modules/gate'
import { MODULES, moduleDef } from '@/lib/modules/registry'
import type { ModuleId } from '@/lib/modules/defaults'
import type { BotReadCapability } from '@/lib/ai/tools/types'
import { createChatToolRegistry, type ChatTool, type ChatToolRegistry } from './registry'

export function moduleOfCapability(capability: BotReadCapability): ModuleId {
  const domain = capability.slice(0, capability.indexOf(':'))
  const matches = MODULES.filter((module) => (module.botDomains as readonly string[]).includes(domain))
  if (matches.length !== 1) throw new Error(`[tool-modules] ${capability} 의 모듈이 ${matches.length}개다`)
  return matches[0].id
}

export interface ChatToolGateInput {
  projectId: string | null
  allowedProjectIds: readonly string[]
  workspaceIds: readonly string[]
  capabilities: readonly BotReadCapability[]
}

/** 워크스페이스 모듈 설정을 읽지 못했다 — 라우트가 503 으로 드러낸다(조용히 좁히지 않는다, 3원칙 ①) */
export class ChatToolGateUnavailableError extends Error {
  readonly code = 'MODULES_UNAVAILABLE' as const
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ChatToolGateUnavailableError'
  }
}

type ScopeSets = ReadonlyArray<readonly [string, ReadonlySet<ModuleId>]>
const enabledIds = (sets: ScopeSets, moduleId: ModuleId) => sets
  .filter(([, enabled]) => enabled.has('chatbot') && enabled.has(moduleId))
  .map(([id]) => id)

function narrowed(tool: ChatTool, allowedProjectIds: readonly string[], workspaceIds: readonly string[]): ChatTool {
  return { ...tool, execute: (args, context) => tool.execute(args, { ...context, allowedProjectIds, workspaceIds }) }
}

export async function gateChatTools(
  registry: ChatToolRegistry, input: ChatToolGateInput,
): Promise<{ registry: ChatToolRegistry; capabilities: BotReadCapability[] }> {
  const tools = registry.names().map((name) => registry.get(name)).filter((tool): tool is ChatTool => tool !== undefined)
  let kept: ChatTool[]
  if (input.projectId) {
    const enabled = await moduleSetFor({ projectId: input.projectId })
    kept = enabled.has('chatbot') ? tools.filter((tool) => enabled.has(moduleOfCapability(tool.requiredCapability))) : []
  } else {
    // 프로젝트 읽기 실패는 그 프로젝트만 닫는다(core — T23-m2). 워크스페이스 읽기 실패는 닫지 않고 던진다: 그 워크스페이스만 빠지고 그 안의
    // 프로젝트는 남으면 "볼 수 있는 프로젝트 ⊆ 보이는 워크스페이스" 전제(visibleTeams 의 질의 범위 — TeamView)가 깨져 그 프로젝트의 전용 팀이
    // 담당 필터에서 조용히 빠진다(A2-3 리뷰 보안 P3 — X2). 라우트가 503 MODULES_UNAVAILABLE 로 드러낸다
    const [projects, workspaces] = await Promise.all([
      Promise.all(input.allowedProjectIds.map(async (id) => [id, await moduleSetFor({ projectId: id })] as const)),
      Promise.all(input.workspaceIds.map(async (id) => {
        try {
          return [id, await moduleSetFor({ workspaceId: id }, { strict: true })] as const
        } catch (e) {
          unstable_rethrow(e)
          throw new ChatToolGateUnavailableError('워크스페이스 모듈 설정을 읽지 못했습니다.', { cause: e })
        }
      })),
    ])
    kept = []
    for (const tool of tools) {
      const moduleId = moduleOfCapability(tool.requiredCapability)
      const projectIds = enabledIds(projects, moduleId)
      const workspaceIds = enabledIds(workspaces, moduleId)
      if ((moduleDef(moduleId).scope === 'workspace' ? workspaceIds : projectIds).length === 0) continue
      kept.push(narrowed(tool, projectIds, workspaceIds))
    }
  }
  const capabilities = input.capabilities.filter((capability) => kept.some((tool) => tool.requiredCapability === capability))
  return { registry: createChatToolRegistry(kept), capabilities }
}
