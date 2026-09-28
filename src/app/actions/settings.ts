'use server'
/**
 * 설정 액션(개정 §2.3.1 8단계, 스펙 §3.3). 관문은 가드 하나다 — RPC 는 등급을 판정하지 않는다.
 * 읽기는 해석기, 이력은 history.ts, 쓰기는 RPC — 이 파일은 설정 표를 직접 from() 하지 않는다(tests/invariants/settings-writes).
 * 자동 재기준(⑦)은 한 번이고, 최신 판독은 새 admin 객체로 해 react cache 를 비켜 간다(adminFor 는 호출마다 새 클라이언트).
 */
import { revalidatePath } from 'next/cache'
import { requireProjectAdmin, requireWorkspaceAdmin } from '@/lib/authz'
import { ERR_DENIED } from '@/lib/authz/errors'
import type { Actor } from '@/lib/domain/authz'
import { isUuidLike } from '@/lib/domain/validate'
import { adminFor, type AdminClient } from '@/lib/supabase/adminFor'
import { createServerClient } from '@/lib/supabase/server'
import type { ModuleId } from '@/lib/modules/defaults'
import { agentsNewlyEnabled, syncAgentsModule } from '@/lib/modules/agentsSync'
import { moduleKeyRule } from '@/lib/modules/saveRule'
import { REQUIRED_ON_CREATE, type EditCtx, type SettingDef } from '@/lib/settings/def'
import { CONFIG_MESSAGES, ConfigUnavailableError, kindOfCode, mapDbError, type DbErrorLike } from '@/lib/settings/errors'
import { changedKeysSince, findCommandOutcome, listHistory, type SettingsHistoryRow } from '@/lib/settings/history'
import { getProjectConfig, type ProjectConfig } from '@/lib/settings/projectConfig'
import { SETTINGS_SCHEMA_VERSION, settingDef, type SettingKey, type SettingScope } from '@/lib/settings/registry'
import { allowedOrNone, loadProjectValidateDeps, validateProjectConfig, validateWorkspaceConfig, type FieldError, type ValidateResult } from '@/lib/settings/validateConfig'
import { getWorkspaceConfig, type WorkspaceConfig } from '@/lib/settings/workspaceConfig'
import { commandDigestInput } from '@/lib/settings/write'
import type { KeyState } from '@/lib/settings/resolve'

export interface SettingsPatch {
  expectedRevision: number
  commandId: string
  set: Partial<Record<SettingKey, unknown>>
  unset: SettingKey[]
}
type InvalidCode = 'CONFIG_INVALID' | 'CONFIG_UNKNOWN_KEY' | 'CONFIG_IN_USE' | 'CONFIG_MODULE_NOT_ALLOWED'
export type SettingsCommandResult =
  | { ok: true; kind: 'applied' | 'duplicate'; commandId: string; revision: number; rebased: boolean }
  | { ok: false; kind: 'conflict'; code: 'CONFIG_CONFLICT'; commandId: string; error: string
      latest: { revision: number; values: Partial<Record<SettingKey, unknown>> }; changedKeys: SettingKey[]; retryable: false }
  | { ok: false; kind: 'invalid'; code: InvalidCode
      commandId: string; error: string; fieldErrors: { key: SettingKey; message: string; refCount?: number }[]; retryable: false }
  | { ok: false; kind: 'denied' | 'unavailable' | 'schema_ahead'; code: string; commandId: string; error: string; retryable: boolean }
export type SettingsHistoryScope = { projectId: string } | { workspaceId: string }
export type SettingsOutcomeResult = { ok: true; outcome: { status: 'applied'; revision: number } | { status: 'unknown' } } | { ok: false; error: string }
export type SettingsHistoryResult = { ok: true; rows: SettingsHistoryRow[]; nextBefore: number | null } | { ok: false; error: string }

