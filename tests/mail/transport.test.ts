import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { WorkspaceMailRow } from '@/lib/mail/workspaceSmtp'

const { createTransport, sendMail, ADMIN, createAdminClient, loadWorkspaceMailRow, vetMailHost } = vi.hoisted(() => {
  const sendMail = vi.fn()
  const ADMIN = { from: vi.fn() }
  return {
    sendMail,
    createTransport: vi.fn<(opts: Record<string, unknown>) => { sendMail: typeof sendMail }>(() => ({ sendMail })),
    ADMIN,
    createAdminClient: vi.fn(() => ADMIN),
    loadWorkspaceMailRow: vi.fn(),
    vetMailHost: vi.fn(),
  }
})
vi.mock('nodemailer', () => ({ default: { createTransport } }))
// adminFor 는 진짜(uuid 가 아니면 throw) — 그 안에서 만드는 service_role 클라이언트만 바꾼다
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }))
// 행 → env 꼴 매핑(rowToSmtpEnv)은 진짜, DB 조회와 DNS 검사만 목
vi.mock('@/lib/mail/workspaceSmtp', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/mail/workspaceSmtp')>()),
  loadWorkspaceMailRow,
  vetMailHost,
}))

import {
  getTransport, resolveMailStatus, resolveSmtpSettings, statusFromLoad, transportFromSettings,
  MAIL_HOST_NOT_ALLOWED, MAIL_HOST_UNUSABLE_AT_SEND, MAIL_SETTINGS_UNAVAILABLE, type SmtpSettings,
} from '@/lib/mail/transport'
import type { WorkspaceMailLoad } from '@/lib/mail/workspaceSmtp'
import { BRAND } from '@/lib/branding'

// 새 키를 모두 '' 로 스텁한다 — 개발자 셸·.env.local 의 값이 테스트로 새지 않게.
const KEYS = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_AUTH', 'SMTP_FROM_ADDRESS', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM_NAME']
const env = (over: Record<string, string>) => { for (const k of KEYS) vi.stubEnv(k, over[k] ?? '') }

const NOT_CONFIGURED = '메일 발송이 설정되지 않았습니다.'
const MISCONFIGURED = '메일 발송 설정이 올바르지 않습니다. 관리자에게 문의하세요.'
const HOST_NOT_ALLOWED = '이 메일 서버 주소는 쓸 수 없습니다. 주소를 찾지 못했거나 내부망 주소입니다 — 주소가 맞는지 확인하세요.'
const HOST_UNUSABLE_AT_SEND = '워크스페이스 메일 설정의 서버 주소를 쓸 수 없어 메일을 보내지 못했습니다. 워크스페이스 관리자에게 알리세요.'

const WID = '11111111-1111-4111-8111-111111111111'
const IP = '203.0.113.10'
const ENV_OK = { SMTP_HOST: 'smtp.env.example', SMTP_USER: 'env@example.com', SMTP_PASS: 'env-pw' }
const MSG = { to: ['a@b.com'], replyTo: null, subject: 'S', html: 'H', text: 'T' }
const row = (over: Partial<WorkspaceMailRow> = {}): WorkspaceMailRow => ({
  workspace_id: WID, preset: 'custom', host: 'smtp.example.org', port: 587, secure: false,
  username: 'bot@example.org', password: 'ws-secret', from_address: null,
  password_set_by: null, password_set_at: '2026-10-15T00:00:00Z', updated_by: null, updated_at: '2026-10-15T00:00:00Z',
  ...over,
})

