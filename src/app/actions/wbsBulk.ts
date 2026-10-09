'use server'

import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireProjectMember } from '@/lib/authz'
import { isProjectAdmin } from '@/lib/domain/authz'
import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { recordProgressSnapshot } from '@/lib/data/snapshots'
import { setWbsStage, setWbsAssignee } from '@/app/actions/wbsAssign'
import { isStageCode } from '@/lib/domain/stageLabels'
import { isUuidLike } from '@/lib/domain/validate'
import { enqueueIndexChange } from '@/lib/ai/index/enqueueChange'

import type { WbsBulkChanges, WbsBulkTarget, WbsBulkSnapshotRow, WbsBulkFailedItem, WbsBulkResult } from '@/lib/domain/wbsBulk'
import { serverTranslator } from '@/lib/i18n/server'
import type { ServerDictKey } from '@/lib/i18n/serverDict'
export type { BulkFieldMode, WbsBulkChanges, WbsBulkTarget, WbsBulkSnapshotRow, WbsBulkFailedItem, WbsBulkResult } from '@/lib/domain/wbsBulk'

const MAX_TARGETS = 2000
const FIELDS = ['plannedStart','plannedEnd','deliverable','biz','stage','assigneeMemberId','teamCode']
const REASONS: Record<string, ServerDictKey> = {
  permission: 'srv.wbsBulk.projectAdminPermissionRequired',
  conflict: 'srv.wbsBulk.anotherUserMadeChanges',
  validation: 'srv.wbsBulk.checkItemsChangeValues',
  dependency: 'srv.wbsBulk.plannedDatesTaskLinkedDependencies',
  member: 'srv.wbsBulk.selectActiveAssigneeProject',
  team: 'srv.wbsBulk.selectActiveTeamProject',
}

/** 현재 표시 결과의 ID를 서버에서 소속·revision과 함께 확정한다. 이후 추가된 행은 포함하지 않는다. */
export async function createWbsBulkSnapshot(projectId: string, itemIds: string[]): Promise<
  { ok: true; rows: WbsBulkSnapshotRow[] } | { ok: false; error: string }
