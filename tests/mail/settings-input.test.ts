// 발송 메일 설정 입력 정규화(src/lib/mail/settingsInput.ts) — 폼과 서버 액션이 같은 규칙을 쓴다(설계 2026-10-15 §3·§2.4).
// 여기를 통과한 값은 DB 제약(0059)과 발송 판정(resolveSmtpSettings)을 함께 통과해야 한다 — 가운데 묶음이 그 짝을 실측한다.
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  normalizeMailSettingsInput, canReusePassword, reasonKey,
  MAIL_PORTS, GMAIL_HOST, type MailSettingsReason,
} from '@/lib/mail/settingsInput'
import { resolveSmtpSettings } from '@/lib/mail/transport'
import { KO } from '@/lib/i18n/dict/ko'

const custom = (over: Record<string, unknown> = {}) => ({
  preset: 'custom', host: 'smtp.example.com', port: 587, secure: false,
  username: 'sender@example.com', password: 'pw-1234', fromAddress: '', ...over,
})
const code = (input: unknown) => {
  const r = normalizeMailSettingsInput(input)
  return r.ok ? 'ok' : r.code
}

describe('normalizeMailSettingsInput — 방식', () => {
  it.each([null, undefined, 'gmail', 42, [], {}, { preset: 'smtp' }, { preset: 'GMAIL' }])('방식이 아니면 preset_invalid: %j', (v) => {
    expect(code(v)).toBe('preset_invalid')
  })
})

describe('normalizeMailSettingsInput — Gmail', () => {
  it('서버 값을 고정하고 계정 = 주소(trim·소문자), 보내는 주소는 비운다(→ 계정)', () => {
    const r = normalizeMailSettingsInput({ preset: 'gmail', address: '  Sender@Gmail.com ', password: 'abcdefghijklmnop' })
    expect(r).toEqual({
      ok: true,
      value: { preset: 'gmail', host: GMAIL_HOST, port: 465, secure: true, username: 'sender@gmail.com', password: 'abcdefghijklmnop', from_address: null },
    })
  })

  it('앱 비밀번호의 공백(4자씩 띄운 표시·탭·줄바꿈)을 모두 지운다', () => {
    const r = normalizeMailSettingsInput({ preset: 'gmail', address: 'a@gmail.com', password: ' abcd efgh\tijkl\nmnop ' })
    expect(r.ok && r.value.password).toBe('abcdefghijklmnop')
  })

  it('Gmail 이면 직접 입력 칸(host·port·secure·username·fromAddress)을 읽지 않는다', () => {
    const r = normalizeMailSettingsInput({
      preset: 'gmail', address: 'a@gmail.com', password: 'x',
      host: 'evil.example.com', port: 25, secure: false, username: 'other', fromAddress: 'boss@example.com',
    })
    expect(r.ok && r.value).toMatchObject({ host: 'smtp.gmail.com', port: 465, secure: true, username: 'a@gmail.com', from_address: null })
  })

  it('비밀번호가 비거나 공백뿐이거나 문자열이 아니면 null(저장값 재사용 후보)', () => {
    for (const password of [undefined, '', '   ', 1234]) {
      const r = normalizeMailSettingsInput({ preset: 'gmail', address: 'a@gmail.com', password })
      expect(r.ok && r.value.password, String(password)).toBeNull()
    }
  })

  it.each(['', '   ', 'not-an-email', 'a@b', 'a b@gmail.com', 'a@gmail.com, b@gmail.com'])('주소 형식이 아니면 address_invalid: %j', (address) => {
    expect(code({ preset: 'gmail', address, password: 'x' })).toBe('address_invalid')
  })

  it('주소가 문자열이 아니면 address_invalid', () => {
    expect(code({ preset: 'gmail', address: 42, password: 'x' })).toBe('address_invalid')
  })
})

