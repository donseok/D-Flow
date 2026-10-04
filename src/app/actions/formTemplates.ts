'use server'
/**
 * SP6 S2 — 양식 업로드 준비·활성화·활성 해제(정본 §4.7.1).
 * 파일 바이트는 받지 않는다. 브라우저가 incoming 경로에 직접 올린 뒤, 등록(registerFormTemplate)은 다음 조각이다.
 * 활성 해제가 계획의 삭제다. 버전 행·스토리지 객체를 지우는 액션은 정본에 없다.
 */
import { revalidatePath } from 'next/cache'
import { requireProjectAdmin } from '@/lib/authz'
import { requireModule } from '@/lib/modules/gate'
import { adminFor } from '@/lib/supabase/adminFor'
import { failWith, rpcFailure, type OwnTokenTable } from '@/lib/errors/dbFail'
import { isUuidLike } from '@/lib/domain/validate'
import { assessFormActivation } from '@/lib/forms/activation'
import { FORM_FORMAT, FORM_TEMPLATE_MAX_BYTES, type FormKind } from '@/lib/report/engine/types'
import { ConfigUnavailableError } from '@/lib/settings/errors'
import { FORM_SETTING_MODULE, isFormKind, type FormSetting, type FormSettingKey } from '@/lib/settings/defs/forms'
import { getProjectConfig } from '@/lib/settings/projectConfig'
import { SETTINGS_SCHEMA_VERSION } from '@/lib/settings/registry'
import type { FieldDef } from '@/lib/domain/customFields'
import type { ProjectSettingKey } from '@/lib/settings/registry'

const ERR_INPUT = '양식 파일의 종류·이름·크기를 확인하세요.'
const ERR_EXT = '이 양식에 맞는 확장자가 아닙니다. .pptm·.xlsm·.ppt·.xls 는 받지 않습니다.'
const ERR_SIZE = '양식 파일은 1바이트 이상 10MB 이하여야 합니다.'
const ERR_WORKSPACE = '프로젝트의 워크스페이스를 찾지 못했습니다.'
const ERR_NOT_FOUND = '양식을 찾지 못했습니다.'
const ERR_COMMAND = '양식을 바꾸지 못했습니다. 같은 요청으로 다시 시도하세요.'
const ERR_SETTING = '양식 설정이 손상되어 활성화할 수 없습니다.'
const ERR_SCHEMA = '설정 형식이 더 새로워 양식을 바꾸지 못했습니다.'
const ERR_FIELDS = '추가 필드 설정을 읽지 못해 활성화할 수 없습니다.'

const FIELD_KEY: Record<FormKind, ProjectSettingKey> = {
  weekly_report_pptx: 'fields.weekly_row',
  weekly_report_xlsx: 'fields.weekly_row',
  issue_analysis_pptx: 'fields.issue',
  wbs_export_xlsx: 'fields.wbs_item',
}

const TOKENS: OwnTokenTable = {
  FORM_TEMPLATE_FORBIDDEN: { status: 403, code: 'ERR_DENIED', message: '이 프로젝트의 양식을 바꿀 권한이 없습니다.' },
  FORM_TEMPLATE_NOT_FOUND: { status: 404, code: 'ERR_NOT_FOUND', message: ERR_NOT_FOUND },
  FORM_TEMPLATE_INPUT: { status: 422, code: 'CONFIG_INVALID', message: '양식 변경 요청을 확인하세요.' },
  FORM_TEMPLATE_SETTING: { status: 422, code: 'CONFIG_INVALID', message: ERR_SETTING },
}

export type FormPrepareResult = { ok: true; path: string } | { ok: false; error: string }
export type FormCommand = { expectedRevision: number; commandId: string }
export type FormCommandResult =
  | { ok: true; status: 'applied' | 'duplicate'; revision: number }
  | { ok: false; error: string; code?: string; unmapped?: string[]; retryable?: boolean }

function extensionOf(fileName: unknown): string | null {
  if (typeof fileName !== 'string' || fileName.length === 0 || fileName.length > 200) return null
  if (/[\\/\u0000]/.test(fileName) || fileName === '.' || fileName === '..') return null
  const i = fileName.lastIndexOf('.')
  if (i <= 0 || i === fileName.length - 1) return null
  return fileName.slice(i + 1).toLowerCase()
}

