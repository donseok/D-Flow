/**
 * 설정 계약의 오류 코드·문구·DB 토큰 대응(개정 §2.3.4, 스펙 §3.3) — 순수 모듈. src/lib/authz/errors.ts 와 같은 이유로
 * 가드 모듈 밖에 둔다(가드 모듈은 테스트 79곳이 통째로 vi.mock 한다). 'use server' 파일은 상수를 export 할 수 없어 여기 산다.
 * 표는 개정 §2.3.4 의 전부다 — 뒤 SP 가 낼 토큰도 지금 알아야 그때 500 이 아니라 사용자 문구가 나온다.
 * 표에 없는 토큰은 null 이다: 호출부가 원문을 로깅하고 500 으로 드러낸다(표시 = 로깅). 정상 경로에서 나올 수 없는 토큰
 * (COPY_TARGET_NOT_EMPTY·SETTINGS_ROW_REQUIRED·SETTINGS_ACTOR_REQUIRED·COMMAND_ID_REQUIRED·*_ISOLATION·HISTORY_IMMUTABLE)은 그래서 없다.
 */
import { ERR_DENIED } from '@/lib/authz/errors'

export type ConfigCode =
  | 'CONFIG_CONFLICT' | 'CONFIG_INVALID' | 'CONFIG_UNKNOWN_KEY' | 'CONFIG_REQUIRED' | 'CONFIG_IN_USE'
  | 'CONFIG_MODULE_NOT_ALLOWED' | 'CONFIG_SCHEMA_AHEAD' | 'CONFIG_UNAVAILABLE' | 'CONFIG_BUSY' | 'CONFIG_STALE'

export const ERR_CONFIG_CONFLICT = '다른 사용자가 설정을 먼저 바꿨습니다. 최신 값을 확인한 뒤 다시 저장하세요.'
export const ERR_CONFIG_INVALID = '설정 값이 올바르지 않습니다.'
export const ERR_CONFIG_UNKNOWN_KEY = '등록되지 않은 설정 항목입니다.'
export const ERR_CONFIG_REQUIRED = '이 기능을 쓰려면 먼저 설정이 필요합니다.'
export const ERR_CONFIG_IN_USE = '사용 중인 항목은 삭제하거나 의미를 바꿀 수 없습니다. 비활성으로 두세요.'
export const ERR_CONFIG_MODULE_NOT_ALLOWED = '이 워크스페이스에서 쓸 수 없는 모듈의 설정입니다.'
export const ERR_CONFIG_SCHEMA_AHEAD = '설정 저장본이 이 서버보다 새 버전입니다. 배포가 끝난 뒤 다시 시도하세요.'
export const ERR_CONFIG_UNAVAILABLE = '설정을 불러오지 못해 중단했습니다.'
export const ERR_CONFIG_BUSY = '다른 작업과 겹쳐 처리하지 못했습니다. 잠시 뒤 다시 시도하세요.'
export const ERR_CONFIG_STALE = '설정이 바뀌었습니다. 새로고침한 뒤 다시 입력하세요.'
/** 늘 명시(explicit) 키의 unset — 설정 액션과 내부 쓰기가 같은 문구로 거부한다(CONFIG_INVALID) */
export const ERR_EXPLICIT_UNSET = '필수 설정은 기본값으로 되돌릴 수 없습니다.'
/** 같은 명령 id 로 다른 내용을 보냈다(스펙 D8) — CONFIG_INVALID 422 로 나간다 */
export const ERR_COMMAND_REUSED = '같은 요청 번호로 다른 내용을 보냈습니다. 새로 고친 뒤 다시 시도하세요.'

export const CONFIG_MESSAGES: Readonly<Record<ConfigCode, string>> = {
  CONFIG_CONFLICT: ERR_CONFIG_CONFLICT, CONFIG_INVALID: ERR_CONFIG_INVALID, CONFIG_UNKNOWN_KEY: ERR_CONFIG_UNKNOWN_KEY,
  CONFIG_REQUIRED: ERR_CONFIG_REQUIRED, CONFIG_IN_USE: ERR_CONFIG_IN_USE, CONFIG_MODULE_NOT_ALLOWED: ERR_CONFIG_MODULE_NOT_ALLOWED,
  CONFIG_SCHEMA_AHEAD: ERR_CONFIG_SCHEMA_AHEAD, CONFIG_UNAVAILABLE: ERR_CONFIG_UNAVAILABLE, CONFIG_BUSY: ERR_CONFIG_BUSY,
  CONFIG_STALE: ERR_CONFIG_STALE,
}