describe('normalizeMailSettingsInput — 직접 입력', () => {
  it('정상 입력 — 호스트는 소문자·끝 점 제거, 포트 문자열은 숫자로, 계정·비밀번호는 trim, 빈 보내는 주소는 null', () => {
    const r = normalizeMailSettingsInput(custom({ host: ' SMTP.Example.COM. ', port: ' 587 ', username: '  sender@example.com ', password: '  pw-1234 ' }))
    expect(r).toEqual({
      ok: true,
      value: { preset: 'custom', host: 'smtp.example.com', port: 587, secure: false, username: 'sender@example.com', password: 'pw-1234', from_address: null },
    })
  })

  it('계정은 대소문자를 그대로 둔다(가리는 서버가 있다), 보내는 주소는 trim 해서 둔다', () => {
    const r = normalizeMailSettingsInput(custom({ username: 'MailUser', fromAddress: ' noreply@example.com ' }))
    expect(r.ok && r.value).toMatchObject({ username: 'MailUser', from_address: 'noreply@example.com' })
  })

  it('비밀번호 안쪽 공백은 지우지 않는다(Gmail 만 지운다)', () => {
    const r = normalizeMailSettingsInput(custom({ password: 'pass word' }))
    expect(r.ok && r.value.password).toBe('pass word')
  })

  it('국제화 도메인은 퓨니코드로 저장한다', () => {
    const r = normalizeMailSettingsInput(custom({ host: 'smtp.한국.kr' }))
    expect(r.ok && r.value.host).toBe('smtp.xn--3e0b707e.kr')
  })

  it.each([
    '', '   ', 'localhost', 'localhost.', 'LOCALHOST', 'mail', 'intranet.',
    '127.0.0.1', '10.0.0.1', '192.168.0.10', '0x7f.1', '[::1]', '::1', 'fe80::1',
    'smtp.example.com:25', 'http://smtp.example.com', 'smtp.example.com/evil', 'smtp.example.com?x', 'user@smtp.example.com',
    'a..example.com', 'smtp.example.com..', '-smtp.example.com', 'smtp_relay.example.com', 'smtp.ex%61mple.com',
  ])('도메인 이름이 아니면 host_invalid: %j', (host) => {
    expect(code(custom({ host }))).toBe('host_invalid')
  })

  it.each(['smtp.localhost', 'SMTP.LocalHost.', 'a.b.localhost'])(
    'localhost 아래 이름(RFC 6761 — 언제나 루프백)이면 host_invalid: %j', (host) => {
      expect(code(custom({ host }))).toBe('host_invalid')
    })

  it.each(['localhost.example.com', 'mylocalhost.com', 'smtp.notlocalhost'])('localhost 를 품었을 뿐인 이름은 통과: %j', (host) => {
    const r = normalizeMailSettingsInput(custom({ host }))
    expect(r.ok && r.value.host).toBe(host)
  })

  it('서버 주소가 문자열이 아니면 host_invalid', () => {
    expect(code(custom({ host: 42 }))).toBe('host_invalid')
    expect(code(custom({ host: undefined }))).toBe('host_invalid')
  })

  it('포트는 표준 넷만 — 숫자·숫자 문자열 모두', () => {
    expect(MAIL_PORTS).toEqual([25, 465, 587, 2525])
    for (const port of MAIL_PORTS) {
      const secure = port === 465
      expect(code(custom({ port, secure })), String(port)).toBe('ok')
      expect(code(custom({ port: String(port), secure })), `'${port}'`).toBe('ok')
    }
  })

  it.each([0, 1, 22, 80, 443, 3306, 8025, 65535, 587.5, -587, NaN, '', ' ', '587a', '0x24b', '5 87', '1e3', undefined, null, true])(
    '표준 넷 밖이면 port_invalid: %j', (port) => {
      expect(code(custom({ port }))).toBe('port_invalid')
    })

  it('포트-보안 짝 — 465 는 SSL, 587·25 는 STARTTLS, 2525 는 어느 쪽이든', () => {
    expect(code(custom({ port: 465, secure: false }))).toBe('tls_mismatch')
    expect(code(custom({ port: 587, secure: true }))).toBe('tls_mismatch')
    expect(code(custom({ port: 25, secure: true }))).toBe('tls_mismatch')
    expect(code(custom({ port: 465, secure: true }))).toBe('ok')
    expect(code(custom({ port: 587, secure: false }))).toBe('ok')
    expect(code(custom({ port: 25, secure: false }))).toBe('ok')
    expect(code(custom({ port: 2525, secure: true }))).toBe('ok')
    expect(code(custom({ port: 2525, secure: false }))).toBe('ok')
  })

  it('보안 연결이 불리언이 아니면 포트로 정한다(465 → SSL, 나머지 → STARTTLS)', () => {
    const at = (port: number, secure: unknown) => {
      const r = normalizeMailSettingsInput(custom({ port, secure }))
      return r.ok ? r.value.secure : r.code
    }
    expect(at(465, undefined)).toBe(true)
    expect(at(587, undefined)).toBe(false)
    expect(at(25, 'true')).toBe(false)
    expect(at(2525, undefined)).toBe(false)
  })

  it.each(['', '   ', undefined, 42])('계정이 비면 username_required: %j', (username) => {
    expect(code(custom({ username }))).toBe('username_required')
  })

  it('보내는 주소를 비우면 계정이 이메일이어야 한다 — 아니면 from_invalid', () => {
    expect(code(custom({ username: 'mailuser', fromAddress: '' }))).toBe('from_invalid')
    expect(code(custom({ username: 'mailuser', fromAddress: '   ' }))).toBe('from_invalid')
    expect(code(custom({ username: 'mailuser', fromAddress: 'noreply@example.com' }))).toBe('ok')
  })

  it.each(['not-an-email', 'a@b', 'Boss <boss@example.com>', 'a@example.com,b@example.com'])('보내는 주소가 형식이 아니면 from_invalid: %j', (fromAddress) => {
    expect(code(custom({ fromAddress }))).toBe('from_invalid')
  })

  it('검사 순서 — 서버 주소 → 포트 → 보안 짝 → 계정 → 보내는 주소', () => {
    expect(code(custom({ host: 'localhost', port: 1, username: '' }))).toBe('host_invalid')
    expect(code(custom({ port: 1, secure: 'x', username: '' }))).toBe('port_invalid')
    expect(code(custom({ port: 465, secure: false, username: '' }))).toBe('tls_mismatch')
    expect(code(custom({ username: '', fromAddress: 'bad' }))).toBe('username_required')
  })

  it('비밀번호가 비거나 공백뿐이면 null(저장값 재사용 후보) — 정규화는 password_required 를 내지 않는다', () => {
    for (const password of [undefined, '', '   ']) {
      const r = normalizeMailSettingsInput(custom({ password }))
      expect(r.ok && r.value.password, String(password)).toBeNull()
    }
  })
})

