'use server'
/**
 * SP6 S2 — 양식 업로드 준비·등록·활성화·활성 해제(정본 §4.7.1·§4.7.2).
 * 파일 바이트는 준비 액션으로 받지 않는다. 등록은 incoming 을 내려 패키지를 검사하고 scan 한 뒤 v<n> 으로 옮긴다.
 * 활성 해제가 계획의 삭제다. tokenScan:false 로 남은 옛 행은 활성화하지 않는다.
 */
import { revalidatePath } from 'next/cache'
import { requireProjectAdmin } from '@/lib/authz'
import { requireModule } from '@/lib/modules/gate'
import { adminFor } from '@/lib/supabase/adminFor'
import { failWith, rpcFailure, tokenTable, type OwnTokenKeys } from '@/lib/errors/dbFail'
import { isUuidLike } from '@/lib/domain/validate'
import { assessFormActivation } from '@/lib/forms/activation'
import { FORM_FORMAT, FORM_TEMPLATE_MAX_BYTES, type FormKind } from '@/lib/report/engine/types'
import { scanFormTemplate } from '@/lib/report/engine/scan'
import { validateFormPackage } from '@/lib/report/engine/validate'
import { ConfigUnavailableError } from '@/lib/settings/errors'
import { FORM_SETTING_MODULE, isFormKind, type FormSetting, type FormSettingKey } from '@/lib/settings/defs/forms'
import { getProjectConfig } from '@/lib/settings/projectConfig'
import { SETTINGS_SCHEMA_VERSION } from '@/lib/settings/registry'
import type { FieldDef } from '@/lib/domain/customFields'
import type { ProjectSettingKey } from '@/lib/settings/registry'
import { serverTranslator } from '@/lib/i18n/server'
import type { ServerTranslate } from '@/lib/i18n/serverDict'

const ERR_INPUT = 'srv.formTemplates.checkTypeNameSizeTemplate'
const ERR_EXT = 'srv.formTemplates.extensionDoesNotMatchTemplate'
const ERR_SIZE = 'srv.formTemplates.templateFileMustBetween1'
const ERR_WORKSPACE = 'srv.formTemplates.couldNotFindProjectS'
const ERR_NOT_FOUND = 'srv.formTemplates.templateNotFound'
const ERR_COMMAND = 'srv.formTemplates.couldNotChangeTemplate'
const ERR_SETTING = 'srv.formTemplates.templateSettingCorruptedCannotActivated'
const ERR_SCHEMA = 'srv.formTemplates.settingsFormatNewerTemplateNot'
const ERR_FIELDS = 'srv.formTemplates.couldNotReadCustomField'
const ERR_REGISTER = 'srv.formTemplates.couldNotRegisterTemplate'
const ERR_REUPLOAD = 'srv.formTemplates.uploadFileAgain'
const ERR_PATH = 'srv.formTemplates.uploadedFilePathDoesNot'
const INCOMING_TTL_MS = 24 * 60 * 60 * 1000
const BUCKET = 'form-templates'

const FIELD_KEY: Record<FormKind, ProjectSettingKey> = {
  weekly_report_pptx: 'fields.weekly_row',
  weekly_report_xlsx: 'fields.weekly_row',
  issue_analysis_pptx: 'fields.issue',
  wbs_export_xlsx: 'fields.wbs_item',
}

const TOKENS: OwnTokenKeys = {
  FORM_TEMPLATE_FORBIDDEN: { status: 403, code: 'ERR_DENIED', key: 'srv.formTemplates.doNotPermissionChangeProject' },
  FORM_TEMPLATE_NOT_FOUND: { status: 404, code: 'ERR_NOT_FOUND', key: ERR_NOT_FOUND },
  FORM_TEMPLATE_INPUT: { status: 422, code: 'CONFIG_INVALID', key: 'srv.formTemplates.checkTemplateChangeRequest' },
  FORM_TEMPLATE_SETTING: { status: 422, code: 'CONFIG_INVALID', key: ERR_SETTING },
}

export type FormPrepareResult = { ok: true; path: string } | { ok: false; error: string }
export type FormRegisterResult =
  | { ok: true; templateId: string; version: number; path: string; warnings: { code: 'ROUNDTRIP_LOSS'; message: string }[] }
  | { ok: false; error: string; code?: string }
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