type Doc = { revision: number; schemaAhead: boolean; keys: Record<string, KeyState<unknown>> }
type Loaded = { doc: Doc; ws: WorkspaceConfig; cfg: ProjectConfig | null }
type RpcArgs = { expectedRevision: number; commandId: string; set: Record<string, unknown>; unset: string[]; actor: string }
/** 스코프 어댑터 — 두 update 액션이 다른 것 전부 */
interface ScopeAdapter {
  scope: SettingScope
  history: SettingsHistoryScope
  admin: () => AdminClient                     // 호출마다 새 객체(재기준 판독이 캐시를 비켜 가게)
  load: (admin: AdminClient) => Promise<Loaded>
  editCtx: EditCtx
  validate: (admin: AdminClient, next: Record<string, unknown>, loaded: Loaded) => Promise<ValidateResult>
  rpc: (admin: AdminClient, args: RpcArgs) => PromiseLike<{ data: unknown; error: DbErrorLike | null }>
  afterApplied: (admin: AdminClient, prev: Doc, set: Record<string, unknown>, actor: Actor) => Promise<{ ok: true } | { ok: false; error: string }>
  revalidate: () => void
}

const INVALID_CODES: readonly string[] = ['CONFIG_INVALID', 'CONFIG_UNKNOWN_KEY', 'CONFIG_IN_USE', 'CONFIG_MODULE_NOT_ALLOWED'] satisfies InvalidCode[]
const invalid = (commandId: string, code: InvalidCode, fieldErrors: FieldError[], error?: string): SettingsCommandResult =>
  ({ ok: false, kind: 'invalid', code, commandId, error: error ?? CONFIG_MESSAGES[code], fieldErrors: fieldErrors as { key: SettingKey; message: string; refCount?: number }[], retryable: false })
const unavailable = (commandId: string, error: string): SettingsCommandResult =>
  ({ ok: false, kind: 'unavailable', code: 'CONFIG_UNAVAILABLE', commandId, error, retryable: true })
const denied = (commandId: string, error: string): SettingsCommandResult =>
  ({ ok: false, kind: 'denied', code: error, commandId, error, retryable: false })

function stateValue(s: KeyState<unknown> | undefined): unknown {
  return s && (s.status === 'set' || s.status === 'default') ? s.value : undefined
}
/** editor 등급 — 워크스페이스·프로젝트 관리 등급은 가드가 이미 판정했다. 남는 것은 플랫폼 관리자 전용 키뿐 */
function canEdit(def: SettingDef, actor: Actor): boolean {
  if (def.editor === 'platform_admin') return actor.isSuperuser
  return true
}
function patchShapeOk(p: SettingsPatch): boolean {
  return typeof p === 'object' && p !== null && Number.isInteger(p.expectedRevision) && p.expectedRevision >= 0
    && typeof p.commandId === 'string' && isUuidLike(p.commandId)
    && typeof p.set === 'object' && p.set !== null && !Array.isArray(p.set) && Array.isArray(p.unset) && p.unset.every((k) => typeof k === 'string')
}
/** 해석기 판독 — 설정 행 부재·조회 실패는 unavailable 결과로(원인 메시지를 그대로 싣는다 — 표시 = 로깅) */
async function loadOrUnavailable(a: ScopeAdapter, admin: AdminClient, commandId: string): Promise<Loaded | SettingsCommandResult> {
  try { return await a.load(admin) } catch (e) {
    if (e instanceof ConfigUnavailableError) { console.error('[settings] load failed', { scope: a.history, error: e.message }); return unavailable(commandId, e.message) }
    throw e
  }
}

/** 저장 형태 만들기(4단계) — edit 가 있으면 parseInput → toStored, 그다음 모두 parse. 하나라도 실패하면 전체 거부 */
async function buildStored(defs: Map<string, SettingDef>, rawSet: Record<string, unknown>, prevDoc: Doc, ctx: EditCtx)
  : Promise<{ ok: true; set: Record<string, unknown> } | { ok: false; fieldErrors: FieldError[] }> {
  const set: Record<string, unknown> = {}
  const fieldErrors: FieldError[] = []
  for (const [key, raw] of Object.entries(rawSet)) {
    const def = defs.get(key)!
    let stored: unknown = raw
    if (def.edit) {
      const input = def.edit.parseInput(raw)
      if (!input.ok) { fieldErrors.push({ key, message: input.error }); continue }
      const s = await def.edit.toStored(stateValue(prevDoc.keys[key]), input.value, ctx)
      if (!s.ok) { fieldErrors.push({ key, message: s.error }); continue }
      stored = s.value
    }
    const p = def.parse(stored)
    if (!p.ok) { fieldErrors.push({ key, message: p.error }); continue }
    set[key] = p.value
  }
  return fieldErrors.length ? { ok: false, fieldErrors } : { ok: true, set }
}

