/**
 * effectiveModules(개정 §2.7.1) — env 가용 ∩ modules.allowed(∖ ai.enabled=false 면 AI_MODULES) ∩ (PROJECT_TOGGLABLE 에 한해) modules.enabled 로
 * 선택 모듈을 고른 뒤, core 를 먼저 합치고 closeRequires 로 닫는다(kanban·agents→wbs 가 살아남는다). 해석기 실패·손상은 그대로 throw —
 * requireModule(Phase B)이 받아 fail-closed 로 닫는다. 요청 안 캐시 하나(react cache). 프로세스 전역 캐시 없음.
 */
import { cache } from 'react'
import { getWorkspaceConfig } from '@/lib/settings/workspaceConfig'
import { getProjectConfig, type ConfigReadClient } from '@/lib/settings/projectConfig'
import { valueOf } from '@/lib/settings/registry'
import { AI_MODULES, PROJECT_TOGGLABLE, type ModuleId } from './defaults'
import { CORE, MODULES, moduleDef } from './registry'
import { closeRequires } from './closure'

async function compute(workspaceId: string, projectId: string | undefined, client: ConfigReadClient | undefined): Promise<ReadonlySet<ModuleId>> {
  const ws = await getWorkspaceConfig(workspaceId, { client })
  const allowed = new Set(valueOf(ws, 'modules.allowed'))          // invalid 면 ConfigKeyError throw(fail-closed)
  let optional = MODULES.filter((m) => !m.core && m.envAvailable() && allowed.has(m.id)).map((m) => m.id)
  if (valueOf(ws, 'ai.enabled') === false) optional = optional.filter((id) => !AI_MODULES.includes(id))
  if (projectId) {
    const enabled = new Set(valueOf(await getProjectConfig(projectId, { client }), 'modules.enabled'))
    optional = optional.filter((id) => !PROJECT_TOGGLABLE.has(id) || enabled.has(id))   // 워크스페이스 층 모듈은 통과
  }
  return closeRequires(new Set<ModuleId>([...CORE, ...optional]), (id) => moduleDef(id).requires)
}

const computeCached = cache(compute)

export function effectiveModules(scope: { workspaceId: string; projectId?: string }, opts?: { client?: ConfigReadClient }): Promise<ReadonlySet<ModuleId>> {
  return computeCached(scope.workspaceId, scope.projectId, opts?.client)
}
