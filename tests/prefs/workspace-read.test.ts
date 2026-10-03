import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getSession: async () => ({ id: 'user' }) }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: async () => ({ from: () => {
  const q = { select: () => q, eq: () => q, maybeSingle: h.read }
  return q
} }) }))
import { getWorkspacePrefs } from '@/app/actions/preferences'
const WS = '00000000-0000-0000-7e57-000000001830'
let log: ReturnType<typeof vi.spyOn>
beforeEach(() => { h.read.mockReset(); log = vi.spyOn(console, 'error').mockImplementation(() => {}) })
afterEach(() => { log.mockRestore() })
it('엄격 조회는 DB 실패를 빈 개인 설정으로 바꾸지 않는다', async () => {
  h.read.mockResolvedValue({ data: null, error: { message: 'down' } })
  await expect(getWorkspacePrefs(WS, { strict: true })).rejects.toThrow('개인 설정을 불러오지 못했습니다.')
  expect(log).toHaveBeenCalled()
  await expect(getWorkspacePrefs(WS)).resolves.toEqual({})
})
it('조회에 성공해 행이 없으면 엄격 조회도 정상 빈 설정이다', async () => {
  h.read.mockResolvedValue({ data: null, error: null })
  await expect(getWorkspacePrefs(WS, { strict: true })).resolves.toEqual({})
  expect(log).not.toHaveBeenCalled()
})
it('엄격 조회도 저장된 워크스페이스 숨김 목록을 반환한다', async () => {
  h.read.mockResolvedValue({ data: { prefs: { portalHiddenWidgets: ['announcements'] } }, error: null })
  await expect(getWorkspacePrefs(WS, { strict: true })).resolves.toMatchObject({ portalHiddenWidgets: ['announcements'] })
})