function commandResult(tr: ServerTranslate, data: unknown): FormCommandResult {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, error: failWith('formTemplates', new Error('RPC response shape'), tr(ERR_COMMAND)), retryable: true }
  }
  const v = data as Record<string, unknown>
  if ((v.status !== 'applied' && v.status !== 'duplicate') || !Number.isSafeInteger(v.revision) || (v.revision as number) < 0) {
    return { ok: false, error: failWith('formTemplates', new Error('RPC response values'), tr(ERR_COMMAND)), retryable: true }
  }
  return { ok: true, status: v.status, revision: v.revision as number }
}

function failure(tr: ServerTranslate, error: Parameters<typeof rpcFailure>[0]): FormCommandResult {
  const mapped = rpcFailure(error, tokenTable(TOKENS, tr), tr)
  return {
    ok: false,
    code: mapped?.code ?? 'CONFIG_UNAVAILABLE',
    error: failWith('formTemplates', error, mapped?.message ?? tr(ERR_COMMAND)),
    retryable: mapped?.retryable ?? true,
  }
}

type TemplateRow = { id: string; form_kind: string; placeholders: unknown }

async function loadTemplate(projectId: string, templateId: string): Promise<{ ok: true; row: TemplateRow } | { ok: false; error: string }> {
  const tr = await serverTranslator()
  const { admin } = adminFor({ projectId })
  const { data, error } = await admin.from('form_templates').select('id, form_kind, placeholders')
    .eq('id', templateId).eq('project_id', projectId).maybeSingle()
  if (error) return { ok: false, error: failWith('formTemplates', error, tr(ERR_COMMAND)) }
  const row = data as TemplateRow | null
  if (!row || !isFormKind(row.form_kind)) return { ok: false, error: tr(ERR_NOT_FOUND) }
  return { ok: true, row }
}

/** 가드·모듈 다음. 브라우저가 올릴 incoming 경로만 돌려준다. 유효 시간은 정리 워커의 24시간이다(정본 §4.7.1). */
export async function prepareFormTemplateUpload(
  projectId: string, formKind: string, fileName: string, sizeBytes: number,
): Promise<FormPrepareResult> {
  const tr = await serverTranslator()
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  if (!isFormKind(formKind)) return { ok: false, error: tr(ERR_INPUT) }
  const mod = await requireModule({ projectId }, FORM_SETTING_MODULE[formKind])
  if (!mod.ok) return { ok: false, error: mod.error }
  if (extensionOf(fileName) !== FORM_FORMAT[formKind]) return { ok: false, error: tr(ERR_EXT) }
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > FORM_TEMPLATE_MAX_BYTES) return { ok: false, error: tr(ERR_SIZE) }
  const workspaceId = g.actor.projectWorkspace.get(projectId)
  if (!workspaceId) return { ok: false, error: tr(ERR_WORKSPACE) }
  const fileId = crypto.randomUUID()
  return { ok: true, path: `ws/${workspaceId}/p/${projectId}/${formKind}/incoming/${fileId}.${FORM_FORMAT[formKind]}` }
}

async function activeCustomKeys(projectId: string, kind: FormKind): Promise<{ ok: true; keys: string[]; mapping: FormSetting['mapping'] } | { ok: false; error: string }> {
  const tr = await serverTranslator()
  const { admin } = adminFor({ projectId })
  let config
  try {
    config = await getProjectConfig(projectId, { client: admin })
  } catch (e) {
    if (e instanceof ConfigUnavailableError) return { ok: false, error: failWith('formTemplates', e, tr(ERR_COMMAND)) }
    throw e
  }
  if (config.schemaAhead) return { ok: false, error: tr(ERR_SCHEMA) }
  const formKey: FormSettingKey = `forms.${kind}`
  const form = config.keys[formKey]
  if (form.status === 'invalid' || form.status === 'required_missing') return { ok: false, error: tr(ERR_SETTING) }
  const fields = config.keys[FIELD_KEY[kind]]
  if (fields.status === 'invalid' || fields.status === 'required_missing') return { ok: false, error: tr(ERR_FIELDS) }
  const keys = (fields.value as FieldDef[]).filter((f) => f.active).map((f) => f.key)
  return { ok: true, keys, mapping: form.value.mapping }
}

