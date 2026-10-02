// @vitest-environment jsdom
// 프로젝트 초대 발급 폼·목록의 계약(Task 14). 토큰은 해시만 저장되므로(0003) 링크는 발급 응답에서 한 번만 온다 —
// 목록 행에는 링크 복사가 없고, 관리자 초대는 워크스페이스 관리자 이상만 발급한다(createProjectInvite 의 워크스페이스 관리자 가드, SP2).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { InviteRow } from '@/app/actions/projectInvites'
import type { ProjectActorView } from '@/lib/domain/authz'
import { makeProjectActorView } from '../fixtures/actor'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const createProjectInvite = vi.fn<(...a: unknown[]) => Promise<unknown>>()
const revokeProjectInvite = vi.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({ ok: true }))
const refresh = vi.fn()
const toast = vi.fn()

vi.mock('@/app/actions/projectInvites', () => ({
  createProjectInvite: (...a: unknown[]) => createProjectInvite(...a),
  revokeProjectInvite: (...a: unknown[]) => revokeProjectInvite(...a),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }))
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ toast }) }))

import { ProjectInviteManager } from '@/components/settings/ProjectInviteManager'

const TEAMS = [{ id: 't-erp', code: 'ERP' }, { id: 't-mes', code: 'MES' }]
const URL_ONCE = 'http://localhost:3000/invite/11111111-2222-4333-8444-555555555555'

function invite(over: Partial<InviteRow> = {}): InviteRow {
  return {
    id: 'i-1', email: 'alice@example.com', accessRole: 'member', roleLabel: null, teamCodes: ['ERP'],
    status: 'active', expiresAt: '2999-01-01T00:00:00Z', createdAt: '2026-09-01T00:00:00Z', redeemedAt: null,
    url: null, ...over,
  }
}
const WS_ADMIN = makeProjectActorView({ userId: 'u-wa', workspaceRole: 'admin' })
const SUPERUSER = makeProjectActorView({ userId: 'u-su', isSuperuser: true })
// 워크스페이스 멤버이면서 이 프로젝트의 관리자 — 초대는 발급하지만 관리자 슬롯은 열지 못한다.
const PROJECT_ADMIN = makeProjectActorView({ userId: 'u-pa', workspaceRole: 'member', projectRole: 'admin' })

describe('ProjectInviteManager', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    createProjectInvite.mockReset()
    createProjectInvite.mockImplementation(async (_pid, input) => {
      const i = input as { email: string }
      return {
        ok: true, url: URL_ONCE, mailed: true, alreadyAccount: false,
        row: invite({ id: 'i-new', email: i.email, url: URL_ONCE }),
      }
    })
    revokeProjectInvite.mockClear(); refresh.mockClear(); toast.mockClear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function render(rows: InviteRow[] = [], actorView: ProjectActorView | null = WS_ADMIN) {
    act(() => {
      root.render(<ProjectInviteManager projectId="p-1" rows={rows} loadError={null} teamOptions={TEAMS} actorView={actorView} timeZone="Asia/Seoul" />)
    })
  }
  const byLabel = <T extends HTMLElement>(label: string) => container.querySelector<T>(`[aria-label="${label}"]`)!
  function typeInto(el: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    act(() => { setter.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) })
  }
  function choose(el: HTMLSelectElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!
    act(() => { setter.call(el, value); el.dispatchEvent(new Event('change', { bubbles: true })) })
  }
  async function submit() {
    await act(async () => {
      container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
  }
  const accessOptions = () => Array.from(byLabel<HTMLSelectElement>('초대 권한').options).map(o => o.value)

  it('권한은 없음·멤버 — 관리자 옵션은 워크스페이스 관리자 이상에게만(프로젝트 관리자에게는 서버가 거부한다)', () => {
    render([], PROJECT_ADMIN)
    expect(accessOptions()).toEqual(['', 'member'])
    act(() => root.unmount()); root = createRoot(container)
    render([], WS_ADMIN)
    expect(accessOptions()).toEqual(['', 'member', 'admin'])
    act(() => root.unmount()); root = createRoot(container)
    render([], SUPERUSER)
    expect(accessOptions()).toEqual(['', 'member', 'admin'])
  })

  it('발급은 권한·역할 라벨·팀 여러 개(선택 순서, 첫 팀이 대표)를 그대로 넘긴다', async () => {
    render([], SUPERUSER)
    typeInto(container.querySelector<HTMLInputElement>('input[type="email"]')!, 'bob@example.com')
    choose(byLabel<HTMLSelectElement>('초대 권한'), 'admin')
    typeInto(byLabel<HTMLInputElement>('역할 라벨'), 'PL')
    await act(async () => { byLabel<HTMLButtonElement>('초대 팀').click() })
    await act(async () => { document.querySelector<HTMLInputElement>('[data-team-check="MES"]')!.click() })
    await act(async () => { document.querySelector<HTMLInputElement>('[data-team-check="ERP"]')!.click() })
    await submit()
    expect(createProjectInvite).toHaveBeenCalledWith('p-1', {
      email: 'bob@example.com', accessRole: 'admin', roleLabel: 'PL', teamIds: ['t-mes', 't-erp'], days: 7,
    })
  })

  it('권한 없음은 accessRole null(조회 전용으로 명단에만 오른다)', async () => {
    render()
    typeInto(container.querySelector<HTMLInputElement>('input[type="email"]')!, 'bob@example.com')
    choose(byLabel<HTMLSelectElement>('초대 권한'), '')
    await submit()
    expect(createProjectInvite).toHaveBeenCalledWith('p-1', expect.objectContaining({ accessRole: null, roleLabel: null, teamIds: [] }))
  })

  it('발급 직후 링크를 한 번만 보여 준다 — "이 링크는 다시 볼 수 없습니다"', async () => {
    render()
    typeInto(container.querySelector<HTMLInputElement>('input[type="email"]')!, 'bob@example.com')
    await submit()
    const panel = container.querySelector('[data-issued-invite]')!
    expect(panel.textContent).toContain('이 링크는 다시 볼 수 없습니다')
    expect(panel.querySelector<HTMLInputElement>('input')!.value).toBe(URL_ONCE)
    expect(refresh).toHaveBeenCalled()
  })

  it('액션 오류는 문구 그대로 보여 주고 링크 상자를 띄우지 않는다', async () => {
    const msg = '관리자 권한 초대는 워크스페이스 관리자만 발급할 수 있습니다.'
    createProjectInvite.mockResolvedValue({ ok: false, error: msg })
    render()
    typeInto(container.querySelector<HTMLInputElement>('input[type="email"]')!, 'bob@example.com')
    await submit()
    expect(container.querySelector('[role="alert"]')!.textContent).toBe(msg)
    expect(container.querySelector('[data-issued-invite]')).toBeNull()
  })

  it('목록 행에는 링크 복사가 없고 상태·권한만 보인다', () => {
    render([
      invite(),
      invite({ id: 'i-2', email: 'carol@example.com', status: 'redeemed', accessRole: null, roleLabel: 'QA', redeemedAt: '2026-09-02T00:00:00Z' }),
    ])
    const rows = container.querySelectorAll('tbody tr')
    expect(rows).toHaveLength(2)
    expect(container.querySelector('tbody')!.textContent).not.toContain('링크 복사')
    expect(rows[0].textContent).toContain('멤버')
    expect(rows[1].textContent).toContain('조회 전용')
    expect(rows[1].textContent).toContain('QA')
  })
})
