/**
 * 여러 프로젝트의 effective 모듈(D39) — 포털·내 업무·'내 업무' 배지가 쓴다. 워크스페이스 설정 1회 + 프로젝트 설정 in() 1회(끝까지, D51).
 * 결과는 프로젝트마다 effectiveModules 를 부른 값과 같다(tests/modules/effective-many.test.ts 동치). effective.ts·gate.ts(A·B)를 고치지 않으려고
 * 새 파일이다 — 규칙(env 가용 ∩ allowed ∖ ai 꺼짐 ∩ 프로젝트 enabled, core 합집합, requires 닫힘)이 바뀌면 이 파일도 함께 바꾸고 동치 테스트가 잡는다.
 * 프로젝트 하나의 실패(행 없음·values 손상·워크스페이스 불일치(CR-5)·modules.enabled 손상)는 failed 로 — 그 프로젝트의 원천은 부분 실패다.
 */
import { createServerClient } from '@/lib/supabase/server'
import { fetchAllPages } from '@/lib/data/paging'
import { getWorkspaceConfig } from '@/lib/settings/workspaceConfig'
import type { ConfigReadClient, ProjectConfig } from '@/lib/settings/projectConfig'
import { PROJECT_SETTINGS, valueOf } from '@/lib/settings/registry'
import { isRecord, resolveKeys } from '@/lib/settings/resolve'
import { AI_MODULES, PROJECT_TOGGLABLE, type ModuleId } from './defaults'
import { CORE, MODULES, moduleDef } from './registry'
import { closeRequires } from './closure'

type Row = { project_id: string; values: unknown; projects: { workspace_id: string } | null }

export async function effectiveModulesMany(
  workspaceId: string, projectIds: readonly string[], opts?: { client?: ConfigReadClient },
): Promise<{ sets: Map<string, ReadonlySet<ModuleId>>; failed: string[] }> {
  const ids = [...new Set(projectIds)]
  if (ids.length === 0) return { sets: new Map(), failed: [] }
  const client = opts?.client ?? (await createServerClient())
  const ws = await getWorkspaceConfig(workspaceId, { client })                 // 실패는 throw — 호출부가 원천 실패로 받는다
  const allowed = new Set(valueOf(ws, 'modules.allowed'))
  let optional = MODULES.filter((m) => !m.core && m.envAvailable() && allowed.has(m.id)).map((m) => m.id)
  if (valueOf(ws, 'ai.enabled') === false) optional = optional.filter((id) => !AI_MODULES.includes(id))

  const rows = await fetchAllPages<Row>('프로젝트 설정(여러 프로젝트)', (from, to) => client.from('project_settings')
    .select('project_id, values, projects!inner(workspace_id)', { count: 'exact' })
    .in('project_id', ids).order('project_id').range(from, to) as unknown as PromiseLike<{ data: Row[] | null; error: { message: string } | null; count: number | null }>)
  const byId = new Map(rows.map((r) => [r.project_id, r]))
  const sets = new Map<string, ReadonlySet<ModuleId>>()
  const failed: string[] = []
  for (const pid of ids) {
    const r = byId.get(pid)
    if (!r || r.projects?.workspace_id !== workspaceId || !isRecord(r.values)) {
      console.error('[effectiveModulesMany] 프로젝트 설정을 판정하지 못했다', { workspaceId, projectId: pid, reason: !r ? 'no-row' : r.projects?.workspace_id !== workspaceId ? 'workspace-mismatch' : 'values' })
      failed.push(pid); continue
    }
    const { keys } = resolveKeys({ scope: 'project', id: pid, values: r.values, defs: PROJECT_SETTINGS })
    let enabled: Set<ModuleId>
    try { enabled = new Set(valueOf({ keys } as unknown as ProjectConfig, 'modules.enabled')) } catch (e) {
      console.error('[effectiveModulesMany] modules.enabled 손상', { projectId: pid, error: e instanceof Error ? e.message : e })
      failed.push(pid); continue
    }
    const chosen = optional.filter((id) => !PROJECT_TOGGLABLE.has(id) || enabled.has(id))
    sets.set(pid, closeRequires(new Set<ModuleId>([...CORE, ...chosen]), (id) => moduleDef(id).requires))
  }
  return { sets, failed }
}