type Attempt = SettingsCommandResult | { retry: true }

async function runCommand(a: ScopeAdapter, actor: Actor, patch: SettingsPatch): Promise<SettingsCommandResult> {
  const commandId = typeof patch?.commandId === 'string' ? patch.commandId : ''
  if (!patchShapeOk(patch)) return invalid(commandId, 'CONFIG_INVALID', [], `${CONFIG_MESSAGES.CONFIG_INVALID}: 요청 형식`)
  // 2. 키 정의·editor 등급
  const unset = [...new Set(patch.unset)].sort()
  const keys = [...new Set([...Object.keys(patch.set), ...unset])]
  const defs = new Map<string, SettingDef>()
  const unknown: FieldError[] = []
  for (const key of keys) {
    const def: SettingDef | undefined = a.scope === 'project' ? settingDef('project', key) : settingDef('workspace', key)
    if (!def) unknown.push({ key, message: '등록되지 않은 설정 키입니다.' })
    else defs.set(key, def)
  }
  if (unknown.length) return invalid(commandId, 'CONFIG_UNKNOWN_KEY', unknown)
  const overlap = unset.filter((k) => Object.prototype.hasOwnProperty.call(patch.set, k))
  if (overlap.length) return invalid(commandId, 'CONFIG_INVALID', overlap.map((key) => ({ key, message: 'set 과 unset 에 같이 있습니다.' })))
  for (const key of unset) if (defs.get(key)!.default === REQUIRED_ON_CREATE) return invalid(commandId, 'CONFIG_INVALID', [{ key, message: '필수 설정은 기본값으로 되돌릴 수 없습니다.' }])
  for (const def of defs.values()) if (!canEdit(def, actor)) return denied(commandId, ERR_DENIED)

  // 3~6 — 재기준 때 한 번 더 돈다. expected 는 첫 시도에 클라이언트 값, 재기준에 방금 읽은 최신 revision
  const attempt = async (admin: AdminClient, expected: number, rebased: boolean): Promise<Attempt> => {
    const loaded = await loadOrUnavailable(a, admin, commandId)
    if ('ok' in loaded) return loaded
    const { doc, ws, cfg } = loaded
    if (doc.schemaAhead) return { ok: false, kind: 'schema_ahead', code: 'CONFIG_SCHEMA_AHEAD', commandId, error: CONFIG_MESSAGES.CONFIG_SCHEMA_AHEAD, retryable: false }
    // 3. 소유 모듈 규칙 — modules.allowed 가 손상이면 빈 집합(fail-closed: core 키만 저장 가능 — 그 안에 modules.allowed 자체가 있어 복구 경로는 남는다)
    const allowed: ReadonlySet<ModuleId> = new Set(allowedOrNone(ws))
    const enabled = cfg ? new Set((stateValue(cfg.keys['modules.enabled']) as ModuleId[] | undefined) ?? []) : null
    const notAllowed: FieldError[] = []
    for (const [key, def] of defs) {
      if (moduleKeyRule({ module: def.module, allowed, enabled }) === 'not_allowed') notAllowed.push({ key, message: `이 워크스페이스나 배포에서 사용할 수 없는 모듈의 설정입니다: ${def.module}` })
    }
    if (notAllowed.length) return invalid(commandId, 'CONFIG_MODULE_NOT_ALLOWED', notAllowed)
    // 4. 저장 형태
    const built = await buildStored(defs, patch.set as Record<string, unknown>, doc, a.editCtx)
    if (!built.ok) return invalid(commandId, 'CONFIG_INVALID', built.fieldErrors)
    // 5. 교차 불변식
    let v: ValidateResult
    try { v = await a.validate(admin, built.set, loaded) } catch (e) {
      if (e instanceof ConfigUnavailableError) return unavailable(commandId, e.message)
      throw e
    }
    if (!v.ok) return invalid(commandId, 'CONFIG_INVALID', v.fieldErrors)
    // 6. RPC
    const digest = commandDigestInput(built.set, unset)
    const { data, error } = await a.rpc(admin, { expectedRevision: expected, commandId, set: digest.set, unset: digest.unset, actor: actor.userId })
    if (error) {
      const mapped = mapDbError(error)
      if (!mapped) throw new Error(`[settings] 알 수 없는 DB 오류: ${error.message}`)      // 표에 없는 토큰은 드러낸다(500)
      if (mapped.code === 'CONFIG_CONFLICT') return { retry: true }
      if (mapped.code === 'ERR_DENIED') return denied(commandId, mapped.message)
      if (mapped.code === 'CONFIG_INVALID') return invalid(commandId, 'CONFIG_INVALID', mapped.fieldKey ? [{ key: mapped.fieldKey, message: mapped.message }] : [], mapped.message)
      const k = kindOfCode(mapped.code)
      if (k.kind === 'unavailable' || k.kind === 'schema_ahead') return { ok: false, kind: k.kind, code: mapped.code, commandId, error: mapped.message, retryable: k.retryable }
      if (k.kind === 'invalid' && INVALID_CODES.includes(mapped.code)) return invalid(commandId, mapped.code as InvalidCode, [], mapped.message)
      throw new Error(`[settings] 설정 RPC 가 낼 수 없는 오류: ${mapped.token}`)
    }
    const r = data as { status: 'applied' | 'duplicate'; revision: number | string }
    if (r.status === 'applied') {
      const after = await a.afterApplied(admin, doc, built.set, actor)
      if (!after.ok) return unavailable(commandId, `설정은 저장됐지만(revision ${Number(r.revision)}) ${after.error}`)
    }
    a.revalidate()
    return { ok: true, kind: r.status, commandId, revision: Number(r.revision), rebased }
  }

  const first = await attempt(a.admin(), patch.expectedRevision, false)
  if (!('retry' in first)) return first
  // 7. 자동 재기준 1회 — 그사이 바뀐 키가 patch 키와 겹치지 않으면 최신 revision 으로 다시
  const conflict = async (): Promise<SettingsCommandResult> => {
    const admin = a.admin()
    const changed = await changedKeysSince(admin, a.history, patch.expectedRevision)
    if (!changed.ok) return unavailable(commandId, changed.error)
    const loaded = await loadOrUnavailable(a, admin, commandId)
    if ('ok' in loaded) return loaded
    const values: Partial<Record<SettingKey, unknown>> = {}
    for (const k of new Set([...keys, ...changed.keys])) values[k as SettingKey] = stateValue(loaded.doc.keys[k])
    return { ok: false, kind: 'conflict', code: 'CONFIG_CONFLICT', commandId, error: CONFIG_MESSAGES.CONFIG_CONFLICT,
      latest: { revision: loaded.doc.revision, values }, changedKeys: changed.keys as SettingKey[], retryable: false }
  }
  const admin2 = a.admin()
  const changed = await changedKeysSince(admin2, a.history, patch.expectedRevision)
  if (!changed.ok) return unavailable(commandId, changed.error)
  if (changed.keys.some((k) => keys.includes(k))) return conflict()
  const latest = await loadOrUnavailable(a, admin2, commandId)
  if ('ok' in latest) return latest
  const second = await attempt(a.admin(), latest.doc.revision, true)
  return 'retry' in second ? conflict() : second
}