/** 매핑 완전성 다음 activate_form_template. 재스캔은 하지 않는다. */
export async function activateFormTemplate(projectId: string, templateId: string, command: FormCommand): Promise<FormCommandResult> {
  const tr = await serverTranslator()
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, code: 'ERR_DENIED', error: g.error, retryable: false }
  if (!isUuidLike(templateId)) return { ok: false, code: 'CONFIG_INVALID', error: tr(ERR_INPUT), retryable: false }
  const loaded = await loadTemplate(projectId, templateId)
  if (!loaded.ok) return { ok: false, code: loaded.error === tr(ERR_NOT_FOUND) ? 'ERR_NOT_FOUND' : 'CONFIG_UNAVAILABLE', error: loaded.error, retryable: loaded.error !== tr(ERR_NOT_FOUND) }
  const kind = loaded.row.form_kind as FormKind
  const mod = await requireModule({ projectId }, FORM_SETTING_MODULE[kind])
  if (!mod.ok) return { ok: false, code: 'ERR_MODULE_DISABLED', error: mod.error, retryable: false }
  if (!validCommand(command)) return { ok: false, code: 'CONFIG_INVALID', error: tr(ERR_INPUT), retryable: false }
  const ready = await activeCustomKeys(projectId, kind)
  if (!ready.ok) return { ok: false, code: 'CONFIG_UNAVAILABLE', error: ready.error, retryable: ready.error !== tr(ERR_SETTING) && ready.error !== tr(ERR_SCHEMA) && ready.error !== tr(ERR_FIELDS) }
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
  if (error) return failure(tr, error)
  const result = commandResult(tr, data)
  if (result.ok) revalidatePath(`/p/${projectId}`, 'layout')
  return result
}

/** 활성 해제. 이 행이 활성이면 template_id 를 null 로 돌린다. 옛 버전을 꺼도 다른 활성 행의 설정은 두지 않는다. */
export async function deactivateFormTemplate(projectId: string, templateId: string, command: FormCommand): Promise<FormCommandResult> {
  const tr = await serverTranslator()
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, code: 'ERR_DENIED', error: g.error, retryable: false }
  if (!isUuidLike(templateId)) return { ok: false, code: 'CONFIG_INVALID', error: tr(ERR_INPUT), retryable: false }
  const loaded = await loadTemplate(projectId, templateId)
  if (!loaded.ok) return { ok: false, code: loaded.error === tr(ERR_NOT_FOUND) ? 'ERR_NOT_FOUND' : 'CONFIG_UNAVAILABLE', error: loaded.error, retryable: loaded.error !== tr(ERR_NOT_FOUND) }
  const kind = loaded.row.form_kind as FormKind
  const mod = await requireModule({ projectId }, FORM_SETTING_MODULE[kind])
  if (!mod.ok) return { ok: false, code: 'ERR_MODULE_DISABLED', error: mod.error, retryable: false }
  if (!validCommand(command)) return { ok: false, code: 'CONFIG_INVALID', error: tr(ERR_INPUT), retryable: false }
  const { admin } = adminFor({ projectId })
  const { data, error } = await admin.rpc('deactivate_form_template', {
    p_project_id: projectId, p_template_id: templateId, p_expected_revision: command.expectedRevision,
    p_command_id: command.commandId, p_actor: g.actor.userId, p_schema_version: SETTINGS_SCHEMA_VERSION,
  })
  if (error) return failure(tr, error)
  const result = commandResult(tr, data)
  if (result.ok) revalidatePath(`/p/${projectId}`, 'layout')
  return result
}

function incomingMatches(workspaceId: string, projectId: string, kind: FormKind, incomingPath: string): boolean {
  const parts = incomingPath.split('/')
  if (parts.length !== 7) return false
  const [ws, wid, p, pid, form, incoming, file] = parts
  if (ws !== 'ws' || wid !== workspaceId || p !== 'p' || pid !== projectId || form !== kind || incoming !== 'incoming') return false
  const m = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([A-Za-z0-9]+)$/.exec(file)
  return !!m && m[2].toLowerCase() === FORM_FORMAT[kind]
}

function createdMs(info: unknown): number | null {
  if (!info || typeof info !== 'object') return null
  const raw = (info as { created_at?: unknown; createdAt?: unknown }).created_at ?? (info as { createdAt?: unknown }).createdAt
  if (typeof raw !== 'string') return null
  const t = Date.parse(raw)
  return Number.isFinite(t) ? t : null
}

async function asBytes(data: unknown): Promise<Uint8Array | null> {
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (typeof Blob !== 'undefined' && data instanceof Blob) return new Uint8Array(await data.arrayBuffer())
  return null
}

/**
 * incoming 객체를 받아 패키지를 검사하고 FormEngine.scan 으로 문법·구조를 본 뒤 v<n> 으로 옮긴다.
 * 스캔 오류가 있으면 행을 만들지 않고 incoming 을 지운다(정본 §4.7.1·§4.7.2).
 */
