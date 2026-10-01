// DB 오류의 응답 통로(SP4 스펙 D21·D45, 계획 P4) — 원문은 로그로만, 응답에는 고정 문구만. 판정 순서 = 호출부 자기 표 → 55P03(잠금
// 대기 상한) 503 재시도 → 기존 mapDbError(40P01·WEEKLY_AREAS_REQUIRED·COMMAND_REUSED …) → null(호출부가 failWith 로 로그 + 고정 문구).
// 정상 경로 밖 토큰(입력 토큰·COMMAND_ID_REQUIRED·*_ISOLATION)은 어느 표에도 없다 — null 이 맞다(D45·마무리 판정 T6, mapDbError 무수정).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { failWith, rpcFailure, type OwnTokenTable } from '@/lib/errors/dbFail'
import { ERR_COMMAND_REUSED, ERR_CONFIG_BUSY, ERR_CONFIG_SCHEMA_AHEAD, ERR_CONFIG_UNAVAILABLE } from '@/lib/settings/errors'

afterEach(() => { vi.restoreAllMocks() })

// 가져오기 라우트 꼴의 자기 표 — 정상 경로 토큰만(D45). 입력 토큰은 일부러 없다
const OWN: OwnTokenTable = {
  PROJECT_NOT_FOUND: { status: 404, code: 'NOT_FOUND', message: '프로젝트를 찾을 수 없습니다.' },
  IMPORT_FORBIDDEN: { status: 403, code: 'ERR_DENIED', message: '권한 없음' },
  COMMAND_REUSED: { status: 422, code: 'COMMAND_REUSED', message: '같은 요청 번호로 다른 내용을 보냈습니다.' },
}

describe('failWith — 원문은 로그로만, 돌려주는 것은 고정 문구', () => {
  it('원문 객체를 그대로 로그 둘째 인자로 남기고 고정 문구만 돌려준다', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const err = {
      code: '23505', message: 'duplicate key value violates unique constraint "weekly_reports_project_id_week_start_key"',
      details: 'Key (project_id, week_start) already exists.',
    }
    const out = failWith('weekly/create', err, '주차 시트를 만들지 못했습니다. 잠시 후 다시 시도하세요.')
    expect(out).toBe('주차 시트를 만들지 못했습니다. 잠시 후 다시 시도하세요.')
    expect(out).not.toContain('duplicate key')
    expect(log).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledWith('[weekly/create] 주차 시트를 만들지 못했습니다. 잠시 후 다시 시도하세요.', err)
  })

  it('Error·문자열·undefined 도 같다 — 원문이 무엇이든 응답에 가는 것은 고정 문구', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const boom = new Error('wbs_items 백업 목록을 끝까지 읽지 못했습니다(999/1001건)')
    for (const raw of [boom, 'socket hang up', undefined]) expect(failWith('import/execute', raw, '고정 문구')).toBe('고정 문구')
    expect(log.mock.calls.map((c) => c[1])).toEqual([boom, 'socket hang up', undefined])
  })
})

