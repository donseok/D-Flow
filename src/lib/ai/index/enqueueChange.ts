import 'server-only'
import { after } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { moduleDef } from '@/lib/modules/registry'
import { INDEX_BACKFILL_ENTITY_TYPE, type IndexBackfillDomain } from './backfill'
import { enqueueIndexMutationBestEffort } from './enqueue'
import { createIndexJobModuleGate, keepEnabledMutations } from './moduleGate'
import { createSupabaseIndexJobQueue, type SupabaseKnowledgeClient } from './pgvector'
import type { IndexMutation } from './types'

/**
 * 증분 색인 배선(정본 §5.4.5) — 색인 대상(WBS 항목·주간 문서·회의·공지·이슈·회의록)을 쓰는 액션이 쓰기 성공 뒤에 부른다.
 * - 배포에서 챗봇을 쓸 수 없으면(모듈 envAvailable) 아무것도 하지 않는다 — 클라이언트도 만들지 않는다.
 * - 모듈이 켜진 범위의 변경만 큐에 넣는다(백필·정합성 검사와 같은 keepEnabledMutations). 꺼졌거나 모르면 넣지 않는다.
 * - 어떤 실패도 로그만 남기고 던지지 않는다 — 색인 실패가 업무 쓰기를 막거나 되돌리면 안 된다. 빠진 것은 ai-index 의 consistency 모드가 메운다.
 * - 응답을 늦추지 않도록 요청이 끝난 뒤(after)에 돈다. 요청 범위 밖에서는 그 자리에서 돈다.
 * 호출 자리는 권한 가드·모듈 관문·입력 검증을 지난 쓰기 성공 뒤다 — 여기서는 권한을 다시 보지 않는다(큐에는 식별자만 들어간다).
 */
export interface IndexChange {
  domain: IndexBackfillDomain
  entityId: string
  /**
   * 색인 범위의 프로젝트. 생략하면 원본 행에서 읽는다(행이 이미 지워졌으면 범위를 알 수 없어 넣지 않는다 — delete 는 반드시 준다).
   * 회의록은 준 값을 쓰지 않고 항상 행에서 정한다: 회의록의 프로젝트, 없으면 연결된 회의의 프로젝트(색인 로더 loadMinute 와 같은 규칙).
   */
  projectId?: string | null
  /** 프로젝트가 없는 변경에 필수(0038 — 워크스페이스 없는 프로젝트 없는 잡은 등록되지 않는다). 회의록은 행에서 읽는다 */
  workspaceId?: string | null
  /** 기본 upsert. 원본 행이 실제로 지워졌을 때만 delete — 보관·숨김은 upsert 로 넣으면 로더가 원본 상태를 보고 지운다 */
  operation?: 'upsert' | 'delete'
}

const BATCH = 200
const PAGE = 1000
/** 범위를 행에서 읽을 때의 원본 표 — 색인 로더(content.ts)가 읽는 표와 같다 */
const SOURCE_TABLE: Record<IndexBackfillDomain, string> = {
  wbs: 'wbs_items', weekly: 'weekly_reports', meetings: 'meetings', announcements: 'announcements', issues: 'issues', minutes: 'minutes',
}

function schedule(run: () => Promise<void>): Promise<void> | void {
  try {
    after(run)
  } catch {
    // 요청 범위 밖(스크립트·단위 테스트)에는 after 가 없다 — 그 자리에서 돌린다.
    return run()
  }
}

const indexEnqueueAvailable = () => moduleDef('chatbot').envAvailable()

export async function enqueueIndexChange(change: IndexChange | readonly IndexChange[]): Promise<void> {
  const changes = (Array.isArray(change) ? change : [change] as readonly IndexChange[]).filter((c) => Boolean(c.entityId))
  if (changes.length === 0 || !indexEnqueueAvailable()) return
  await schedule(() => enqueueNow(changes))
}

/** 회의록 변경 — 범위는 행에서 정한다(IndexChange.projectId 주석). 호출부가 그 규칙을 다시 적지 않게 하는 이름 있는 입구다. */
export function enqueueMinuteIndexChange(minuteId: string): Promise<void> {
  return enqueueIndexChange({ domain: 'minutes', entityId: minuteId })
}

/** 주간 행(셀·추가 정보) 변경 — 색인 단위는 행이 아니라 그 행이 속한 주간 문서다. 행에서 문서 id 를 읽어 문서를 다시 색인한다. */
export async function enqueueWeeklyRowIndexChange(projectId: string, rowIds: readonly string[]): Promise<void> {
  const ids = [...new Set(rowIds.filter(Boolean))]
  if (ids.length === 0 || !indexEnqueueAvailable()) return
  await schedule(async () => {
    try {
      const { data, error } = await createAdminClient().from('weekly_report_rows').select('report_id').eq('project_id', projectId).in('id', ids)
      if (error) {
        console.error('[assistant] 색인 변경 등록 — 주간 문서 조회 실패(무시하고 계속):', error.message)
        return
      }
      const reportIds = [...new Set(((data ?? []) as { report_id: string | null }[]).map((r) => r.report_id).filter((id): id is string => Boolean(id)))]
      await enqueueNow(reportIds.map((entityId) => ({ domain: 'weekly' as const, projectId, entityId })))
    } catch (e) {
      console.error('[assistant] 색인 변경 등록 예외(무시하고 계속):', e instanceof Error ? e.message : e)
    }
  })
}

