import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'

const { createAdminClient, requireSuperuser } = vi.hoisted(() => ({
  createAdminClient: vi.fn(() => { throw new Error('createAdminClient 는 게이트 통과 전에 호출되면 안 된다') }),
  requireSuperuser: vi.fn(),
}))
vi.mock('@/lib/authz', () => ({ requireSuperuser }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }))

import { listPlatformAdmins, findAccountByEmail } from '@/app/actions/platformAdmins'
import { canManagePlatformAdmins } from '@/lib/authz/accountsAccess'
import { makeActor, makeSuperuser } from '../fixtures/actor'

type Result = { data?: unknown; error: { message: string } | null }
function chain(result: Result) {
  const c: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'order']) c[m] = vi.fn(() => c)
  c.maybeSingle = vi.fn(async () => result)
  c.then = (res: (v: Result) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej)
  return c as Record<string, Mock<(...a: unknown[]) => unknown>> & PromiseLike<Result>
}
const SU = makeSuperuser({ userId: 'u-su' })
const DENIED = { ok: false as const, error: '권한 없음' }

beforeEach(() => {
  createAdminClient.mockReset()
  createAdminClient.mockImplementation(() => { throw new Error('createAdminClient 는 게이트 통과 전에 호출되면 안 된다') })
  requireSuperuser.mockReset()
})

describe('canManagePlatformAdmins', () => {
  it('플랫폼 관리자만 참, 열화(null)는 거짓', () => {
    expect(canManagePlatformAdmins(SU)).toBe(true)
    expect(canManagePlatformAdmins(makeActor())).toBe(false)
    expect(canManagePlatformAdmins(null)).toBe(false)
  })
})

