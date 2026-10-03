import { beforeEach, describe, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ current: vi.fn(), account: vi.fn(), workspace: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getSession: async () => null }))
vi.mock('@/app/actions/project', () => ({ listProjectsWithState: async () => ({ projects: [], degraded: false }) }))
vi.mock('@/lib/workspace/current', () => ({ readCurrentWorkspace: h.current }))
vi.mock('@/app/actions/preferences', () => ({ getAccountPrefs: h.account, getWorkspacePrefs: h.workspace }))
vi.mock('@/components/account/AccountView', () => ({ AccountView: () => null }))
import AccountPage from '@/app/(app)/(global)/account/page'
const WS = { id: 'ws-a', slug: 'alpha', name: 'Alpha' }
beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockReset()
  h.current.mockResolvedValue({ ok: true, ws: WS }); h.account.mockResolvedValue({ projectsView: 'cards' }); h.workspace.mockResolvedValue({ startPage: 'projects' })
})
describe('계정 페이지의 선호 원천', () => {
  it('검증된 현재 소속의 선호만 읽고 계정 보기와 따로 전달한다', async () => {
    const page = await AccountPage()
    expect(h.workspace).toHaveBeenCalledExactlyOnceWith(WS.id, { strict: true })
    expect(page.props).toMatchObject({ currentWorkspace: { id: WS.id, name: WS.name }, startPage: 'projects', projectsView: 'cards', currentWorkspaceError: false })
  })
  it('소속이 없으면 워크스페이스 선호를 읽지 않는다', async () => {
    h.current.mockResolvedValue({ ok: true, ws: null })
    expect((await AccountPage()).props).toMatchObject({ currentWorkspace: null, currentWorkspaceError: false })
    expect(h.workspace).not.toHaveBeenCalled()
  })
  it.each(['membership', 'preferences'])('%s 조회 실패는 기본값 선택을 열지 않는다', async kind => {
    if (kind === 'membership') h.current.mockResolvedValue({ ok: false, error: 'down' })
    else h.workspace.mockRejectedValue(new Error('down'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect((await AccountPage()).props).toMatchObject({ currentWorkspaceError: true, startPage: null })
      expect(err).toHaveBeenCalled()
      if (kind === 'membership') expect(h.workspace).not.toHaveBeenCalled()
    } finally { err.mockRestore() }
  })
})