describe('정규화 결과는 발송 판정(resolveSmtpSettings)과 DB 제약(0059)을 함께 통과한다', () => {
  const asEnv = (v: { host: string; port: number; secure: boolean; username: string; from_address: string | null }) => ({
    SMTP_HOST: v.host, SMTP_PORT: String(v.port), SMTP_SECURE: String(v.secure),
    SMTP_USER: v.username, SMTP_PASS: 'pw', SMTP_FROM_ADDRESS: v.from_address ?? '',
  })
  it.each([
    ['gmail', { preset: 'gmail', address: 'A@gmail.com', password: 'abcd efgh ijkl mnop' }],
    ['custom 587', custom()],
    ['custom 465', custom({ port: 465, secure: true })],
    ['custom 2525 SSL', custom({ port: 2525, secure: true })],
    ['custom 계정 ≠ 이메일', custom({ username: 'mailuser', fromAddress: 'noreply@example.com' })],
    ['custom IDN', custom({ host: 'SMTP.한국.KR.' })],
  ])('%s', (_name, input) => {
    const r = normalizeMailSettingsInput(input)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const v = r.value
    expect(resolveSmtpSettings(asEnv(v)).ok).toBe(true)
    // workspace_mail_settings_host·_login·_from·_tls·_gmail 과 같은 식
    expect(v.host.length).toBeGreaterThan(0)
    expect(v.host.length).toBeLessThanOrEqual(253)
    expect(v.host).toBe(v.host.toLowerCase())
    expect(v.host.endsWith('.')).toBe(false)
    expect(v.username.trim().length).toBeGreaterThan(0)
    expect(v.from_address === null || v.from_address.trim().length > 0).toBe(true)
    expect(MAIL_PORTS as readonly number[]).toContain(v.port)
    expect(v.port === 465 && !v.secure).toBe(false)
    expect((v.port === 587 || v.port === 25) && v.secure).toBe(false)
    if (v.preset === 'gmail') expect([v.host, v.port, v.secure]).toEqual(['smtp.gmail.com', 465, true])
  })
})

