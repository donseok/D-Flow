import { describe, it, expect } from 'vitest'
import {
  isInviteToken, normalizeInviteEmail, isAllowedInviteDomain, normalizeEmailHost, isValidInviteEmail, canonicalInviteEmail,
  DEFAULT_INVITE_DAYS, MAX_INVITE_DAYS, normalizeInviteDays,
  inviteStatus, inviteStatusLabel, maskEmail, validateSignupInput,
  type InviteStateRow,
} from '@/lib/domain/invites'
import { normalizeDomain } from '@/lib/settings/defs/workspace'

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

describe('isAllowedInviteDomain — 퓨니코드·정규화(D40)', () => {
  it('메일 호스트를 저장값과 같은 규칙으로 바꿔 비교한다', () => {
    expect(isAllowedInviteDomain('kim@한글.kr', ['xn--bj0bj06e.kr'])).toBe(true)
    expect(isAllowedInviteDomain('kim@Example.COM.', ['example.com'])).toBe(true)
    expect(isAllowedInviteDomain('kim@sub.example.com', ['example.com'])).toBe(false)   // 서브도메인 불허 유지
    expect(isAllowedInviteDomain('kim@example.com', ['*'])).toBe(true)
    expect(isAllowedInviteDomain('kim@example.com', [])).toBe(false)
    expect(normalizeEmailHost('한글.kr')).toBe('xn--bj0bj06e.kr'); expect(normalizeEmailHost('bad host')).toBeNull()
  })

  // C2-F3 — URL 파서는 퓨니코드 변환에만 쓴다. 구분자에서 자르거나 %xx·soft hyphen 을 풀어 다른 호스트를 만들면 정확 일치가 뚫린다
  it.each([
    'alice@acme.test/evil.example', 'alice@acme.test#x', 'alice@acme.test?x', 'alice@acme.test\\x', 'alice@acm%65.test',
    'alice@acme.test:25', 'alice@ac\u00ADme.test', 'alice@ａcme.test',
  ])('URL 파서가 다른 호스트로 바꾸는 주소 %s 는 허용 도메인을 통과하지 못한다', (email) => {
    expect(isAllowedInviteDomain(email, ['acme.test'])).toBe(false)
  })
  it('형태가 아닌 호스트는 null — 조용히 잘라 쓰지 않는다', () => {
    expect(normalizeEmailHost('acme.test/x')).toBeNull()
    expect(normalizeEmailHost('acm%65.test')).toBeNull()
    expect(normalizeEmailHost('acme.test..')).toBeNull()
  })
  it('퓨니코드 일치와 끝 점 하나(FQDN 표기)는 지금처럼 같은 호스트로 본다', () => {
    expect(isAllowedInviteDomain('kim@한글.kr', ['xn--bj0bj06e.kr'])).toBe(true)
    expect(isAllowedInviteDomain('kim@xn--bj0bj06e.kr', ['xn--bj0bj06e.kr'])).toBe(true)
    // 끝 점 하나는 저장값 정규화(normalizeDomain)와 같이 떼어 낸다 — 'acme.test.' 는 문자열로는 다르지만 같은 호스트다
    expect(normalizeEmailHost('acme.test.')).toBe('acme.test')
    expect(isAllowedInviteDomain('alice@acme.test.', ['acme.test'])).toBe(true)
    expect(isAllowedInviteDomain('alice@acme.test..', ['acme.test'])).toBe(false)
  })
})

describe('IDN 라벨 왕복 검사(F3A-1) — 바뀐 라벨은 xn-- + punycode(입력) 일 때만', () => {
  // URL 파서의 UTS46 매핑이 입력과 다른 문자열을 같은 퓨니코드로 만들면 판정 호스트와 발송 호스트가 갈린다
  it.each([
    ['전각 섞인 IDN', 'alice@\u0430\uff43\uff4d\uff45.test', ['xn--cme-5cd.test']],
    ['NFD(u + 결합 분음)', 'alice@bu\u0308cher.test', ['xn--bcher-kva.test']],
    ['IDN + CGJ', 'alice@\u0430cme\u034f.test', ['xn--cme-5cd.test']],
    ['체로키 대문자(소문자화가 U+AB70 으로 바꾸고 매핑이 되돌림)', 'alice@\u13a0cme.test', ['xn--cme-t8p.test']],
  ])('%s 는 거부한다', (_label, email, domains) => {
    expect(isAllowedInviteDomain(email, domains)).toBe(false)
  })
  it.each([
    ['한글', 'kim@한글.kr', ['xn--bj0bj06e.kr']],
    ['일본어', 'kim@日本.jp', ['xn--wgv71a.jp']],
    ['NFC bücher', 'kim@b\u00fccher.test', ['xn--bcher-kva.test']],
    ['faß(비전이 처리)', 'kim@fa\u00df.test', ['xn--fa-hia.test']],
    ['키릴 а', 'kim@\u0430cme.test', ['xn--cme-5cd.test']],
    ['직접 쓴 xn--', 'kim@xn--cme-5cd.test', ['xn--cme-5cd.test']],
  ])('%s 는 그대로 통과한다', (_label, email, domains) => {
    expect(isAllowedInviteDomain(email, domains)).toBe(true)
  })
})

