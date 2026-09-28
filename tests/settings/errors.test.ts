// 설정 오류 모듈 — 코드 표·DB 토큰 표의 전수와 kind 대응(스펙 §3.3, 개정 §2.3.4). 표에 없는 토큰은 null(호출부가 500 으로 드러낸다).
import { describe, expect, it } from 'vitest'
import { ERR_DENIED } from '@/lib/authz/errors'
import {
  CONFIG_MESSAGES, ConfigKeyError, ConfigUnavailableError, ERR_COMMAND_REUSED, ERR_CONFIG_CONFLICT, ERR_CONFIG_UNAVAILABLE,
  configStatus, dbToken, kindOfCode, mapDbError, type ConfigCode,
} from '@/lib/settings/errors'

const CODES: ConfigCode[] = ['CONFIG_CONFLICT', 'CONFIG_INVALID', 'CONFIG_UNKNOWN_KEY', 'CONFIG_REQUIRED', 'CONFIG_IN_USE',
  'CONFIG_MODULE_NOT_ALLOWED', 'CONFIG_SCHEMA_AHEAD', 'CONFIG_UNAVAILABLE', 'CONFIG_BUSY', 'CONFIG_STALE']

describe('코드 표', () => {
  it('열 코드마다 문구와 HTTP 상태가 있다(개정 §2.3.4)', () => {
    expect(Object.keys(CONFIG_MESSAGES).sort()).toEqual([...CODES].sort())
    for (const c of CODES) expect(CONFIG_MESSAGES[c].length, c).toBeGreaterThan(4)
    expect(CODES.map((c) => [c, configStatus(c)])).toEqual([
      ['CONFIG_CONFLICT', 409], ['CONFIG_INVALID', 422], ['CONFIG_UNKNOWN_KEY', 422], ['CONFIG_REQUIRED', 409], ['CONFIG_IN_USE', 409],
      ['CONFIG_MODULE_NOT_ALLOWED', 422], ['CONFIG_SCHEMA_AHEAD', 503], ['CONFIG_UNAVAILABLE', 503], ['CONFIG_BUSY', 503], ['CONFIG_STALE', 409],
    ])
  })

  it('kind 대응(스펙 §3.3 표) — invalid·conflict·denied·unavailable·schema_ahead 와 retryable', () => {
    for (const c of ['CONFIG_INVALID', 'CONFIG_UNKNOWN_KEY', 'CONFIG_IN_USE', 'CONFIG_MODULE_NOT_ALLOWED'] as const) {
      expect(kindOfCode(c), c).toEqual({ kind: 'invalid', retryable: false })
    }
    expect(kindOfCode('CONFIG_CONFLICT')).toEqual({ kind: 'conflict', retryable: false })
    expect(kindOfCode('ERR_DENIED')).toEqual({ kind: 'denied', retryable: false })
    expect(kindOfCode('ERR_MODULE_DISABLED')).toEqual({ kind: 'denied', retryable: false })
    expect(kindOfCode('CONFIG_UNAVAILABLE')).toEqual({ kind: 'unavailable', retryable: true })
    expect(kindOfCode('CONFIG_BUSY')).toEqual({ kind: 'unavailable', retryable: true })
    expect(kindOfCode('CONFIG_SCHEMA_AHEAD')).toEqual({ kind: 'schema_ahead', retryable: false })
    // 읽기 전용 코드 둘도 kind 를 갖는다(액션이 낼 일은 없지만 표는 닫혀 있어야 한다)
    expect(kindOfCode('CONFIG_REQUIRED').kind).toBe('invalid')
    expect(kindOfCode('CONFIG_STALE').kind).toBe('conflict')
  })
})

