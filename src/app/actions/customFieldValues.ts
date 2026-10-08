'use server'
import { revalidatePath } from 'next/cache'
import { requireProjectMember } from '@/lib/authz'
import { isProjectAdmin } from '@/lib/domain/authz'
import { requireModule } from '@/lib/modules/gate'
import { createServerClient } from '@/lib/supabase/server'
import { getProjectConfig } from '@/lib/settings/projectConfig'
import { valueOf } from '@/lib/settings/registry'
import { FIELD_ENTITIES, type CustomValues, type FieldEntity } from '@/lib/domain/customFields'
import { customFieldChanges, mapCustomFieldDbError, parseCustomValues, validateCustomValues, type FieldRowError } from '@/lib/domain/customFieldValues'
import { isUuidLike } from '@/lib/domain/validate'
import { failWith, rpcFailure, type OwnTokenTable } from '@/lib/errors/dbFail'
import type { ModuleId } from '@/lib/modules/defaults'
const MODULES: Record<FieldEntity, ModuleId> = { wbs_item: 'wbs', issue: 'issues', weekly_row: 'weekly' }
const entityOk = (v: unknown): v is FieldEntity => typeof v === 'string' && (FIELD_ENTITIES as readonly string[]).includes(v)
const ERR = '추가 정보를 저장하지 못했습니다. 최신 값을 확인한 뒤 다시 시도하세요.'
const INVALID = '추가 정보의 입력값과 편집 권한을 확인하세요.'
export type CustomFieldSaveResult = { ok: true; values: CustomValues } | { ok: false; code: string; error: string; fieldErrors?: Record<string, FieldRowError> }
const TOKENS: OwnTokenTable = {
  CUSTOM_FIELD_ADMIN_ONLY: { status: 403, code: 'ERR_DENIED', message: '관리자만 편집할 수 있는 필드가 있습니다.' },
  CUSTOM_FIELD_INACTIVE: { status: 422, code: 'FIELD_INVALID', message: '비활성 필드의 값은 변경하거나 지울 수 없습니다.' },
  CUSTOM_FIELD_REQUIRED: { status: 422, code: 'FIELD_INVALID', message: '필수 필드의 값을 입력하세요.' },
  CUSTOM_FIELD_INVALID: { status: 422, code: 'FIELD_INVALID', message: INVALID },
  CUSTOM_FIELD_UNKNOWN: { status: 422, code: 'FIELD_INVALID', message: '필드 정의가 변경되었습니다. 최신 설정과 값을 확인하세요.' },
  CUSTOM_FIELD_NULL: { status: 422, code: 'FIELD_INVALID', message: INVALID },
  CUSTOM_FIELD_SHAPE: { status: 422, code: 'FIELD_INVALID', message: INVALID },
  CUSTOM_FIELD_SIZE: { status: 422, code: 'FIELD_INVALID', message: '한 행의 추가 정보는 최대 16KB입니다.' },
}
/** Session JWT only. Full JSONB compare-and-swap prevents a stale form from overwriting a changed admin/other field. */
export async function saveCustomFieldValues(projectId: string, entity: FieldEntity, rowId: string, expected: unknown, next: unknown): Promise<CustomFieldSaveResult> {
  const g = await requireProjectMember(projectId)
  if (!g.ok) return { ok: false, code: 'ERR_DENIED', error: g.error }
  const mod = await requireModule({ projectId }, entityOk(entity) ? MODULES[entity] : 'wbs')
  if (!mod.ok) return { ok: false, code: 'ERR_MODULE_DISABLED', error: mod.error }
  if (!entityOk(entity) || !isUuidLike(rowId) || !parseCustomValues(expected).ok) return { ok: false, code: 'FIELD_INVALID', error: INVALID }
  try {
    const cfg = await getProjectConfig(projectId)
    const defs = valueOf(cfg, `fields.${entity}`)
    const checked = validateCustomValues(defs, next, expected, isProjectAdmin(g.actor, projectId))
    if (!checked.ok) return { ok: false, code: 'FIELD_INVALID', error: INVALID, fieldErrors: checked.errors }
    const sb = await createServerClient()
    const old = JSON.stringify(expected)
    const patch = { custom: checked.value }
    // Literal chains keep the historical weekly-column scanner effective; both id and project scope are mandatory.
    const reply = entity === 'wbs_item'
      ? await sb.from('wbs_items').update(patch).eq('project_id', projectId).eq('id', rowId).eq('custom', old).select('custom').maybeSingle()
      : entity === 'issue'
        ? await sb.from('issues').update({ ...patch, updated_at: new Date().toISOString() }).eq('project_id', projectId).eq('id', rowId).eq('custom', old).select('custom').maybeSingle()
        : await sb.from('weekly_report_rows').update(patch).eq('project_id', projectId).eq('id', rowId).eq('custom', old).select('custom').maybeSingle()
    if (reply.error) {
      const mapped = rpcFailure(reply.error, TOKENS)
      const fieldErrors = mapCustomFieldDbError(reply.error)
      return { ok: false, code: reply.error.code === '42501' ? 'ERR_DENIED' : mapped?.code ?? 'FIELD_UNAVAILABLE', error: failWith('customFieldValues', reply.error, mapped?.message ?? ERR), ...(fieldErrors ? { fieldErrors } : {}) }
    }
    if (!reply.data) return { ok: false, code: 'FIELD_CONFLICT', error: '값이나 편집 권한이 바뀌었습니다. 최신 행을 확인한 뒤 저장하세요.' }
    const saved = parseCustomValues(reply.data.custom)
    if (!saved.ok) return { ok: false, code: 'FIELD_UNAVAILABLE', error: failWith('customFieldValues', new Error('saved row shape'), ERR) }
    // WBS 값 변경 이력(§3.6.7) — change_logs 에 바뀐 키마다 field='custom.<key>'(현 필드 편집 관례 — actions/wbs.ts). CAS 를 통과했으므로
    // expected 가 곧 변경 전 값이다. 이슈·주간 행은 필드 값 이력이 없다(비목표). 본 저장은 이미 성공했다 — 이력 실패로 되돌리지 않되 삼키지도 않는다
    const before = parseCustomValues(expected)
    const logs = entity === 'wbs_item' && before.ok ? customFieldChanges(before.value, saved.value) : []
    if (logs.length) {
      // 던지는 실패(전송 오류)도 여기서 받는다 — 바깥 catch 로 새면 저장된 값을 '저장하지 못했다'고 답하게 된다
      try {
        const { error: logErr } = await sb.from('change_logs').insert(logs.map(l => ({ user_id: g.actor.userId, wbs_item_id: rowId, field: l.field, old_value: l.old, new_value: l.new })))
        if (logErr) console.error('[customFieldValues] 변경 이력 기록 실패:', logErr.message)
      } catch (e) { console.error('[customFieldValues] 변경 이력 기록 실패:', e) }
    }
    revalidatePath(`/p/${projectId}`, 'layout')
    return { ok: true, values: saved.value }
  } catch (e) { return { ok: false, code: 'FIELD_UNAVAILABLE', error: failWith('customFieldValues', e, ERR) } }
}
