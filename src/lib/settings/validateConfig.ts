/**
 * 교차 불변식(개정 §2.7.2, 스펙 §3.6 교차 열) — parse 를 통과한 저장 형태에 대해, 다른 행·다른 키와의 관계를 본다.
 * 참조 건수는 여기서 세지 않는다(DB 가 셈한다 — S9). 선행 조회가 실패하면 throw — 쓰기 전 선행 조회 실패는 중단이다(3원칙).
 */
import { treeMaxDepth } from '@/lib/domain/levelSettings'
import type { ExcelProfile } from '@/lib/excel/profile'
import type { ModuleId } from '@/lib/modules/defaults'
import { MODULES } from '@/lib/modules/registry'
import { checkEnabledModules } from '@/lib/modules/saveRule'
import { parseBrandingPath } from './brandingPath'
import { ConfigKeyError, ConfigUnavailableError } from './errors'
import type { BrandingLogo } from './defs/workspace'
import type { ConfigReadClient, ProjectConfig } from './projectConfig'
import type { ProjectSettingKey, WorkspaceSettingKey } from './registry'
import type { WorkspaceConfig } from './workspaceConfig'
import { valueOf } from './registry'

export interface FieldError { key: string; message: string; refCount?: number }
export type ValidateResult = { ok: true } | { ok: false; fieldErrors: FieldError[] }
export interface ProjectValidateDeps {
  treeMaxDepth: number | null            // 0-base. 빈 트리는 null
  teamCodes: readonly string[]           // 활성 팀 코드(프로젝트 전용 + 워크스페이스 공용)
  allowed: readonly ModuleId[]           // 워크스페이스 허용 ∩ env 가용
  prevEnabled: readonly ModuleId[] | null   // 저장된(또는 기본값의) modules.enabled. 생성이면 null
  allowedBroken?: boolean                // 워크스페이스 modules.allowed 가 손상(invalid) — allowed 는 빈 목록이고 거부 사유를 따로 알린다
}
export const ERR_MODULES_ALLOWED_BROKEN = '워크스페이스 모듈 허용 설정이 손상돼 새 모듈을 켤 수 없습니다 — 관리자에게 알리세요'

const has = <K extends string>(o: Partial<Record<K, unknown>>, k: K) => Object.prototype.hasOwnProperty.call(o, k)

export function validateProjectConfig(next: Partial<Record<ProjectSettingKey, unknown>>, deps: ProjectValidateDeps): ValidateResult {
  const fieldErrors: FieldError[] = []
  if (has(next, 'core.level_labels')) {
    const labels = next['core.level_labels'] as string[]
    if (deps.treeMaxDepth != null && labels.length < deps.treeMaxDepth + 1) {
      fieldErrors.push({ key: 'core.level_labels', message: `기존 WBS 에 깊이 ${deps.treeMaxDepth + 1}단 항목이 있어 ${labels.length}단으로 줄일 수 없습니다.` })
    }
  }
  if (has(next, 'wbs.excel_profile') && next['wbs.excel_profile'] !== null) {
    const profile = next['wbs.excel_profile'] as ExcelProfile
    const unknownCodes = profile.teamColumns.map(([, code]) => code).filter((c) => c !== '*' && !deps.teamCodes.includes(c))
    if (unknownCodes.length) fieldErrors.push({ key: 'wbs.excel_profile', message: `양식의 팀 열이 프로젝트 팀에 없습니다: ${[...new Set(unknownCodes)].join(', ')}` })
  }
  if (has(next, 'modules.enabled')) {
    const enabled = next['modules.enabled'] as ModuleId[]
    const added = enabled.filter((id) => !(deps.prevEnabled ?? []).includes(id))
    if (deps.allowedBroken && added.length) fieldErrors.push({ key: 'modules.enabled', message: `${ERR_MODULES_ALLOWED_BROKEN}: ${added.join(', ')}` })
    else {
      const r = checkEnabledModules({ next: enabled, prev: deps.prevEnabled, allowed: deps.allowed })
      if (!r.ok) fieldErrors.push({ key: 'modules.enabled', message: r.error })
    }
  }
  return fieldErrors.length ? { ok: false, fieldErrors } : { ok: true }
}