> {
  const tr = await serverTranslator()
  const g = await requireProjectMember(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  if (!isProjectAdmin(g.actor, projectId)) return { ok: false, error: tr(REASONS.permission) }
  if (!Array.isArray(itemIds) || itemIds.length > MAX_TARGETS || itemIds.some(id => !isUuidLike(id))) return { ok: false, error: tr(REASONS.validation) }
  if (!itemIds.length) return { ok: true, rows: [] }
  const ids = [...new Set(itemIds)]
  const sb = await createServerClient()
  const rows: WbsBulkSnapshotRow[] = []
  // PostgREST의 기본 1000행 상한에 결과가 조용히 잘리지 않도록 나눈다.
  for (let offset = 0; offset < ids.length; offset += 200) {
    const { data, error } = await sb.from('wbs_items')
      .select('id, name, planned_start, planned_end, deliverable, biz, stage, assignee_member_id, updated_at, item_owners(kind, teams(code))')
      .eq('project_id', projectId).in('id', ids.slice(offset, offset + 200))
    if (error) { console.error('[wbsBulk.snapshot]', error); return { ok: false, error: tr('srv.wbsBulk.couldNotVerifyTargets') } }
    for (const raw of data ?? []) {
      const owners = raw.item_owners as unknown as Array<{ kind: string; teams: { code: string } | null }>
      rows.push({ id: raw.id, name: raw.name, plannedStart: raw.planned_start, plannedEnd: raw.planned_end,
        deliverable: raw.deliverable, biz: raw.biz, stage: raw.stage, assigneeMemberId: raw.assignee_member_id,
        updatedAt: raw.updated_at, teamCode: owners?.find(o => o.kind === 'primary')?.teams?.code ?? null })
    }
  }
  if (rows.length !== ids.length) return { ok: false, error: tr('srv.wbsBulk.someItemsDeletedCannotAccessed') }
  const byId = new Map(rows.map(row => [row.id, row]))
  return { ok: true, rows: ids.map(id => byId.get(id)!) }
}

/** 항목별 트랜잭션 + 화면에서 검토한 revision CAS. 재시도도 최신 스냅샷을 먼저 검토한다. */
export async function bulkUpdateWbsItems(projectId: string, itemIds: string[], changes: WbsBulkChanges,
  targets?: WbsBulkTarget[],
): Promise<WbsBulkResult> {
  return updateWbsItems(projectId, itemIds, changes, targets, true)
}

async function updateWbsItems(projectId: string, itemIds: string[], changes: WbsBulkChanges,
  targets: WbsBulkTarget[] | undefined, recordSnapshot: boolean,
): Promise<WbsBulkResult> {
  const tr = await serverTranslator()
  const ids = Array.isArray(itemIds) ? [...new Set(itemIds)] : []
  const failAll = (reason: WbsBulkFailedItem['reason'], message: string): WbsBulkResult => ({ ok: false, error: message, total: ids.length, succeeded: [], failed: ids.map(itemId => ({ itemId, reason, message })) })
  const g = await requireProjectMember(projectId)
  if (!g.ok) return failAll('permission', g.error)
  if (!isProjectAdmin(g.actor, projectId)) return failAll('permission', tr(REASONS.permission))
  if (!Array.isArray(itemIds) || ids.length > MAX_TARGETS || ids.some(id => !isUuidLike(id))) return failAll('validation', tr(REASONS.validation))
  if (!ids.length) return { ok: true, total: 0, succeeded: [], failed: [] }
  if (!changes || typeof changes !== 'object' || Object.keys(changes).some(key => !FIELDS.includes(key))) return failAll('validation', tr(REASONS.validation))
  const changed = Object.entries(changes).filter(([, value]) => value?.mode !== 'unchanged')
  for (const [field, value] of changed) {
    if (!value || !['set','clear'].includes(value.mode) || (value.mode === 'set' && typeof value.value !== 'string')) return failAll('validation', tr(REASONS.validation))
    if (value.mode === 'set') {
      if (field.startsWith('planned') && (!/^\d{4}-\d{2}-\d{2}$/.test(value.value) || Number.isNaN(Date.parse(value.value)))) return failAll('validation', tr('srv.wbsBulk.setValidPlannedDateChoose'))
      if (field === 'stage' && value.value !== 'none' && !isStageCode(value.value)) return failAll('validation', tr(REASONS.validation))
      if (field === 'assigneeMemberId' && !isUuidLike(value.value)) return failAll('validation', tr(REASONS.member))
      if (value.value.length > 4000) return failAll('validation', tr(REASONS.validation))
    }
  }
  if (!targets || targets.length !== ids.length || new Set(targets.map(t => t.id)).size !== ids.length
    || targets.some(t => !ids.includes(t.id) || (t.updatedAt !== null && (typeof t.updatedAt !== 'string' || Number.isNaN(Date.parse(t.updatedAt)))))) return failAll('validation', tr('srv.wbsBulk.checkLatestContentTargetsFirst'))
  if (changed.some(([field]) => field === 'stage' || field === 'assigneeMemberId') && changed.length > 1) return failAll('validation', tr('srv.wbsBulk.applyStageAssigneeChangesSeparately'))
  if (!changed.length) return { ok: true, total: ids.length, succeeded: ids, failed: [] }
  const admin = createAdminClient()
  const result: WbsBulkResult = { ok: true, total: ids.length, succeeded: [], failed: [] }
  const patch: Record<string, string | null> = {}
  const columns: Record<string, string> = { plannedStart: 'planned_start', plannedEnd: 'planned_end', deliverable: 'deliverable', biz: 'biz', teamCode: 'team_code' }
  for (const [field, value] of changed) if (columns[field]) patch[columns[field]] = value.mode === 'clear' ? null : value.value.trim() || null
  for (const target of targets) {
    try {
      if (changes.stage && changes.stage.mode !== 'unchanged') {
        const value = changes.stage.mode === 'clear' || changes.stage.value === 'none' ? null : changes.stage.value
        const res = await setWbsStage(target.id, value, undefined, target.updatedAt)
        if (!res.ok) { result.failed.push({ itemId: target.id, reason: res.stale ? 'conflict' : 'validation', message: res.error ?? tr(REASONS.validation) }); continue }
      } else if (changes.assigneeMemberId && changes.assigneeMemberId.mode !== 'unchanged') {
        const value = changes.assigneeMemberId.mode === 'clear' ? null : changes.assigneeMemberId.value
        const res = await setWbsAssignee(target.id, value, target.updatedAt)
        if (!res.ok) { result.failed.push({ itemId: target.id, reason: res.conflict ? 'conflict' : 'validation', message: res.error ?? tr(REASONS.validation) }); continue }
      } else {
        const { data, error } = await admin.rpc('apply_wbs_bulk_item', { p_project_id: projectId, p_actor: g.actor.userId,
          p_item_id: target.id, p_expected_updated_at: target.updatedAt, p_patch: patch })
        if (error) { console.error('[wbsBulk.apply]', error); result.failed.push({ itemId: target.id, reason: 'unknown', message: tr('srv.wbsBulk.couldNotSave') }); continue }
        if (data?.ok !== true) {
          const reason = data?.reason === 'permission' ? 'permission' : data?.reason === 'conflict' ? 'conflict' : 'validation'
          result.failed.push({ itemId: target.id, reason, message: tr(REASONS[data?.reason] ?? REASONS.validation) }); continue
        }
      }
      result.succeeded.push(target.id)
    } catch (error) {
      console.error('[wbsBulk.apply]', error)
      result.failed.push({ itemId: target.id, reason: 'unknown', message: tr('srv.wbsBulk.couldNotSave') })
    }
  }
  if (result.succeeded.length) await enqueueIndexChange(result.succeeded.map((entityId) => ({ domain: 'wbs' as const, projectId, entityId })))
  result.ok = !result.failed.length
  if (recordSnapshot && result.succeeded.length) { revalidatePath('/(app)/p/[projectId]', 'layout'); after(() => recordProgressSnapshot(projectId)) }
  return result
}


/** 붙여넣기 미리보기의 서로 다른 행 값을 항목별 결과로 저장한다. */
export async function bulkPasteWbsItems(projectId: string, operations: Array<{ target: WbsBulkTarget; changes: WbsBulkChanges }>): Promise<WbsBulkResult> {
  const tr = await serverTranslator()
  const g = await requireProjectMember(projectId)
  const input = Array.isArray(operations) ? operations : []
  const result: WbsBulkResult = { ok: true, total: input.length, succeeded: [], failed: [] }
  if (!g.ok || !isProjectAdmin(g.actor, projectId) || input.length > 200 || new Set(input.map(op => op?.target?.id)).size !== input.length) {
    return { ...result, ok: false, error: !g.ok ? g.error : tr('srv.wbsBulk.checkTargetsPermission'), failed: input.map(op => ({ itemId: op?.target?.id ?? '', reason: !g.ok ? 'permission' : 'validation', message: !g.ok ? g.error : tr('srv.wbsBulk.checkTargetsPermission') })) }
  }
  for (const operation of input) {
    if (!operation?.target || !operation.changes || typeof operation.changes !== 'object' || Object.keys(operation.changes).some(field => !['deliverable','plannedStart','plannedEnd','biz'].includes(field))) {
      result.failed.push({ itemId: operation?.target?.id ?? '', reason: 'validation', message: tr('srv.wbsBulk.columnCannotEditedPasting') }); continue
    }
    const row = await updateWbsItems(projectId, [operation.target.id], operation.changes, [operation.target], false)
    result.succeeded.push(...row.succeeded); result.failed.push(...row.failed)
  }
  result.ok = !result.failed.length
  if (result.succeeded.length) { revalidatePath('/(app)/p/[projectId]', 'layout'); after(() => recordProgressSnapshot(projectId)) }
  return result
}