export async function registerFormTemplate(
  projectId: string, formKind: string, incomingPath: string, fileName: string,
): Promise<FormRegisterResult> {
  const tr = await serverTranslator()
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  if (!isFormKind(formKind)) return { ok: false, code: 'CONFIG_INVALID', error: tr(ERR_INPUT) }
  const mod = await requireModule({ projectId }, FORM_SETTING_MODULE[formKind])
  if (!mod.ok) return { ok: false, code: 'ERR_MODULE_DISABLED', error: mod.error }
  const workspaceId = g.actor.projectWorkspace.get(projectId)
  if (!workspaceId) return { ok: false, code: 'CONFIG_INVALID', error: tr(ERR_WORKSPACE) }
  if (extensionOf(fileName) !== FORM_FORMAT[formKind] || !incomingMatches(workspaceId, projectId, formKind, incomingPath)) {
    return { ok: false, code: 'CONFIG_INVALID', error: tr(ERR_PATH) }
  }
  const { admin } = adminFor({ projectId })
  const bucket = admin.storage.from(BUCKET)
  const info = await bucket.info(incomingPath)
  if (info.error || !info.data) return { ok: false, code: 'FORM_GONE', error: tr(ERR_REUPLOAD) }
  const created = createdMs(info.data)
  if (created !== null && Date.now() - created > INCOMING_TTL_MS) {
    await bucket.remove([incomingPath])
    return { ok: false, code: 'FORM_GONE', error: tr(ERR_REUPLOAD) }
  }
  const downloaded = await bucket.download(incomingPath)
  if (downloaded.error || downloaded.data == null) return { ok: false, code: 'FORM_GONE', error: tr(ERR_REUPLOAD) }
  const bytes = await asBytes(downloaded.data)
  if (!bytes || bytes.length < 1 || bytes.length > FORM_TEMPLATE_MAX_BYTES) {
    await bucket.remove([incomingPath])
    return { ok: false, code: 'FORM_SIZE', error: bytes && bytes.length > FORM_TEMPLATE_MAX_BYTES ? tr(ERR_SIZE) : ERR_PACKAGE_SIZE(tr) }
  }
  const checked = validateFormPackage(bytes, FORM_FORMAT[formKind])
  if (!checked.ok) {
    await bucket.remove([incomingPath])
    return { ok: false, code: checked.code, error: checked.error }
  }
  const ext = FORM_FORMAT[formKind]
  let scanned
  try {
    scanned = await scanFormTemplate(bytes, ext)
  } catch {
    await bucket.remove([incomingPath])
    return { ok: false, code: 'PACKAGE', error: tr('err.templateFileStructureNotValid') }
  }
  const scanError = scanned.issues.find((i) => i.severity === 'error')
  if (scanError) {
    await bucket.remove([incomingPath])
    return { ok: false, code: 'FORM_SCAN', error: tr('srv.formTemplates.templatePlaceholderSyntaxStructureErrors') }
  }
  const latest = await admin.from('form_templates').select('version').eq('project_id', projectId).eq('form_kind', formKind)
    .order('version', { ascending: false }).limit(1).maybeSingle()
  if (latest.error) {
    await bucket.remove([incomingPath])
    return { ok: false, code: 'CONFIG_UNAVAILABLE', error: failWith('formTemplates.register', latest.error, tr(ERR_REGISTER)) }
  }
  const version = (typeof latest.data?.version === 'number' && Number.isSafeInteger(latest.data.version) && latest.data.version >= 1)
    ? latest.data.version + 1 : 1
  const dest = `ws/${workspaceId}/p/${projectId}/${formKind}/v${version}.${ext}`
  const moved = await bucket.move(incomingPath, dest)
  if (moved.error) {
    await bucket.remove([incomingPath])
    return { ok: false, code: 'CONFIG_UNAVAILABLE', error: failWith('formTemplates.register', moved.error, tr(ERR_REGISTER)) }
  }
  const id = crypto.randomUUID()
  const placeholders = scanned
  const inserted = await admin.from('form_templates').insert({
    id, project_id: projectId, form_kind: formKind, file_name: fileName, storage_path: dest,
    size_bytes: bytes.length, version, placeholders, active: false, uploaded_by: g.actor.userId,
  }).select('id').single()
  if (inserted.error || !inserted.data) {
    await bucket.remove([dest])
    return { ok: false, code: 'CONFIG_UNAVAILABLE', error: failWith('formTemplates.register', inserted.error ?? new Error('insert'), tr(ERR_REGISTER)) }
  }
  revalidatePath(`/p/${projectId}`, 'layout')
  return { ok: true, templateId: id, version, path: dest, warnings: checked.warnings }
}

function ERR_PACKAGE_SIZE(tr: ServerTranslate): string { return tr('srv.formTemplates.couldNotReadTemplateFile') }
