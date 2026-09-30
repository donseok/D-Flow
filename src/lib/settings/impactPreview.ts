import 'server-only'
import { fetchAllPages } from '@/lib/data/paging'
import { PROJECT_TOGGLABLE, type ModuleId } from '@/lib/modules/defaults'
import type { AdminClient } from '@/lib/supabase/adminFor'
import { getProjectConfig } from './projectConfig'
import { valueOf } from './registry'

export interface ModuleAllowImpact {
  removed: { moduleId: ModuleId; projectCount: number }[]
  affectedProjects: number
}

/** 허용 목록을 좁힐 때 영향을 받는 프로젝트 수. 조회 실패·손상은 숫자 0으로 위장하지 않는다. */
export async function previewModuleAllowImpact(
  admin: AdminClient,
  args: { workspaceId: string; before: readonly ModuleId[]; next: readonly ModuleId[] },
): Promise<ModuleAllowImpact> {
  const removed = args.before.filter(id => !args.next.includes(id))
  if (removed.length === 0) return { removed: [], affectedProjects: 0 }

  const projects = await fetchAllPages<{ id: string }>('영향 대상 프로젝트', (from, to) =>
    admin.from('projects').select('id', { count: 'exact' }).eq('workspace_id', args.workspaceId).order('id').range(from, to))
  const counts = new Map<ModuleId, number>(removed.map(id => [id, 0]))
  const toggled = removed.filter(id => PROJECT_TOGGLABLE.has(id))
  let affectedProjects = 0
  for (const project of projects) {
    const enabled = toggled.length ? valueOf(await getProjectConfig(project.id, { client: admin }), 'modules.enabled') : []
    const affected = removed.filter(id => !PROJECT_TOGGLABLE.has(id) || enabled.includes(id))
    if (affected.length) affectedProjects += 1
    for (const id of affected) counts.set(id, counts.get(id)! + 1)
  }
  return { removed: removed.map(moduleId => ({ moduleId, projectCount: counts.get(moduleId)! })), affectedProjects }
}