describe('rpcFailure — 판정 순서(P4)', () => {
  it('① 자기 표 — 메시지의 첫 낱말(`TOKEN` 또는 `TOKEN:<세부>`)로 찾는다', () => {
    expect(rpcFailure({ code: 'P0002', message: 'PROJECT_NOT_FOUND' }, OWN))
      .toEqual({ status: 404, code: 'NOT_FOUND', message: '프로젝트를 찾을 수 없습니다.', retryable: false, token: 'PROJECT_NOT_FOUND' })
    expect(rpcFailure({ code: '42501', message: 'IMPORT_FORBIDDEN: 00000000-0000-0000-7e57-000000001899' }, OWN))
      .toEqual({ status: 403, code: 'ERR_DENIED', message: '권한 없음', retryable: false, token: 'IMPORT_FORBIDDEN' })
  })

  it('① 이 ③ 보다 먼저 — 기존 표에도 있는 토큰(COMMAND_REUSED)은 호출부의 상태·문구, 자기 표가 비면 기존 표', () => {
    expect(rpcFailure({ code: '23505', message: 'COMMAND_REUSED' }, OWN))
      .toEqual({ status: 422, code: 'COMMAND_REUSED', message: '같은 요청 번호로 다른 내용을 보냈습니다.', retryable: false, token: 'COMMAND_REUSED' })
    expect(rpcFailure({ code: '23505', message: 'COMMAND_REUSED' }, {}))
      .toEqual({ status: 422, code: 'CONFIG_INVALID', message: ERR_COMMAND_REUSED, retryable: false, token: 'COMMAND_REUSED' })
  })

  it('① 자기 표의 503 은 재시도 가능, 그 밖 상태는 아니다', () => {
    const own: OwnTokenTable = { PEER_BUSY: { status: 503, code: 'CONFIG_BUSY', message: '잠시 뒤 다시 시도하세요.' } }
    expect(rpcFailure({ code: 'P0001', message: 'PEER_BUSY' }, own)?.retryable).toBe(true)
    expect(rpcFailure({ code: 'P0002', message: 'PROJECT_NOT_FOUND' }, OWN)?.retryable).toBe(false)
  })

  it('② 55P03(RPC 의 lock_timeout 15s 초과) → 503 재시도 가능 — 메시지는 토큰이 아니라 SQLSTATE 로 본다', () => {
    expect(rpcFailure({ code: '55P03', message: 'canceling statement due to lock timeout' }, OWN))
      .toEqual({ status: 503, code: 'CONFIG_BUSY', message: ERR_CONFIG_BUSY, retryable: true, token: '55P03' })
  })

  it('③ 기존 mapDbError — 40P01 503 재시도, WEEKLY_AREAS_REQUIRED 409, 재시도 여부는 SP3a kindOfCode 규칙', () => {
    expect(rpcFailure({ code: '40P01', message: 'deadlock detected' }, OWN))
      .toEqual({ status: 503, code: 'CONFIG_BUSY', message: ERR_CONFIG_BUSY, retryable: true, token: '40P01' })
    expect(rpcFailure({ code: '23514', message: 'WEEKLY_AREAS_REQUIRED' }, {}))
      .toEqual({ status: 409, code: 'CONFIG_REQUIRED', message: '주간보고 영역을 먼저 설정하세요.', retryable: false, token: 'WEEKLY_AREAS_REQUIRED' })
    expect(rpcFailure({ code: 'P0001', message: 'SETTINGS_ROW_MISSING' }, {}))
      .toEqual({ status: 503, code: 'CONFIG_UNAVAILABLE', message: ERR_CONFIG_UNAVAILABLE, retryable: true, token: 'SETTINGS_ROW_MISSING' })
    expect(rpcFailure({ code: 'P0001', message: 'SETTINGS_SCHEMA_AHEAD' }, {}))
      .toEqual({ status: 503, code: 'CONFIG_SCHEMA_AHEAD', message: ERR_CONFIG_SCHEMA_AHEAD, retryable: false, token: 'SETTINGS_SCHEMA_AHEAD' })
  })

  it('입력 토큰(22023)은 자기 표에 없으면 null → 호출부가 로그 + 500(D45·T6 — 호출부가 RPC 앞에서 같은 것을 먼저 거른다)', () => {
    expect(rpcFailure({ code: '22023', message: 'IMPORT_INVALID_INPUT' }, OWN)).toBeNull()
    expect(rpcFailure({ code: '22023', message: 'WEEKLY_SEED_INVALID' }, OWN)).toBeNull()
  })

  it.each([
    ['WEEKLY_ISOLATION', '25001'], ['IMPORT_RECEIPT_ISOLATION', '25001'], ['TEAM_CONVERT_ISOLATION', '25001'],
    ['COMMAND_ID_REQUIRED', '22023'], ['WEEKLY_INVALID_INPUT', '22023'], ['AREA_INVALID_INPUT', '22023'],
    ['TEAM_CONVERT_INVALID_INPUT', '22023'],
  ])('정상 경로 밖 토큰 %s(%s) → null — 기존 표(mapDbError)에도 없다(SP3a 규칙 그대로)', (message, code) => {
    expect(rpcFailure({ code, message }, OWN)).toBeNull()
    expect(rpcFailure({ code, message }, {})).toBeNull()
  })

  it('토큰 없는 원문(제약 위반·없는 관계)·빈 메시지 → null', () => {
    expect(rpcFailure({ code: '23505', message: 'duplicate key value violates unique constraint "project_areas_project_id_kind_code_key"' }, OWN)).toBeNull()
    expect(rpcFailure({ code: '42P01', message: 'relation "public.secret_table" does not exist' }, OWN)).toBeNull()
    expect(rpcFailure({ code: 'XX000', message: null }, OWN)).toBeNull()
  })

  it('프로토타입 이름 토큰(constructor·__proto__·toString)은 어느 표의 값도 아니다 — null', () => {
    for (const message of ['constructor', '__proto__', 'toString: x', 'hasOwnProperty']) {
      expect(rpcFailure({ code: 'P0001', message }, OWN), message).toBeNull()
      expect(rpcFailure({ code: 'P0001', message }, {}), message).toBeNull()
    }
  })
})
