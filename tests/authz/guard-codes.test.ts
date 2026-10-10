// 가드·관문 실패의 구분 코드 — 비교는 문구가 아니라 코드로 한다(문구를 고쳐도 판정이 흔들리지 않는다).
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ guard: vi.fn() }))
vi.mock('@/lib/authz', () => ({ requireWorkspaceAdmin: h.guard }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }))
vi.mock('@/lib/supabase/adminFor', () => ({ adminFor: vi.fn() }))

import { listAuthzEvents } from '@/app/actions/authzEvents'
import {
  ERR_ANON, ERR_DENIED, ERR_LOOKUP, ERR_MISSING, ERR_MODULE_DISABLED, GUARD_TEXT, denyStatus, guardCodeOf, guardFail,
  type GuardCode,
} from '@/lib/authz/errors'
import { rpcFailure, tokenTable } from '@/lib/errors/dbFail'
import { serverKoTranslate } from '@/lib/i18n/serverDict'
import { denied } from '@/lib/i18n/serverText'
import { mapDbError } from '@/lib/settings/errors'
import { wbsErrorKey } from '@/lib/wbs/actionErrors'

const t = serverKoTranslate
const CODES: GuardCode[] = ['lookup', 'denied', 'anon', 'missing', 'module_disabled']
const WS = '0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d'

beforeEach(() => { vi.clearAllMocks() })

describe('가드 코드 — 문구 표', () => {
  it('문구는 종전 상수 그대로다(한 글자도 바뀌지 않는다)', () => {
    expect(GUARD_TEXT.lookup).toBe('권한을 확인할 수 없어 중단했습니다.')
    expect(GUARD_TEXT.denied).toBe('권한 없음')
    expect(GUARD_TEXT.anon).toBe('로그인 필요')
    expect(GUARD_TEXT.missing).toBe('대상을 찾을 수 없습니다.')
    expect(GUARD_TEXT.module_disabled).toBe('이 기능은 지금 사용할 수 없습니다.')
    expect([ERR_LOOKUP, ERR_DENIED, ERR_ANON, ERR_MISSING, ERR_MODULE_DISABLED]).toEqual(CODES.map(c => GUARD_TEXT[c]))
  })
})

describe('guardCodeOf — 결과 객체의 code, 없으면 문구', () => {
  it('guardFail 은 문구와 코드를 함께 싣는다', () => {
    expect(guardFail('denied')).toEqual({ ok: false, error: ERR_DENIED, code: 'denied' })
    for (const code of CODES) expect(guardCodeOf(guardFail(code))).toBe(code)
  })

  it('code 가 없는 결과(가드를 통째로 대역한 테스트·옛 호출부)는 문구로 읽는다', () => {
    expect(guardCodeOf({ error: ERR_MISSING })).toBe('missing')
    expect(guardCodeOf(ERR_MODULE_DISABLED)).toBe('module_disabled')
  })

  it('code 가 문구보다 먼저다 — 문구가 바뀌어도 판정은 그대로다', () => {
    expect(guardCodeOf({ error: '접근이 거부되었습니다(다른 문구)', code: 'denied' })).toBe('denied')
  })

  it('다섯 가지가 아니면 null — 모르는 code 는 믿지 않고 문구로 다시 읽는다', () => {
    expect(guardCodeOf('저장하지 못했습니다.')).toBeNull()
    expect(guardCodeOf({ error: 'x', code: 'ERR_DENIED' })).toBeNull()          // 액션 결과의 다른 code 체계
    expect(guardCodeOf({ error: ERR_DENIED, code: 'constructor' })).toBe('denied')
    expect(guardCodeOf(null)).toBeNull()
    expect(guardCodeOf(undefined)).toBeNull()
    expect(guardCodeOf({})).toBeNull()
  })
})

describe('denyStatus — 코드로 판정한다', () => {
  it.each([
    ['anon', 401], ['denied', 403], ['missing', 404], ['module_disabled', 404],
  ] as const)('%s → %i (결과 객체·문구 모두)', (code, status) => {
    expect(denyStatus(guardFail(code))).toBe(status)
    expect(denyStatus(GUARD_TEXT[code])).toBe(status)
    expect(denyStatus(guardFail(code), 503)).toBe(status)
  })

  it('조회 실패·모르는 사유는 호출부의 fallback(기본 500)', () => {
    expect(denyStatus(guardFail('lookup'))).toBe(500)
    expect(denyStatus(guardFail('lookup'), 503)).toBe(503)
    expect(denyStatus('알 수 없는 사유')).toBe(500)
    expect(denyStatus({ error: 'x' }, 503)).toBe(503)
  })
})

describe('응답에 싣는 문구 — 받은 문구 그대로(제품은 한국어 전용)', () => {
  it('denied 는 가드 문구를 그대로 싣고 code 는 뺀다', () => {
    expect(denied(guardFail('denied'))).toEqual({ ok: false, error: ERR_DENIED })      // code 는 싣지 않는다 — 액션 계약 그대로
    expect(denied({ ok: false, error: ERR_MISSING })).toEqual({ ok: false, error: ERR_MISSING })
  })

  it('DB 오류 표의 가드 문구(message: ERR_DENIED)는 t 를 넘기든 아니든 같은 글자', () => {
    const own = { X_FORBIDDEN: { status: 403, code: 'ERR_DENIED', message: ERR_DENIED } } as const
    expect(rpcFailure({ message: 'X_FORBIDDEN: no' }, own, t)?.message).toBe(ERR_DENIED)
    expect(rpcFailure({ message: 'X_FORBIDDEN: no' }, own)?.message).toBe(ERR_DENIED)
    expect(tokenTable(own, t).X_FORBIDDEN.message).toBe(ERR_DENIED)
    expect(mapDbError({ message: 'CUSTOM_FIELD_ADMIN_ONLY' }, t)?.message).toBe(ERR_DENIED)
    expect(mapDbError({ message: 'CUSTOM_FIELD_ADMIN_ONLY' })?.message).toBe(ERR_DENIED)
  })

  it('화면의 문구 → 키 표(wbsErrorKey)는 가드 문구를 코드로 읽는다', () => {
    expect(wbsErrorKey(ERR_DENIED)).toBe('wbs.err.denied')
    expect(wbsErrorKey(ERR_MODULE_DISABLED)).toBe('wbs.err.moduleOff')
    expect(wbsErrorKey('constructor')).toBeNull()
  })
})

describe('액션 — 가드 거부 문구를 그대로 돌려준다', () => {
  it('코드가 있든 없든(가드를 통째로 대역한 결과) 문구 그대로, code 는 싣지 않는다', async () => {
    h.guard.mockResolvedValue(guardFail('denied'))
    expect(await listAuthzEvents(WS)).toEqual({ ok: false, error: ERR_DENIED })
    h.guard.mockResolvedValue({ ok: false, error: ERR_MISSING })
    expect(await listAuthzEvents(WS)).toEqual({ ok: false, error: ERR_MISSING })
  })
})