function projectAdapter(projectId: string): ScopeAdapter {
  return {
    scope: 'project', history: { projectId },
    admin: () => adminFor({ projectId }).admin,
    load: async (admin) => {
      const cfg = await getProjectConfig(projectId, { client: admin })
      const ws = await getWorkspaceConfig(cfg.workspaceId, { client: admin })
      return { cfg, ws, doc: { revision: cfg.revision, schemaAhead: cfg.schemaAhead, keys: cfg.keys } }
    },
    editCtx: { scope: 'project', projectId, today: new Date().toISOString().slice(0, 10) },
    validate: async (admin, next, { ws, cfg }) => validateProjectConfig(next, await loadProjectValidateDeps(admin, cfg!, ws)),
    rpc: (admin, x) => admin.rpc('apply_project_settings', { p_project_id: projectId, p_expected_revision: x.expectedRevision, p_command_id: x.commandId,
      p_set: x.set, p_unset: x.unset, p_actor: x.actor, p_schema_version: SETTINGS_SCHEMA_VERSION, p_source: 'edit' }),
    afterApplied: async (admin, prev, set, actor) => {
      if (!('modules.enabled' in set)) return { ok: true }
      const prevEnabled = (stateValue(prev.keys['modules.enabled']) as ModuleId[] | undefined) ?? null
      const next = set['modules.enabled'] as ModuleId[]
      if (!agentsNewlyEnabled(prevEnabled, next)) return { ok: true }
      const r = await syncAgentsModule(admin, { projectId, actorUserId: actor.userId, prevEnabled, nextEnabled: next })
      return r.ok ? { ok: true } : { ok: false, error: `에이전트 등록 동기화에 실패했습니다: ${r.error}` }
    },
    revalidate: () => revalidatePath(`/p/${projectId}`, 'layout'),
  }
}
function workspaceAdapter(workspaceId: string): ScopeAdapter {
  return {
    scope: 'workspace', history: { workspaceId },
    admin: () => adminFor({ workspaceId }).admin,
    load: async (admin) => {
      const ws = await getWorkspaceConfig(workspaceId, { client: admin })
      return { cfg: null, ws, doc: { revision: ws.revision, schemaAhead: ws.schemaAhead, keys: ws.keys } }
    },
    editCtx: { scope: 'workspace', workspaceId },
    validate: async (_admin, next) => validateWorkspaceConfig(next, { workspaceId }),
    rpc: (admin, x) => admin.rpc('apply_workspace_settings', { p_workspace_id: workspaceId, p_expected_revision: x.expectedRevision, p_command_id: x.commandId,
      p_set: x.set, p_unset: x.unset, p_actor: x.actor, p_schema_version: SETTINGS_SCHEMA_VERSION, p_source: 'edit' }),
    afterApplied: async () => ({ ok: true }),
    revalidate: () => revalidatePath('/', 'layout'),      // 워크스페이스 전역 키는 /p/* 에도 적용된다
  }
}