beforeEach(() => {
  createTransport.mockClear(); sendMail.mockReset(); createAdminClient.mockClear()
  loadWorkspaceMailRow.mockReset(); loadWorkspaceMailRow.mockResolvedValue({ kind: 'none' })
  vetMailHost.mockReset(); vetMailHost.mockResolvedValue({ ok: true, address: IP })
  env({})
})
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe('getTransport — env 경로(workspaceId: null)', () => {
  it('워크스페이스가 없으면 DB 를 보지 않는다', async () => {
    env(ENV_OK)
    expect((await getTransport({ workspaceId: null })).ok).toBe(true)
    expect(createAdminClient).not.toHaveBeenCalled()
    expect(loadWorkspaceMailRow).not.toHaveBeenCalled()
    expect(vetMailHost).not.toHaveBeenCalled()
  })

  it('SMTP_HOST 가 없으면 설정되지 않음 — Gmail 로 가지 않는다', async () => {
    env({ SMTP_USER: 'a@example.com', SMTP_PASS: 'pw' })
    expect(await getTransport({ workspaceId: null })).toEqual({ ok: false, error: NOT_CONFIGURED })
    expect(createTransport).not.toHaveBeenCalled()
  })

  it('SMTP_HOST 만 있고 USER·PASS 가 둘 다 없으면 설정되지 않음 — 오류 로그도 남기지 않는다', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    env({ SMTP_HOST: 'smtp.example.com' })
    expect(await getTransport({ workspaceId: null })).toEqual({ ok: false, error: NOT_CONFIGURED })
    expect(createTransport).not.toHaveBeenCalled()
    expect(err).not.toHaveBeenCalled()
  })

  it('명시한 호스트·포트·보안으로 만들고 10초 타임아웃을 건다', async () => {
    env({ SMTP_HOST: 'smtp.example.com', SMTP_PORT: '2525', SMTP_SECURE: 'false', SMTP_USER: 'a@example.com', SMTP_PASS: 'pw' })
    expect((await getTransport({ workspaceId: null })).ok).toBe(true)
    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({
      host: 'smtp.example.com', port: 2525, secure: false, requireTLS: true,
      auth: { user: 'a@example.com', pass: 'pw' },
      connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 10_000,
    }))
  })

  it('포트·보안이 없으면 587 STARTTLS 이고 인증이 있으면 requireTLS — env 경로는 이름을 바꿔 달지 않는다', async () => {
    env({ SMTP_HOST: 'smtp.example.com', SMTP_USER: 'a@example.com', SMTP_PASS: 'pw' })
    expect((await getTransport({ workspaceId: null })).ok).toBe(true)
    const opts = createTransport.mock.calls[0][0]
    expect(opts).toMatchObject({ host: 'smtp.example.com', port: 587, secure: false, requireTLS: true, auth: { user: 'a@example.com', pass: 'pw' } })
    expect(opts).not.toHaveProperty('tls')
    expect(opts).not.toHaveProperty('name')
  })

  it('465 는 secure — 이미 TLS 라 requireTLS 는 없다', async () => {
    env({ SMTP_HOST: 'smtp.example.com', SMTP_PORT: '465', SMTP_USER: 'a@example.com', SMTP_PASS: 'pw' })
    expect((await getTransport({ workspaceId: null })).ok).toBe(true)
    const opts = createTransport.mock.calls[0][0]
    expect(opts).toMatchObject({ port: 465, secure: true, requireTLS: false, auth: { user: 'a@example.com', pass: 'pw' } })
    expect(opts).not.toHaveProperty('tls')
  })

  it.each([
    ['true', 465, true],
    ['false', 587, false],
  ] as const)('SMTP_SECURE=%s 만 있으면 포트는 %i', async (secure, port, expected) => {
    env({ SMTP_HOST: 'smtp.example.com', SMTP_SECURE: secure, SMTP_USER: 'a@example.com', SMTP_PASS: 'pw' })
    expect((await getTransport({ workspaceId: null })).ok).toBe(true)
    expect(createTransport.mock.calls[0][0]).toMatchObject({ port, secure: expected })
  })

  it('SMTP_AUTH=none + 1025 평문(로컬 inbucket 127.0.0.1) — auth 키가 없고, 주소 검사를 받지 않는다', async () => {
    env({ SMTP_HOST: '127.0.0.1', SMTP_PORT: '1025', SMTP_AUTH: 'none', SMTP_FROM_ADDRESS: 'noreply@example.com' })
    expect((await getTransport({ workspaceId: null })).ok).toBe(true)
    const opts = createTransport.mock.calls[0][0]
    expect(opts).not.toHaveProperty('auth')
    expect(opts).toMatchObject({ host: '127.0.0.1', port: 1025, secure: false, requireTLS: false })
    expect(vetMailHost).not.toHaveBeenCalled()
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
  ])('잘못된 설정 %o 은 invalid — 문구에 키 이름이 없고, 키 이름은 로그에만', async (over) => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    env({ SMTP_HOST: 'smtp.example.com', SMTP_USER: 'a@example.com', SMTP_PASS: 'pw', ...over })
    const tx = await getTransport({ workspaceId: null })
    expect(tx).toEqual({ ok: false, error: MISCONFIGURED })
    expect(JSON.stringify(tx)).not.toContain('SMTP_')
    const logged = err.mock.calls.flat().join(' ')
    expect(logged).toMatch(/SMTP_/)
    expect(logged).not.toContain('pw')                      // 비밀번호는 로그에도 넣지 않는다
    expect(createTransport).not.toHaveBeenCalled()
  })

  it('SMTP_FROM_ADDRESS 가 발신 주소를 정한다', async () => {
    env({ SMTP_HOST: 'smtp.example.com', SMTP_USER: 'apikey', SMTP_PASS: 'pw', SMTP_FROM_ADDRESS: 'noreply@example.com' })
    sendMail.mockResolvedValue({ rejected: [] })
    const tx = await getTransport({ workspaceId: null })
    if (!tx.ok) throw new Error('트랜스포트가 만들어져야 한다')
    await tx.send(MSG)
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      from: { name: `${BRAND.productName} 알림`, address: 'noreply@example.com' },
    }))
  })

  it('send 는 발신 표시명을 붙이고 rejected 를 문자열 배열로 돌려준다', async () => {
    env({ SMTP_HOST: 'smtp.example.com', SMTP_PORT: '587', SMTP_USER: 'a@example.com', SMTP_PASS: 'pw', MAIL_FROM_NAME: '테스트 발신' })
    sendMail.mockResolvedValue({ rejected: ['bad@x.com'] })
    const tx = await getTransport({ workspaceId: null })
    if (!tx.ok) throw new Error('트랜스포트가 만들어져야 한다')
    const out = await tx.send({ to: ['a@example.com'], replyTo: 'me@example.com', subject: 'S', html: '<b>H</b>', text: 'T' })
    expect(out).toEqual({ rejected: ['bad@x.com'] })
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      from: { name: '테스트 발신', address: 'a@example.com' },
      to: ['a@example.com'], replyTo: 'me@example.com',
      subject: 'S', html: '<b>H</b>', text: 'T',
    }))
  })

  it('워크스페이스 발신 표시명(fromName)이 MAIL_FROM_NAME 보다 앞선다', async () => {
    env({ ...ENV_OK, MAIL_FROM_NAME: '배포 발신' })
    sendMail.mockResolvedValue({ rejected: [] })
    const tx = await getTransport({ workspaceId: null, fromName: '한빛 발신' })
    if (!tx.ok) throw new Error('트랜스포트가 만들어져야 한다')
    await tx.send(MSG)
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ from: { name: '한빛 발신', address: 'env@example.com' } }))
  })

  it('MAIL_FROM_NAME 이 비면 발신 표시명은 "<제품명> 알림" 이다', async () => {
    env({ SMTP_HOST: 'smtp.example.com', SMTP_PORT: '587', SMTP_USER: 'a@example.com', SMTP_PASS: 'pw' })
    sendMail.mockResolvedValue({ rejected: [] })
    const tx = await getTransport({ workspaceId: null })
    if (!tx.ok) throw new Error('트랜스포트가 만들어져야 한다')
    await tx.send(MSG)
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      from: { name: `${BRAND.productName} 알림`, address: 'a@example.com' },
    }))
  })

  it('rejected 가 없으면 빈 배열을 낸다', async () => {
    env({ SMTP_HOST: 'smtp.example.com', SMTP_PORT: '587', SMTP_USER: 'a@example.com', SMTP_PASS: 'pw' })
    sendMail.mockResolvedValue({})
    const tx = await getTransport({ workspaceId: null })
    if (!tx.ok) throw new Error('트랜스포트가 만들어져야 한다')
    expect(await tx.send(MSG)).toEqual({ rejected: [] })
  })
})

