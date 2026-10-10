/**
 * 설정 계약의 오류 코드·문구·DB 토큰 대응(개정 §2.3.4, 스펙 §3.3) — 순수 모듈. src/lib/authz/errors.ts 와 같은 이유로
 * 가드 모듈 밖에 둔다(가드 모듈은 테스트 79곳이 통째로 vi.mock 한다). 'use server' 파일은 상수를 export 할 수 없어 여기 산다.
 * 표는 개정 §2.3.4 의 전부다 — 뒤 SP 가 낼 토큰도 지금 알아야 그때 500 이 아니라 사용자 문구가 나온다.
 * 표에 없는 토큰은 null 이다: 호출부가 원문을 로깅하고 500 으로 드러낸다(표시 = 로깅). 정상 경로에서 나올 수 없는 토큰
 * (COPY_TARGET_NOT_EMPTY·SETTINGS_ROW_REQUIRED·SETTINGS_ACTOR_REQUIRED·COMMAND_ID_REQUIRED·*_ISOLATION·HISTORY_IMMUTABLE)은 그래서 없다.
 */
import { ERR_DENIED } from '@/lib/authz/errors'
// 서버 사전은 타입으로만 안다 — 이 모듈은 클라이언트(ConfigStateNotice)도 가져오므로 값으로 끌어오면 서버 문구가 번들에 실린다
import type { ServerDictKey, ServerTranslate } from '@/lib/i18n/serverDict'
import { fill, textBy } from '@/lib/i18n/translate'

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
const ERR_COPY_CHANGED = '복사 원본이 변경되었습니다. 다시 시도하세요.'
const ERR_COPY_INPUT = '원본 양식 연결을 확인하세요.'
const ERR_COPY_MISSING = '양식 파일 복사를 확인하지 못했습니다. 다시 시도하세요.'
const ERR_COPY_REQUIRED = '양식 복사를 지원하는 버전에서 다시 시도하세요.'
const ERR_CATEGORY_MISMATCH = '같은 범주의 상태로만 옮길 수 있습니다.'
const ERR_APPROVAL_REQUIRED = '승인 단계를 거쳐야 완료할 수 있습니다.'
const ERR_WEEK_KEY = '주차 시작일이 프로젝트의 주 시작 규칙과 맞지 않습니다.'
const ERR_AREAS_REQUIRED = '주간보고 영역을 먼저 설정하세요.'
const TOKENS: Readonly<Record<string, Row>> = {
  SETTINGS_REVISION_CONFLICT: { code: 'CONFIG_CONFLICT', message: ERR_CONFIG_CONFLICT },
  SETTINGS_SCHEMA_AHEAD: { code: 'CONFIG_SCHEMA_AHEAD', message: ERR_CONFIG_SCHEMA_AHEAD },
  SETTINGS_REVISION_OVERFLOW: { code: 'CONFIG_SCHEMA_AHEAD', message: ERR_CONFIG_SCHEMA_AHEAD },
  SETTINGS_ROW_MISSING: { code: 'CONFIG_UNAVAILABLE', message: ERR_CONFIG_UNAVAILABLE },
  SETTINGS_CODE_IN_USE: { code: 'CONFIG_IN_USE', message: ERR_CONFIG_IN_USE },
  FORM_TEMPLATE_COPY_CHANGED: { code: 'CONFIG_UNAVAILABLE', message: ERR_COPY_CHANGED },
  FORM_TEMPLATE_COPY_INPUT: { code: 'CONFIG_INVALID', message: ERR_COPY_INPUT },
  FORM_TEMPLATE_COPY_MISSING: { code: 'CONFIG_UNAVAILABLE', message: ERR_COPY_MISSING },
  FORM_TEMPLATE_COPY_REQUIRED: { code: 'CONFIG_UNAVAILABLE', message: ERR_COPY_REQUIRED },
  FORM_MAPPING_IN_USE: { code: 'CONFIG_IN_USE', message: ERR_CONFIG_IN_USE },
  CONFIG_INVALID: { code: 'CONFIG_INVALID', message: ERR_CONFIG_INVALID },
  PROJECT_VOCAB_INACTIVE: { code: 'CONFIG_STALE', message: ERR_CONFIG_STALE },
  ISSUE_STATUS_INACTIVE: { code: 'CONFIG_STALE', message: ERR_CONFIG_STALE },
  ISSUE_STATUS_UNKNOWN: { code: 'CONFIG_STALE', message: ERR_CONFIG_STALE },               // SP5b — 개정 :541 "미존재 code"
  ISSUE_RESOLVED_AT_DERIVED: { code: 'CONFIG_INVALID', message: ERR_ISSUE_TRANSITION },    // SP5b D4 — 해결일은 트리거만 정한다
  SETTINGS_CODE_CATEGORY_MISMATCH: { code: 'CONFIG_INVALID', message: ERR_CATEGORY_MISMATCH },   // SP5b D3
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
  WORKFLOW_APPROVAL_REQUIRED: { code: 'ERR_DENIED', message: ERR_APPROVAL_REQUIRED },
  WORKFLOW_COLUMNS_RPC_ONLY: { code: 'ERR_DENIED', message: ERR_DENIED },
  WEEK_KEY_INVALID: { code: 'CONFIG_INVALID', message: ERR_WEEK_KEY },
  WEEKLY_AREAS_REQUIRED: { code: 'CONFIG_REQUIRED', message: ERR_AREAS_REQUIRED },
  COMMAND_REUSED: { code: 'CONFIG_INVALID', message: ERR_COMMAND_REUSED },
  COPY_SOURCE_FORBIDDEN: { code: 'ERR_DENIED', message: ERR_DENIED },
}