describe('canReusePassword — 빈 비밀번호로 저장값을 다시 써도 되는가', () => {
  const stored = { host: 'smtp.example.com', username: 'sender@example.com' }

  it('저장 행이 없으면 false', () => {
    expect(canReusePassword(stored, null)).toBe(false)
  })

  it('같은 서버·같은 계정이면 true — 서버 주소의 대소문자·끝 점, 계정의 대소문자·앞뒤 공백은 같은 것으로 본다', () => {
    expect(canReusePassword({ host: 'smtp.example.com', username: 'sender@example.com' }, stored)).toBe(true)
    expect(canReusePassword({ host: 'SMTP.Example.com.', username: '  Sender@Example.COM ' }, stored)).toBe(true)
  })

  it('국제화 도메인은 유니코드·퓨니코드 표기를 같은 서버로 본다', () => {
    expect(canReusePassword({ host: 'smtp.한국.kr', username: 'u@example.com' }, { host: 'smtp.xn--3e0b707e.kr', username: 'u@example.com' })).toBe(true)
  })

  it('서버나 계정이 다르면 false', () => {
    expect(canReusePassword({ host: 'smtp.other.com', username: 'sender@example.com' }, stored)).toBe(false)
    expect(canReusePassword({ host: 'smtp.example.com', username: 'other@example.com' }, stored)).toBe(false)
  })

  it('직접 입력 → Gmail(같은 주소)은 서버가 달라 false', () => {
    const g = normalizeMailSettingsInput({ preset: 'gmail', address: 'sender@example.com' })
    expect(g.ok).toBe(true)
    if (g.ok) expect(canReusePassword(g.value, stored)).toBe(false)
  })

  it('Gmail → 직접 입력(다른 서버)은 false, 같은 서버·같은 계정이면 true', () => {
    const gmailRow = { host: GMAIL_HOST, username: 'sender@gmail.com' }
    expect(canReusePassword({ host: 'smtp.example.com', username: 'sender@gmail.com' }, gmailRow)).toBe(false)
    expect(canReusePassword({ host: 'smtp.gmail.com', username: 'sender@gmail.com' }, gmailRow)).toBe(true)
  })

  it('어느 한쪽이 비면 false — 빈 값끼리 같다고 보지 않는다', () => {
    expect(canReusePassword({ host: '', username: '' }, { host: '', username: '' })).toBe(false)
    expect(canReusePassword({ host: 'smtp.example.com', username: ' ' }, { host: 'smtp.example.com', username: '' })).toBe(false)
  })
})