function validCommand(x: FormCommand | null | undefined): x is FormCommand {
  return !!x && Number.isSafeInteger(x.expectedRevision) && x.expectedRevision >= 0
    && typeof x.commandId === 'string' && isUuidLike(x.commandId)
}

function commandResult(data: unknown): FormCommandResult {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, error: failWith('formTemplates', new Error('RPC response shape'), ERR_COMMAND), retryable: true }
  }
  const v = data as Record<string, unknown>
  if ((v.status !== 'applied' && v.status !== 'duplicate') || !Number.isSafeInteger(v.revision) || (v.revision as number) < 0) {
    return { ok: false, error: failWith('formTemplates', new Error('RPC response values'), ERR_COMMAND), retryable: true }
  }
  return { ok: true, status: v.status, revision: v.revision as number }
}

function failure(error: Parameters<typeof rpcFailure>[0]): FormCommandResult {
  const mapped = rpcFailure(error, TOKENS)
  return {
    ok: false,
    code: mapped?.code ?? 'CONFIG_UNAVAILABLE',
    error: failWith('formTemplates', error, mapped?.message ?? ERR_COMMAND),
    retryable: mapped?.retryable ?? true,
  }
}

type TemplateRow = { id: string; form_kind: string; placeholders: unknown }

async function loadTemplate(projectId: string, templateId: string): Promise<{ ok: true; row: TemplateRow } | { ok: false; error: string }> {
  const { admin } = adminFor({ projectId })
  const { data, error } = await admin.from('form_templates').select('id, form_kind, placeholders')
    .eq('id', templateId).eq('project_id', projectId).maybeSingle()
  if (error) return { ok: false, error: failWith('formTemplates', error, ERR_COMMAND) }
  const row = data as TemplateRow | null
  if (!row || !isFormKind(row.form_kind)) return { ok: false, error: ERR_NOT_FOUND }
  return { ok: true, row }
}

/** 가드·모듈 다음. 브라우저가 올릴 incoming 경로만 돌려준다. 유효 시간은 정리 워커의 24시간이다(정본 §4.7.1). */
export async function prepareFormTemplateUpload(
  projectId: string, formKind: string, fileName: string, sizeBytes: number,
): Promise<FormPrepareResult> {
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  if (!isFormKind(formKind)) return { ok: false, error: ERR_INPUT }
  const mod = await requireModule({ projectId }, FORM_SETTING_MODULE[formKind])
  if (!mod.ok) return { ok: false, error: mod.error }
  if (extensionOf(fileName) !== FORM_FORMAT[formKind]) return { ok: false, error: ERR_EXT }
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > FORM_TEMPLATE_MAX_BYTES) return { ok: false, error: ERR_SIZE }
  const workspaceId = g.actor.projectWorkspace.get(projectId)
  if (!workspaceId) return { ok: false, error: ERR_WORKSPACE }
  const fileId = crypto.randomUUID()
  return { ok: true, path: `ws/${workspaceId}/p/${projectId}/${formKind}/incoming/${fileId}.${FORM_FORMAT[formKind]}` }
}

async function activeCustomKeys(projectId: string, kind: FormKind): Promise<{ ok: true; keys: string[]; mapping: FormSetting['mapping'] } | { ok: false; error: string }> {
  const { admin } = adminFor({ projectId })
  let config
  try {
    config = await getProjectConfig(projectId, { client: admin })
  } catch (e) {
    if (e instanceof ConfigUnavailableError) return { ok: false, error: failWith('formTemplates', e, ERR_COMMAND) }
    throw e
  }
  if (config.schemaAhead) return { ok: false, error: ERR_SCHEMA }
  const formKey: FormSettingKey = `forms.${kind}`
  const form = config.keys[formKey]
  if (form.status === 'invalid' || form.status === 'required_missing') return { ok: false, error: ERR_SETTING }
  const fields = config.keys[FIELD_KEY[kind]]
  if (fields.status === 'invalid' || fields.status === 'required_missing') return { ok: false, error: ERR_FIELDS }
  const keys = (fields.value as FieldDef[]).filter((f) => f.active).map((f) => f.key)
  return { ok: true, keys, mapping: form.value.mapping }
}

