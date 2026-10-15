import { describe, it, expect, vi, beforeEach } from 'vitest'

// DNS 는 목으로 — 실제 해석을 하지 않는다(테스트가 네트워크·리졸버에 기대지 않게)
const h = vi.hoisted(() => ({ lookup: vi.fn() }))
vi.mock('node:dns', () => ({ promises: { lookup: h.lookup }, default: { promises: { lookup: h.lookup } } }))

import {
  WORKSPACE_MAIL_COLUMNS, isForbiddenAddress, loadWorkspaceMailRow, rowToSmtpEnv, vetMailHost,
  type WorkspaceMailRow,
} from '@/lib/mail/workspaceSmtp'
import { resolveSmtpSettings } from '@/lib/mail/transport'

const WID = '00000000-0000-0000-7e57-00000000aa01'

const GMAIL: WorkspaceMailRow = {
  workspace_id: WID, preset: 'gmail', host: 'smtp.gmail.com', port: 465, secure: true,
  username: 'sender@gmail.com', password: 'abcdabcdabcdabcd', from_address: null,
  password_set_by: '00000000-0000-0000-7e57-0000000000a1', password_set_at: '2026-10-15T00:00:00Z',
  updated_by: '00000000-0000-0000-7e57-0000000000a1', updated_at: '2026-10-15T00:00:00Z',
}
const CUSTOM: WorkspaceMailRow = {
  ...GMAIL, preset: 'custom', host: 'mail.acme.test', port: 587, secure: false,
  username: 'relay-user', password: 'pw', from_address: 'noreply@acme.test',
}

type Result = { data: unknown; error: { message: string } | null }
/** from().select().eq().maybeSingle() 만 있는 가짜 service_role 클라이언트 — 부른 인자를 calls 에 남긴다 */
function fakeAdmin(result: Result) {
  const calls: unknown[][] = []
  const admin = {
    from: (t: string) => ({
      select: (c: string) => ({
        eq: (k: string, v: string) => {
          calls.push([t, c, k, v])
          return { maybeSingle: async () => result }
        },
      }),
    }),
  }
  return { admin: admin as unknown as Parameters<typeof loadWorkspaceMailRow>[0], calls }
}

