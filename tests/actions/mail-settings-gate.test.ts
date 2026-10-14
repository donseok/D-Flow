import { describe, it, expect, vi, beforeEach } from 'vitest'

// 가드 · adminFor · 세션 · 메일 설정 행/DNS · 트랜스포트 · 브랜딩 모킹(tests/actions/project-invites-gate.test.ts 관례).
// vi.mock 팩토리는 최상단으로 호이스팅되므로 스파이는 vi.hoisted 로 먼저 만든다.
const h = vi.hoisted(() => {
  const send = vi.fn()
  return {
    requireWorkspaceAdmin: vi.fn(),
    adminFor: vi.fn(),
    getSession: vi.fn(),
    loadWorkspaceMailRow: vi.fn(),
    vetMailHost: vi.fn(),
    resolveMailStatus: vi.fn(),
    transportFromSettings: vi.fn<(...a: unknown[]) => { ok: true; send: typeof send }>(() => ({ ok: true as const, send })),
    send,
    loadDisplayBranding: vi.fn<(...a: unknown[]) => Promise<{ productName: string; mailFromName: string }>>(async () => ({ productName: 'D-Flow', mailFromName: '우리 팀 메일' })),
  }
})
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/authz', () => ({ requireWorkspaceAdmin: h.requireWorkspaceAdmin }))
vi.mock('@/lib/auth', () => ({ getSession: h.getSession }))
vi.mock('@/lib/supabase/adminFor', () => ({ adminFor: h.adminFor }))
// 행 매핑(rowToSmtpEnv)은 진짜 — 행 조회·DNS 만 목
vi.mock('@/lib/mail/workspaceSmtp', async (orig) => ({
  ...(await orig<typeof import('@/lib/mail/workspaceSmtp')>()),
  loadWorkspaceMailRow: h.loadWorkspaceMailRow,
  vetMailHost: h.vetMailHost,
}))
// 검증(resolveSmtpSettings)·문구 상수는 진짜 — 상태 판정과 nodemailer 구성만 목
vi.mock('@/lib/mail/transport', async (orig) => ({
  ...(await orig<typeof import('@/lib/mail/transport')>()),
  resolveMailStatus: h.resolveMailStatus,
  transportFromSettings: h.transportFromSettings,
}))
vi.mock('@/lib/settings/displayBranding', () => ({ loadDisplayBranding: h.loadDisplayBranding }))

import { revalidatePath } from 'next/cache'
import {
  getWorkspaceMailSettings, saveWorkspaceMailSettings, deleteWorkspaceMailSettings, sendWorkspaceTestMail,
} from '@/app/actions/mailSettings'
import { reasonKey, type MailSettingsInput } from '@/lib/mail/settingsInput'
import type { WorkspaceMailRow } from '@/lib/mail/workspaceSmtp'
import { MAIL_HOST_NOT_ALLOWED, MAIL_SETTINGS_UNAVAILABLE } from '@/lib/mail/transport'
import { smtpErrorMessage } from '@/lib/mail/errors'
import { serverKoTranslate } from '@/lib/i18n/serverDict'
import { workspaceAdminVerdict, type Actor } from '@/lib/domain/authz'
import { ERR_DENIED, ERR_MISSING } from '@/lib/authz/errors'
import { makeActor, WS } from '../fixtures/actor'

const ADMIN = makeActor({ userId: 'u-admin', workspaceRoles: new Map([[WS, 'admin']]) })
const MEMBER = makeActor({ userId: 'u-member' })   // WS 의 member — 워크스페이스 관리자 아님
const PASSWORD_REQUIRED = serverKoTranslate(reasonKey('password_required'))
const ME = 'me@acme.com'

/** 가드를 이 액터의 순수 판정(workspaceAdminVerdict)에 위임한다 — 실제 가드와 같은 404/403 구분 */
function signedInAs(a: Actor) {
  h.requireWorkspaceAdmin.mockImplementation(async (wid: string | null) => {
    const v = workspaceAdminVerdict(a, wid)
    return v === 'ok' ? { ok: true, actor: a } : { ok: false, error: v === 'missing' ? ERR_MISSING : ERR_DENIED }
  })
}