export function validateWorkspaceConfig(next: Partial<Record<WorkspaceSettingKey, unknown>>, deps: { workspaceId: string }): ValidateResult {
  const fieldErrors: FieldError[] = []
  if (has(next, 'branding.logo')) {
    const logo = next['branding.logo'] as BrandingLogo
    for (const slot of ['full', 'full_dark', 'mark'] as const) {
      const path = logo[slot]
      if (path === null) continue
      const p = parseBrandingPath(path)           // parse 가 이미 통과시킨 형태 — 워크스페이스만 본다
      if (p.ok && p.value.workspaceId !== deps.workspaceId) fieldErrors.push({ key: 'branding.logo', message: `${slot}: 다른 워크스페이스의 경로입니다.` })
    }
  }
  return fieldErrors.length ? { ok: false, fieldErrors } : { ok: true }
}

/** 워크스페이스 허용 ∩ 이 배포에서 가용 — 저장 규칙의 allowed 는 늘 이 값이다(개정 §2.7.3 "허용 밖, 또는 env 불가") */
export function allowedAndAvailable(ws: WorkspaceConfig): ModuleId[] {
  const allowed = valueOf(ws, 'modules.allowed')
  return MODULES.filter((m) => allowed.includes(m.id) && m.envAvailable()).map((m) => m.id)
}

/** 저장 경로용 — modules.allowed 가 손상(invalid)이면 빈 목록(fail-closed). core 키는 저장 규칙상 늘 'always' 라
 *  복구 경로(플랫폼 관리자가 modules.allowed 를 다시 쓰기)와 프로젝트의 core 키 저장은 막히지 않는다(Review Focus 6) */
export function allowedOrNone(ws: WorkspaceConfig): ModuleId[] {
  try { return allowedAndAvailable(ws) } catch (e) {
    if (!(e instanceof ConfigKeyError)) throw e
    console.error('[settings] modules.allowed 손상 — 빈 허용 목록으로 본다', { workspaceId: ws.workspaceId, code: e.code })
    return []
  }
}
/** 허용 목록이 손상돼 allowedOrNone 이 빈 목록을 냈는가 — 거부 사유를 "허용하지 않음"과 구분하려고 */
export function modulesAllowedBroken(ws: WorkspaceConfig): boolean {
  const s = ws.keys['modules.allowed']
  return s.status === 'invalid' || s.status === 'required_missing'
}

/** 선행 조회 — SUB-ACT(is_owner_split)·스텁(stub_for) 행은 단계 이름보다 한 단 깊어 0012 ① 과 같은 규칙으로 뺀다 */
export async function loadProjectValidateDeps(
  client: ConfigReadClient, cfg: ProjectConfig, ws: WorkspaceConfig, pre?: { allowed: readonly ModuleId[] },   // pre — 호출부가 이미 구한 allowed(손상 로그를 한 번만)
): Promise<ProjectValidateDeps> {
  const { data, error } = await client.from('wbs_items').select('id, parent_id')
    .eq('project_id', cfg.projectId).eq('is_owner_split', false).is('stub_for', null)
  if (error) throw new ConfigUnavailableError(`WBS 조회 실패: ${error.message}`, { cause: error })
  const enabled = cfg.keys['modules.enabled']
  return {
    treeMaxDepth: treeMaxDepth((data ?? []) as { id: string; parent_id: string | null }[]),
    teamCodes: cfg.teams.filter((t) => t.active).map((t) => t.code),
    allowed: pre?.allowed ?? allowedOrNone(ws),
    prevEnabled: enabled.status === 'set' || enabled.status === 'default' ? enabled.value : [],
    allowedBroken: modulesAllowedBroken(ws),
  }
}