describe('isValidInviteEmail — 로컬 파트 specials(F3A-2)', () => {
  // nodemailer 가 주소를 다시 해석해 초대 행과 다른 수신자로 보낸다('bob>,<victim@acme.test' → victim@acme.test)
  it.each(['bob>,<victim@acme.test', 'a,b@acme.test', 'x<evil.example>y@acme.test', '"a b"@acme.test', 'a;b@acme.test',
    'a:b@acme.test', 'a(b)@acme.test', 'a[b]@acme.test', 'a\\b@acme.test', 'a\u0007b@acme.test', 'a@b@acme.test'])('%s 는 거부한다', (email) => {
    expect(isValidInviteEmail(email)).toBe(false)
    expect(isAllowedInviteDomain(email, ['acme.test'])).toBe(false)
  })
  it('보통 주소(점·더하기 태그)는 통과한다', () => {
    expect(isValidInviteEmail('alice.b+tag@acme.test')).toBe(true)
    expect(isAllowedInviteDomain('alice.b+tag@acme.test', ['acme.test'])).toBe(true)
  })
})

describe('로컬 파트는 ASCII atext 허용 목록(M-1) — GoTrue checkmail 과 같은 글자', () => {
  it.each([
    ['ZWSP', 'ceo\u200b@acme.test'], ['RLO', '\u202etset@acme.test'], ['한글(EAI)', '홍길동@acme.test'],
    ['한글 채움 U+3164', 'a\u3164b@acme.test'], ['점자 공백 U+2800', 'a\u2800b@acme.test'], ['BOM', '\ufeffalice@acme.test'],
    ['앞 점', '.alice@acme.test'], ['끝 점', 'alice.@acme.test'], ['연속 점', 'al..ice@acme.test'],
  ])('%s 는 거부한다', (_label, email) => {
    expect(isValidInviteEmail(email)).toBe(false)
  })
})

describe('specials 한 글자씩(N-1)', () => {
  it.each(['x<victim@acme.test', 'victim>x@acme.test', '"bob"victim@acme.test', 'a(b@acme.test', 'a)b@acme.test', 'a[b@acme.test',
    'a]b@acme.test', 'a,b@acme.test', 'a;b@acme.test', 'a:b@acme.test', 'a\\b@acme.test'])('%s 는 거부한다', (email) => {
    expect(isValidInviteEmail(email)).toBe(false)
  })
})

describe("'*' 모드에서도 호스트 형태를 요구한다(M-2)", () => {
  it.each(['alice@evil.example,victim.test', 'alice@[127.0.0.1]', 'alice@a.b:victim', 'alice@evil.example/x', 'alice@acme.test\u200b'])('%s 는 거부한다', (email) => {
    expect(isValidInviteEmail(email)).toBe(false)
    expect(isAllowedInviteDomain(email, ['*'])).toBe(false)
  })
})