describe('getTransport — 워크스페이스 설정(설계 §2.1 규칙 1–4·§2.2)', () => {
  it('행이 유효하면 그 계정으로 — env 가 있어도 쓰지 않는다. 검사한 IP 로 접속하고 인사·인증서는 원래 호스트', async () => {
    env(ENV_OK)
    loadWorkspaceMailRow.mockResolvedValue({ kind: 'row', row: row() })
    sendMail.mockResolvedValue({ rejected: [] })
    const tx = await getTransport({ workspaceId: WID, fromName: '한빛 발신' })
    if (!tx.ok) throw new Error('트랜스포트가 만들어져야 한다')
    expect(createAdminClient).toHaveBeenCalledTimes(1)
    expect(loadWorkspaceMailRow).toHaveBeenCalledWith(ADMIN, WID)
    expect(vetMailHost).toHaveBeenCalledWith('smtp.example.org')
    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({
      host: IP, port: 587, secure: false, requireTLS: true,
      auth: { user: 'bot@example.org', pass: 'ws-secret' },
      tls: { servername: 'smtp.example.org' },
      connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 10_000,
    }))
    expect(createTransport.mock.calls[0][0]).not.toHaveProperty('name')
    await tx.send(MSG)
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ from: { name: '한빛 발신', address: 'bot@example.org' } }))
  })

  it('Gmail 행 — 465 SSL, 보내는 주소가 비면 계정 주소', async () => {
    loadWorkspaceMailRow.mockResolvedValue({ kind: 'row', row: row({ preset: 'gmail', host: 'smtp.gmail.com', port: 465, secure: true, username: 'team@gmail.com' }) })
    sendMail.mockResolvedValue({ rejected: [] })
    const tx = await getTransport({ workspaceId: WID })
    if (!tx.ok) throw new Error('트랜스포트가 만들어져야 한다')
    expect(createTransport.mock.calls[0][0]).toMatchObject({
      host: IP, port: 465, secure: true, requireTLS: false,
      auth: { user: 'team@gmail.com', pass: 'ws-secret' }, tls: { servername: 'smtp.gmail.com' },
    })
    expect(createTransport.mock.calls[0][0]).not.toHaveProperty('name')
    await tx.send(MSG)
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ from: { name: `${BRAND.productName} 알림`, address: 'team@gmail.com' } }))
  })

  it('행의 보내는 주소(from_address)가 발신 주소를 정한다', async () => {
    loadWorkspaceMailRow.mockResolvedValue({ kind: 'row', row: row({ username: 'apikey', from_address: 'noreply@example.org' }) })
    sendMail.mockResolvedValue({ rejected: [] })
    const tx = await getTransport({ workspaceId: WID, fromName: '한빛' })
    if (!tx.ok) throw new Error('트랜스포트가 만들어져야 한다')
    await tx.send(MSG)
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ from: { name: '한빛', address: 'noreply@example.org' } }))
  })

  it.each([
    ['계정이 공백', { username: '   ' }],
    ['계정·비밀번호 모두 공백(unset 꼴이어도)', { username: ' ', password: ' ' }],
    ['이메일이 아닌 계정 + 보내는 주소 없음', { username: 'apikey' }],
  ] as const)('규칙을 어긴 행(%s)은 env 가 있어도 SMTP_MISCONFIGURED — env 로 내려가지 않는다', async (_label, over) => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    env(ENV_OK)
    loadWorkspaceMailRow.mockResolvedValue({ kind: 'row', row: row(over) })
    expect(await getTransport({ workspaceId: WID })).toEqual({ ok: false, error: MISCONFIGURED })
    expect(createTransport).not.toHaveBeenCalled()
    expect(vetMailHost).not.toHaveBeenCalled()
    const logged = err.mock.calls.flat().join(' ')
    expect(logged).not.toContain('ws-secret')
    expect(logged).not.toContain('env-pw')
    // 워크스페이스 행의 사유는 env 키 이름(SMTP_*)으로 적지 않는다 — 행 판정이라는 것과 사유 종류만
    expect(logged).not.toContain('SMTP_')
    expect(logged).toMatch(/워크스페이스 메일 설정 행.*(unset|invalid)/)
  })

  it('모르는 조회 결과(kind)는 닫는다 — env 로 내려가지 않고 MAIL_SETTINGS_UNAVAILABLE', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    env(ENV_OK)
    loadWorkspaceMailRow.mockResolvedValue({ kind: 'mystery' })
    expect(await getTransport({ workspaceId: WID })).toEqual({ ok: false, error: MAIL_SETTINGS_UNAVAILABLE })
    expect(createTransport).not.toHaveBeenCalled()
  })

  it('보관된 워크스페이스의 행 — 보내지 않고 env 로도 내려가지 않는다(보관 사실은 드러내지 않는 문구)', async () => {
    env(ENV_OK)
    loadWorkspaceMailRow.mockResolvedValue({ kind: 'archived' })
    expect(await getTransport({ workspaceId: WID })).toEqual({ ok: false, error: MAIL_SETTINGS_UNAVAILABLE })
    expect(createTransport).not.toHaveBeenCalled()
  })

  it('행 조회가 실패하면 MAIL_SETTINGS_UNAVAILABLE — 미설정으로 위장하지도, env 로 내려가지도 않는다', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    env(ENV_OK)
    loadWorkspaceMailRow.mockRejectedValue(new Error('workspace_mail_settings 조회 실패'))
    expect(await getTransport({ workspaceId: WID })).toEqual({ ok: false, error: MAIL_SETTINGS_UNAVAILABLE })
    expect(createTransport).not.toHaveBeenCalled()
    expect(err).toHaveBeenCalled()
  })

  it('uuid 가 아닌 워크스페이스 id — adminFor 가 throw 하면 MAIL_SETTINGS_UNAVAILABLE, 클라이언트도 만들지 않는다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    env(ENV_OK)
    expect(await getTransport({ workspaceId: 'ws-1' })).toEqual({ ok: false, error: MAIL_SETTINGS_UNAVAILABLE })
    expect(createAdminClient).not.toHaveBeenCalled()
    expect(loadWorkspaceMailRow).not.toHaveBeenCalled()
    expect(createTransport).not.toHaveBeenCalled()
  })

  it('행이 없으면 env — 주소 검사를 받지 않고 원래 호스트로 접속한다', async () => {
    env(ENV_OK)
    expect((await getTransport({ workspaceId: WID })).ok).toBe(true)
    expect(loadWorkspaceMailRow).toHaveBeenCalledWith(ADMIN, WID)
    expect(vetMailHost).not.toHaveBeenCalled()
    const opts = createTransport.mock.calls[0][0]
    expect(opts).toMatchObject({ host: 'smtp.env.example', auth: { user: 'env@example.com', pass: 'env-pw' } })
    expect(opts).not.toHaveProperty('tls')
    expect(opts).not.toHaveProperty('name')
  })

  it('행이 없고 env 도 없으면 SMTP_NOT_CONFIGURED, env 가 잘못이면 SMTP_MISCONFIGURED', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await getTransport({ workspaceId: WID })).toEqual({ ok: false, error: NOT_CONFIGURED })
    env({ ...ENV_OK, SMTP_PORT: '465', SMTP_SECURE: 'false' })
    expect(await getTransport({ workspaceId: WID })).toEqual({ ok: false, error: MISCONFIGURED })
    expect(createTransport).not.toHaveBeenCalled()
  })

  it('서버 주소가 검사에서 거부되면 발송 경로 문구(MAIL_HOST_UNUSABLE_AT_SEND) — 관리자용 문구가 아니고, 접속하지 않는다', async () => {
    loadWorkspaceMailRow.mockResolvedValue({ kind: 'row', row: row() })
    vetMailHost.mockResolvedValue({ ok: false })
    const tx = await getTransport({ workspaceId: WID })
    expect(tx).toEqual({ ok: false, error: HOST_UNUSABLE_AT_SEND })
    expect(tx).not.toEqual({ ok: false, error: HOST_NOT_ALLOWED })
    expect(createTransport).not.toHaveBeenCalled()
  })

  it('두 거부 문구는 리터럴 상수로 고정된다 — 저장·테스트 발송은 관리자용, 발송은 고칠 사람을 가리킨다', () => {
    expect(MAIL_HOST_NOT_ALLOWED).toBe(HOST_NOT_ALLOWED)
    expect(MAIL_HOST_UNUSABLE_AT_SEND).toBe(HOST_UNUSABLE_AT_SEND)
  })

  it('주소 검사 자체가 던져도 거부로 닫는다', async () => {
    loadWorkspaceMailRow.mockResolvedValue({ kind: 'row', row: row() })
    vetMailHost.mockRejectedValue(Object.assign(new Error('getaddrinfo ENOTFOUND smtp.example.org'), { code: 'ENOTFOUND' }))
    const tx = await getTransport({ workspaceId: WID })
    expect(tx).toEqual({ ok: false, error: HOST_UNUSABLE_AT_SEND })
    expect(JSON.stringify(tx)).not.toContain('ENOTFOUND')
    expect(createTransport).not.toHaveBeenCalled()
  })

  it('캐시하지 않는다 — 저장한 다음 발송부터 새 행을 쓴다', async () => {
    loadWorkspaceMailRow.mockResolvedValueOnce({ kind: 'row', row: row() })
    loadWorkspaceMailRow.mockResolvedValueOnce({ kind: 'row', row: row({ username: 'next@example.org', password: 'next-pw' }) })
    await getTransport({ workspaceId: WID })
    await getTransport({ workspaceId: WID })
    expect(loadWorkspaceMailRow).toHaveBeenCalledTimes(2)
    expect(createTransport.mock.calls[1][0]).toMatchObject({ auth: { user: 'next@example.org', pass: 'next-pw' } })
  })
})

