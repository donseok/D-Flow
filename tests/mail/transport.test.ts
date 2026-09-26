import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { createTransport, sendMail } = vi.hoisted(() => {
  const sendMail = vi.fn()
  return {
    sendMail,
    createTransport: vi.fn<(opts: Record<string, unknown>) => { sendMail: typeof sendMail }>(() => ({ sendMail })),
  }
})
vi.mock('nodemailer', () => ({ default: { createTransport } }))

import { getTransport, resolveSmtpSettings } from '@/lib/mail/transport'
import { BRAND } from '@/lib/branding'

// 새 키를 모두 '' 로 스텁한다 — 개발자 셸·.env.local 의 값이 테스트로 새지 않게.
const KEYS = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_AUTH', 'SMTP_FROM_ADDRESS', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM_NAME']
const env = (over: Record<string, string>) => { for (const k of KEYS) vi.stubEnv(k, over[k] ?? '') }

const NOT_CONFIGURED = '메일 발송이 설정되지 않았습니다.'
const MISCONFIGURED = '메일 발송 설정이 올바르지 않습니다. 관리자에게 문의하세요.'

describe('getTransport', () => {
  beforeEach(() => { createTransport.mockClear(); sendMail.mockReset(); env({}) })
  afterEach(() => { vi.unstubAllEnvs() })

  it('SMTP_HOST 가 없으면 설정되지 않음 — Gmail 로 가지 않는다', () => {
    env({ SMTP_USER: 'a@example.com', SMTP_PASS: 'pw' })
    expect(getTransport()).toEqual({ ok: false, error: NOT_CONFIGURED })
    expect(createTransport).not.toHaveBeenCalled()
  })

  it('SMTP_HOST 만 있고 USER·PASS 가 둘 다 없으면 설정되지 않음 — 오류 로그도 남기지 않는다', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    env({ SMTP_HOST: 'smtp.example.com' })
    expect(getTransport()).toEqual({ ok: false, error: NOT_CONFIGURED })
    expect(createTransport).not.toHaveBeenCalled()
    expect(err).not.toHaveBeenCalled()
    err.mockRestore()
  })

  it('명시한 호스트·포트·보안으로 만들고 10초 타임아웃을 건다', () => {
    env({ SMTP_HOST: 'smtp.example.com', SMTP_PORT: '2525', SMTP_SECURE: 'false', SMTP_USER: 'a@example.com', SMTP_PASS: 'pw' })
    expect(getTransport().ok).toBe(true)
    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({
      host: 'smtp.example.com', port: 2525, secure: false, requireTLS: true,
      auth: { user: 'a@example.com', pass: 'pw' },
      connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 10_000,
    }))
  })

  it('포트·보안이 없으면 587 STARTTLS 이고 인증이 있으면 requireTLS', () => {
    env({ SMTP_HOST: 'smtp.example.com', SMTP_USER: 'a@example.com', SMTP_PASS: 'pw' })
    expect(getTransport().ok).toBe(true)
    const opts = createTransport.mock.calls[0][0]
    expect(opts).toMatchObject({ host: 'smtp.example.com', port: 587, secure: false, requireTLS: true, auth: { user: 'a@example.com', pass: 'pw' } })
    expect(opts).not.toHaveProperty('tls')
  })

  it('465 는 secure — 이미 TLS 라 requireTLS 는 없다', () => {
    env({ SMTP_HOST: 'smtp.example.com', SMTP_PORT: '465', SMTP_USER: 'a@example.com', SMTP_PASS: 'pw' })
    expect(getTransport().ok).toBe(true)
    const opts = createTransport.mock.calls[0][0]
    expect(opts).toMatchObject({ port: 465, secure: true, requireTLS: false, auth: { user: 'a@example.com', pass: 'pw' } })
    expect(opts).not.toHaveProperty('tls')
  })

  it.each([
    ['true', 465, true],
    ['false', 587, false],
  ] as const)('SMTP_SECURE=%s 만 있으면 포트는 %i', (secure, port, expected) => {
    env({ SMTP_HOST: 'smtp.example.com', SMTP_SECURE: secure, SMTP_USER: 'a@example.com', SMTP_PASS: 'pw' })
    expect(getTransport().ok).toBe(true)
    expect(createTransport.mock.calls[0][0]).toMatchObject({ port, secure: expected })
  })

  it('SMTP_AUTH=none + 1025 평문 — auth 키가 없고 발신 주소가 필수', () => {
    env({ SMTP_HOST: '127.0.0.1', SMTP_PORT: '1025', SMTP_AUTH: 'none', SMTP_FROM_ADDRESS: 'noreply@example.com' })
    expect(getTransport().ok).toBe(true)
    const opts = createTransport.mock.calls[0][0]
    expect(opts).not.toHaveProperty('auth')
    expect(opts).toMatchObject({ port: 1025, secure: false, requireTLS: false })
  })

  it.each([
    [{ SMTP_PORT: '0' }], [{ SMTP_PORT: '70000' }], [{ SMTP_PORT: 'abc' }], [{ SMTP_SECURE: 'yes' }],
    [{ SMTP_PORT: '465', SMTP_SECURE: 'false' }], [{ SMTP_PORT: '587', SMTP_SECURE: 'true' }], [{ SMTP_AUTH: 'login' }],
    [{ SMTP_PASS: '' }],                                    // 부분 인증
    [{ SMTP_USER: 'apikey', SMTP_FROM_ADDRESS: '' }],      // 이메일이 아닌 USER + 발신 주소 없음
    [{ SMTP_AUTH: 'none', SMTP_FROM_ADDRESS: '', SMTP_USER: '', SMTP_PASS: '' }],
    [{ SMTP_PORT: '25', SMTP_SECURE: 'true' }],
    [{ SMTP_AUTH: 'none', SMTP_FROM_ADDRESS: 'noreply@example.com' }], // 무인증이라면서 USER·PASS 가 남아 있다
    [{ SMTP_FROM_ADDRESS: 'not-an-email' }],
  ])('잘못된 설정 %o 은 invalid — 문구에 키 이름이 없고, 키 이름은 로그에만', (over) => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    env({ SMTP_HOST: 'smtp.example.com', SMTP_USER: 'a@example.com', SMTP_PASS: 'pw', ...over })
    const tx = getTransport()
    expect(tx).toEqual({ ok: false, error: MISCONFIGURED })
    expect(JSON.stringify(tx)).not.toContain('SMTP_')
    const logged = err.mock.calls.flat().join(' ')
    expect(logged).toMatch(/SMTP_/)
    expect(logged).not.toContain('pw')                      // 비밀번호는 로그에도 넣지 않는다
    expect(createTransport).not.toHaveBeenCalled()
    err.mockRestore()
  })

  it('SMTP_FROM_ADDRESS 가 발신 주소를 정한다', async () => {
    env({ SMTP_HOST: 'smtp.example.com', SMTP_USER: 'apikey', SMTP_PASS: 'pw', SMTP_FROM_ADDRESS: 'noreply@example.com' })
    sendMail.mockResolvedValue({ rejected: [] })

    const tx = getTransport()
    if (!tx.ok) throw new Error('트랜스포트가 만들어져야 한다')
    await tx.send({ to: ['a@b.com'], replyTo: null, subject: 'S', html: 'H', text: 'T' })

    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      from: { name: `${BRAND.productName} 알림`, address: 'noreply@example.com' },
    }))
  })

  it('send 는 발신 표시명을 붙이고 rejected 를 문자열 배열로 돌려준다', async () => {
    env({ SMTP_HOST: 'smtp.example.com', SMTP_PORT: '587', SMTP_USER: 'a@example.com', SMTP_PASS: 'pw', MAIL_FROM_NAME: '테스트 발신' })
    sendMail.mockResolvedValue({ rejected: ['bad@x.com'] })

    const tx = getTransport()
    if (!tx.ok) throw new Error('트랜스포트가 만들어져야 한다')
    const out = await tx.send({
      to: ['a@example.com'], replyTo: 'me@example.com',
      subject: 'S', html: '<b>H</b>', text: 'T',
    })

    expect(out).toEqual({ rejected: ['bad@x.com'] })
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      from: { name: '테스트 발신', address: 'a@example.com' },
      to: ['a@example.com'], replyTo: 'me@example.com',
      subject: 'S', html: '<b>H</b>', text: 'T',
    }))
  })

  it('MAIL_FROM_NAME 이 비면 발신 표시명은 "<제품명> 알림" 이다', async () => {
    env({ SMTP_HOST: 'smtp.example.com', SMTP_PORT: '587', SMTP_USER: 'a@example.com', SMTP_PASS: 'pw' })
    sendMail.mockResolvedValue({ rejected: [] })

    const tx = getTransport()
    if (!tx.ok) throw new Error('트랜스포트가 만들어져야 한다')
    await tx.send({ to: ['a@b.com'], replyTo: null, subject: 'S', html: 'H', text: 'T' })

    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      from: { name: `${BRAND.productName} 알림`, address: 'a@example.com' },
    }))
  })

  it('rejected 가 없으면 빈 배열을 낸다', async () => {
    env({ SMTP_HOST: 'smtp.example.com', SMTP_PORT: '587', SMTP_USER: 'a@example.com', SMTP_PASS: 'pw' })
    sendMail.mockResolvedValue({})
    const tx = getTransport()
    if (!tx.ok) throw new Error('트랜스포트가 만들어져야 한다')
    expect(await tx.send({ to: ['a@b.com'], replyTo: null, subject: 'S', html: 'H', text: 'T' }))
      .toEqual({ rejected: [] })
  })
})

describe('resolveSmtpSettings', () => {
  it('넘긴 env 만 읽고 값의 앞뒤 공백을 걷는다', () => {
    expect(resolveSmtpSettings({ SMTP_HOST: ' smtp.example.com ', SMTP_PORT: ' 587 ', SMTP_USER: 'a@example.com', SMTP_PASS: 'pw' }))
      .toEqual({
        ok: true,
        settings: {
          host: 'smtp.example.com', port: 587, secure: false, requireTLS: true,
          auth: { user: 'a@example.com', pass: 'pw' }, fromAddress: 'a@example.com',
        },
      })
  })

  it('빈 env 는 unset — 사유에 키 이름을 담는다', () => {
    const r = resolveSmtpSettings({})
    expect(r).toMatchObject({ ok: false, kind: 'unset' })
    if (r.ok) throw new Error('unset 이어야 한다')
    expect(r.reason).toContain('SMTP_HOST')
  })
})