// 적대 탐색 표 B(invite-attack2.md) — 발급의 실제 관문(canonicalInviteEmail)을 지나 판정한다. 허용 목록은 저장 parse(normalizeDomain) 결과.
describe('과잉 거부 없음 — 탐색 표 B', () => {
  const stored = (raw: string) => { const n = normalizeDomain(raw); if (!n.ok) throw new Error(n.error); return n.value }
  const B: Array<[string, string, string, boolean]> = [
    ['n-1', 'first.last@acme.test', 'acme.test', true], ['n-2', 'first_last+tag@acme.test', 'acme.test', true],
    ['n-3', '123abc@acme.test', 'acme.test', true], ['n-4', '1234567@acme.test', 'acme.test', true],
    ['n-5', 'alice@my-company.test', 'my-company.test', true], ['n-6', 'alice@eng.acme.test', 'eng.acme.test', true],
    ['n-7', 'alice@mail.eng.acme.co.kr', 'mail.eng.acme.co.kr', true], ['n-8', 'kim@한글.kr', '한글.kr', true],
    ['n-9', 'kim@한글회사.한국', '한글회사.한국', true], ['n-10', "o'brien@acme.test", 'acme.test', true],
    ['n-11', 'Alice@ACME.TEST', 'acme.test', true], ['n-12', 'alice@acme.technology', 'acme.technology', true],
    ['n-13', 'alice@acme.xn--3e0b707e', 'acme.xn--3e0b707e', true], ['n-14', 'alice@acme.한국', 'acme.xn--3e0b707e', true],
    ['n-15', 'alice@3m.test', '3m.test', true], ['n-16', 'alice@123.test', '123.test', true],
    ['n-17', 'a@acme.test', 'acme.test', true], ['n-18', 'x-y_z.w+1@acme.test', 'acme.test', true],
    ['n-19', "!#$%&'*+-/=?^_`{|}~@acme.test", 'acme.test', true], ['n-20', 'alice@m\u00fcnchen.de', 'MÜNCHEN.DE', true],
    ['n-21', 'alice@日本.jp', '日本.jp', true], ['n-22', 'alice@xn--wgv71a.jp', '日本.jp', true],
    ['n-23', 'alice@acme.test', '@acme.test', true], ['n-24', 'alice@acme.test.', 'acme.test', true],
    ['n-25', '  Alice.Kim@Acme.Test  ', 'acme.test', true], ['n-26', 'alice@acme.test\u200b', 'acme.test', false],
    ['n-27(M-1 로 거부)', '홍길동@acme.test', 'acme.test', false], ['n-28', 'alice@ab--cd.test', 'ab--cd.test', true],
    ['n-29', 'alice@acme.co.uk', 'acme.co.uk', true],
    ['n-30', 'alice@\u0645\u062b\u0627\u0644.\u0625\u062e\u062a\u0628\u0627\u0631', 'مثال.إختبار', true],
    ['n-31', 'alice@\u0baa\u0bb0\u0bbf\u0b9f\u0bcd\u0b9a\u0bc8.\u0b87\u0ba8\u0bcd\u0ba4\u0bbf\u0baf\u0bbe', 'பரிட்சை.இந்தியா', true],
    ['n-32', 'alice@b\u00fccher.test', 'BÜCHER.TEST', true], ['n-33', 'alice@\u0444\u0438\u0440\u043c\u0430.\u0440\u0444', 'ФИРМА.РФ', true],
    ['n-34', 'alice@\u4f8b\u5b50.\u4e2d\u56fd', '例子.中国', true], ['n-35', 'alice@vi\u1ec7t.vn', 'việt.vn', true],
    ['n-36', 'alice@vie\u0323\u0302t.vn', 'việt.vn', false], ['n-37', 'alice@\u1112\u1161\u11ab\u1100\u1173\u11af.kr', '한글.kr', false],
    ['n-38', 'alice@\u13a0\u13a1.test', 'xn--7tbj.test', false],
  ]
  it.each(B)('%s %s', (_id, email, allowed, expected) => {
    const c = canonicalInviteEmail(email)
    expect(c !== null && isAllowedInviteDomain(c, [stored(allowed)])).toBe(expected)
  })
  // 허용 행은 정규형도 고정한다 — 행·판정·발송·계정 이메일이 되는 값
  it.each([
    ['n-2', 'first_last+tag@acme.test', 'first_last+tag@acme.test'], ['n-8', 'kim@한글.kr', 'kim@xn--bj0bj06e.kr'],
    ['n-10', "o'brien@acme.test", "o'brien@acme.test"], ['n-11', 'Alice@ACME.TEST', 'alice@acme.test'],
    ['n-14', 'alice@acme.한국', 'alice@acme.xn--3e0b707e'], ['n-18', 'x-y_z.w+1@acme.test', 'x-y_z.w+1@acme.test'],
    ['n-19', "!#$%&'*+-/=?^_`{|}~@acme.test", "!#$%&'*+-/=?^_`{|}~@acme.test"], ['n-24', 'alice@acme.test.', 'alice@acme.test'],
    ['n-25', '  Alice.Kim@Acme.Test  ', 'alice.kim@acme.test'], ['n-32', 'alice@b\u00fccher.test', 'alice@xn--bcher-kva.test'],
  ])('%s 정규형 %s → %s', (_id, email, canonical) => {
    expect(canonicalInviteEmail(email)).toBe(canonical)
  })
})

