import { describe, it, expect, vi } from 'vitest'
import {
  isInviteToken, normalizeInviteEmail, parseAllowedDomains, isAllowedInviteDomain, resolveInviteDomains,
  DEFAULT_INVITE_DAYS, MAX_INVITE_DAYS, normalizeInviteDays,
  inviteStatus, inviteStatusLabel, maskEmail, validateSignupInput,
  type InviteStateRow,
} from '@/lib/domain/invites'

const TOKEN = '3f0f5f8e-1b2c-4d5e-8a9b-0c1d2e3f4a5b'

describe('isInviteToken', () => {
  it('UUID 형식만 통과(대문자 허용)', () => {
    expect(isInviteToken(TOKEN)).toBe(true)
    expect(isInviteToken(TOKEN.toUpperCase())).toBe(true)
  })
  it('비-UUID는 거부 — DB 조회 전 차단', () => {
    expect(isInviteToken('not-a-uuid')).toBe(false)
    expect(isInviteToken('')).toBe(false)
    expect(isInviteToken(TOKEN.slice(0, -1))).toBe(false)
    expect(isInviteToken(TOKEN + 'a')).toBe(false)
    expect(isInviteToken(` ${TOKEN} `)).toBe(false) // 공백 포함은 그대로 거부(정규화하지 않는다)
  })
})

describe('normalizeInviteEmail', () => {
  it('소문자·trim — DB check(email = lower(btrim(email)))와 같은 규칙', () => {
    expect(normalizeInviteEmail('  Mina.PARK@Example.com \n')).toBe('mina.park@example.com')
    expect(normalizeInviteEmail('a@b.com')).toBe('a@b.com')
    expect(normalizeInviteEmail('   ')).toBe('')
  })
})

describe('resolveInviteDomains', () => {
  it('워크스페이스 목록이 비어 있지 않으면 그것 — env 는 보지 않는다', () => {
    expect(resolveInviteDomains(['Acme.test', '@corp.co.kr'], 'example.com')).toEqual(['acme.test', 'corp.co.kr'])
    expect(resolveInviteDomains(['acme.test'], '*')).toEqual(['acme.test'])
  })
  it('워크스페이스 목록이 빈 배열이거나 행이 없으면(null) env', () => {
    expect(resolveInviteDomains([], 'example.com, corp.co.kr')).toEqual(['example.com', 'corp.co.kr'])
    expect(resolveInviteDomains(null, 'example.com')).toEqual(['example.com'])
  })
  it('둘 다 없으면 [] — 초대 불가(fail-closed)', () => {
    expect(resolveInviteDomains(null, undefined)).toEqual([])
    expect(resolveInviteDomains([], '')).toEqual([])
  })
  it('워크스페이스 목록이 있는데 항목이 전부 깨졌으면 [] — env 로 넓히지 않는다', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(resolveInviteDomains(['*.acme.test', 'not a host'], 'example.com')).toEqual([])
    spy.mockRestore()
  })
})