/** 매핑 완전성 다음 activate_form_template. 재스캔은 하지 않는다. */
export async function activateFormTemplate(projectId: string, templateId: string, command: FormCommand): Promise<FormCommandResult> {
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, code: 'ERR_DENIED', error: g.error, retryable: false }
  if (!isUuidLike(templateId)) return { ok: false, code: 'CONFIG_INVALID', error: ERR_INPUT, retryable: false }
  const loaded = await loadTemplate(projectId, templateId)
  if (!loaded.ok) return { ok: false, code: loaded.error === ERR_NOT_FOUND ? 'ERR_NOT_FOUND' : 'CONFIG_UNAVAILABLE', error: loaded.error, retryable: loaded.error !== ERR_NOT_FOUND }
  const kind = loaded.row.form_kind as FormKind
  const mod = await requireModule({ projectId }, FORM_SETTING_MODULE[kind])
  if (!mod.ok) return { ok: false, code: 'ERR_MODULE_DISABLED', error: mod.error, retryable: false }
  if (!validCommand(command)) return { ok: false, code: 'CONFIG_INVALID', error: ERR_INPUT, retryable: false }
  const ready = await activeCustomKeys(projectId, kind)
  if (!ready.ok) return { ok: false, code: 'CONFIG_UNAVAILABLE', error: ready.error, retryable: ready.error !== ERR_SETTING && ready.error !== ERR_SCHEMA && ready.error !== ERR_FIELDS }
  const assessed = assessFormActivation(kind, loaded.row.placeholders, ready.mapping, ready.keys)
  if (!assessed.ok) {
    return assessed.code === 'UNMAPPED'
      ? { ok: false, code: assessed.code, error: assessed.error, unmapped: assessed.unmapped, retryable: false }
      : { ok: false, code: assessed.code, error: assessed.error, retryable: false }
  }
  const { admin } = adminFor({ projectId })
  const { data, error } = await admin.rpc('activate_form_template', {
    p_project_id: projectId, p_template_id: templateId, p_expected_revision: command.expectedRevision,
    p_command_id: command.commandId, p_actor: g.actor.userId, p_schema_version: SETTINGS_SCHEMA_VERSION,
  })
  if (error) return failure(error)
  const result = commandResult(data)
  if (result.ok) revalidatePath(`/p/${projectId}`, 'layout')
  return result
}

/** 활성 해제. 이 행이 활성이면 template_id 를 null 로 돌린다. 옛 버전을 꺼도 다른 활성 행의 설정은 두지 않는다. */
export async function deactivateFormTemplate(projectId: string, templateId: string, command: FormCommand): Promise<FormCommandResult> {
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, code: 'ERR_DENIED', error: g.error, retryable: false }
  if (!isUuidLike(templateId)) return { ok: false, code: 'CONFIG_INVALID', error: ERR_INPUT, retryable: false }
  const loaded = await loadTemplate(projectId, templateId)
  if (!loaded.ok) return { ok: false, code: loaded.error === ERR_NOT_FOUND ? 'ERR_NOT_FOUND' : 'CONFIG_UNAVAILABLE', error: loaded.error, retryable: loaded.error !== ERR_NOT_FOUND }
  const kind = loaded.row.form_kind as FormKind
  const mod = await requireModule({ projectId }, FORM_SETTING_MODULE[kind])
  if (!mod.ok) return { ok: false, code: 'ERR_MODULE_DISABLED', error: mod.error, retryable: false }
  if (!validCommand(command)) return { ok: false, code: 'CONFIG_INVALID', error: ERR_INPUT, retryable: false }
  const { admin } = adminFor({ projectId })
  const { data, error } = await admin.rpc('deactivate_form_template', {
    p_project_id: projectId, p_template_id: templateId, p_expected_revision: command.expectedRevision,
    p_command_id: command.commandId, p_actor: g.actor.userId, p_schema_version: SETTINGS_SCHEMA_VERSION,
  })
  if (error) return failure(error)
  const result = commandResult(data)
  if (result.ok) revalidatePath(`/p/${projectId}`, 'layout')
  return result
}