describe('canonicalInviteEmail(M-3) — 행·판정·발송·계정 이메일이 같은 한 문자열', () => {
  it('로컬 파트 + @ + ASCII 호스트(퓨니코드·끝 점 하나 제거), 소문자·앞뒤 공백 제거', () => {
    expect(canonicalInviteEmail('kim@한글.kr')).toBe('kim@xn--bj0bj06e.kr')
    expect(canonicalInviteEmail('alice@acme.test.')).toBe('alice@acme.test')
    expect(canonicalInviteEmail('  Alice.Kim@Acme.Test  ')).toBe('alice.kim@acme.test')
    expect(canonicalInviteEmail('alice@acme.한국')).toBe('alice@acme.xn--3e0b707e')
    expect(canonicalInviteEmail('kim@xn--bj0bj06e.kr')).toBe('kim@xn--bj0bj06e.kr')   // 이미 정규형이면 그대로(멱등)
  })
  it('길이 상한(L-1) — 로컬 파트 64자, 전체 254자', () => {
    expect(canonicalInviteEmail(`${'a'.repeat(200)}@${'b'.repeat(60)}.test`)).toBeNull()
    expect(canonicalInviteEmail(`${'a'.repeat(65)}@acme.test`)).toBeNull()
    expect(canonicalInviteEmail(`${'a'.repeat(64)}@acme.test`)).toBe(`${'a'.repeat(64)}@acme.test`)
    const host = `${'b'.repeat(62)}.${'c'.repeat(62)}.${'d'.repeat(62)}.test`   // 193자 — 호스트 상한(253) 안
    expect(canonicalInviteEmail(`${'a'.repeat(64)}@${host}`)).toBeNull()      // 전체 258자
    expect(canonicalInviteEmail(`${'a'.repeat(60)}@${host}`)).toBe(`${'a'.repeat(60)}@${host}`)   // 254자
    expect(isAllowedInviteDomain(`${'a'.repeat(65)}@acme.test`, ['*'])).toBe(false)
  })
  it('전체 길이는 정규형(퓨니코드 호스트) 기준이다 — 원문 254자 이하여도 정규형이 넘으면 null(R4)', () => {
    const raw = `${'a'.repeat(64)}@${'가나다라마바사아자차카타파하.'.repeat(4)}kr`
    const host = normalizeEmailHost(raw.slice(raw.indexOf('@') + 1))!
    expect(raw.length).toBeLessThanOrEqual(254)
    expect(64 + 1 + host.length).toBeGreaterThan(254)
    expect(canonicalInviteEmail(raw)).toBeNull()
  })
  it('254자는 통과, 255자는 거부(ML1)', () => {
    const host = `${'b'.repeat(62)}.${'c'.repeat(62)}.${'d'.repeat(62)}.test`   // 193자
    const at254 = `${'a'.repeat(60)}@${host}`
    const at255 = `${'a'.repeat(61)}@${host}`
    expect(at254).toHaveLength(254)
    expect(at255).toHaveLength(255)
    expect(canonicalInviteEmail(at254)).toBe(at254)
    expect(canonicalInviteEmail(at255)).toBeNull()
  })
  it('괄호 없는 IPv4 호스트는 거부(L-2)', () => {
    expect(canonicalInviteEmail('alice@127.0.0.1')).toBeNull()
    expect(isAllowedInviteDomain('alice@127.0.0.1', ['*'])).toBe(false)
    expect(isAllowedInviteDomain('alice@169.254.169.254', ['*'])).toBe(false)
  })
  it('초대할 수 없는 주소는 null', () => {
    expect(canonicalInviteEmail('홍길동@acme.test')).toBeNull()
    expect(canonicalInviteEmail('alice@[127.0.0.1]')).toBeNull()
    expect(canonicalInviteEmail('broken-email')).toBeNull()
  })
})

describe("'*' 는 단독일 때만 전체 허용(F3A-3)", () => {
  it('섞인 목록의 * 는 전체 허용이 아니다', () => {
    expect(isAllowedInviteDomain('alice@evil.example', ['*', 'acme.test'])).toBe(false)
    expect(isAllowedInviteDomain('alice@acme.test', ['*', 'acme.test'])).toBe(true)
    expect(isAllowedInviteDomain('alice@evil.example', ['*'])).toBe(true)
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