describe('parseAllowedDomains', () => {
  it('쉼표·공백 구분, 소문자, 중복 제거', () => {
    expect(parseAllowedDomains('Example.com, corp.co.kr')).toEqual(['example.com', 'corp.co.kr'])
    expect(parseAllowedDomains('a.com  b.com\tc.com')).toEqual(['a.com', 'b.com', 'c.com'])
    expect(parseAllowedDomains('a.com, A.COM')).toEqual(['a.com'])
  })
  it("'@' 접두는 떼어낸다", () => { expect(parseAllowedDomains('@example.com')).toEqual(['example.com']) })
  it('미설정·공백은 빈 목록 — 제한 없음이 아니라 초대 불가(fail-closed)', () => {
    expect(parseAllowedDomains(undefined)).toEqual([])
    expect(parseAllowedDomains('')).toEqual([])
    expect(parseAllowedDomains('  , ,\t')).toEqual([])
  })
  it("'*' 는 명시적 전체 허용이며 다른 값과 섞이면 '*' 만 남는다", () => {
    expect(parseAllowedDomains('*')).toEqual(['*'])
    expect(parseAllowedDomains('a.com, *')).toEqual(['*'])
  })
  it('끝의 점 하나는 벗겨낸다(FQDN 표기 흡수)', () => {
    expect(parseAllowedDomains('Example.com.')).toEqual(['example.com'])
    expect(parseAllowedDomains('example.com., corp.co.kr')).toEqual(['example.com', 'corp.co.kr'])
  })
  it("'*' 를 부분 포함한 항목(와일드카드 흔적)은 버린다 — '*' 는 단독일 때만 전체 허용", () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(parseAllowedDomains('*.example.com, corp.co.kr')).toEqual(['corp.co.kr'])
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('*.example.com'))
    spy.mockRestore()
  })
  it('호스트명 형태가 아닌 항목은 버린다(점 없음·빈 라벨·허용되지 않는 문자)', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(parseAllowedDomains('nodothost, corp.co.kr')).toEqual(['corp.co.kr'])
    expect(parseAllowedDomains('exa_mple.com, corp.co.kr')).toEqual(['corp.co.kr'])
    expect(parseAllowedDomains('a..com, corp.co.kr')).toEqual(['corp.co.kr'])
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
  it('전 항목이 깨졌으면 빈 목록 — 초대 불가(fail-closed)', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(parseAllowedDomains('*.evil.io, nodothost')).toEqual([])
    spy.mockRestore()
  })
})

describe('isAllowedInviteDomain', () => {
  it('빈 목록은 모두 거부', () => { expect(isAllowedInviteDomain('a@example.com', [])).toBe(false) })
  it("'*' 는 형식이 맞는 주소만 허용", () => {
    expect(isAllowedInviteDomain('a@anything.io', ['*'])).toBe(true)
    expect(isAllowedInviteDomain('@x.io', ['*'])).toBe(false)
    expect(isAllowedInviteDomain('a@', ['*'])).toBe(false)
  })
  it("'@' 없는 맨 문자열은 '*' 아래서도 거부 — 형식 검사가 자체 내장돼 있다", () => {
    expect(isAllowedInviteDomain('notanemail', ['*'])).toBe(false)
  })
  it("'@' 가 둘 이상이면 거부 — 호출부의 isValidEmail 선검증에 기대지 않는다(자기완결)", () => {
    expect(isAllowedInviteDomain('a@b@example.com', ['*'])).toBe(false)
    expect(isAllowedInviteDomain('a@b@example.com', ['example.com'])).toBe(false)
  })
  it('정확 일치만 — 서브도메인·접두 사칭 거부', () => {
    expect(isAllowedInviteDomain('a@example.com', ['example.com'])).toBe(true)
    expect(isAllowedInviteDomain('a@x.example.com', ['example.com'])).toBe(false)
    expect(isAllowedInviteDomain('a@example.com.evil.io', ['example.com'])).toBe(false)
  })
  it('대소문자 무시 — 이메일 호스트·허용 목록 양쪽 모두', () => {
    expect(isAllowedInviteDomain('mina.park@EXAMPLE.com', ['example.com'])).toBe(true)
    expect(isAllowedInviteDomain('a@b.com', ['A.COM', 'b.com'])).toBe(true)
  })
  it('끝의 점 하나는 이메일 호스트·허용 목록 양쪽에서 정규화한다', () => {
    expect(isAllowedInviteDomain('a@example.com.', ['example.com'])).toBe(true)
    expect(isAllowedInviteDomain('a@example.com', ['example.com.'])).toBe(true)
  })
})