const STATUS: Readonly<Record<ConfigCode, number>> = {
  CONFIG_CONFLICT: 409, CONFIG_INVALID: 422, CONFIG_UNKNOWN_KEY: 422, CONFIG_REQUIRED: 409, CONFIG_IN_USE: 409,
  CONFIG_MODULE_NOT_ALLOWED: 422, CONFIG_SCHEMA_AHEAD: 503, CONFIG_UNAVAILABLE: 503, CONFIG_BUSY: 503, CONFIG_STALE: 409,
}
export function configStatus(code: ConfigCode): number {
  return STATUS[code]
}

export type SettingsResultKind = 'applied' | 'duplicate' | 'invalid' | 'conflict' | 'denied' | 'unavailable' | 'schema_ahead'
/** 스펙 §3.3 의 kind 대응표 — 액션이 SettingsCommandResult 를 만들 때 쓴다 */
export function kindOfCode(
  code: ConfigCode | 'ERR_DENIED' | 'ERR_MODULE_DISABLED',
): { kind: Exclude<SettingsResultKind, 'applied' | 'duplicate'>; retryable: boolean } {
  switch (code) {
    case 'CONFIG_CONFLICT': case 'CONFIG_STALE': return { kind: 'conflict', retryable: false }
    case 'ERR_DENIED': case 'ERR_MODULE_DISABLED': return { kind: 'denied', retryable: false }
    case 'CONFIG_UNAVAILABLE': case 'CONFIG_BUSY': return { kind: 'unavailable', retryable: true }
    case 'CONFIG_SCHEMA_AHEAD': return { kind: 'schema_ahead', retryable: false }
    default: return { kind: 'invalid', retryable: false }
  }
}

export interface DbErrorLike { code?: string | null; message?: string | null; details?: string | null }
export interface MappedDbError {
  code: ConfigCode | 'ERR_DENIED'
  status: number
  message: string
  /** 메시지의 첫 토큰(':' 앞) */
  token: string
  /** CONFIG_INVALID:<key> 의 <key> */
  fieldKey: string | null
  /** 원문 details — SETTINGS_REVISION_CONFLICT 는 현재 revision 의 십진 문자열 */
  detail: string | null
}

/** 트리거·RPC 는 사유를 메시지의 첫 토큰으로 싣는다(`TOKEN` 또는 `TOKEN:<세부>`) */
export function dbToken(message: string | null | undefined): string {
  return (message ?? '').split(':')[0].trim()
}

