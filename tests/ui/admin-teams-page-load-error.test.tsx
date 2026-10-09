import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement } from 'react'
import { makeSuperuser, WS } from '../fixtures/actor'

// 팀 관리 화면의 조회 실패는 오류 카드로 보인다 — 'TEAMS 0 / ACTIVE 0' 과 빈 관리자를 사실처럼 그리지 않는다
// (SP2 최종 리뷰 ERR-7, 에러 처리 3원칙 ①). 그 화면을 믿은 관리자는 '없는' 팀을 다시 추가하다 중복 오류를 만난다.
const mocks = vi.hoisted(() => ({
  loadWorkspaceScope: vi.fn(),
  listTeamsAdmin: vi.fn(),
  redirect: vi.fn(() => { throw new Error('NEXT_REDIRECT') }),
  TeamsManager: vi.fn<(props: Record<string, unknown>) => null>(() => null),
}))
vi.mock('@/lib/authz/workspaceScope', () => ({ loadWorkspaceScope: mocks.loadWorkspaceScope }))
vi.mock('@/app/actions/teams', () => ({ listTeamsAdmin: mocks.listTeamsAdmin }))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))
vi.mock('@/lib/i18n/server', () => ({ getServerLocale: async () => 'ko' }))
vi.mock('@/components/admin/TeamsManager', () => ({ TeamsManager: mocks.TeamsManager }))

import TeamsAdminPage from '@/app/(app)/w/[slug]/admin/teams/page'

const render = async () => renderToStaticMarkup((await TeamsAdminPage({ params: Promise.resolve({ slug: 'acme' }) })) as ReactElement)

beforeEach(() => {
  vi.clearAllMocks()
  mocks.loadWorkspaceScope.mockResolvedValue({ ws: { id: WS, slug: 'acme', name: 'Acme' }, actor: makeSuperuser({ workspaceRoles: new Map([[WS, 'admin']]) }), degraded: false, role: 'superuser' })
})

describe('/w/[slug]/admin/teams — 조회 실패 표시', () => {
  it('목록 조회가 실패하면 오류 카드 — TEAMS 0 과 빈 관리자를 그리지 않는다', async () => {
    mocks.listTeamsAdmin.mockResolvedValue({ ok: false, error: '팀 목록을 불러오지 못했습니다. 잠시 후 다시 시도하세요.' })
    const out = await render()
    // 머리글은 한 번만 — 페이지가 같은 문장을 제목과 본문에 두 번 찍지 않는다(SP2 최종 리뷰 minor b).
    expect(out.split('팀 목록을 불러오지 못했습니다').length - 1).toBe(1)
    expect(out).toContain('잠시 후 다시 시도하세요.')
    expect(out).toContain('role="alert"')
    expect(mocks.TeamsManager).not.toHaveBeenCalled()   // 빈 관리자(= 팀 0개)를 그리지 않는다
  })

  it('대조: 정상 조회는 관리자에 목록을 넘기고 오류 카드가 없다', async () => {
    mocks.listTeamsAdmin.mockResolvedValue({ ok: true, rows: [
      { id: 't1', code: 'PMO', sortOrder: 0, active: true, progressVisible: true },
      { id: 't2', code: '휴면', sortOrder: 1, active: false, progressVisible: true },
    ] })
    const out = await render()
    expect(out).not.toContain('role="alert"')
    expect(mocks.TeamsManager.mock.calls.at(-1)![0].teams).toHaveLength(2)
  })
})