describe('normalizeInviteDays', () => {
  it('기본·최대 상수', () => {
    expect(DEFAULT_INVITE_DAYS).toBe(7)
    expect(MAX_INVITE_DAYS).toBe(30)
  })
  it('1~30 정수는 통과', () => {
    expect(normalizeInviteDays(1)).toBe(1)
    expect(normalizeInviteDays(7)).toBe(7)
    expect(normalizeInviteDays(30)).toBe(30)
  })
  it('범위 밖은 null', () => {
    expect(normalizeInviteDays(0)).toBeNull()
    expect(normalizeInviteDays(31)).toBeNull()
    expect(normalizeInviteDays(-1)).toBeNull()
  })
  it('비정수·비수치는 null', () => {
    expect(normalizeInviteDays(7.5)).toBeNull()
    expect(normalizeInviteDays(Number.NaN)).toBeNull()
    expect(normalizeInviteDays(Infinity)).toBeNull()
    expect(normalizeInviteDays(undefined)).toBeNull()
    expect(normalizeInviteDays(null)).toBeNull()
    expect(normalizeInviteDays({})).toBeNull()
    expect(normalizeInviteDays(true)).toBeNull()
  })
  it('폼이 보내는 십진 정수 문자열은 받는다', () => {
    expect(normalizeInviteDays('7')).toBe(7)
    expect(normalizeInviteDays(' 30 ')).toBe(30)
  })
  it('정수 문자열이 아니면 null', () => {
    expect(normalizeInviteDays('7.5')).toBeNull()
    expect(normalizeInviteDays('-1')).toBeNull()
    expect(normalizeInviteDays('')).toBeNull()
    expect(normalizeInviteDays('   ')).toBeNull()
    expect(normalizeInviteDays('7일')).toBeNull()
    expect(normalizeInviteDays('0')).toBeNull()
    expect(normalizeInviteDays('31')).toBeNull()
  })
})

describe('inviteStatus', () => {
  const now = new Date('2026-08-03T00:00:00.000Z')
  const row = (o: Partial<InviteStateRow> = {}): InviteStateRow => ({
    expiresAt: '2026-08-10T00:00:00.000Z', revokedAt: null, redeemedAt: null, ...o,
  })

  it('기본은 active', () => {
    expect(inviteStatus(row(), now)).toBe('active')
  })
  it('우선순위: revoked > redeemed > expired > active', () => {
    // 넷이 동시에 성립해도 revoked 가 이긴다.
    expect(inviteStatus(row({
      revokedAt: '2026-08-02T00:00:00.000Z',
      redeemedAt: '2026-08-02T00:00:00.000Z',
      expiresAt: '2026-08-01T00:00:00.000Z',
    }), now)).toBe('revoked')
    expect(inviteStatus(row({
      redeemedAt: '2026-08-02T00:00:00.000Z',
      expiresAt: '2026-08-01T00:00:00.000Z',
    }), now)).toBe('redeemed')
    expect(inviteStatus(row({ expiresAt: '2026-08-01T00:00:00.000Z' }), now)).toBe('expired')
  })
  it('만료 경계 — 정확히 now 는 만료(소비 RPC 의 expires_at > now() 와 동일)', () => {
    expect(inviteStatus(row({ expiresAt: now.toISOString() }), now)).toBe('expired')
    expect(inviteStatus(row({ expiresAt: new Date(now.getTime() + 1).toISOString() }), now)).toBe('active')
    expect(inviteStatus(row({ expiresAt: new Date(now.getTime() - 1).toISOString() }), now)).toBe('expired')
  })
  it('expiresAt 파싱 실패는 expired — fail-closed', () => {
    expect(inviteStatus(row({ expiresAt: 'not-a-date' }), now)).toBe('expired')
    expect(inviteStatus(row({ expiresAt: '' }), now)).toBe('expired')
  })
  it('파싱 실패여도 revoked·redeemed 가 우선한다', () => {
    expect(inviteStatus(row({ expiresAt: 'x', revokedAt: '2026-08-02T00:00:00.000Z' }), now)).toBe('revoked')
    expect(inviteStatus(row({ expiresAt: 'x', redeemedAt: '2026-08-02T00:00:00.000Z' }), now)).toBe('redeemed')
  })
})

describe('inviteStatusLabel', () => {
  it('상태별 한국어 라벨', () => {
    expect(inviteStatusLabel('active')).toBe('유효')
    expect(inviteStatusLabel('redeemed')).toBe('합류 완료')
    expect(inviteStatusLabel('revoked')).toBe('취소됨')
    expect(inviteStatusLabel('expired')).toBe('만료됨')
  })
})

