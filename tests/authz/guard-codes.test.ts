// 가드·관문 실패의 구분 코드(i18n 4차) — 비교는 문구가 아니라 코드로 하고, 문구는 응답을 만드는 자리에서 화면 언어로 번역한다.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ guard: vi.fn(), translator: vi.fn() }))
vi.mock('@/lib/authz', () => ({ requireWorkspaceAdmin: h.guard }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }))
vi.mock('@/lib/supabase/adminFor', () => ({ adminFor: vi.fn() }))
vi.mock('@/lib/i18n/server', () => ({ serverTranslator: () => h.translator() }))

import { listAuthzEvents } from '@/app/actions/authzEvents'
import {
  ERR_ANON, ERR_DENIED, ERR_LOOKUP, ERR_MISSING, ERR_MODULE_DISABLED, GUARD_DICT_KEY, GUARD_TEXT, denyStatus, guardCodeOf, guardFail, guardTextBy,
  type GuardCode,
} from '@/lib/authz/errors'
import { rpcFailure, tokenTable } from '@/lib/errors/dbFail'
import { SERVER_EN, SERVER_KO, serverKoTranslate, serverTranslatorFor } from '@/lib/i18n/serverDict'
import { denied, guardText, libText } from '@/lib/i18n/serverText'
import { mapDbError } from '@/lib/settings/errors'
import { wbsErrorKey } from '@/lib/wbs/actionErrors'

const en = serverTranslatorFor('en')
const CODES: GuardCode[] = ['lookup', 'denied', 'anon', 'missing', 'module_disabled']
const HANGUL = /[가-힣]/
const WS = '0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d'

beforeEach(() => { vi.clearAllMocks(); h.translator.mockResolvedValue(serverKoTranslate) })

describe('가드 코드 — 문구 표', () => {
  it('ko 문구는 종전 상수 그대로다(한 글자도 바뀌지 않는다)', () => {
    expect(GUARD_TEXT.lookup.ko).toBe('권한을 확인할 수 없어 중단했습니다.')
    expect(GUARD_TEXT.denied.ko).toBe('권한 없음')
    expect(GUARD_TEXT.anon.ko).toBe('로그인 필요')
    expect(GUARD_TEXT.missing.ko).toBe('대상을 찾을 수 없습니다.')
    expect(GUARD_TEXT.module_disabled.ko).toBe('이 기능은 지금 사용할 수 없습니다.')
    expect([ERR_LOOKUP, ERR_DENIED, ERR_ANON, ERR_MISSING, ERR_MODULE_DISABLED]).toEqual(CODES.map(c => GUARD_TEXT[c].ko))
  })

  it('서버 사전 err.guard.* 의 ko·en 은 순수 모듈의 표와 같은 글자다(어긋나면 화면이 번역된 문구를 코드로 읽지 못한다)', () => {
    for (const code of CODES) {
      const key = GUARD_DICT_KEY[code]
      expect(SERVER_KO[key], key).toBe(GUARD_TEXT[code].ko)
      expect(SERVER_EN[key], key).toBe(GUARD_TEXT[code].en)
      expect(GUARD_TEXT[code].en, key).not.toMatch(HANGUL)
    }
  })
})

describe('guardCodeOf — 결과 객체의 code, 없으면 문구(한국어·영어)', () => {
  it('guardFail 은 한국어 문구와 코드를 함께 싣는다', () => {
    expect(guardFail('denied')).toEqual({ ok: false, error: ERR_DENIED, code: 'denied' })
    for (const code of CODES) expect(guardCodeOf(guardFail(code))).toBe(code)
  })

  it('code 가 없는 결과(가드를 통째로 대역한 테스트·옛 호출부)는 문구로 읽는다', () => {
    expect(guardCodeOf({ error: ERR_MISSING })).toBe('missing')
    expect(guardCodeOf(ERR_MODULE_DISABLED)).toBe('module_disabled')
  })

  it('영어로 번역된 문구도 같은 코드다', () => {
    for (const code of CODES) expect(guardCodeOf(en(GUARD_DICT_KEY[code]))).toBe(code)
  })

  it('code 가 문구보다 먼저다 — 문구가 바뀌어도 판정은 그대로다', () => {
    expect(guardCodeOf({ error: 'Access denied (translated elsewhere)', code: 'denied' })).toBe('denied')
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
  ] as const)('%s → %i (결과 객체·한국어 문구·영어 문구 모두)', (code, status) => {
    expect(denyStatus(guardFail(code))).toBe(status)
    expect(denyStatus(GUARD_TEXT[code].ko)).toBe(status)
    expect(denyStatus(GUARD_TEXT[code].en)).toBe(status)
    expect(denyStatus(guardFail(code), 503)).toBe(status)
  })

  it('조회 실패·모르는 사유는 호출부의 fallback(기본 500)', () => {
    expect(denyStatus(guardFail('lookup'))).toBe(500)
    expect(denyStatus(guardFail('lookup'), 503)).toBe(503)
    expect(denyStatus('알 수 없는 사유')).toBe(500)
    expect(denyStatus({ error: 'x' }, 503)).toBe(503)
  })
})