describe('resolveMailStatus — 화면 상태 줄과 발송이 같은 규칙', () => {
  it('워크스페이스 없음: env 가 없으면 none, 유효하면 env·valid, 잘못이면 env·invalid', async () => {
    expect(await resolveMailStatus(null)).toEqual({ source: 'none' })
    env(ENV_OK)
    expect(await resolveMailStatus(null)).toEqual({ source: 'env', valid: true, fromAddress: 'env@example.com' })
    env({ ...ENV_OK, SMTP_PORT: '587', SMTP_SECURE: 'true' })
    expect(await resolveMailStatus(null)).toEqual({ source: 'env', valid: false })
    expect(loadWorkspaceMailRow).not.toHaveBeenCalled()
  })

  it('행이 유효하면 workspace·valid(발신 주소 포함) — 상태 판정은 DNS 를 보지 않고 연결하지도 않는다', async () => {
    env(ENV_OK)
    loadWorkspaceMailRow.mockResolvedValue({ kind: 'row', row: row({ from_address: 'noreply@example.org' }) })
    expect(await resolveMailStatus(WID)).toEqual({ source: 'workspace', valid: true, fromAddress: 'noreply@example.org' })
    expect(vetMailHost).not.toHaveBeenCalled()
    expect(createTransport).not.toHaveBeenCalled()
  })

  it('규칙을 어긴 행은 env 가 유효해도 workspace·invalid', async () => {
    env(ENV_OK)
    loadWorkspaceMailRow.mockResolvedValue({ kind: 'row', row: row({ username: ' ', password: ' ' }) })
    expect(await resolveMailStatus(WID)).toEqual({ source: 'workspace', valid: false })
  })

  it('행이 없으면 env 판정(env 가 없으면 none)', async () => {
    expect(await resolveMailStatus(WID)).toEqual({ source: 'none' })
    env(ENV_OK)
    expect(await resolveMailStatus(WID)).toEqual({ source: 'env', valid: true, fromAddress: 'env@example.com' })
  })

  it('보관·조회 실패·uuid 아닌 id 는 { error } — 미설정으로 위장하지 않는다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    env(ENV_OK)
    loadWorkspaceMailRow.mockResolvedValueOnce({ kind: 'archived' })
    expect(await resolveMailStatus(WID)).toEqual({ error: MAIL_SETTINGS_UNAVAILABLE })
    loadWorkspaceMailRow.mockRejectedValueOnce(new Error('조회 실패'))
    expect(await resolveMailStatus(WID)).toEqual({ error: MAIL_SETTINGS_UNAVAILABLE })
    expect(await resolveMailStatus('ws-1')).toEqual({ error: MAIL_SETTINGS_UNAVAILABLE })
  })
})