/** DB 오류 → 코드·상태·문구. 표에 없으면 null(호출부가 로깅 + 500). 교착(40P01)만 토큰이 아니라 SQLSTATE 로 잡는다 */
/** 고정 문구 → 사전 키 — 문구가 코드 겸용(화면·테스트가 문구로 비교)이라 상수는 한국어로 두고, 화면에 내보내는 자리에서 `configText(t, 문구)` 로 푼다. */
export const CONFIG_TEXT_KEY: Readonly<Record<string, ServerDictKey>> = {
  [ERR_CONFIG_CONFLICT]: 'err.config.conflict',
  [ERR_CONFIG_INVALID]: 'err.config.invalid',
  [ERR_CONFIG_UNKNOWN_KEY]: 'err.config.unknownKey',
  [ERR_CONFIG_REQUIRED]: 'err.config.required',
  [ERR_CONFIG_IN_USE]: 'err.config.inUse',
  [ERR_CONFIG_MODULE_NOT_ALLOWED]: 'err.config.moduleNotAllowed',
  [ERR_CONFIG_SCHEMA_AHEAD]: 'err.config.schemaAhead',
  [ERR_CONFIG_UNAVAILABLE]: 'err.config.unavailable',
  [ERR_CONFIG_BUSY]: 'err.config.busy',
  [ERR_CONFIG_STALE]: 'err.config.stale',
  [ERR_EXPLICIT_UNSET]: 'err.config.explicitUnset',
  [ERR_COMMAND_REUSED]: 'err.config.commandReused',
  [ERR_ISSUE_TRANSITION]: 'err.config.issueTransition',
  [ERR_FIELD_VALUE]: 'err.config.fieldValue',
  [ERR_COPY_CHANGED]: 'err.config.copyChanged',
  [ERR_COPY_INPUT]: 'err.config.copyInput',
  [ERR_COPY_MISSING]: 'err.config.copyMissing',
  [ERR_COPY_REQUIRED]: 'err.config.copyRequired',
  [ERR_CATEGORY_MISMATCH]: 'err.config.categoryMismatch',
  [ERR_APPROVAL_REQUIRED]: 'err.config.approvalRequired',
  [ERR_WEEK_KEY]: 'err.config.weekKey',
  [ERR_AREAS_REQUIRED]: 'err.config.areasRequired',
}
/** 설정 계열 고정 문구를 요청의 화면 언어로 — 표에 없는 문구(키 이름이 붙은 문구 등)는 받은 그대로 */
export const configText = (t: ServerTranslate, message: string): string => textBy(t, CONFIG_TEXT_KEY, message)

/** t(서버 번역 함수)를 넘기면 message 가 그 언어다(화면에 내보내는 액션·라우트). 넘기지 않으면 종전 한국어 — code·status·token 은 언어와 무관하다 */
export function mapDbError(err: DbErrorLike, t?: ServerTranslate): MappedDbError | null {
  const say = (message: string): string => t ? configText(t, message) : message
  const detail = err.details ?? null
  if (err.code === '40P01') return { code: 'CONFIG_BUSY', status: 503, message: say(ERR_CONFIG_BUSY), token: '40P01', fieldKey: null, detail }
  const token = dbToken(err.message)
  const row = Object.hasOwn(TOKENS, token) ? TOKENS[token] : undefined   // 프로토타입 이름('constructor' 등)은 표의 값이 아니다(SP4 A2 P11)
  if (!row) return null
  const fieldKey = token === 'CONFIG_INVALID' ? ((err.message ?? '').split(':')[1]?.trim() || null) : null
  const status = row.code === 'ERR_DENIED' ? 403 : STATUS[row.code]
  return { code: row.code, status, message: say(row.message), token, fieldKey, detail }
}

/** 설정 조회 실패·설정 행 부재 — 기본값으로 채우지 않고 전체를 멈춘다(개정 §2.5 failed) */
export class ConfigUnavailableError extends Error {
  readonly code = 'CONFIG_UNAVAILABLE' as const
  constructor(message: string = ERR_CONFIG_UNAVAILABLE, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ConfigUnavailableError'
  }
}

/**
 * 보관된 워크스페이스(0056)의 설정을 읽으려 했다 — 설정을 읽지 못한 것과 같이 닫는다(ConfigUnavailableError 의 하위라 기존 fail-closed 갈래를 그대로 탄다:
 * 모듈 관문은 거부, 워커의 3값 판정은 'unknown'). 따로 가르는 호출부는 instanceof 로 본다(색인·위키 워커가 잡을 실패로 세지 않고 미뤄 둘 때).
 */