export async function updateProjectSettings(projectId: string, patch: SettingsPatch): Promise<SettingsCommandResult> {
  const commandId = typeof patch?.commandId === 'string' ? patch.commandId : ''
  if (typeof projectId !== 'string' || !isUuidLike(projectId)) return invalid(commandId, 'CONFIG_INVALID', [], `${CONFIG_MESSAGES.CONFIG_INVALID}: projectId`)
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return denied(commandId, g.error)
  return runCommand(projectAdapter(projectId), g.actor, patch)
}

export async function updateWorkspaceSettings(workspaceId: string, patch: SettingsPatch): Promise<SettingsCommandResult> {
  const commandId = typeof patch?.commandId === 'string' ? patch.commandId : ''
  if (typeof workspaceId !== 'string' || !isUuidLike(workspaceId)) return invalid(commandId, 'CONFIG_INVALID', [], `${CONFIG_MESSAGES.CONFIG_INVALID}: workspaceId`)
  const g = await requireWorkspaceAdmin(workspaceId)
  if (!g.ok) return denied(commandId, g.error)
  return runCommand(workspaceAdapter(workspaceId), g.actor, patch)
}

async function guardScope(scope: SettingsHistoryScope) {
  return 'projectId' in scope ? requireProjectAdmin(scope.projectId) : requireWorkspaceAdmin(scope.workspaceId)
}

/** 결과 불명 뒤 재조회 — 자기 명령만. 세션 클라이언트로 읽는다(D24) */
export async function getSettingsCommandOutcome(scope: SettingsHistoryScope, commandId: string): Promise<SettingsOutcomeResult> {
  const g = await guardScope(scope)
  if (!g.ok) return { ok: false, error: g.error }
  const sb = await createServerClient()
  return findCommandOutcome(sb, scope, commandId, g.actor.userId)
}

export async function listSettingsHistory(scope: SettingsHistoryScope, opts?: { limit?: number; before?: number }): Promise<SettingsHistoryResult> {
  const g = await guardScope(scope)
  if (!g.ok) return { ok: false, error: g.error }
  const sb = await createServerClient()
  return listHistory(sb, scope, opts)
}
