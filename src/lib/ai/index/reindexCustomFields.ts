import type { AdminClient } from '@/lib/supabase/adminFor'
import type { FieldEntity } from '@/lib/domain/customFields'
import { indexJobKey } from './jobs'

const ENTITY_CONFIG: Record<FieldEntity, { table: string; domain: 'wbs' | 'issues' | 'weekly'; entityType: 'wbs_item' | 'issue' | 'weekly_report' }> = {
  wbs_item: { table: 'wbs_items', domain: 'wbs', entityType: 'wbs_item' },
  issue: { table: 'issues', domain: 'issues', entityType: 'issue' },
  weekly_row: { table: 'weekly_reports', domain: 'weekly', entityType: 'weekly_report' },
}

/**
 * Enqueues AI index upsert jobs for all entities of a project when its custom field definitions change.
 * Uses upsert_ai_index_jobs RPC with 200 batch limit.
 */
export async function enqueueCustomFieldsReindex(
  admin: AdminClient,
  projectId: string,
  entity: FieldEntity,
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const conf = ENTITY_CONFIG[entity]
  if (!conf) return { ok: true, count: 0 }

  const { data, error } = await admin
    .from(conf.table)
    .select('id')
    .eq('project_id', projectId)

  if (error) {
    console.error('[ai/reindex] 엔티티 목록 조회 실패:', error.message)
    return { ok: false, error: error.message }
  }

  const ids = ((data ?? []) as { id: string }[]).map(r => r.id).filter(Boolean)
  if (ids.length === 0) return { ok: true, count: 0 }

  const rows = ids.map(id => ({
    job_key: indexJobKey({ projectId, domain: conf.domain, entityType: conf.entityType, entityId: id }),
    operation: 'upsert',
    project_id: projectId,
    domain: conf.domain,
    entity_type: conf.entityType,
    entity_id: id,
    payload: { reason: 'custom_fields_changed' },
    run_after: null,
  }))

  const batchSize = 200
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize)
    const { error: rpcError } = await admin.rpc('upsert_ai_index_jobs', { p_jobs: batch })
    if (rpcError) {
      console.error('[ai/reindex] upsert_ai_index_jobs 호출 실패:', rpcError.message)
      return { ok: false, error: rpcError.message }
    }
  }

  return { ok: true, count: ids.length }
}