type QueryResult = { data: unknown; error: { code?: string; message: string; details?: string } | null }
interface Chain {
  select: (...a: unknown[]) => Chain
  eq: (...a: unknown[]) => Chain
  maybeSingle: () => Promise<QueryResult>
  then: (res: (v: QueryResult) => unknown, rej?: (e: unknown) => unknown) => Promise<unknown>
}
/** PostgREST 빌더 흉내 — 체이닝은 자신을, await 는 결과를. 부른 메서드·인자를 calls 에 쌓는다 */
function chainOf(result: QueryResult, calls: unknown[][]): Chain {
  const chain: Chain = {
    select: (...a) => { calls.push(['select', ...a]); return chain },
    eq: (...a) => { calls.push(['eq', ...a]); return chain },
    maybeSingle: async () => result,
    then: (res, rej) => Promise.resolve(result).then(res, rej),
  }
  return chain
}

/** 액션이 만지는 세 표만 아는 가짜 service_role 클라이언트 */
function makeAdmin(o: { profile?: QueryResult; member?: QueryResult; write?: QueryResult; upsert?: QueryResult; setterFails?: 'reject' | 'throw' } = {}) {
  const calls = { upsert: [] as unknown[][], update: [] as unknown[][], delete: [] as unknown[][], profiles: [] as unknown[][], members: [] as unknown[][] }
  const upsert = vi.fn<(...a: unknown[]) => Chain>(() => chainOf(o.upsert ?? { data: null, error: null }, calls.upsert))
  const update = vi.fn<(...a: unknown[]) => Chain>(() => chainOf(o.write ?? { data: [{ workspace_id: WS }], error: null }, calls.update))
  const del = vi.fn(() => chainOf(o.write ?? { data: [{ workspace_id: WS }], error: null }, calls.delete))
  const from = vi.fn((table: string) => {
    if (table === 'workspace_mail_settings') return { upsert, update, delete: del }
    // 설정자 조회가 { error } 대신 reject(fetch 실패 등)하거나 동기 throw 하는 경우
    if ((table === 'profiles' || table === 'workspace_members') && o.setterFails === 'throw') throw new Error('from 동기 실패')
    if ((table === 'profiles' || table === 'workspace_members') && o.setterFails === 'reject') {
      const c = chainOf({ data: null, error: null }, [])
      c.maybeSingle = () => Promise.reject(new Error('fetch failed'))   // eq 가 돌려주는 바로 그 객체를 바꾼다
      return c
    }
    if (table === 'profiles') return chainOf(o.profile ?? { data: { display_name: '김설정' }, error: null }, calls.profiles)
    if (table === 'workspace_members') return chainOf(o.member ?? { data: { role: 'admin' }, error: null }, calls.members)
    throw new Error('예상치 못한 표 접근: ' + table)
  })
  const client = { from }
  h.adminFor.mockImplementation((s: { workspaceId: string }) => ({ ...s, admin: client }))
  return { client, from, upsert, update, del, calls }
}

const storedRow = (over: Partial<WorkspaceMailRow> = {}): WorkspaceMailRow => ({
  workspace_id: WS, preset: 'custom', host: 'smtp.acme.com', port: 587, secure: false,
  username: 'mailer@acme.com', password: 'stored-secret', from_address: null,
  password_set_by: 'u-setter', password_set_at: '2026-10-01T00:00:00.000Z',
  updated_by: 'u-setter', updated_at: '2026-10-01T00:00:00.000Z', ...over,
})
const CUSTOM: MailSettingsInput = { preset: 'custom', host: 'smtp.acme.com', port: 587, secure: false, username: 'mailer@acme.com', password: 'new-secret' }
const GMAIL: MailSettingsInput = { preset: 'gmail', address: 'sender@gmail.com', password: 'abcd efgh ijkl mnop' }