describe('rowToSmtpEnv — 행을 env 꼴로(검증은 resolveSmtpSettings 한 벌)', () => {
  it('Gmail 행: 465·SSL·계정 로그인, 보내는 주소는 비워 계정을 쓴다', () => {
    expect(rowToSmtpEnv(GMAIL)).toEqual({
      SMTP_HOST: 'smtp.gmail.com', SMTP_PORT: '465', SMTP_SECURE: 'true', SMTP_AUTH: '',
      SMTP_USER: 'sender@gmail.com', SMTP_PASS: 'abcdabcdabcdabcd', SMTP_FROM_ADDRESS: '',
    })
    const r = resolveSmtpSettings(rowToSmtpEnv(GMAIL))
    expect(r).toEqual({ ok: true, settings: {
      host: 'smtp.gmail.com', port: 465, secure: true, requireTLS: false,
      auth: { user: 'sender@gmail.com', pass: 'abcdabcdabcdabcd' }, fromAddress: 'sender@gmail.com',
    } })
  })

  it('직접 입력 행: 587 STARTTLS·보내는 주소 그대로 — 계정이 이메일이 아니어도 보내는 주소가 있으면 통과', () => {
    expect(rowToSmtpEnv(CUSTOM)).toEqual({
      SMTP_HOST: 'mail.acme.test', SMTP_PORT: '587', SMTP_SECURE: 'false', SMTP_AUTH: '',
      SMTP_USER: 'relay-user', SMTP_PASS: 'pw', SMTP_FROM_ADDRESS: 'noreply@acme.test',
    })
    const r = resolveSmtpSettings(rowToSmtpEnv(CUSTOM))
    expect(r.ok && r.settings).toMatchObject({ port: 587, secure: false, requireTLS: true, fromAddress: 'noreply@acme.test' })
  })

  it('SMTP_AUTH 는 언제나 빈 값 — 워크스페이스 행에는 무인증 릴레이가 없다', () => {
    expect(rowToSmtpEnv(CUSTOM).SMTP_AUTH).toBe('')
  })

  it('공백뿐인 계정·비밀번호 행(손상)은 ok 가 아니다 — 판정이 workspace·invalid 로 읽을 근거', () => {
    expect(resolveSmtpSettings(rowToSmtpEnv({ ...CUSTOM, username: '  ', password: '  ' })).ok).toBe(false)
    expect(resolveSmtpSettings(rowToSmtpEnv({ ...CUSTOM, password: '   ' })).ok).toBe(false)
  })

  it('결과에 행 밖의 키(MAIL_FROM_NAME 등)를 싣지 않는다', () => {
    expect(Object.keys(rowToSmtpEnv(GMAIL)).sort()).toEqual(
      ['SMTP_AUTH', 'SMTP_FROM_ADDRESS', 'SMTP_HOST', 'SMTP_PASS', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER'])
  })
})

describe('WORKSPACE_MAIL_COLUMNS', () => {
  it('행 형의 필드 전부 — 비밀번호 설정자·시각과 갱신자·시각 포함', () => {
    expect(WORKSPACE_MAIL_COLUMNS.split(', ').sort()).toEqual(Object.keys(GMAIL).sort())
  })
})

describe('loadWorkspaceMailRow — 행 · 없음 · 보관 · 판독 불가', () => {
  it('그 워크스페이스 한 행을 보관 시각 임베드와 함께 읽고, 임베드는 행 밖으로 내지 않는다', async () => {
    const { admin, calls } = fakeAdmin({ data: { ...GMAIL, workspaces: { archived_at: null } }, error: null })
    await expect(loadWorkspaceMailRow(admin, WID)).resolves.toEqual({ kind: 'row', row: GMAIL })
    expect(calls).toEqual([[
      'workspace_mail_settings', `${WORKSPACE_MAIL_COLUMNS}, workspaces!inner(archived_at)`, 'workspace_id', WID,
    ]])
  })

  it('임베드가 배열로 와도 첫 원소로 본다', async () => {
    const { admin } = fakeAdmin({ data: { ...CUSTOM, workspaces: [{ archived_at: null }] }, error: null })
    await expect(loadWorkspaceMailRow(admin, WID)).resolves.toEqual({ kind: 'row', row: CUSTOM })
  })

  it('행이 없으면 none', async () => {
    const { admin } = fakeAdmin({ data: null, error: null })
    await expect(loadWorkspaceMailRow(admin, WID)).resolves.toEqual({ kind: 'none' })
  })

  it('보관된 워크스페이스의 행은 archived — 행을 돌려주지 않는다', async () => {
    const { admin } = fakeAdmin({ data: { ...GMAIL, workspaces: { archived_at: '2026-10-01T00:00:00Z' } }, error: null })
    await expect(loadWorkspaceMailRow(admin, WID)).resolves.toEqual({ kind: 'archived' })
  })

  it('조회 오류는 throw — 미설정(none)으로 위장하지 않는다', async () => {
    const { admin } = fakeAdmin({ data: null, error: { message: 'db down' } })
    await expect(loadWorkspaceMailRow(admin, WID)).rejects.toThrow('db down')
  })

  it.each([
    ['임베드 키 없음', {}],
    ['임베드 null', { workspaces: null }],
    ['빈 배열', { workspaces: [] }],
    ['archived_at 키 없음', { workspaces: {} }],
    ['archived_at 형이 다름', { workspaces: { archived_at: 0 } }],
    ['임베드가 문자열', { workspaces: 'x' }],
  ])('보관 여부를 못 읽으면(%s) throw — 모르면 닫는다', async (_name, embed) => {
    const { admin } = fakeAdmin({ data: { ...GMAIL, ...embed }, error: null })
    await expect(loadWorkspaceMailRow(admin, WID)).rejects.toThrow()
  })

  it('던지는 오류에 비밀번호가 실리지 않는다', async () => {
    const { admin } = fakeAdmin({ data: { ...GMAIL, workspaces: {} }, error: null })
    const err = await loadWorkspaceMailRow(admin, WID).catch((e: unknown) => e)
    expect(String((err as Error).message)).not.toContain(GMAIL.password)
  })
})

describe('isForbiddenAddress — 사설·예약 대역(순수)', () => {
  it.each([
    '0.0.0.0', '0.1.2.3', '127.0.0.1', '127.255.255.254', '10.0.0.1', '10.255.255.255',
    '172.16.0.1', '172.31.255.255', '192.168.0.1', '192.168.255.255', '169.254.169.254',
    '100.64.0.1', '100.127.255.255', '224.0.0.1', '255.255.255.255',
    '::', '::1', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'fe80::1%eth0', 'febf::1', 'ff02::1',
    '::ffff:10.0.0.1', '::ffff:127.0.0.1', '::ffff:169.254.169.254', '::ffff:a00:1', '::ffff:7f00:1',
    '::10.0.0.1', '0:0:0:0:0:ffff:192.168.1.1',
    // IPv4 를 품은 다른 꼴 — NAT64 잘 알려진 접두(64:ff9b::/96)·6to4(2002::/16, 16~47비트)·IPv4 변환(::ffff:0:a.b.c.d)
    '64:ff9b::10.0.0.1', '64:ff9b::7f00:1', '64:ff9b::a9fe:a9fe', '64:ff9b:0:0:0:0:c0a8:101',
    '2002:a00:1::', '2002:7f00:1::1', '2002:a9fe:a9fe:1:2:3:4:5', '2002:c0a8:101::',
    '::ffff:0:10.0.0.1', '::ffff:0:7f00:1', '::ffff:0:169.254.169.254',
  ])('%s 는 거부', (ip) => {
    expect(isForbiddenAddress(ip)).toBe(true)
  })

  it.each([
    '8.8.8.8', '1.1.1.1', '74.125.140.108', '172.15.255.255', '172.32.0.1', '192.167.255.255', '192.169.0.1',
    '100.63.255.255', '100.128.0.1', '169.253.255.255', '11.0.0.1', '126.255.255.255', '128.0.0.1', '223.255.255.255',
    '2001:4860:4860::8888', '2a00:1450:400c:c06::6c', 'fbff::1', '::ffff:8.8.8.8', '::ffff:808:808',
    '64:ff9b::8.8.8.8', '64:ff9b::808:808', '2002:808:808::1', '::ffff:0:8.8.8.8',
  ])('%s 는 통과(공인)', (ip) => {
    expect(isForbiddenAddress(ip)).toBe(false)
  })

  it.each(['', 'smtp.gmail.com', '1.2.3', '256.0.0.1', '::ffff:999.0.0.1', 'gggg::1', '1:2:3:4:5:6:7:8:9'])(
    '형태가 아닌 값(%j)은 거부 — fail-closed', (ip) => {
      expect(isForbiddenAddress(ip)).toBe(true)
    })
})

describe('vetMailHost — 발송 직전 DNS 검사', () => {
  beforeEach(() => { h.lookup.mockReset() })

  it('공인 주소로만 풀리면 통과하고 첫 주소를 연결 대상으로 돌려준다 — all·verbatim 으로 묻는다', async () => {
    h.lookup.mockResolvedValue([{ address: '142.250.4.108', family: 4 }, { address: '2404:6800:4008:c00::6c', family: 6 }])
    await expect(vetMailHost('smtp.gmail.com')).resolves.toEqual({ ok: true, address: '142.250.4.108' })
    expect(h.lookup).toHaveBeenCalledWith('smtp.gmail.com', { all: true, verbatim: true })
  })

  it('IPv6 가 먼저 와도 IPv4 를 연결 대상으로 고른다(Vercel 함수는 IPv6 로 나가지 못하는 경우가 많고, 고정 IP 접속은 nodemailer 의 대체 시도를 건너뛴다)', async () => {
    h.lookup.mockResolvedValue([{ address: '2404:6800:4008:c00::6c', family: 6 }, { address: '142.250.4.108', family: 4 }])
    await expect(vetMailHost('smtp.gmail.com')).resolves.toEqual({ ok: true, address: '142.250.4.108' })
  })

  it('하나라도 사설 대역이면 거부(공인 주소가 섞여 있어도)', async () => {
    h.lookup.mockResolvedValue([{ address: '142.250.4.108', family: 4 }, { address: '10.0.0.5', family: 4 }])
    await expect(vetMailHost('mixed.acme.test')).resolves.toEqual({ ok: false })
  })

  it.each([
    ['루프백', [{ address: '127.0.0.1', family: 4 }]],
    ['메타데이터(링크 로컬)', [{ address: '169.254.169.254', family: 4 }]],
    ['IPv6 루프백', [{ address: '::1', family: 6 }]],
    ['매핑된 사설 IPv4', [{ address: '::ffff:192.168.0.10', family: 6 }]],
  ])('%s 로 풀리면 거부', async (_name, found) => {
    h.lookup.mockResolvedValue(found)
    await expect(vetMailHost('internal.acme.test')).resolves.toEqual({ ok: false })
  })

  it('저장 때 통과한 이름(smtp.localhost)도 루프백으로 풀리면 여기서 거부 — 이름이 아니라 해석된 주소로 본다', async () => {
    h.lookup.mockResolvedValue([{ address: '::1', family: 6 }, { address: '127.0.0.1', family: 4 }])
    await expect(vetMailHost('smtp.localhost')).resolves.toEqual({ ok: false })
  })

  it('결과가 비면 거부', async () => {
    h.lookup.mockResolvedValue([])
    await expect(vetMailHost('empty.acme.test')).resolves.toEqual({ ok: false })
  })

  it('해석 오류는 거부 — 결과에 원문을 싣지 않고 로그엔 코드만', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.lookup.mockRejectedValue(Object.assign(new Error('getaddrinfo ENOTFOUND nope.acme.test'), { code: 'ENOTFOUND' }))
    const r = await vetMailHost('nope.acme.test')
    expect(r).toEqual({ ok: false })
    expect(err).toHaveBeenCalledWith(expect.any(String), 'ENOTFOUND')
    err.mockRestore()
  })

  it('해석이 5초 안에 끝나지 않으면 거부 — 결과에 리졸버 문구를 싣지 않는다', async () => {
    vi.useFakeTimers()
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      h.lookup.mockReturnValue(new Promise(() => {}))   // 끝나지 않는 해석
      let settled: unknown = 'pending'
      void vetMailHost('slow.acme.test').then((r) => { settled = r })
      await vi.advanceTimersByTimeAsync(4_999)
      expect(settled).toBe('pending')
      await vi.advanceTimersByTimeAsync(1)
      expect(settled).toEqual({ ok: false })
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      err.mockRestore()
      vi.useRealTimers()
    }
  })

  it('제때 끝난 해석은 타이머를 남기지 않는다(프로세스를 붙잡지 않는다)', async () => {
    vi.useFakeTimers()
    try {
      h.lookup.mockResolvedValue([{ address: '142.250.4.108', family: 4 }])
      await expect(vetMailHost('smtp.gmail.com')).resolves.toEqual({ ok: true, address: '142.250.4.108' })
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('해석 타이머는 unref — 대기 중에도 이벤트 루프를 붙잡지 않는다', async () => {
    const unref = vi.fn()
    const spy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void) => {
      void fn
      return { unref } as unknown as ReturnType<typeof setTimeout>
    }) as unknown as typeof setTimeout)
    try {
      h.lookup.mockResolvedValue([{ address: '142.250.4.108', family: 4 }])
      await expect(vetMailHost('smtp.gmail.com')).resolves.toEqual({ ok: true, address: '142.250.4.108' })
      expect(unref).toHaveBeenCalledTimes(1)
    } finally {
      spy.mockRestore()
    }
  })

  it('빈 호스트는 해석하지 않고 거부', async () => {
    await expect(vetMailHost('')).resolves.toEqual({ ok: false })
    expect(h.lookup).not.toHaveBeenCalled()
  })
})
