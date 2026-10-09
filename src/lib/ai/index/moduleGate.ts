import { moduleState, projectsWithModule, workspacesWithModule, type ModuleState } from '@/lib/modules/gate'
import type { ConfigReadClient } from '@/lib/settings/projectConfig'
import { fetchAllPages, type PageResult } from '@/lib/data/paging'
import type { ClaimedIndexJob, IndexMutation } from './types'

export const MODULE_DISABLED_ERROR = 'module_disabled'
export const CONFIG_UNAVAILABLE_ERROR = 'CONFIG_UNAVAILABLE'

export type IndexJobRef = Pick<IndexMutation, 'projectId' | 'workspaceId' | 'domain' | 'entityId'> & { jobKey?: string }

export interface IndexJobModuleGate {
  state(job: IndexJobRef): Promise<ModuleState>
  skip(job: ClaimedIndexJob): Promise<boolean>
}

export function createIndexJobModuleGate(db: ConfigReadClient): IndexJobModuleGate {
  return {
    async state(job) {
      if (job.projectId) return moduleState({ projectId: job.projectId }, 'chatbot', { client: db })
      if (job.domain !== 'minutes') {
        // 프로젝트 없는 잡은 그 행의 워크스페이스로 판정한다(0036 — 잡 행이 워크스페이스를 갖고 있다). 그것도 없으면 범위를 모른다.
        if (job.workspaceId) return moduleState({ workspaceId: job.workspaceId }, 'chatbot', { client: db })
        console.error(`[index-worker] 프로젝트 없는 ${job.domain} 잡 — 판정할 범위가 없다(job ${job.jobKey ?? job.entityId})`)
        return 'unknown'
      }
      const { data, error } = await db.from('minutes').select('workspace_id').eq('id', job.entityId).maybeSingle()
      if (error) {
        console.error('[index-worker] 회의록 워크스페이스 조회 실패:', error.message)
        return 'unknown'
      }
      // 원본이 이미 삭제됐다면 기존 색인 청크를 지우는 작업은 계속 진행한다.
      if (!data) return 'on'
      return moduleState({ workspaceId: (data as { workspace_id: string }).workspace_id }, 'chatbot', { client: db })
    },
    async skip(job) {
      const { data, error } = await db.from('ai_index_jobs')
        .update({ status: 'skipped', last_error: MODULE_DISABLED_ERROR, locked_at: null, updated_at: new Date().toISOString() })
        .eq('id', job.id).eq('status', 'running').select('id')
      if (error) throw new Error(`INDEX_JOB_SKIP_FAILED:${error.code ?? 'UNKNOWN'}`)
      return Array.isArray(data) && data.length > 0
    },
  }
}

/** 백필과 정합성 검사에서는 켜진 프로젝트의 변경만 큐에 넣는다. */
export async function keepEnabledMutations<M extends IndexMutation>(gate: IndexJobModuleGate, mutations: readonly M[]): Promise<M[]> {
  const memo = new Map<string, Promise<ModuleState>>()
  const stateOf = (mutation: M): Promise<ModuleState> => {
    const key = mutation.projectId ?? `${mutation.domain}:${mutation.entityId}`
    let state = memo.get(key)
    if (!state) {
      state = gate.state(mutation).catch(() => 'unknown' as const)
      memo.set(key, state)
    }
    return state
  }
  const states = await Promise.all(mutations.map(stateOf))
  const kept = mutations.filter((_, index) => states[index] === 'on')
  if (kept.length < mutations.length) console.info(`[index-worker] 모듈 꺼짐·모름 — 변경 ${mutations.length - kept.length}건을 큐에 넣지 않았다`)
  return kept
}

export type WikiJobTarget =
  | { table: 'wiki_processing_jobs'; id: number; projectId: string; lockedBy: string }
  | { table: 'wiki_project_rebuild_jobs'; projectId: string; lockedBy: string }

/** 위키 잡은 선점 직후 프로젝트 설정을 보고, 꺼졌으면 선점한 행만 skipped 로 닫는다. */
export async function gateWikiJob(db: ConfigReadClient, target: WikiJobTarget): Promise<'run' | 'skipped' | 'unknown'> {
  let state: ModuleState
  try {
    state = await moduleState({ projectId: target.projectId }, 'wiki', { client: db })
  } catch (error) {
    console.error('[wiki] 잡 모듈 판정 실패:', error instanceof Error ? error.message : error)
    return 'unknown'
  }
  if (state !== 'off') return state === 'on' ? 'run' : 'unknown'
  const base = db.from(target.table).update({
    status: 'skipped', last_error: MODULE_DISABLED_ERROR, locked_at: null, locked_by: null, updated_at: new Date().toISOString(),
  })
  const keyed = target.table === 'wiki_processing_jobs' ? base.eq('id', target.id) : base.eq('project_id', target.projectId)
  const { data, error } = await keyed.eq('status', 'running').eq('locked_by', target.lockedBy).select('status')
  if (error) throw new Error(`WIKI_JOB_SKIP_FAILED:${error.code ?? 'UNKNOWN'}`)
  const key = target.table === 'wiki_processing_jobs' ? target.id : target.projectId
  if (Array.isArray(data) && data.length > 0) console.info(`[wiki] 모듈 꺼짐 — ${target.table} ${key} 건너뜀(skipped)`)
  else console.warn(`[wiki] 모듈 꺼짐 — ${target.table} ${key} 의 선점을 잃어 닫지 못했다`)
  return 'skipped'
}

/**
 * 워커 접근 스코프는 켜진 워크스페이스의 켜진 프로젝트만 포함한다. 목록은 끝까지 읽는다(fetchAllPages — 쪽 넘김 + count 대조):
 * 앞에서 자르면 잘린 뒤쪽 프로젝트의 잡이 "범위 밖"(INDEX_ACCESS_DENIED)으로 실패한다 — 조용한 절단은 접근 없음으로 위장된 조회 누락이다.
 * 어느 조회든 실패·잘림이면 { ok: false } — 일부만 읽은 범위로 워커를 돌리지 않는다.
 */
export async function enabledIndexProjectIds(db: ConfigReadClient): Promise<{ ok: true; ids: string[] } | { ok: false }> {
  type IdPage = PromiseLike<PageResult<{ id: string }>>
  let workspaceIds: string[]
  try {
    workspaceIds = (await fetchAllPages<{ id: string }>('워크스페이스', (from, to) =>
      db.from('workspaces').select('id', { count: 'exact' }).order('id').range(from, to) as unknown as IdPage)).map((workspace) => workspace.id)
  } catch (e) {
    console.error('[index-worker] 워크스페이스 조회 실패:', e instanceof Error ? e.message : e)
    return { ok: false }
  }
  const enabledWorkspaces = await workspacesWithModule(workspaceIds, 'chatbot', { client: db })
  const perWorkspace = await Promise.all(enabledWorkspaces.map(async (workspaceId) => {
    let projectIds: string[]
    try {
      projectIds = (await fetchAllPages<{ id: string }>('프로젝트', (from, to) =>
        db.from('projects').select('id', { count: 'exact' }).eq('workspace_id', workspaceId).order('id').range(from, to) as unknown as IdPage))
        .map((project) => project.id)
    } catch (e) {
      console.error('[index-worker] 프로젝트 조회 실패:', workspaceId, e instanceof Error ? e.message : e)
      return null
    }
    return projectsWithModule(projectIds, 'chatbot', { client: db })
  }))
  if (perWorkspace.some((ids) => ids === null)) return { ok: false }
  return { ok: true, ids: (perWorkspace as string[][]).flat() }
}