describe('문구 번역 — 응답을 만드는 자리에서만', () => {
  it('guardText·denied·libText 는 영어 로캘에서 영어, 한국어 로캘에서 종전 문구', () => {
    for (const code of CODES) {
      const g = guardFail(code)
      expect(guardText(en, g)).toBe(GUARD_TEXT[code].en)
      expect(guardText(serverKoTranslate, g)).toBe(g.error)
      expect(libText(en, g.error)).toBe(GUARD_TEXT[code].en)
      expect(libText(serverKoTranslate, g.error)).toBe(g.error)
    }
    expect(denied(guardFail('denied'), en)).toEqual({ ok: false, error: 'No permission' })      // code 는 싣지 않는다 — 액션 계약 그대로
    expect(denied({ ok: false, error: ERR_MISSING }, serverKoTranslate)).toEqual({ ok: false, error: ERR_MISSING })
  })

  it('번역은 멱등이다 — 이미 번역된 문구를 다시 넘겨도 같은 글자', () => {
    for (const code of CODES) expect(guardText(en, guardText(en, guardFail(code)))).toBe(GUARD_TEXT[code].en)
  })

  it('가드 문구가 아니면 libText 와 같다(받은 그대로)', () => {
    expect(guardText(en, 'duplicate key value')).toBe('duplicate key value')
    expect(guardTextBy(en, 'duplicate key value')).toBe('duplicate key value')
  })

  it('DB 오류 표의 가드 문구(message: ERR_DENIED)도 화면 언어로 — t 를 넘기지 않으면 한국어', () => {
    const own = { X_FORBIDDEN: { status: 403, code: 'ERR_DENIED', message: ERR_DENIED } } as const
    expect(rpcFailure({ message: 'X_FORBIDDEN: no' }, own, en)?.message).toBe('No permission')
    expect(rpcFailure({ message: 'X_FORBIDDEN: no' }, own)?.message).toBe(ERR_DENIED)
    expect(tokenTable(own, en).X_FORBIDDEN.message).toBe('No permission')
    expect(mapDbError({ message: 'CUSTOM_FIELD_ADMIN_ONLY' }, en)?.message).toBe('No permission')
    expect(mapDbError({ message: 'CUSTOM_FIELD_ADMIN_ONLY' })?.message).toBe(ERR_DENIED)
  })

  it('화면의 문구 → 키 표(wbsErrorKey)는 번역된 문구도 같은 키로 읽는다', () => {
    expect(wbsErrorKey(ERR_DENIED)).toBe('wbs.err.denied')
    expect(wbsErrorKey(en('err.guard.denied'))).toBe('wbs.err.denied')
    expect(wbsErrorKey(en('err.guard.moduleOff'))).toBe('wbs.err.moduleOff')
    expect(wbsErrorKey('constructor')).toBeNull()
  })
})

describe('액션 — 가드 거부 문구가 요청의 화면 언어를 따른다', () => {
  it('영어 로캘: 가드가 한국어 문구로 거부해도 응답은 영어다(코드 없는 대역 결과 포함)', async () => {
    h.translator.mockResolvedValue(en)
    h.guard.mockResolvedValue(guardFail('denied'))
    expect(await listAuthzEvents(WS)).toEqual({ ok: false, error: 'No permission' })
    h.guard.mockResolvedValue({ ok: false, error: ERR_MISSING })
    expect(await listAuthzEvents(WS)).toEqual({ ok: false, error: 'Target not found.' })
  })

  it('한국어 로캘·요청 범위 밖: 종전 문구 그대로', async () => {
    h.guard.mockResolvedValue(guardFail('denied'))
    expect(await listAuthzEvents(WS)).toEqual({ ok: false, error: ERR_DENIED })
  })
})
