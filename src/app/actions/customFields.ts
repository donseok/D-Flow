'use server'
/** SP5c field administration: admin → entity module → input → project-scoped query/RPC. */
import { revalidatePath } from 'next/cache'
import { requireProjectAdmin } from '@/lib/authz'
import { requireModule } from '@/lib/modules/gate'
import { adminFor } from '@/lib/supabase/adminFor'
import { fetchAllByKeyset, type PageResult } from '@/lib/data/paging'
import { FIELD_ENTITIES, FIELD_KEY_RE, type FieldEntity, type FieldValue } from '@/lib/domain/customFields'
import { isUuidLike } from '@/lib/domain/validate'
import { failWith, rpcFailure, tokenTable, type OwnTokenKeys } from '@/lib/errors/dbFail'
import type { ModuleId } from '@/lib/modules/defaults'
import { serverTranslator } from '@/lib/i18n/server'
import type { ServerTranslate } from '@/lib/i18n/serverDict'

const MODULES: Record<FieldEntity, ModuleId> = { wbs_item: 'wbs', issue: 'issues', weekly_row: 'weekly' }
const entityOk = (v: unknown): v is FieldEntity => typeof v === 'string' && (FIELD_ENTITIES as readonly string[]).includes(v)
const owner = (v: unknown): ModuleId => entityOk(v) ? MODULES[v] : 'wbs'
const ERR_COMMAND = 'srv.customFields.couldNotChangeCustomField'
const ERR_USAGE = 'srv.customFields.couldNotLoadFieldUsage'
const ERR_INPUT = 'srv.customFields.checkFieldRequest'
export type FieldCommandInput = { expectedRevision: number; commandId: string; key: string }
export type FieldCommandResult = { ok: true; status: 'applied' | 'duplicate'; revision: number; count: number }
  | { ok: false; error: string; code: string; retryable: boolean }
export type FieldUsage = { total: number; counts: Record<string, number> }
export type FieldUsageResult = { ok: true; usage: FieldUsage } | { ok: false; error: string }
const invalid = (t: ServerTranslate): FieldCommandResult => ({ ok: false, error: t(ERR_INPUT), code: 'CONFIG_INVALID', retryable: false })
function validInput(x: FieldCommandInput): boolean {
  return !!x && Number.isSafeInteger(x.expectedRevision) && x.expectedRevision >= 0
    && typeof x.commandId === 'string' && isUuidLike(x.commandId) && typeof x.key === 'string' && FIELD_KEY_RE.test(x.key)
}
const basicValue = (v: unknown): v is FieldValue => typeof v === 'string' || typeof v === 'boolean'
  || (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e12)
  || (Array.isArray(v) && v.every(x => typeof x === 'string'))
const TOKENS: OwnTokenKeys = {
  CUSTOM_FIELD_COMMAND_FORBIDDEN: { status: 403, code: 'ERR_DENIED', key: 'srv.customFields.doNotPermissionManageProject' },
  CUSTOM_FIELD_COUNT_CONFLICT: { status: 409, code: 'CONFIG_STALE', key: 'srv.customFields.fieldUsageCountChanged' },
  CUSTOM_FIELD_SHAPE: { status: 422, code: 'CONFIG_INVALID', key: 'srv.customFields.customFieldsMustValuesKeyed' },
  CUSTOM_FIELD_SIZE: { status: 422, code: 'CONFIG_INVALID', key: 'srv.customFields.customFieldsCanHoldUp' },
  PROJECT_NOT_FOUND: { status: 404, code: 'ERR_NOT_FOUND', key: 'err.projectNotFound' },
}
function commandResult(t: ServerTranslate, data: unknown): FieldCommandResult {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return { ok: false, code: 'CONFIG_UNAVAILABLE', error: failWith('customFields', new Error('RPC response shape'), t(ERR_COMMAND)), retryable: true }
  const v = data as Record<string, unknown>
  if ((v.status !== 'applied' && v.status !== 'duplicate') || !Number.isSafeInteger(v.revision) || (v.revision as number) < 0 || !Number.isSafeInteger(v.count) || (v.count as number) < 0) {
    return { ok: false, code: 'CONFIG_UNAVAILABLE', error: failWith('customFields', new Error('RPC response values'), t(ERR_COMMAND)), retryable: true }
  }
  return { ok: true, status: v.status, revision: v.revision as number, count: v.count as number }
}
function failure(t: ServerTranslate, error: Parameters<typeof rpcFailure>[0]): FieldCommandResult {
  const mapped = rpcFailure(error, tokenTable(TOKENS, t), t)
  return { ok: false, code: mapped?.code ?? 'CONFIG_UNAVAILABLE', error: failWith('customFields', error, mapped?.message ?? t(ERR_COMMAND)), retryable: mapped?.retryable ?? true }
}

