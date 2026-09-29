/** 봇 도구의 capability 도메인을 모듈에 연결해, 꺼진 모듈의 도구와 범위를 제거한다. */
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
    const [projects, workspaces] = await Promise.all([
      Promise.all(input.allowedProjectIds.map(async (id) => [id, await moduleSetFor({ projectId: id })] as const)),
      Promise.all(input.workspaceIds.map(async (id) => [id, await moduleSetFor({ workspaceId: id })] as const)),
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