describe('statusFromLoad — 이미 읽은 행 조회 결과로 상태 줄(설정 화면이 행을 한 번만 읽는다)', () => {
  it('행이면 그 행만 본다 — env 가 유효해도 workspace 판정, 조회·DNS 를 하지 않는다', () => {
    env(ENV_OK)
    expect(statusFromLoad({ kind: 'row', row: row({ from_address: 'noreply@example.org' }) }))
      .toEqual({ source: 'workspace', valid: true, fromAddress: 'noreply@example.org' })
    expect(statusFromLoad({ kind: 'row', row: row({ username: ' ', password: ' ' }) })).toEqual({ source: 'workspace', valid: false })
    expect(loadWorkspaceMailRow).not.toHaveBeenCalled()
    expect(vetMailHost).not.toHaveBeenCalled()
  })

  it('행이 없으면 env 판정 — 없으면 none, 유효하면 env·valid, 잘못이면 env·invalid', () => {
    expect(statusFromLoad({ kind: 'none' })).toEqual({ source: 'none' })
    env(ENV_OK)
    expect(statusFromLoad({ kind: 'none' })).toEqual({ source: 'env', valid: true, fromAddress: 'env@example.com' })
    env({ ...ENV_OK, SMTP_PORT: '465', SMTP_SECURE: 'false' })
    expect(statusFromLoad({ kind: 'none' })).toEqual({ source: 'env', valid: false })
  })

  it('보관·모르는 결과는 { error } — 미설정으로 위장하지 않는다', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    env(ENV_OK)
    expect(statusFromLoad({ kind: 'archived' })).toEqual({ error: MAIL_SETTINGS_UNAVAILABLE })
    expect(statusFromLoad({ kind: 'mystery' } as unknown as WorkspaceMailLoad)).toEqual({ error: MAIL_SETTINGS_UNAVAILABLE })
  })

  it('resolveMailStatus 와 같은 판정이다 — 같은 행이면 같은 결과', async () => {
    env(ENV_OK)
    for (const load of [{ kind: 'row', row: row() }, { kind: 'row', row: row({ username: 'apikey' }) }, { kind: 'none' }, { kind: 'archived' }] as WorkspaceMailLoad[]) {
      loadWorkspaceMailRow.mockResolvedValueOnce(load)
      expect(await resolveMailStatus(WID)).toEqual(statusFromLoad(load))
    }
  })
})

