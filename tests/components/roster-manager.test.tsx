// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { RosterMember } from '@/lib/data/memberSelect'
import type { ProjectActorView } from '@/lib/domain/authz'
import { makeProjectActorView } from '../fixtures/actor'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

type Fail = { ok: false; error: string }
const upsertRosterMember = vi.fn<(...a: unknown[]) => Promise<{ ok: true; memberId: string } | Fail>>(async () => ({ ok: true, memberId: 'm-new' }))
const removeRosterMember = vi.fn<(...a: unknown[]) => Promise<{ ok: true } | Fail>>(async () => ({ ok: true }))
const refresh = vi.fn()

vi.mock('@/app/actions/roster', () => ({
  upsertRosterMember: (...a: unknown[]) => upsertRosterMember(...a),
  removeRosterMember: (...a: unknown[]) => removeRosterMember(...a),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }))

import { RosterManager } from '@/components/roster/RosterManager'

const TEAMS = [{ id: 't-erp', code: 'ERP' }, { id: 't-mes', code: 'MES' }]

function member(over: Partial<RosterMember> = {}): RosterMember {
  return {
    id: 'm-alice', projectId: 'p-1', personId: 'pe-alice',
    name: 'alice', email: 'alice@example.com', userId: 'u-alice', kind: 'account',
    accessRole: 'member', roleLabel: null, title: null, active: true, sortOrder: 0, createdAt: '2026-09-01T00:00:00Z',
    teams: [{ id: 't-erp', code: 'ERP', name: 'ERP', isPrimary: true }], teamCode: 'ERP', hasAccount: true,
    ...over,
  }
}
const BOB = member({
  id: 'm-bob', personId: 'pe-bob', name: 'bob', email: null, userId: null, kind: 'external', hasAccount: false,
  accessRole: null, teams: [], teamCode: null,
})
const PROJECT_ADMIN = makeProjectActorView({ userId: 'u-pa', workspaceRole: 'member', projectRole: 'admin' })
const WS_ADMIN = makeProjectActorView({ userId: 'u-wa', workspaceRole: 'admin' })

