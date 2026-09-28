/**
 * 설정 정의의 형(개정 §2.6.1) — 잎 파일. registry.ts 와 defs/*.ts 가 둘 다 여기서 가져온다.
 * registry.ts → defs → registry.ts 순환에서 defs 가 평가되는 순간 defineSetting·REQUIRED_ON_CREATE 가 초기화되지 않았을 수 있어 분리했다.
 * registry.ts 가 이 파일을 다시 내보내므로 소비처는 '@/lib/settings/registry' 에서 import 해도 된다.
 */
import type { DictKey } from '@/lib/i18n/dict'
import type { ModuleId } from '@/lib/modules/defaults'

export type SettingScope = 'workspace' | 'project'
export type SettingEditor = 'platform_admin' | 'workspace_admin' | 'project_admin'
/** restart·rebuild 는 운영 설정(env)만의 값. 재색인은 apply 가 아니라 부수효과(reindexOn) */
export type ApplyTiming = 'immediate' | 'next_job'
export type DataImpact = 'none' | 'recompute' | 'future_only' | 'guarded'
export const REQUIRED_ON_CREATE: unique symbol = Symbol('required')
export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }

/** 설정 페이지의 자동 폼이 아는 6종(정본@31878b1:1113-1119). 그 밖은 전용 편집기 — custom 으로 선언만 한다(D13) */
export type SettingWidget =
  | { kind: 'text'; maxLength: number }
  | { kind: 'text_list'; maxItems: number }
  | { kind: 'boolean' }
  | { kind: 'select'; options: readonly { value: string; labelKey: DictKey }[] }
  | { kind: 'vocab'; fixedCodes?: readonly string[] }
  | { kind: 'custom'; component: string }

/** 입력≠저장 편집의 문맥(D14 — 스코프 유니온). 프로젝트 쪽은 개정 §2.6.1 그대로 */
export type EditCtx =
  | { scope: 'project'; projectId: string; today: string; loadWeekKeys?: () => Promise<string[]> }
  | { scope: 'workspace'; workspaceId: string }

// 함수 필드는 메서드 시그니처로 쓴다 — 화살표 속성이면 strictFunctionTypes 가 반공변으로 검사해
// 구체 정의(SettingDef<string[]> 등)를 SettingDef(unknown) 목록에 넣지 못한다.
export interface SettingDef<T = unknown, I = T, K extends string = string> {
  key: K                                  // '<ns>.<name>' 2단 평면 키
  scope: SettingScope
  module: ModuleId                        // 소유 모듈(개정 §2.7.3 저장 규칙의 기준)
  default: T | typeof REQUIRED_ON_CREATE
  /** 늘 명시 — 저장값이 늘 있어야 하는 키. unset(기본값으로 되돌리기)을 설정 액션·내부 쓰기가 거부한다.
   *  REQUIRED_ON_CREATE 키는 모두 explicit 이다(로드 단언). 목록은 0012 생성 RPC 의 필수 키와 같다(tests/settings/registry) */
  explicit?: true
  parse(raw: unknown): Parsed<T>          // 저장 형태 T 의 검증. 순수·throw 금지. 정규화(소문자·공백)는 여기서 한다
  widget: SettingWidget
  editor: SettingEditor
  apply: ApplyTiming
  impact: readonly [DataImpact, ...DataImpact[]]
  sql: null | { readers: readonly string[] }   // values 에서 이 키를 읽는 SQL 함수·트리거 — 패리티 테스트 대상
  deployDefault?: { env: string; parse(raw: string | undefined): T | undefined }   // 개정 S2 의 3키만
  seedFrom?: { key: string; map?(wsValue: unknown): T }
  edit?: {
    parseInput(raw: unknown): Parsed<I>
    toStored(prev: T | undefined, input: I, ctx: EditCtx): Promise<Parsed<T>> | Parsed<T>
  }
  reindexOn?: readonly string[]
}

/** 정의 하나 — K 를 리터럴로 고정해 키 유니온을 목록에서 유도한다 */
export function defineSetting<const K extends string, T, I = T>(def: SettingDef<T, I, K>): SettingDef<T, I, K> {
  return def
}
