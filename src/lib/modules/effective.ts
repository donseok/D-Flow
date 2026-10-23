/**
 * effectiveModules(개정 §2.7.1) — env 가용 ∩ modules.allowed(∖ ai.enabled=false 면 AI_MODULES) ∩ (PROJECT_TOGGLABLE 에 한해) modules.enabled 로
 * 선택 모듈을 고른 뒤, core 를 먼저 합치고 closeRequires 로 닫는다(kanban·agents→wbs 가 살아남는다). 해석기 실패·손상은 그대로 throw —
 * requireModule(Phase B)이 받아 fail-closed 로 닫는다. 요청 안 캐시 하나(react cache). 프로세스 전역 캐시 없음.
 * projectConfig 를 받으면 다시 읽지 않는다(관문 — 라우트·액션·워커는 react cache 밖이다).
 */
import { requestCache as cache } from '@/lib/server/requestCache'
import { getWorkspaceConfig } from '@/lib/settings/workspaceConfig'
import { getProjectConfig, type ConfigReadClient, type ProjectConfig } from '@/lib/settings/projectConfig'
import { ConfigUnavailableError, ERR_CONFIG_UNAVAILABLE } from '@/lib/settings/errors'
import { valueOf } from '@/lib/settings/registry'
import { AI_MODULES, PROJECT_TOGGLABLE, type ModuleId } from './defaults'
import { CORE, MODULES, moduleDef } from './registry'
import { closeRequires } from './closure'

async function compute(
  workspaceId: string, projectId: string | undefined, client: ConfigReadClient | undefined, projectConfig: ProjectConfig | undefined,
): Promise<ReadonlySet<ModuleId>> {
  // 프로젝트 없이 받은 프로젝트 설정은 프로그래밍 오류다 — 조용히 무시하면 프로젝트 토글과 CR-5 검사가 둘 다 빠진다(관문은 로그 뒤 닫힘)
  if (projectConfig && !projectId) throw new Error('[effectiveModules] projectConfig 는 projectId 와 함께')
  // 워크스페이스 설정과 프로젝트 설정은 서로를 기다릴 이유가 없다(둘 다 id 만으로 읽는다) — 예전에는 워크스페이스 설정을 끝낸 뒤 프로젝트 설정을 읽어
  // 범위 레이아웃의 모듈 판정이 직렬 두 단계 + 프로젝트 설정 안의 두 단계였다. 관문이 프로젝트 설정을 이미 읽어 넘기면(projectConfig) 그것을 쓴다.
  // 한쪽이 실패해도 다른 쪽 약속이 처리되지 않은 거절로 남지 않게 둘 다 받아 두고(allSettled) 워크스페이스 설정의 실패를 먼저 던진다 — 예전 순서와 같다.
  const [wsR, pcfgR] = await Promise.allSettled([
    getWorkspaceConfig(workspaceId, { client }),
    projectId ? (projectConfig ? Promise.resolve(projectConfig) : getProjectConfig(projectId, { client })) : Promise.resolve(undefined),
  ])
  if (wsR.status === 'rejected') throw wsR.reason
  const ws = wsR.value
  const allowed = new Set(valueOf(ws, 'modules.allowed'))          // invalid 면 ConfigKeyError throw(fail-closed)
  let optional = MODULES.filter((m) => !m.core && m.envAvailable() && allowed.has(m.id)).map((m) => m.id)
  if (valueOf(ws, 'ai.enabled') === false) optional = optional.filter((id) => !AI_MODULES.includes(id))
  if (projectId) {
    if (pcfgR.status === 'rejected') throw pcfgR.reason
    const pcfg = pcfgR.value as ProjectConfig   // P27 — 관문이 이미 읽었으면 다시 읽지 않는다(위에서 같은 단계로 읽었다)
    // 프로젝트의 워크스페이스가 정본이다(CR-5) — 어긋나면 다른 워크스페이스의 허용 목록으로 판정하게 되므로 닫는다(관문은 모르면 닫힘)
    if (pcfg.projectId !== projectId || pcfg.workspaceId !== workspaceId) {
      throw new ConfigUnavailableError(`${ERR_CONFIG_UNAVAILABLE} (프로젝트 ${projectId} 가 워크스페이스 ${workspaceId} 소속이 아니다)`)
    }
    const enabled = new Set(valueOf(pcfg, 'modules.enabled'))
    optional = optional.filter((id) => !PROJECT_TOGGLABLE.has(id) || enabled.has(id))   // 워크스페이스 층 모듈은 통과
  }
  return closeRequires(new Set<ModuleId>([...CORE, ...optional]), (id) => moduleDef(id).requires)
}

const computeCached = cache(compute)

export function effectiveModules(
  scope: { workspaceId: string; projectId?: string },
  opts?: { client?: ConfigReadClient; projectConfig?: ProjectConfig },
): Promise<ReadonlySet<ModuleId>> {
  return computeCached(scope.workspaceId, scope.projectId, opts?.client, opts?.projectConfig)
}