/** Preview counts only: pagination is complete and counts are never silently replaced by zero. */
export async function getCustomFieldUsage(projectId: string, entity: FieldEntity): Promise<FieldUsageResult> {
  const t = await serverTranslator()
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const mod = await requireModule({ projectId }, owner(entity))
  if (!mod.ok) return { ok: false, error: mod.error }
  if (!entityOk(entity)) return { ok: false, error: t(ERR_INPUT) }
  const { admin } = adminFor({ projectId })
  try {
    const rows = await fetchAllByKeyset<{ id: string; custom: Record<string, FieldValue> }>('추가 필드', r => r.id, (after, limit) => {
      // Literal query chains keep the historical weekly-column invariant effective.
      let q = entity === 'wbs_item'
        ? admin.from('wbs_items').select('id, custom', { count: 'exact' }).eq('project_id', projectId).order('id').limit(limit)
        : entity === 'issue'
          ? admin.from('issues').select('id, custom', { count: 'exact' }).eq('project_id', projectId).order('id').limit(limit)
          : admin.from('weekly_report_rows').select('id, custom', { count: 'exact' }).eq('project_id', projectId).order('id').limit(limit)
      if (after) q = q.gt('id', after.id)
      return q as unknown as PromiseLike<PageResult<{ id: string; custom: Record<string, FieldValue> }>>
    })
    const counts = new Map<string, number>()
    for (const row of rows) {
      if (typeof row.custom !== 'object' || row.custom === null || Array.isArray(row.custom)) throw new Error('custom row shape')
      for (const key of Object.keys(row.custom)) counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return { ok: true, usage: { total: rows.length, counts: Object.fromEntries(counts) } }
  } catch (e) { return { ok: false, error: failWith('customFields:usage', e, t(ERR_USAGE)) } }
}

/** Fill missing values and enable required within the DB command's single transaction. */
export async function backfillCustomField(projectId: string, entity: FieldEntity, input: FieldCommandInput & { value: FieldValue }): Promise<FieldCommandResult> {
  const t = await serverTranslator()
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, code: 'ERR_DENIED', error: g.error, retryable: false }
  const mod = await requireModule({ projectId }, owner(entity))
  if (!mod.ok) return { ok: false, code: 'ERR_MODULE_DISABLED', error: mod.error, retryable: false }
  if (!entityOk(entity) || !validInput(input) || !basicValue(input.value)) return invalid(t)
  const { admin } = adminFor({ projectId })
  try {
    const { data, error } = await admin.rpc('backfill_custom_field', { p_project_id: projectId, p_entity: entity,
      p_expected_revision: input.expectedRevision, p_command_id: input.commandId, p_key: input.key, p_value: input.value, p_actor: g.actor.userId })
    if (error) return failure(t, error)
    const result = commandResult(t, data)
    if (result.ok) revalidatePath(`/p/${projectId}`, 'layout')
    return result
  } catch (e) { return { ok: false, code: 'CONFIG_UNAVAILABLE', error: failWith('customFields:backfill', e, t(ERR_COMMAND)), retryable: true } }
}

/** Preview count and revision are both required; a stale destructive request cannot apply. */
export async function purgeCustomField(projectId: string, entity: FieldEntity, input: FieldCommandInput & { expectedCount: number }): Promise<FieldCommandResult> {
  const t = await serverTranslator()
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, code: 'ERR_DENIED', error: g.error, retryable: false }
  const mod = await requireModule({ projectId }, owner(entity))
  if (!mod.ok) return { ok: false, code: 'ERR_MODULE_DISABLED', error: mod.error, retryable: false }
  if (!entityOk(entity) || !validInput(input) || !Number.isSafeInteger(input.expectedCount) || input.expectedCount < 0) return invalid(t)
  const { admin } = adminFor({ projectId })
  try {
    const { data, error } = await admin.rpc('purge_custom_field', { p_project_id: projectId, p_entity: entity,
      p_expected_revision: input.expectedRevision, p_command_id: input.commandId, p_key: input.key, p_expected_count: input.expectedCount, p_actor: g.actor.userId })
    if (error) return failure(t, error)
    const result = commandResult(t, data)
    if (result.ok) revalidatePath(`/p/${projectId}`, 'layout')
    return result
  } catch (e) { return { ok: false, code: 'CONFIG_UNAVAILABLE', error: failWith('customFields:purge', e, t(ERR_COMMAND)), retryable: true } }
}