export class WorkspaceArchivedError extends ConfigUnavailableError {
  readonly workspaceId: string
  constructor(workspaceId: string) {
    super(`보관된 워크스페이스입니다: ${workspaceId}`)
    this.name = 'WorkspaceArchivedError'
    this.workspaceId = workspaceId
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

/**
 * SETTINGS_CODE_IN_USE 의 detail(JSON) → 키별 문구(SP5 D53 — [RF3]). calendar.week_start 는 막는 주차(최대 20)를 싣는다.
 * 모르는 모양이면 빈 목록 — 호출부가 일반 CONFIG_IN_USE 문구를 쓴다. 순수(throw 없음)
 */
/** 사용 중 거부 문구의 한국어 틀 — t 를 넘기지 않을 때의 폴백이다. 같은 키가 서버 사전에 같은 글자로 있다(불변식이 대조한다) */
export const IN_USE_KO = {
  'err.config.inUse.weeks': '이미 만든 주간보고({weeks})가 새 주 시작 규칙과 맞지 않아 저장할 수 없습니다.',
  'err.config.inUse.removed': '\'{code}\' 을(를) 쓰는 기록이 {n}건 있어 지울 수 없습니다. 다른 항목으로 옮긴 뒤 지우세요.',
  'err.config.inUse.category': '\'{code}\' 상태의 이슈가 {n}건 있어 범주를 바꿀 수 없습니다. 새 상태를 만들어 이슈를 옮긴 뒤 바꾸세요.',
  'err.config.inUse.countsAs': '\'{code}\' 을(를) 쓰는 기록이 {n}건 있어 집계 분류를 바꿀 수 없습니다. 새 항목을 만들어 옮긴 뒤 바꾸세요.',
  'err.config.inUse.pendingRound': '\'{code}\' 단계로 검수 중인 항목이 {n}건 있어 지울 수 없습니다. 그 검수가 끝난 뒤 지우세요.',
  'err.config.inUse.approverWiden': '\'{code}\' 단계 승인을 기다리는 항목이 {n}건 있어 승인자를 넓힐 수 없습니다. 그 승인이 끝난 뒤 바꾸세요.',
} as const
type InUseTranslate = (key: keyof typeof IN_USE_KO) => string
const inUseKo: InUseTranslate = (key) => IN_USE_KO[key]

export function inUseFieldErrors(detail: string | null, t: InUseTranslate = inUseKo): { key: string; message: string; refCount?: number; code?: string }[] {
  if (!detail) return []
  let d: unknown
  try { d = JSON.parse(detail) } catch { return [] }
  if (typeof d !== 'object' || d === null || Array.isArray(d)) return []
  const o = d as Record<string, unknown>
  if (o.key === 'calendar.week_start' && Array.isArray(o.weeks) && o.weeks.length > 0 && o.weeks.every((w) => typeof w === 'string')) {
    return [{ key: 'calendar.week_start', message: t('err.config.inUse.weeks').replace('{weeks}', () => (o.weeks as string[]).join(', ')) }]
  }
  // 어휘(SP5 B4 — 0023): 지운 code·집계 분류를 바꾼 근태 유형의 참조 건수. 화면이 '다른 항목으로 옮긴 뒤 삭제'를 연다
  // SP5b I — 이슈 표시 상태의 범주 변경(reason 'category')도 같은 꼴: 이슈가 있는 상태의 범주는 바꿀 수 없다(과거 집계 의미 보존)
  if (typeof o.key === 'string' && typeof o.code === 'string' && Number.isSafeInteger(o.count)
      && (o.reason === 'removed' || o.reason === 'counts_as' || o.reason === 'category')) {
    const n = Number(o.count)
    const message = o.reason === 'removed'
      ? fill(t('err.config.inUse.removed'), { code: o.code, n })
      : o.reason === 'category'
        ? fill(t('err.config.inUse.category'), { code: o.code, n })
        : fill(t('err.config.inUse.countsAs'), { code: o.code, n })
    return [{ key: o.key, message, refCount: n, code: o.code }]
  }
  // SP5b W1 — 승인 단계(settings_ref_check): 대기 라운드의 스냅샷 단계 삭제, 대기 단계의 승인자 넓히기(admin → subtree_or_admin)
  if (typeof o.key === 'string' && typeof o.code === 'string' && Number.isSafeInteger(o.count)
      && (o.reason === 'pending_round' || o.reason === 'approver_widen')) {
    const n = Number(o.count)
    const message = o.reason === 'pending_round'
      ? fill(t('err.config.inUse.pendingRound'), { code: o.code, n })
      : fill(t('err.config.inUse.approverWiden'), { code: o.code, n })
    return [{ key: o.key, message, refCount: n, code: o.code }]
  }
  return typeof o.key === 'string' ? [{ key: o.key, message: ERR_CONFIG_IN_USE }] : []   // 고정 문구 — 화면에 내보내는 호출부가 configText 로 푼다
}