describe('RosterManager', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    upsertRosterMember.mockClear(); upsertRosterMember.mockResolvedValue({ ok: true, memberId: 'm-new' })
    removeRosterMember.mockClear(); refresh.mockClear()
    Element.prototype.scrollIntoView = vi.fn()   // jsdom 미구현 — 기존 행 선택이 그 행으로 스크롤한다
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function render(rows: RosterMember[], actorView: ProjectActorView | null = WS_ADMIN, canEdit = true) {
    act(() => { root.render(<RosterManager projectId="p-1" rows={rows} teamOptions={TEAMS} actorView={actorView} canEdit={canEdit} />) })
  }
  const row = (id: string) => container.querySelector<HTMLTableRowElement>(`tr[data-roster-row="${id}"]`)!
  const byLabel = <T extends HTMLElement>(label: string) => container.querySelector<T>(`[aria-label="${label}"]`)!
  function typeInto(el: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    act(() => { setter.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) })
  }
  function choose(el: HTMLSelectElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!
    act(() => { setter.call(el, value); el.dispatchEvent(new Event('change', { bubbles: true })) })
  }
  const button = (text: string) => Array.from(container.querySelectorAll('button')).find(b => b.textContent?.trim() === text)!

  it('외부 인력(kind external)에만 계정 미연결 배지를 단다', () => {
    render([member(), BOB])
    expect(row('m-bob').querySelector('[data-unlinked-badge]')?.textContent).toContain('계정 미연결')
    expect(row('m-alice').querySelector('[data-unlinked-badge]')).toBeNull()
  })

  it('워크스페이스 관리자가 아니면 관리자 옵션이 비활성이고 관리자 행은 읽기 전용이다', () => {
    render([member(), member({ id: 'm-lead', personId: 'pe-lead', name: 'lead', email: 'lead@example.com', accessRole: 'admin' })], PROJECT_ADMIN)
    const adminOpt = byLabel<HTMLSelectElement>('alice 권한').querySelector<HTMLOptionElement>('option[value="admin"]')!
    expect(adminOpt.disabled).toBe(true)
    expect(row('m-lead').querySelector('select')).toBeNull()
    expect(row('m-lead').textContent).toContain('관리자 행은 워크스페이스 관리자만 수정할 수 있습니다.')
  })

  it('워크스페이스 관리자는 관리자 옵션을 고를 수 있다', () => {
    render([member()], WS_ADMIN)
    const adminOpt = byLabel<HTMLSelectElement>('alice 권한').querySelector<HTMLOptionElement>('option[value="admin"]')!
    expect(adminOpt.disabled).toBe(false)
  })

  it('저장은 행 초안 전체를 upsertRosterMember 로 보낸다 — 팀 첫 원소가 대표', async () => {
    render([member()])
    typeInto(byLabel<HTMLInputElement>('alice 직함'), ' 책임 ')
    choose(byLabel<HTMLSelectElement>('alice 권한'), 'admin')
    act(() => byLabel<HTMLButtonElement>('alice 팀').click())
    act(() => container.querySelector<HTMLInputElement>('input[data-team-check="MES"]')!.click())
    act(() => container.querySelector<HTMLInputElement>('input[data-team-primary="MES"]')!.click())
    await act(async () => button('저장').click())
    expect(upsertRosterMember).toHaveBeenCalledWith('p-1', {
      personId: 'pe-alice', name: 'alice', email: 'alice@example.com', accessRole: 'admin',
      roleLabel: null, title: '책임', teamIds: ['t-mes', 't-erp'], active: true,
    })
    expect(refresh).toHaveBeenCalled()
  })

  it('비활성 토글은 active=false 로 저장한다', async () => {
    render([member()])
    act(() => byLabel<HTMLInputElement>('alice 활성').click())
    await act(async () => button('저장').click())
    expect(upsertRosterMember.mock.calls[0][1]).toMatchObject({ personId: 'pe-alice', active: false })
  })

  it('저장 오류는 그 행 아래에 표시한다', async () => {
    upsertRosterMember.mockResolvedValueOnce({ ok: false, error: '본인의 권한은 회수할 수 없습니다.' })
    render([member(), BOB])
    choose(byLabel<HTMLSelectElement>('alice 권한'), '')
    await act(async () => button('저장').click())
    const err = container.querySelector('tr[data-roster-error="m-alice"]')
    expect(err?.textContent).toContain('본인의 권한은 회수할 수 없습니다.')
    expect(row('m-alice').nextElementSibling).toBe(err)
    expect(refresh).not.toHaveBeenCalled()
  })

  it('사람 추가 — 이름만(외부 인력)으로 추가한다', async () => {
    render([member()])
    typeInto(byLabel<HTMLInputElement>('추가할 사람 이름'), ' carol ')
    await act(async () => button('사람 추가').click())
    expect(upsertRosterMember).toHaveBeenCalledWith('p-1', {
      personId: null, name: 'carol', email: null, accessRole: null, roleLabel: null, title: null, teamIds: [], active: true,
    })
  })

  it('사람 추가 — 명단에 같은 이메일이 있으면 호출하지 않고 기존 사람을 고르게 한다', async () => {
    render([member()])
    typeInto(byLabel<HTMLInputElement>('추가할 사람 이름'), 'alice2')
    typeInto(byLabel<HTMLInputElement>('추가할 사람 이메일(선택)'), 'ALICE@example.com')
    await act(async () => button('사람 추가').click())
    expect(upsertRosterMember).not.toHaveBeenCalled()
    expect(container.textContent).toContain('같은 이메일의 사람이 이미 있습니다. 목록에서 선택하세요.')
    act(() => button('alice 선택').click())
    expect(row('m-alice').className).toContain('bg-brand-weak')
  })

  it('삭제는 확인을 한 번 더 받고 removeRosterMember 를 부른다', async () => {
    render([member()])
    act(() => byLabel<HTMLButtonElement>('alice 삭제').click())
    expect(removeRosterMember).not.toHaveBeenCalled()
    await act(async () => button('삭제 확인').click())
    expect(removeRosterMember).toHaveBeenCalledWith('m-alice')
  })

  it('편집 권한이 없으면 입력 없이 읽기 전용 표와 배지만 그린다', () => {
    render([member(), BOB], null, false)
    expect(container.querySelector('select, input')).toBeNull()
    expect(container.querySelector('form')).toBeNull()
    expect(row('m-bob').textContent).toContain('계정 미연결')
    expect(row('m-alice').textContent).toContain('멤버')
  })
})