describe('reasonKey — 사유 코드 → 공용 사전 문구', () => {
  const CODES: MailSettingsReason[] = [
    'preset_invalid', 'address_invalid', 'host_invalid', 'port_invalid',
    'tls_mismatch', 'username_required', 'from_invalid', 'password_required',
  ]

  it.each(CODES)('%s → mailSettings.reason.<code>, 공용 사전(ko.ts)에 한국어 문구가 있다', (c) => {
    const key = reasonKey(c)
    expect(key).toBe(`mailSettings.reason.${c}`)
    expect((KO as Record<string, string>)[key]).toMatch(/[가-힣]/)
  })

  it('사전의 mailSettings.reason.* 는 사유 코드 여덟 개와 정확히 같다(남는 키·빠진 키 없음)', () => {
    const keys = Object.keys(KO).filter(k => k.startsWith('mailSettings.reason.')).sort()
    expect(keys).toEqual(CODES.map(c => `mailSettings.reason.${c}`).sort())
  })
})

describe('클라이언트 공용 — settingsInput 은 server-only 모듈을 값으로 끌어오지 않는다', () => {
  const ROOT = process.cwd()
  /** 값으로 끌어오는 대상 경로 — 파일 전체에서 `import … from`·`export … from`(여러 줄 꼴 포함)·부수효과 `import '…'`·동적 `import('…')`,
   *  홑·겹따옴표 모두. `import type`·`export type` 은 번들에 남지 않으므로 뺀다(`import { type A, b }` 는 값으로 센다 — 더 엄격한 쪽) */
  const valueImports = (src: string): string[] => [
    /^\s*(?:import|export)\s+(?!type\b)[^;'"=()]*?\bfrom\s*['"]([^'"]+)['"]/gm,
    /^\s*import\s*['"]([^'"]+)['"]/gm,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ].flatMap(re => [...src.matchAll(re)].map(m => m[1]))

  it('판정기 표본 — 여러 줄·겹따옴표·re-export·동적 import 를 보고, type 전용은 뺀다', () => {
    const src = [
      `import {`, `  a,`, `  b,`, `} from "@/lib/multi"`,
      `import x from '@/lib/single'`,
      `import 'server-only'`,
      `export { c } from './re'`,
      `export * from "../star"`,
      `const m = await import('@/lib/dyn')`,
      `import type { T } from '@/lib/typeonly'`,
      `export type { U } from '@/lib/typeexport'`,
      `export const label = 'from here'`,
    ].join('\n')
    expect(valueImports(src).sort()).toEqual(['../star', './re', '@/lib/dyn', '@/lib/multi', '@/lib/single', 'server-only'].sort())
  })
  const resolve = (spec: string, from: string): string | null => {
    const base = spec.startsWith('@/') ? join(ROOT, 'src', spec.slice(2)) : spec.startsWith('.') ? join(dirname(from), spec) : null
    if (!base) return null
    return [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts')].find(existsSync) ?? null
  }

  it('자기 자신과 값으로 닿는 모든 모듈에 server-only·transport·nodemailer 가 없다', () => {
    const seen = new Set<string>()
    const bad: string[] = []
    const visit = (file: string) => {
      if (seen.has(file)) return
      seen.add(file)
      for (const spec of valueImports(readFileSync(file, 'utf8'))) {
        if (spec === 'server-only' || spec === 'nodemailer' || /mail\/transport$/.test(spec)) bad.push(`${relative(ROOT, file)} → ${spec}`)
        const next = resolve(spec, file)
        if (next) visit(next)
      }
    }
    visit(join(ROOT, 'src/lib/mail/settingsInput.ts'))
    expect(bad, bad.join('\n')).toEqual([])
    // 실제로 따라갔는지 — 쓰는 두 순수 모듈이 목록에 있다
    expect([...seen].map(f => relative(ROOT, f))).toEqual(expect.arrayContaining([
      'src/lib/mail/settingsInput.ts', 'src/lib/domain/hostname.ts', 'src/lib/mail/recipients.ts',
    ]))
  })
})
