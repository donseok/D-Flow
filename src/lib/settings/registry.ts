/**
 * 설정 레지스트리(개정 §2.6.1·§2.6.2, 스펙 §3.6) — 설정 항목의 스키마는 여기(코드)에만 있고 DB 는 값만 담는다(결정 5).
 * 정의는 defs/workspace.ts·defs/project.ts 에, 형과 defineSetting 은 잎 파일 def.ts 에 있고 이 파일이 목록·찾기·로드 단언·타입을 낸다.
 * 설정 → 모듈은 타입 import 만(ModuleId 는 잎 파일 src/lib/modules/defaults.ts). 모듈 레지스트리가 이 목록을 값으로 import 한다.
 * 변경 규칙은 개정 §2.6.2 R1~R6 — 형태를 제자리에서 바꾸지 않고(R5) 새 키로 옮긴다. 은퇴한 키는 RETIRED_KEYS 에 이유와 함께.
 */
export * from './def'
import { REQUIRED_ON_CREATE, type Parsed, type SettingDef, type SettingScope } from './def'
import type { ModuleId } from '@/lib/modules/defaults'
import type { NavItemId } from '@/lib/nav/ids'
import { WORKSPACE_DEFS } from './defs/workspace'
import { PROJECT_DEFS } from './defs/project'
import { ConfigKeyError } from './errors'
import type { ProjectConfig } from './projectConfig'
import type { WorkspaceConfig } from './workspaceConfig'

export type { ModulesList, BrandingLogo, NavMenuSetting } from './defs/workspace'

export const SETTINGS_SCHEMA_VERSION = 1

export const WORKSPACE_SETTINGS = WORKSPACE_DEFS
export const PROJECT_SETTINGS = PROJECT_DEFS
export type WorkspaceDef = (typeof WORKSPACE_DEFS)[number]
export type ProjectDef = (typeof PROJECT_DEFS)[number]
export type WorkspaceSettingKey = WorkspaceDef['key']
export type ProjectSettingKey = ProjectDef['key']
export type SettingKey = WorkspaceSettingKey | ProjectSettingKey
type ValueOfDef<D> = D extends { parse(raw: unknown): Parsed<infer T> } ? T : never
export type SettingValue<K extends SettingKey> = ValueOfDef<Extract<WorkspaceDef | ProjectDef, { key: K }>>
/** 스코프별 값 형 — 같은 이름 키가 두 스코프에 있으면(calendar.*) SettingValue 는 합집합이 된다. 해석기·valueOf 는 이것을 쓴다 */
export type ProjectSettingValue<K extends ProjectSettingKey> = ValueOfDef<Extract<ProjectDef, { key: K }>>
export type WorkspaceSettingValue<K extends WorkspaceSettingKey> = ValueOfDef<Extract<WorkspaceDef, { key: K }>>

export function settingDef(scope: 'workspace', key: string): WorkspaceDef | undefined
export function settingDef(scope: 'project', key: string): ProjectDef | undefined
export function settingDef(scope: SettingScope, key: string): WorkspaceDef | ProjectDef | undefined {
  const list: readonly (WorkspaceDef | ProjectDef)[] = scope === 'workspace' ? WORKSPACE_DEFS : PROJECT_DEFS
  return list.find((d) => d.key === key)
}

/** 은퇴 키(개정 §2.6.2 R4) — 저장값은 남지만 읽지 않고, 쓰면 CONFIG_UNKNOWN_KEY. 개명된 네 키는 저장된 적이 없어 비어 있다 */
export const RETIRED_KEYS: readonly { scope: SettingScope; key: string; reason: string }[] = []
/** 배포 기본값(env)을 갖는 키 — 개정 S2 의 셋뿐. 넓히지 않는다 */
export const DEPLOY_DEFAULT_KEYS = ['invites.allowed_domains', 'branding.product_name', 'branding.mail_from_name'] as const
export const KEY_PATTERN = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/

