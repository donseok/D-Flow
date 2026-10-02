// @vitest-environment jsdom
// 로그아웃 정리(W16 — 옛 tests/ui/header-chrome-signout 의 케이스를 함수 하나로 옮김) + U2b-2 권한 리뷰 Y2:
// 서버 로그아웃이 오류(네트워크·5xx)를 돌려주면 auth-js 는 로컬 세션을 지우지 않는다 — 로컬 로그아웃으로 반드시 지운 뒤 이동한다.
// 현재 워크스페이스 쿠키(dflow-ws — httpOnly 아님, 1년)도 그 자리에서 지운다(공용 PC 에 앞 사용자의 슬러그가 남지 않게).
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ calls: [] as string[], signOut: vi.fn(), draftsAtSignOut: null as string[] | null }))
vi.mock('@/lib/supabase/client', () => ({ createBrowserClient: () => ({ auth: { signOut: h.signOut } }) }))
import { endSession, signOutAndClear } from '@/lib/auth/signOut'

const router = () => ({ replace: vi.fn((href: string) => { h.calls.push(`replace:${href}`) }), refresh: vi.fn(() => { h.calls.push('refresh') }) })
const draftKeys = () => Object.keys(localStorage).filter((k) => k.startsWith('wiki-draft'))

beforeEach(() => {
  vi.clearAllMocks(); h.calls = []; localStorage.clear()
  document.cookie = 'dflow-ws=acme; path=/'
  h.signOut.mockImplementation(async (o?: { scope?: string }) => { h.calls.push(`signOut:${o?.scope ?? 'global'}`); h.draftsAtSignOut = draftKeys(); return { error: null } })
})

describe('signOutAndClear', () => {
  it('위키 초안(새·옛 키)을 지우고 다른 키는 남긴 뒤 세션을 끊고 /login 으로', async () => {
    localStorage.setItem('wiki-draft:v2:u1:p1:t1', 'x'); localStorage.setItem('wiki-draft:p1:t1', 'y'); localStorage.setItem('other', 'keep')
    await signOutAndClear(router())
    expect(draftKeys()).toEqual([]); expect(localStorage.getItem('other')).toBe('keep')
    expect(h.draftsAtSignOut).toEqual([])
    expect(h.calls).toEqual(['signOut:global', 'replace:/login', 'refresh'])
  })
  it('현재 워크스페이스 쿠키(dflow-ws)를 지운다', async () => {
    await signOutAndClear(router())
    expect(document.cookie).not.toContain('dflow-ws=acme')
  })
  it('서버 로그아웃이 오류를 돌려주면 로컬 로그아웃으로 세션을 지운 뒤 이동한다(로그)', async () => {
    h.signOut.mockImplementationOnce(async () => { h.calls.push('signOut:global'); return { error: { message: '503', status: 503 } } })
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    await signOutAndClear(router())
    expect(h.calls).toEqual(['signOut:global', 'signOut:local', 'replace:/login', 'refresh'])
    expect(err).toHaveBeenCalled(); err.mockRestore()
  })
  it('서버 로그아웃이 던져도(오프라인) 로컬 로그아웃 뒤 이동한다', async () => {
    h.signOut.mockImplementationOnce(async () => { h.calls.push('signOut:global'); throw new Error('offline') })
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    await signOutAndClear(router())
    expect(h.calls).toEqual(['signOut:global', 'signOut:local', 'replace:/login', 'refresh'])
    err.mockRestore()
  })
  it('저장소 접근이 throw 해도 로그아웃은 진행한다', async () => {
    const spy = vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => { throw new Error('denied') })
    await signOutAndClear(router())
    expect(h.calls).toContain('replace:/login')
    spy.mockRestore()
  })
})

// AA8 — 이동 없는 세션 정리(초대 화면의 불일치 계정 되돌림이 같이 쓴다 — 로그아웃 경로는 하나, W16)
describe('endSession', () => {
  it('서버 로그아웃이 되면 그것뿐 — 이동·쿠키·초안 정리 없음', async () => {
    localStorage.setItem('wiki-draft:v2:u1:p1:t1', 'x')
    await endSession()
    expect(h.calls).toEqual(['signOut:global'])
    expect(localStorage.getItem('wiki-draft:v2:u1:p1:t1')).toBe('x'); expect(document.cookie).toContain('dflow-ws=acme')
  })
  it('오류·던짐이면 로컬 로그아웃으로 지운다(로그)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.signOut.mockImplementationOnce(async () => { h.calls.push('signOut:global'); return { error: { message: '503' } } })
    await endSession()
    h.signOut.mockImplementationOnce(async () => { h.calls.push('signOut:global'); throw new Error('offline') })
    await endSession()
    expect(h.calls).toEqual(['signOut:global', 'signOut:local', 'signOut:global', 'signOut:local'])
    err.mockRestore()
  })
})