describe('transportFromSettings — 검증이 끝난 설정으로 만든다(테스트 발송도 이것을 쓴다)', () => {
  const S: SmtpSettings = {
    host: 'smtp.example.org', port: 465, secure: true, requireTLS: false,
    auth: { user: 'bot@example.org', pass: 'pw' }, fromAddress: 'noreply@example.org',
  }

  it('connectTo 가 없으면 host 그대로, name·tls 를 달지 않는다 — DB·DNS 를 보지 않는다', () => {
    expect(transportFromSettings(S).ok).toBe(true)
    const opts = createTransport.mock.calls[0][0]
    expect(opts).toMatchObject({ host: 'smtp.example.org', port: 465, secure: true, requireTLS: false, auth: { user: 'bot@example.org', pass: 'pw' } })
    expect(opts).not.toHaveProperty('tls')
    expect(opts).not.toHaveProperty('name')
    expect(loadWorkspaceMailRow).not.toHaveBeenCalled()
    expect(vetMailHost).not.toHaveBeenCalled()
  })

  it('connectTo 면 host 는 그 IP, tls.servername 은 원래 호스트(재해석·DNS 리바인딩 차단, 인증서는 원래 이름) — name(EHLO)은 달지 않는다', () => {
    transportFromSettings(S, { connectTo: IP })
    const opts = createTransport.mock.calls[0][0]
    expect(opts).toMatchObject({
      host: IP, tls: { servername: 'smtp.example.org' },
      connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 10_000,
    })
    expect(opts).not.toHaveProperty('name')
  })

  it('from 은 { name, address: settings.fromAddress } 로 고정한다', async () => {
    sendMail.mockResolvedValue({ rejected: [] })
    const tx = transportFromSettings(S, { fromName: '한빛 발신', connectTo: IP })
    if (!tx.ok) throw new Error('트랜스포트가 만들어져야 한다')
    await tx.send(MSG)
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ from: { name: '한빛 발신', address: 'noreply@example.org' } }))
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

  it('invalid 사유는 키 이름만 — env 로 받은 포트 값을 사유에 보간하지 않는다', () => {
    const reason = (port: string) => {
      const r = resolveSmtpSettings({ SMTP_HOST: 'smtp.example.com', SMTP_USER: 'a@example.com', SMTP_PASS: 'pw', SMTP_PORT: port, SMTP_SECURE: 'true' })
      if (r.ok) throw new Error('invalid 여야 한다')
      return r.reason
    }
    expect(reason('25')).toBe(reason('587'))
    expect(reason('25')).toContain('SMTP_PORT')
  })

  it('빈 env 는 unset — 사유에 키 이름을 담는다', () => {
    const r = resolveSmtpSettings({})
    expect(r).toMatchObject({ ok: false, kind: 'unset' })
    if (r.ok) throw new Error('unset 이어야 한다')
    expect(r.reason).toContain('SMTP_HOST')
  })
})