/**
 * 로드 단언(스펙 §3.6) — 키 이름 형식, 스코프 안 유일, deployDefault 는 세 키만, impact 비지 않음, 기본값이 자기 parse 를 통과,
 * 생성 필수 키는 explicit(unset 거부), seedFrom.key 가 워크스페이스 목록에 있음, 은퇴 키와 겹치지 않음. 모듈 소속은 moduleIds 를 받았을 때만 본다(정의의 module 은
 * ModuleId 타입이라 컴파일이 이미 막는다 — 모듈 레지스트리 로드와 테스트가 목록을 넘겨 다시 본다). defs 는 테스트 주입용이다.
 */
export function assertRegistry(opts: { moduleIds?: readonly string[]; defs?: readonly SettingDef[] } = {}): void {
  const defs: readonly SettingDef[] = opts.defs ?? [...WORKSPACE_DEFS, ...PROJECT_DEFS]
  const wsKeys = new Set(WORKSPACE_DEFS.map((d) => d.key as string))
  const seen = new Set<string>()
  for (const d of defs) {
    const at = `${d.scope}/${d.key}`
    if (!KEY_PATTERN.test(d.key)) throw new Error(`설정 레지스트리: 키 이름 형식 위반 ${at}`)
    if (seen.has(at)) throw new Error(`설정 레지스트리: 스코프 안에서 키가 겹친다 ${at}`)
    seen.add(at)
    if (opts.moduleIds && !opts.moduleIds.includes(d.module)) throw new Error(`설정 레지스트리: 모르는 모듈 ${d.module} (${at})`)
    if (d.impact.length === 0) throw new Error(`설정 레지스트리: impact 가 비었다 ${at}`)
    if (d.deployDefault && !(DEPLOY_DEFAULT_KEYS as readonly string[]).includes(d.key)) {
      throw new Error(`설정 레지스트리: deployDefault 는 세 키만 가진다 ${at}`)
    }
    if (d.default !== REQUIRED_ON_CREATE) {
      const p = d.parse(d.default)
      if (!p.ok) throw new Error(`설정 레지스트리: 기본값이 parse 를 통과하지 못한다 ${at} — ${p.error}`)
    } else if (!d.explicit) throw new Error(`설정 레지스트리: 생성 필수 키는 explicit 이어야 한다(unset 하면 required_missing) ${at}`)
    if (d.seedFrom && !wsKeys.has(d.seedFrom.key)) throw new Error(`설정 레지스트리: seedFrom 키가 워크스페이스 목록에 없다 ${at}`)
    if (RETIRED_KEYS.some((r) => r.scope === d.scope && r.key === d.key)) throw new Error(`설정 레지스트리: 은퇴 키를 다시 등록했다 ${at}`)
  }
}

// 모듈 로드 때 한 번 — 정의가 깨진 채로 앱이 뜨지 않게 한다(모듈 소속은 모듈 레지스트리 로드가 본다)
assertRegistry()

export type { ModuleId, NavItemId }

/** 값이 필요한 소비처의 유일한 접근자. invalid → CONFIG_INVALID, required_missing → CONFIG_REQUIRED (그 키를 쓰는 기능만 멈춘다) */
export function valueOf<K extends ProjectSettingKey>(cfg: ProjectConfig, key: K): ProjectSettingValue<K>
export function valueOf<K extends WorkspaceSettingKey>(cfg: WorkspaceConfig, key: K): WorkspaceSettingValue<K>
export function valueOf(cfg: ProjectConfig | WorkspaceConfig, key: string): unknown {
  const state = (cfg.keys as Record<string, { status: string; value?: unknown; error?: string }>)[key]
  if (!state) throw new ConfigKeyError('CONFIG_INVALID', key)          // 등록되지 않은 키 — 타입이 막지만 런타임 방어
  if (state.status === 'set' || state.status === 'default') return state.value
  if (state.status === 'invalid') throw new ConfigKeyError('CONFIG_INVALID', key)
  throw new ConfigKeyError('CONFIG_REQUIRED', key)
}