describe('DB 토큰 표', () => {
  it('첫 토큰은 ":" 앞이다', () => {
    expect(dbToken('CONFIG_INVALID:core.level_labels')).toBe('CONFIG_INVALID')
    expect(dbToken('SETTINGS_REVISION_CONFLICT')).toBe('SETTINGS_REVISION_CONFLICT')
    expect(dbToken(null)).toBe('')
  })

  it.each([
    ['SETTINGS_REVISION_CONFLICT', 'P0001', '7', 'CONFIG_CONFLICT', 409, ERR_CONFIG_CONFLICT],
    ['SETTINGS_SCHEMA_AHEAD', 'P0001', null, 'CONFIG_SCHEMA_AHEAD', 503, null],
    ['SETTINGS_REVISION_OVERFLOW', 'P0001', null, 'CONFIG_SCHEMA_AHEAD', 503, null],
    ['SETTINGS_ROW_MISSING', 'P0001', null, 'CONFIG_UNAVAILABLE', 503, ERR_CONFIG_UNAVAILABLE],
    ['SETTINGS_CODE_IN_USE', '23514', null, 'CONFIG_IN_USE', 409, null],
    ['FORM_MAPPING_IN_USE', '23514', null, 'CONFIG_IN_USE', 409, null],
    ['PROJECT_VOCAB_INACTIVE:attendance.types:x', '23514', null, 'CONFIG_STALE', 409, null],
    ['ISSUE_STATUS_INACTIVE', '23514', null, 'CONFIG_STALE', 409, null],
    ['CUSTOM_FIELD_INACTIVE', '23514', null, 'CONFIG_STALE', 409, null],
    ['CUSTOM_FIELD_UNKNOWN', '23514', null, 'CONFIG_STALE', 409, null],
    ['ISSUE_TRANSITION_DENIED', '23514', null, 'CONFIG_INVALID', 422, null],
    ['ISSUE_STATUS_NOT_INITIAL', '23514', null, 'CONFIG_INVALID', 422, null],
    ['ISSUE_STATUS_DERIVED', '23514', null, 'CONFIG_INVALID', 422, null],
    ['CUSTOM_FIELD_INVALID', '23514', null, 'CONFIG_INVALID', 422, null],
    ['CUSTOM_FIELD_NULL', '23514', null, 'CONFIG_INVALID', 422, null],
    ['CUSTOM_FIELD_REQUIRED', '23514', null, 'CONFIG_INVALID', 422, null],
    ['CUSTOM_FIELD_ADMIN_ONLY', '42501', null, 'ERR_DENIED', 403, ERR_DENIED],
    ['WORKFLOW_ACTUAL_LOCKED', '42501', null, 'ERR_DENIED', 403, ERR_DENIED],
    ['WORKFLOW_APPROVAL_REQUIRED', '42501', null, 'ERR_DENIED', 403, null],
    ['WORKFLOW_COLUMNS_RPC_ONLY', '42501', null, 'ERR_DENIED', 403, ERR_DENIED],
    ['WEEK_KEY_INVALID', '23514', null, 'CONFIG_INVALID', 422, null],
    ['WEEKLY_AREAS_REQUIRED', '23514', null, 'CONFIG_REQUIRED', 409, null],
    ['COMMAND_REUSED', '23505', null, 'CONFIG_INVALID', 422, ERR_COMMAND_REUSED],
    ['COPY_SOURCE_FORBIDDEN', '42501', null, 'ERR_DENIED', 403, ERR_DENIED],
  ] as const)('%s → %s %s', (token, sqlstate, details, code, status, message) => {
    const m = mapDbError({ code: sqlstate, message: token, details })
    expect(m).toMatchObject({ code, status, token: token.split(':')[0], detail: details })
    if (message) expect(m?.message).toBe(message)
  })

  it('CONFIG_INVALID:<key> 는 키를 싣는다. 교착(40P01)은 메시지가 아니라 SQLSTATE 로 CONFIG_BUSY', () => {
    expect(mapDbError({ code: '22023', message: 'CONFIG_INVALID:core.level_labels' }))
      .toMatchObject({ code: 'CONFIG_INVALID', status: 422, fieldKey: 'core.level_labels' })
    expect(mapDbError({ code: '40P01', message: 'deadlock detected' })).toMatchObject({ code: 'CONFIG_BUSY', status: 503 })
  })

  it('표에 없는 토큰은 null — 정상 경로에서 나올 수 없는 것들과 모르는 문구', () => {
    for (const token of ['COPY_TARGET_NOT_EMPTY', 'SETTINGS_ROW_REQUIRED', 'SETTINGS_ACTOR_REQUIRED', 'COMMAND_ID_REQUIRED',
      'SETTINGS_ISOLATION', 'AUTHZ_EVENT_ISOLATION', 'HISTORY_IMMUTABLE', 'permission denied for table project_settings', '']) {
      expect(mapDbError({ code: '23514', message: token }), token).toBeNull()
    }
    expect(mapDbError({ code: null, message: null })).toBeNull()
  })

  it('예외 둘 — 코드와 키를 갖는다', () => {
    const u = new ConfigUnavailableError('조회 실패', { cause: new Error('db down') })
    expect(u.code).toBe('CONFIG_UNAVAILABLE')
    expect(u.message).toBe('조회 실패')
    const k = new ConfigKeyError('CONFIG_REQUIRED', 'wbs.excel_profile')
    expect([k.code, k.key]).toEqual(['CONFIG_REQUIRED', 'wbs.excel_profile'])
    expect(k.message).toContain('wbs.excel_profile')
  })
})