type Row = { code: ConfigCode | 'ERR_DENIED'; message: string }
const ERR_ISSUE_TRANSITION = '이 상태로는 옮길 수 없습니다.'
const ERR_FIELD_VALUE = '필드 값이 올바르지 않습니다.'
/** 개정 §2.3.4 DB 토큰 표 — 뒤 SP 의 토큰도 지금 싣는다(그 SP 가 문구를 다듬는다) */
const TOKENS: Readonly<Record<string, Row>> = {
  SETTINGS_REVISION_CONFLICT: { code: 'CONFIG_CONFLICT', message: ERR_CONFIG_CONFLICT },
  SETTINGS_SCHEMA_AHEAD: { code: 'CONFIG_SCHEMA_AHEAD', message: ERR_CONFIG_SCHEMA_AHEAD },
  SETTINGS_REVISION_OVERFLOW: { code: 'CONFIG_SCHEMA_AHEAD', message: ERR_CONFIG_SCHEMA_AHEAD },
  SETTINGS_ROW_MISSING: { code: 'CONFIG_UNAVAILABLE', message: ERR_CONFIG_UNAVAILABLE },
  SETTINGS_CODE_IN_USE: { code: 'CONFIG_IN_USE', message: ERR_CONFIG_IN_USE },
  FORM_MAPPING_IN_USE: { code: 'CONFIG_IN_USE', message: ERR_CONFIG_IN_USE },
  CONFIG_INVALID: { code: 'CONFIG_INVALID', message: ERR_CONFIG_INVALID },
  PROJECT_VOCAB_INACTIVE: { code: 'CONFIG_STALE', message: ERR_CONFIG_STALE },
  ISSUE_STATUS_INACTIVE: { code: 'CONFIG_STALE', message: ERR_CONFIG_STALE },
  CUSTOM_FIELD_INACTIVE: { code: 'CONFIG_STALE', message: ERR_CONFIG_STALE },
  CUSTOM_FIELD_UNKNOWN: { code: 'CONFIG_STALE', message: ERR_CONFIG_STALE },
  ISSUE_TRANSITION_DENIED: { code: 'CONFIG_INVALID', message: ERR_ISSUE_TRANSITION },
  ISSUE_STATUS_NOT_INITIAL: { code: 'CONFIG_INVALID', message: ERR_ISSUE_TRANSITION },
  ISSUE_STATUS_DERIVED: { code: 'CONFIG_INVALID', message: ERR_ISSUE_TRANSITION },
  CUSTOM_FIELD_INVALID: { code: 'CONFIG_INVALID', message: ERR_FIELD_VALUE },
  CUSTOM_FIELD_NULL: { code: 'CONFIG_INVALID', message: ERR_FIELD_VALUE },
  CUSTOM_FIELD_REQUIRED: { code: 'CONFIG_INVALID', message: ERR_FIELD_VALUE },
  CUSTOM_FIELD_ADMIN_ONLY: { code: 'ERR_DENIED', message: ERR_DENIED },
  WORKFLOW_ACTUAL_LOCKED: { code: 'ERR_DENIED', message: ERR_DENIED },
  WORKFLOW_APPROVAL_REQUIRED: { code: 'ERR_DENIED', message: '승인 단계를 거쳐야 완료할 수 있습니다.' },
  WORKFLOW_COLUMNS_RPC_ONLY: { code: 'ERR_DENIED', message: ERR_DENIED },
  WEEK_KEY_INVALID: { code: 'CONFIG_INVALID', message: '주차 시작일이 프로젝트의 주 시작 규칙과 맞지 않습니다.' },
  WEEKLY_AREAS_REQUIRED: { code: 'CONFIG_REQUIRED', message: '주간보고 영역을 먼저 설정하세요.' },
  COMMAND_REUSED: { code: 'CONFIG_INVALID', message: ERR_COMMAND_REUSED },
  COPY_SOURCE_FORBIDDEN: { code: 'ERR_DENIED', message: ERR_DENIED },
}

/** DB 오류 → 코드·상태·문구. 표에 없으면 null(호출부가 로깅 + 500). 교착(40P01)만 토큰이 아니라 SQLSTATE 로 잡는다 */
export function mapDbError(err: DbErrorLike): MappedDbError | null {
  const detail = err.details ?? null
  if (err.code === '40P01') return { code: 'CONFIG_BUSY', status: 503, message: ERR_CONFIG_BUSY, token: '40P01', fieldKey: null, detail }
  const token = dbToken(err.message)
  const row = TOKENS[token]
  if (!row) return null
  const fieldKey = token === 'CONFIG_INVALID' ? ((err.message ?? '').split(':')[1]?.trim() || null) : null
  const status = row.code === 'ERR_DENIED' ? 403 : STATUS[row.code]
  return { code: row.code, status, message: row.message, token, fieldKey, detail }
}

/** 설정 조회 실패·설정 행 부재 — 기본값으로 채우지 않고 전체를 멈춘다(개정 §2.5 failed) */
export class ConfigUnavailableError extends Error {
  readonly code = 'CONFIG_UNAVAILABLE' as const
  constructor(message: string = ERR_CONFIG_UNAVAILABLE, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ConfigUnavailableError'
  }
}

/** valueOf 가 invalid·required_missing 키에서 던진다 — 그 키를 쓰는 기능만 멈춘다 */
export class ConfigKeyError extends Error {
  readonly code: 'CONFIG_INVALID' | 'CONFIG_REQUIRED'
  readonly key: string
  constructor(code: 'CONFIG_INVALID' | 'CONFIG_REQUIRED', key: string) {
    super(`${CONFIG_MESSAGES[code]} (${key})`)
    this.name = 'ConfigKeyError'
    this.code = code
    this.key = key
  }
}