/** 프로젝트의 한 도메인 전체(가져오기처럼 무엇이 바뀌었는지 건별로 알 수 없는 쓰기) — 그 프로젝트의 원본 id 를 읽어 전부 다시 색인한다. */
export async function enqueueProjectIndexChange(projectId: string, domain: Exclude<IndexBackfillDomain, 'minutes'>): Promise<void> {
  if (!projectId || !indexEnqueueAvailable()) return
  await schedule(async () => {
    try {
      const admin = createAdminClient()
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await admin.from(SOURCE_TABLE[domain]).select('id').eq('project_id', projectId).order('id').range(from, from + PAGE - 1)
        if (error) {
          console.error(`[assistant] 색인 변경 등록 — ${domain} 목록 조회 실패(무시하고 계속):`, error.message)
          return
        }
        const ids = ((data ?? []) as { id: string }[]).map((row) => row.id)
        await enqueueNow(ids.map((entityId) => ({ domain, projectId, entityId })))
        if (ids.length < PAGE) return
      }
    } catch (e) {
      console.error('[assistant] 색인 변경 등록 예외(무시하고 계속):', e instanceof Error ? e.message : e)
    }
  })
}

function toMutation(change: IndexChange, scope: { projectId: string | null; workspaceId?: string | null }): IndexMutation {
  return {
    operation: change.operation ?? 'upsert',
    projectId: scope.projectId,
    workspaceId: scope.workspaceId ?? null,
    domain: change.domain,
    entityType: INDEX_BACKFILL_ENTITY_TYPE[change.domain],
    entityId: change.entityId,
  }
}

type ScopeRow = { id: string; project_id: string | null; workspace_id?: string | null; meetings?: { project_id: string | null } | { project_id: string | null }[] | null }

/** 범위를 준 변경은 그대로, 주지 않은 변경(과 회의록)은 원본 행에서 읽어 채운다. 읽지 못한 것은 넣지 않고 로그를 남긴다. */
async function withScope(admin: ReturnType<typeof createAdminClient>, changes: readonly IndexChange[]): Promise<IndexMutation[]> {
  const out: IndexMutation[] = []
  const lookups = new Map<IndexBackfillDomain, IndexChange[]>()
  for (const change of changes) {
    if (change.domain !== 'minutes' && change.projectId !== undefined) {
      out.push(toMutation(change, { projectId: change.projectId, workspaceId: change.workspaceId }))
    } else {
      lookups.set(change.domain, [...(lookups.get(change.domain) ?? []), change])
    }
  }
  for (const [domain, pending] of lookups) {
    for (let i = 0; i < pending.length; i += BATCH) {
      const slice = pending.slice(i, i + BATCH)
      const columns = domain === 'minutes' ? 'id, project_id, workspace_id, meetings(project_id)' : 'id, project_id'
      const { data, error } = await admin.from(SOURCE_TABLE[domain]).select(columns).in('id', slice.map((c) => c.entityId))
      if (error) {
        console.error(`[assistant] 색인 변경 등록 — ${domain} 범위 조회 실패(무시하고 계속):`, error.message)
        continue
      }
      const rows = new Map(((data ?? []) as unknown as ScopeRow[]).map((row) => [row.id, row]))
      for (const change of slice) {
        const row = rows.get(change.entityId)
        if (!row) continue
        const meeting = Array.isArray(row.meetings) ? row.meetings[0] ?? null : row.meetings ?? null
        out.push(toMutation(change, { projectId: row.project_id ?? meeting?.project_id ?? null, workspaceId: row.workspace_id ?? change.workspaceId }))
      }
    }
  }
  return out
}

async function enqueueNow(changes: readonly IndexChange[]): Promise<void> {
  try {
    const admin = createAdminClient()
    const kept = await keepEnabledMutations(createIndexJobModuleGate(admin), await withScope(admin, changes))
    for (let i = 0; i < kept.length; i += BATCH) {
      const batch = kept.slice(i, i + BATCH)
      const projectIds = [...new Set(batch.map((m) => m.projectId).filter((id): id is string => Boolean(id)))]
      // 어댑터의 범위 검사는 프로젝트가 하나도 없는 범위를 닫는다(검색과 같은 함수 — fail-closed). 프로젝트 없는 변경만 있는 묶음은
      // 그 변경의 워크스페이스를 범위의 자리표로 준다 — 이 묶음은 위 관문을 통과한 변경으로만 이뤄져 있다.
      const placeholder = batch.map((m) => m.workspaceId).filter((id): id is string => Boolean(id)).slice(0, 1)
      const queue = createSupabaseIndexJobQueue(admin as unknown as SupabaseKnowledgeClient, {
        allowedProjectIds: projectIds.length > 0 ? projectIds : placeholder, allowGlobal: true,
      })
      await enqueueIndexMutationBestEffort(queue, batch)
    }
  } catch (e) {
    console.error('[assistant] 색인 변경 등록 예외(무시하고 계속):', e instanceof Error ? e.message : e)
  }
}