describe('listPlatformAdmins', () => {
  it('플랫폼 관리자가 아니면 거부 — DB 를 읽지 않는다', async () => {
    requireSuperuser.mockResolvedValue(DENIED)
    expect(await listPlatformAdmins()).toEqual(DENIED)
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('지정 일시 순 목록 + 지정한 사람 — 프로필 없는 행도 빠지지 않는다(null)', async () => {
    requireSuperuser.mockResolvedValue({ ok: true, actor: SU })
    createAdminClient.mockReturnValue({
      from: vi.fn((t: string) => {
        if (t === 'platform_admins') return chain({ data: [
          { user_id: 'u-su', granted_by: null, granted_at: '2026-10-14T00:00:00Z' },
          { user_id: 'u-b', granted_by: 'u-su', granted_at: '2026-10-15T00:00:00Z' },
          { user_id: 'u-gone', granted_by: 'u-x', granted_at: '2026-10-15T01:00:00Z' },
        ], error: null })
        if (t === 'profiles') return chain({ data: [
          { user_id: 'u-su', email: 'su@example.com', display_name: '수퍼' },
          { user_id: 'u-b', email: 'b@example.com', display_name: '비' },
        ], error: null })
        throw new Error('예상치 못한 테이블 접근: ' + t)
      }),
    } as never)
    expect(await listPlatformAdmins()).toEqual({ ok: true, rows: [
      { userId: 'u-su', email: 'su@example.com', name: '수퍼', grantedAt: '2026-10-14T00:00:00Z', grantedBy: null },
      { userId: 'u-b', email: 'b@example.com', name: '비', grantedAt: '2026-10-15T00:00:00Z', grantedBy: { userId: 'u-su', email: 'su@example.com', name: '수퍼' } },
      { userId: 'u-gone', email: null, name: null, grantedAt: '2026-10-15T01:00:00Z', grantedBy: { userId: 'u-x', email: null, name: null } },
    ] })
  })

  it.each(['platform_admins', 'profiles'])('%s 조회 실패는 { ok: false } — 빈 목록으로 위장하지 않는다', async (bad) => {
    requireSuperuser.mockResolvedValue({ ok: true, actor: SU })
    createAdminClient.mockReturnValue({
      from: vi.fn((t: string) => t === bad
        ? chain({ data: null, error: { message: 'boom' } })
        : chain({ data: t === 'platform_admins' ? [{ user_id: 'u-su', granted_by: null, granted_at: 'x' }] : [], error: null })),
    } as never)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await listPlatformAdmins()).toEqual({ ok: false, error: '플랫폼 관리자 목록을 불러오지 못했습니다.' })
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('findAccountByEmail', () => {
  function client(o: { profile?: Result; platform?: Result; members?: Result } = {}) {
    const profiles = chain(o.profile ?? { data: { user_id: 'u-b', email: 'bob@example.com', display_name: '밥' }, error: null })
    const from = vi.fn((t: string) => {
      if (t === 'profiles') return profiles
      if (t === 'platform_admins') return chain(o.platform ?? { data: null, error: null })
      if (t === 'workspace_members') return chain(o.members ?? { data: [
        { role: 'admin', workspaces: { name: '알파', archived_at: null } },
        { role: 'member', workspaces: { name: '베타', archived_at: '2026-10-01T00:00:00Z' } },
      ], error: null })
      throw new Error('예상치 못한 테이블 접근: ' + t)
    })
    createAdminClient.mockReturnValue({ from } as never)
    return { profiles }
  }

  it('플랫폼 관리자가 아니면 거부 — DB 를 읽지 않는다', async () => {
    requireSuperuser.mockResolvedValue(DENIED)
    expect(await findAccountByEmail('bob@example.com')).toEqual(DENIED)
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('정규화(공백·대문자) 뒤 완전 일치로 찾고 소속 워크스페이스(보관 표시 포함)를 싣는다', async () => {
    requireSuperuser.mockResolvedValue({ ok: true, actor: SU })
    const { profiles } = client()
    expect(await findAccountByEmail('  Bob@Example.COM ')).toEqual({ ok: true, account: {
      userId: 'u-b', email: 'bob@example.com', name: '밥', isPlatformAdmin: false,
      workspaces: [{ name: '알파', role: 'admin', archived: false }, { name: '베타', role: 'member', archived: true }],
    } })
    expect(profiles.eq).toHaveBeenCalledWith('email', 'bob@example.com')
  })

  it('이미 플랫폼 관리자면 isPlatformAdmin true', async () => {
    requireSuperuser.mockResolvedValue({ ok: true, actor: SU })
    client({ platform: { data: { user_id: 'u-b' }, error: null } })
    const res = await findAccountByEmail('bob@example.com')
    expect(res.ok && res.account?.isPlatformAdmin).toBe(true)
  })

  it('없으면 account: null', async () => {
    requireSuperuser.mockResolvedValue({ ok: true, actor: SU })
    client({ profile: { data: null, error: null } })
    expect(await findAccountByEmail('nobody@example.com')).toEqual({ ok: true, account: null })
  })

  it('형식이 아니면 오류 문구 — DB 를 읽지 않는다', async () => {
    requireSuperuser.mockResolvedValue({ ok: true, actor: SU })
    expect(await findAccountByEmail('not-an-email')).toEqual({ ok: false, error: '올바른 이메일 형식이 아닙니다.' })
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it.each([
    ['profiles', { profile: { data: null, error: { message: 'boom' } } }],
    ['platform_admins', { platform: { data: null, error: { message: 'boom' } } }],
    ['workspace_members', { members: { data: null, error: { message: 'boom' } } }],
  ] as const)('%s 조회 실패는 { ok: false } — "계정 없음"으로 위장하지 않는다', async (_t, o) => {
    requireSuperuser.mockResolvedValue({ ok: true, actor: SU })
    client(o)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await findAccountByEmail('bob@example.com')).toEqual({ ok: false, error: '계정을 조회하지 못했습니다. 잠시 뒤 다시 시도하세요.' })
    spy.mockRestore()
  })
})