describe('maskEmail', () => {
  it('로컬파트 앞 2자만 남긴다', () => {
    expect(maskEmail('mina.park@example.com')).toBe('mi*******@example.com')
    expect(maskEmail('abc@example.com')).toBe('ab*@example.com')
  })
  it('대문자·공백은 정규화 후 마스킹', () => {
    expect(maskEmail('  Mina.PARK@Example.com ')).toBe('mi*******@example.com')
  })
  it('로컬파트 2자 이하는 첫 1자만 — 별표는 최소 1개', () => {
    expect(maskEmail('ab@example.com')).toBe('a*@example.com')
    expect(maskEmail('a@example.com')).toBe('a*@example.com')
  })
  it('형식이 깨졌으면 무엇도 흘리지 않는다', () => {
    expect(maskEmail('example.com')).toBe('***')
    expect(maskEmail('@example.com')).toBe('***')
    expect(maskEmail('abc@')).toBe('***')
    expect(maskEmail('')).toBe('***')
  })
})

describe('validateSignupInput', () => {
  const ok = { name: '홍길동', password: 'password1', passwordConfirmation: 'password1' }
  it('정상 입력', () => {
    expect(validateSignupInput(ok)).toEqual({ ok: true })
  })
  it('이름 공백은 E6', () => {
    expect(validateSignupInput({ ...ok, name: '   ' })).toEqual({ ok: false, error: '이름을 입력해 주세요.' })
  })
  it('비밀번호 8자 미만은 E7 — 7자 거부, 8자 통과', () => {
    expect(validateSignupInput({ ...ok, password: '1234567', passwordConfirmation: '1234567' }))
      .toEqual({ ok: false, error: '비밀번호는 8자 이상이어야 합니다.' })
    expect(validateSignupInput({ ...ok, password: '12345678', passwordConfirmation: '12345678' }))
      .toEqual({ ok: true })
  })
  it('비밀번호 불일치는 E8', () => {
    expect(validateSignupInput({ ...ok, passwordConfirmation: 'password2' }))
      .toEqual({ ok: false, error: '비밀번호가 일치하지 않습니다.' })
  })
  it('형상이 어긋난 입력은 TypeError 없이 거부 — 공개 액션의 첫 관문', () => {
    // 인증 게이트가 없어 조작된 요청이 그대로 들어온다. 던지지 말고 판정으로 끝내야 한다.
    const bad = (v: unknown) => validateSignupInput(v as never)
    const shapeErr = { ok: false, error: '입력값을 확인해 주세요.' }
    expect(bad(null)).toEqual(shapeErr)
    expect(bad(undefined)).toEqual(shapeErr)
    expect(bad({})).toEqual(shapeErr)
    expect(bad({ name: 1, password: 'password1', passwordConfirmation: 'password1' })).toEqual(shapeErr)
    expect(bad({ name: '홍길동', password: 12345678, passwordConfirmation: 'password1' })).toEqual(shapeErr)
    expect(bad({ name: '홍길동', password: 'password1', passwordConfirmation: null })).toEqual(shapeErr)
    // 필드 일부 누락
    expect(bad({ name: '홍길동' })).toEqual(shapeErr)
    expect(bad({ name: '홍길동', password: 'password1' })).toEqual(shapeErr)
    expect(bad({ password: 'password1', passwordConfirmation: 'password1' })).toEqual(shapeErr)
    // 객체가 아닌 값
    expect(bad('홍길동')).toEqual(shapeErr)
    expect(bad(0)).toEqual(shapeErr)
  })
  it('이메일은 검증 대상이 아니다 — 초대 행이 정한다(폼에 입력란 없음)', () => {
    // 이름·비밀번호만으로 통과해야 한다. 이메일 필드 자체가 SignupInput 에 없다.
    expect(Object.keys(ok)).toEqual(['name', 'password', 'passwordConfirmation'])
  })
})