beforeEach(() => {
  for (const f of [h.requireWorkspaceAdmin, h.adminFor, h.getSession, h.loadWorkspaceMailRow, h.vetMailHost, h.resolveMailStatus, h.send]) f.mockReset()
  h.transportFromSettings.mockClear()
  h.loadDisplayBranding.mockClear()
  vi.mocked(revalidatePath).mockClear()
  signedInAs(ADMIN)
  h.getSession.mockResolvedValue({ id: 'u-admin', email: ME, user_metadata: {} })
  h.vetMailHost.mockResolvedValue({ ok: true, address: '203.0.113.10' })
  h.resolveMailStatus.mockResolvedValue({ source: 'workspace', valid: true, fromAddress: 'mailer@acme.com' })
  h.loadWorkspaceMailRow.mockResolvedValue({ kind: 'none' })
  h.send.mockResolvedValue({ rejected: [] })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('메일 설정 액션 — 가드와 범위', () => {
  it('워크스페이스 관리자가 아니면 네 액션 모두 거부 — adminFor·세션·DNS·트랜스포트 미도달', async () => {
    signedInAs(MEMBER)
    const results = await Promise.all([
      getWorkspaceMailSettings(WS), saveWorkspaceMailSettings(WS, CUSTOM),
      deleteWorkspaceMailSettings(WS), sendWorkspaceTestMail(WS, CUSTOM),
    ])
    for (const r of results) expect(r).toEqual({ ok: false, error: ERR_DENIED })
    expect(h.adminFor).not.toHaveBeenCalled()
    expect(h.getSession).not.toHaveBeenCalled()
    expect(h.vetMailHost).not.toHaveBeenCalled()
    expect(h.transportFromSettings).not.toHaveBeenCalled()
  })

  it('워크스페이스 id 형식이 아니면 가드 앞에서 거부한다(SAFE_ID_RE)', async () => {
    const bad = serverKoTranslate('err.invalidWorkspace')
    expect(await getWorkspaceMailSettings('a/b')).toEqual({ ok: false, error: bad })
    expect(await deleteWorkspaceMailSettings(42 as unknown as string)).toEqual({ ok: false, error: bad })
    expect(h.requireWorkspaceAdmin).not.toHaveBeenCalled()
    expect(h.adminFor).not.toHaveBeenCalled()
  })

  it('adminFor 가 throw 하면(uuid 아님) 던지지 않고 조회 실패 문구로 돌려준다', async () => {
    h.adminFor.mockImplementation(() => { throw new Error('adminFor: 스코프 id 가 올바르지 않다') })
    expect(await getWorkspaceMailSettings(WS)).toEqual({ ok: false, error: MAIL_SETTINGS_UNAVAILABLE })
    expect(await saveWorkspaceMailSettings(WS, CUSTOM)).toEqual({ ok: false, error: MAIL_SETTINGS_UNAVAILABLE })
    expect(await deleteWorkspaceMailSettings(WS)).toEqual({ ok: false, error: MAIL_SETTINGS_UNAVAILABLE })
    expect(await sendWorkspaceTestMail(WS, CUSTOM)).toEqual({ ok: false, error: MAIL_SETTINGS_UNAVAILABLE })
  })

  it('입력이 형식부터 틀리면 adminFor 를 만들지 않는다(가드 → 검증 → 범위 클라이언트)', async () => {
    expect((await saveWorkspaceMailSettings(WS, {} as MailSettingsInput)).ok).toBe(false)
    expect((await sendWorkspaceTestMail(WS, {} as MailSettingsInput)).ok).toBe(false)
    expect(h.adminFor).not.toHaveBeenCalled()
    expect(h.transportFromSettings).not.toHaveBeenCalled()
  })
})
describe('getWorkspaceMailSettings — 보기·상태·비밀번호 설정자', () => {
  it('저장된 행이 없으면 settings null · 설정자 세 칸 null, 상태는 resolveMailStatus 그대로', async () => {
    makeAdmin()
    h.resolveMailStatus.mockResolvedValue({ source: 'none' })
    expect(await getWorkspaceMailSettings(WS)).toEqual({
      ok: true, settings: null, status: { source: 'none' }, passwordSetBy: null, passwordSetAt: null, passwordSetterIsAdmin: null,
    })
    expect(h.resolveMailStatus).toHaveBeenCalledWith(WS)
    expect(h.adminFor).toHaveBeenCalledWith({ workspaceId: WS })
  })

  it('행이 있으면 비밀번호를 뺀 보기 + 설정자 이름·시각·관리자 여부 — 응답 어디에도 비밀번호가 없다', async () => {
    const a = makeAdmin()
    h.loadWorkspaceMailRow.mockResolvedValue({ kind: 'row', row: storedRow({ from_address: 'noreply@acme.com' }) })
    const r = await getWorkspaceMailSettings(WS)
    expect(r).toEqual({
      ok: true,
      settings: { preset: 'custom', host: 'smtp.acme.com', port: 587, secure: false, username: 'mailer@acme.com', fromAddress: 'noreply@acme.com', hasPassword: true },
      status: { source: 'workspace', valid: true, fromAddress: 'mailer@acme.com' },
      passwordSetBy: '김설정', passwordSetAt: '2026-10-01T00:00:00.000Z', passwordSetterIsAdmin: true,
    })
    expect(JSON.stringify(r)).not.toContain('stored-secret')
    expect(h.loadWorkspaceMailRow).toHaveBeenCalledWith(a.client, WS)
    // 관리자 여부는 이 워크스페이스의 그 사람 소속 행으로
    expect(a.calls.members).toContainEqual(['eq', 'workspace_id', WS])
    expect(a.calls.members).toContainEqual(['eq', 'user_id', 'u-setter'])
  })

  it('설정자가 더 이상 관리자가 아니면 false, 소속이 없어도 false, 조회 실패면 unknown', async () => {
    h.loadWorkspaceMailRow.mockResolvedValue({ kind: 'row', row: storedRow() })
    makeAdmin({ member: { data: { role: 'member' }, error: null } })
    expect(await getWorkspaceMailSettings(WS)).toMatchObject({ ok: true, passwordSetterIsAdmin: false })
    makeAdmin({ member: { data: null, error: null } })
    expect(await getWorkspaceMailSettings(WS)).toMatchObject({ ok: true, passwordSetterIsAdmin: false })
    makeAdmin({ member: { data: null, error: { message: 'boom' } } })
    expect(await getWorkspaceMailSettings(WS)).toMatchObject({ ok: true, passwordSetterIsAdmin: 'unknown' })
  })

  it('설정자 조회가 { error } 대신 reject·throw 해도 던지지 않는다 — 이름은 확인 불가, 관리자 여부는 unknown', async () => {
    h.loadWorkspaceMailRow.mockResolvedValue({ kind: 'row', row: storedRow() })
    for (const setterFails of ['reject', 'throw'] as const) {
      makeAdmin({ setterFails })
      expect(await getWorkspaceMailSettings(WS)).toMatchObject({
        ok: true,
        settings: { host: 'smtp.acme.com', hasPassword: true },
        passwordSetBy: serverKoTranslate('srv.mailSettings.setterUnavailable'),
        passwordSetAt: '2026-10-01T00:00:00.000Z',
        passwordSetterIsAdmin: 'unknown',
      })
    }
  })

  it('설정자 계정이 지워졌으면(password_set_by null) 삭제된 계정·false, 이름 조회 실패는 확인 불가 문구', async () => {
    h.loadWorkspaceMailRow.mockResolvedValue({ kind: 'row', row: storedRow({ password_set_by: null }) })
    makeAdmin()
    expect(await getWorkspaceMailSettings(WS)).toMatchObject({
      ok: true, passwordSetBy: serverKoTranslate('srv.mailSettings.setterDeleted'), passwordSetterIsAdmin: false,
    })
    h.loadWorkspaceMailRow.mockResolvedValue({ kind: 'row', row: storedRow() })
    makeAdmin({ profile: { data: null, error: { message: 'boom' } } })
    expect(await getWorkspaceMailSettings(WS)).toMatchObject({ ok: true, passwordSetBy: serverKoTranslate('srv.mailSettings.setterUnavailable') })
  })

  it('행 조회 실패·보관 응답·상태 판정 실패는 조회 실패 — 미설정으로 위장하지 않는다', async () => {
    makeAdmin()
    h.loadWorkspaceMailRow.mockRejectedValue(new Error('db down'))
    expect(await getWorkspaceMailSettings(WS)).toEqual({ ok: false, error: MAIL_SETTINGS_UNAVAILABLE })
    h.loadWorkspaceMailRow.mockResolvedValue({ kind: 'archived' })
    expect(await getWorkspaceMailSettings(WS)).toEqual({ ok: false, error: MAIL_SETTINGS_UNAVAILABLE })
    h.loadWorkspaceMailRow.mockResolvedValue({ kind: 'none' })
    h.resolveMailStatus.mockResolvedValue({ error: MAIL_SETTINGS_UNAVAILABLE })
    expect(await getWorkspaceMailSettings(WS)).toEqual({ ok: false, error: MAIL_SETTINGS_UNAVAILABLE })
  })
})

describe('saveWorkspaceMailSettings — 새 비밀번호·유지·재사용 거부', () => {
  it('Gmail 새 비밀번호 — 고정 서버값, 공백 지운 비밀번호, 설정자·설정 시각·수정자를 이 관리자로 upsert', async () => {
    const a = makeAdmin()
    expect(await saveWorkspaceMailSettings(WS, GMAIL)).toEqual({ ok: true })
    expect(a.upsert).toHaveBeenCalledTimes(1)
    const [payload, opts] = a.upsert.mock.calls[0] as [Record<string, unknown>, unknown]
    expect(payload).toMatchObject({
      workspace_id: WS, preset: 'gmail', host: 'smtp.gmail.com', port: 465, secure: true,
      username: 'sender@gmail.com', password: 'abcdefghijklmnop', from_address: null,
      password_set_by: 'u-admin', updated_by: 'u-admin',
    })
    expect(typeof payload.password_set_at).toBe('string')
    expect(payload.password_set_at).toBe(payload.updated_at)
    expect(opts).toEqual({ onConflict: 'workspace_id' })
    expect(h.loadWorkspaceMailRow).not.toHaveBeenCalled()   // 새 비밀번호면 저장값을 읽을 필요가 없다
    expect(revalidatePath).toHaveBeenCalledWith('/w/[slug]/settings', 'page')
  })

  it('비밀번호 빈칸 + 같은 host·username(대소문자·끝 점만 다름) — 비밀번호·설정자 칸을 건드리지 않는 update', async () => {
    const a = makeAdmin()
    h.loadWorkspaceMailRow.mockResolvedValue({ kind: 'row', row: storedRow() })
    const r = await saveWorkspaceMailSettings(WS, { ...CUSTOM, host: 'SMTP.Acme.com.', username: ' Mailer@Acme.com ', password: '' })
    expect(r).toEqual({ ok: true })
    expect(a.upsert).not.toHaveBeenCalled()
    expect(a.update).toHaveBeenCalledTimes(1)
    const payload = a.update.mock.calls[0]![0] as Record<string, unknown>
    expect(payload).not.toHaveProperty('password')
    expect(payload).not.toHaveProperty('password_set_by')
    expect(payload).not.toHaveProperty('password_set_at')
    expect(payload).toMatchObject({ host: 'smtp.acme.com', updated_by: 'u-admin' })
    // 읽은 뒤 다른 관리자가 서버·계정을 바꿨으면 0행이 되게 저장값으로 조건을 건다
    expect(a.calls.update).toContainEqual(['eq', 'workspace_id', WS])
    expect(a.calls.update).toContainEqual(['eq', 'host', 'smtp.acme.com'])
    expect(a.calls.update).toContainEqual(['eq', 'username', 'mailer@acme.com'])
    expect(a.calls.update).toContainEqual(['select', 'workspace_id'])
  })

  it('유지 저장이 0행이면(그 사이 바뀜) 비밀번호를 다시 입력하게 한다', async () => {
    makeAdmin({ write: { data: [], error: null } })
    h.loadWorkspaceMailRow.mockResolvedValue({ kind: 'row', row: storedRow() })
    expect(await saveWorkspaceMailSettings(WS, { ...CUSTOM, password: '' })).toEqual({ ok: false, error: PASSWORD_REQUIRED })
  })

  it('재사용 거부 — 저장 행 없음 / 직접 입력→Gmail 같은 주소 / Gmail→직접 입력 다른 host. 아무것도 쓰지 않는다', async () => {
    const a = makeAdmin()
    expect(await saveWorkspaceMailSettings(WS, { ...CUSTOM, password: '' })).toEqual({ ok: false, error: PASSWORD_REQUIRED })

    h.loadWorkspaceMailRow.mockResolvedValue({ kind: 'row', row: storedRow({ username: 'sender@gmail.com' }) })
    expect(await saveWorkspaceMailSettings(WS, { preset: 'gmail', address: 'sender@gmail.com', password: '' }))
      .toEqual({ ok: false, error: PASSWORD_REQUIRED })

    h.loadWorkspaceMailRow.mockResolvedValue({ kind: 'row', row: storedRow({ preset: 'gmail', host: 'smtp.gmail.com', port: 465, secure: true, username: 'sender@gmail.com' }) })
    expect(await saveWorkspaceMailSettings(WS, { ...CUSTOM, username: 'sender@gmail.com', password: '' }))
      .toEqual({ ok: false, error: PASSWORD_REQUIRED })

    expect(a.upsert).not.toHaveBeenCalled()
    expect(a.update).not.toHaveBeenCalled()
  })

  it('입력 검증 실패는 사유 문구, 저장 실패는 고정 문구(DB 원문을 싣지 않는다)', async () => {
    makeAdmin({ upsert: { data: null, error: { code: '23514', message: 'violates check constraint' } } })
    expect(await saveWorkspaceMailSettings(WS, { ...CUSTOM, port: 8025 })).toEqual({ ok: false, error: serverKoTranslate(reasonKey('port_invalid')) })
    const r = await saveWorkspaceMailSettings(WS, CUSTOM)
    expect(r).toEqual({ ok: false, error: serverKoTranslate('srv.mailSettings.saveFailed') })
    expect(JSON.stringify(r)).not.toContain('constraint')
  })
  it('검사 제약 위반(23514)은 upsert·유지 update 모두 던지지 않고 저장 실패 문구 — 로그에도 details(행 값·비밀번호)를 싣지 않는다', async () => {
    const err = {
      code: '23514', message: 'new row violates check constraint "workspace_mail_settings_login"',
      details: 'Failing row contains (ws-1, custom, smtp.acme.com, 587, f, mailer@acme.com, new-secret, stored-secret)',
    }
    makeAdmin({ upsert: { data: null, error: err } })
    const r1 = await saveWorkspaceMailSettings(WS, CUSTOM)
    expect(r1).toEqual({ ok: false, error: serverKoTranslate('srv.mailSettings.saveFailed') })

    makeAdmin({ write: { data: null, error: err } })
    h.loadWorkspaceMailRow.mockResolvedValue({ kind: 'row', row: storedRow() })
    const r2 = await saveWorkspaceMailSettings(WS, { ...CUSTOM, password: '' })
    expect(r2).toEqual({ ok: false, error: serverKoTranslate('srv.mailSettings.saveFailed') })

    const logged = JSON.stringify(vi.mocked(console.error).mock.calls)
    expect(logged).not.toContain('new-secret')
    expect(logged).not.toContain('stored-secret')
    expect(JSON.stringify([r1, r2])).not.toContain('constraint')
  })

  it('재사용 저장값 조회가 실패하면 쓰지 않고 조회 실패 문구 — 비밀번호 필요로 위장하지 않는다', async () => {
    const a = makeAdmin()
    h.loadWorkspaceMailRow.mockRejectedValue(new Error('db down'))
    expect(await saveWorkspaceMailSettings(WS, { ...CUSTOM, password: '' })).toEqual({ ok: false, error: MAIL_SETTINGS_UNAVAILABLE })
    expect(a.upsert).not.toHaveBeenCalled()
    expect(a.update).not.toHaveBeenCalled()
  })
})

describe('deleteWorkspaceMailSettings', () => {
  it('그 워크스페이스 행만 지우고 영향 행으로 결과를 정한다 — 0행이면 지울 설정이 없다', async () => {
    const a = makeAdmin()
    expect(await deleteWorkspaceMailSettings(WS)).toEqual({ ok: true })
    expect(a.calls.delete).toEqual([['eq', 'workspace_id', WS], ['select', 'workspace_id']])
    expect(revalidatePath).toHaveBeenCalledWith('/w/[slug]/settings', 'page')

    makeAdmin({ write: { data: [], error: null } })
    expect(await deleteWorkspaceMailSettings(WS)).toEqual({ ok: false, error: serverKoTranslate('srv.mailSettings.nothingToDelete') })
    makeAdmin({ write: { data: null, error: { message: 'boom' } } })
    expect(await deleteWorkspaceMailSettings(WS)).toEqual({ ok: false, error: serverKoTranslate('srv.mailSettings.deleteFailed') })
  })
})

describe('sendWorkspaceTestMail — 저장 전 값으로 본인에게만', () => {
  it('수신자는 로그인한 본인 — 입력에 다른 주소가 섞여도 무시. 저장 전 폼 값·워크스페이스 발신 표시명·검사한 IP 로 보낸다', async () => {
    const a = makeAdmin()
    const input = { ...CUSTOM, host: 'smtp.new-acme.com', to: 'evil@example.com' } as MailSettingsInput
    const r = await sendWorkspaceTestMail(WS, input)
    expect(r).toEqual({ ok: true, to: ME })
    expect(h.vetMailHost).toHaveBeenCalledWith('smtp.new-acme.com')
    expect(h.transportFromSettings).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'smtp.new-acme.com', port: 587, secure: false, auth: { user: 'mailer@acme.com', pass: 'new-secret' }, fromAddress: 'mailer@acme.com' }),
      { fromName: '우리 팀 메일', connectTo: '203.0.113.10' },
    )
    expect(h.loadDisplayBranding).toHaveBeenCalledWith(WS, a.client)
    expect(h.send).toHaveBeenCalledTimes(1)
    expect(h.send.mock.calls[0]![0]).toMatchObject({ to: [ME], replyTo: null })
    expect(h.loadWorkspaceMailRow).not.toHaveBeenCalled()   // 새 비밀번호 — 저장값을 읽지 않는다
    expect(a.upsert).not.toHaveBeenCalled()                  // 테스트 발송은 저장하지 않는다
    expect(JSON.stringify(r)).not.toContain('new-secret')
  })

  it('비밀번호 빈칸이면 같은 재사용 규칙 — 같은 host·username 이면 저장 비밀번호로 보내고, 아니면 거부', async () => {
    makeAdmin()
    h.loadWorkspaceMailRow.mockResolvedValue({ kind: 'row', row: storedRow() })
    expect(await sendWorkspaceTestMail(WS, { ...CUSTOM, password: '' })).toEqual({ ok: true, to: ME })
    expect(h.transportFromSettings.mock.calls[0]![0]).toMatchObject({ auth: { user: 'mailer@acme.com', pass: 'stored-secret' } })

    h.transportFromSettings.mockClear()
    expect(await sendWorkspaceTestMail(WS, { ...CUSTOM, host: 'smtp.other.com', password: '' })).toEqual({ ok: false, error: PASSWORD_REQUIRED })
    expect(h.transportFromSettings).not.toHaveBeenCalled()
  })

  it('비밀번호 빈칸인데 저장 행이 없으면 비밀번호 필요 — DNS·트랜스포트 미도달', async () => {
    makeAdmin()
    expect(await sendWorkspaceTestMail(WS, { ...CUSTOM, password: '' })).toEqual({ ok: false, error: PASSWORD_REQUIRED })
    expect(await sendWorkspaceTestMail(WS, { ...GMAIL, password: '   ' })).toEqual({ ok: false, error: PASSWORD_REQUIRED })
    expect(h.vetMailHost).not.toHaveBeenCalled()
    expect(h.transportFromSettings).not.toHaveBeenCalled()
  })

  it('본인 메일 주소를 모르면 거부 — DNS·트랜스포트 미도달', async () => {
    makeAdmin()
    h.getSession.mockResolvedValue({ id: 'u-admin', email: undefined, user_metadata: {} })
    expect(await sendWorkspaceTestMail(WS, CUSTOM)).toEqual({ ok: false, error: serverKoTranslate('srv.mailSettings.testNoRecipient') })
    expect(h.vetMailHost).not.toHaveBeenCalled()
    expect(h.transportFromSettings).not.toHaveBeenCalled()
  })

  it('서버 주소가 사설·예약 대역으로 풀리면 MAIL_HOST_NOT_ALLOWED — 연결하지 않는다', async () => {
    makeAdmin()
    h.vetMailHost.mockResolvedValue({ ok: false })
    expect(await sendWorkspaceTestMail(WS, CUSTOM)).toEqual({ ok: false, error: MAIL_HOST_NOT_ALLOWED })
    expect(h.transportFromSettings).not.toHaveBeenCalled()
  })

  it('발송 오류는 smtpErrorMessage(test) 문구 — SMTP 원문·비밀번호를 싣지 않는다', async () => {
    makeAdmin()
    const err = Object.assign(new Error('535 bad credentials for mailer@acme.com / new-secret'), { code: 'EAUTH', responseCode: 535 })
    h.send.mockRejectedValue(err)
    const r = await sendWorkspaceTestMail(WS, CUSTOM)
    expect(r).toEqual({ ok: false, error: smtpErrorMessage(serverKoTranslate, err, { test: true }) })
    expect(JSON.stringify(r)).not.toContain('new-secret')
    // 로그에도 원문(계정·비밀번호가 섞일 수 있다)을 남기지 않는다 — code·responseCode 만
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('new-secret')
  })

  it('메일 서버가 본인 주소를 거부하면 실패 문구', async () => {
    makeAdmin()
    h.send.mockResolvedValue({ rejected: [ME.toUpperCase()] })
    const r = await sendWorkspaceTestMail(WS, CUSTOM)
    expect(r).toMatchObject({ ok: false })
    expect((r as { error: string }).error).toContain(ME)
  })
})
