import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ getHiddenProjectIds: vi.fn(async (): Promise<ReadonlySet<string>> => new Set()), readCurrentWorkspace: vi.fn(), getWorkspacePrefs: vi.fn(async (): Promise<object> => ({})), getActorViewState: vi.fn(), redirect: vi.fn((u: string) => { throw new Error(`NEXT_REDIRECT:${u}`) }) }))
vi.mock('@/lib/workspace/current', () => ({ readCurrentWorkspace: h.readCurrentWorkspace }))
vi.mock('@/app/actions/preferences', () => ({ getWorkspacePrefs: h.getWorkspacePrefs }))
vi.mock('@/lib/authz', () => ({ getActorViewState: h.getActorViewState }))
vi.mock('@/lib/authz/visibility', () => ({ getHiddenProjectIds: h.getHiddenProjectIds }))
vi.mock('next/navigation', () => ({ redirect: h.redirect, useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }))

import Root from '@/app/page'
import { makeActor, makeSuperuser } from '../fixtures/actor'

const WID = '00000000-0000-0000-7e57-0000000016f3', P1 = '00000000-0000-0000-7e57-0000000016f4', PX = '00000000-0000-0000-7e57-0000000016f6'
beforeEach(() => { vi.clearAllMocks(); h.getActorViewState.mockResolvedValue({ actor: makeActor(), degraded: false }) })

describe('루트 리졸버', () => {
  it('현재 워크스페이스의 시작 화면으로 redirect', async () => {
    h.readCurrentWorkspace.mockResolvedValue({ ok: true, ws: { id: WID, slug: 'acme', name: 'Acme' } })
    await expect(Root()).rejects.toThrow('NEXT_REDIRECT:/w/acme')
    expect(h.getWorkspacePrefs).toHaveBeenCalledWith(WID)
  })
  it('last_project — 그 워크스페이스에서 지금 열 수 있는 첫 최근 프로젝트(다른 워크스페이스·숨김은 건너뜀)', async () => {
    h.readCurrentWorkspace.mockResolvedValue({ ok: true, ws: { id: WID, slug: 'acme', name: 'Acme' } })
    h.getActorViewState.mockResolvedValue({ actor: makeActor({ workspaceRoles: new Map([[WID, 'member'], ['ws-x', 'member']]),
      projectWorkspace: new Map([[P1, WID], [PX, 'ws-x']]) }), degraded: false })
    h.getWorkspacePrefs.mockResolvedValue({ startPage: 'last_project', recentProjects: [{ id: PX, at: 'a' }, { id: '00000000-0000-0000-7e57-0000000016f7', at: 'b' }, { id: P1, at: 'c' }] })
    await expect(Root()).rejects.toThrow(`NEXT_REDIRECT:/p/${P1}/dashboard`)
  })
  it('GG1 — 명단 밖 비공개 최근 프로젝트는 건너뛴다(레이아웃과 같은 판정자)', async () => {
    h.readCurrentWorkspace.mockResolvedValue({ ok: true, ws: { id: WID, slug: 'acme', name: 'Acme' } })
    h.getActorViewState.mockResolvedValue({ actor: makeActor({ workspaceRoles: new Map([[WID, 'member']]), projectWorkspace: new Map([[P1, WID], [PX, WID]]) }), degraded: false })
    h.getHiddenProjectIds.mockResolvedValue(new Set([PX]))
    h.getWorkspacePrefs.mockResolvedValue({ startPage: 'last_project', recentProjects: [{ id: PX, at: 'a' }, { id: P1, at: 'c' }] })
    await expect(Root()).rejects.toThrow(`NEXT_REDIRECT:/p/${P1}/dashboard`)
  })
  it('GG1 — 비공개 판정이 실패하면 최근 프로젝트를 판정할 수 없으니 홈으로', async () => {
    h.readCurrentWorkspace.mockResolvedValue({ ok: true, ws: { id: WID, slug: 'acme', name: 'Acme' } })
    h.getActorViewState.mockResolvedValue({ actor: makeActor({ workspaceRoles: new Map([[WID, 'member']]), projectWorkspace: new Map([[P1, WID]]) }), degraded: false })
    h.getHiddenProjectIds.mockRejectedValue(new Error('x'))
    h.getWorkspacePrefs.mockResolvedValue({ startPage: 'last_project', recentProjects: [{ id: P1, at: 'c' }] })
    await expect(Root()).rejects.toThrow('NEXT_REDIRECT:/w/acme')
  })
  it('권한 조회 열화 — 최근 프로젝트를 판정할 수 없으니 홈으로', async () => {
    h.readCurrentWorkspace.mockResolvedValue({ ok: true, ws: { id: WID, slug: 'acme', name: 'Acme' } })
    h.getActorViewState.mockResolvedValue({ actor: null, degraded: true })
    h.getWorkspacePrefs.mockResolvedValue({ startPage: 'last_project', recentProjects: [{ id: P1, at: 'c' }] })
    await expect(Root()).rejects.toThrow('NEXT_REDIRECT:/w/acme')
  })
  it('소속 0 — 소속 없음 화면(h1·초대 안내·로그아웃), 플랫폼 관리자에게는 LLM 설정 링크', async () => {
    h.readCurrentWorkspace.mockResolvedValue({ ok: true, ws: null })
    const html = renderToString(await Root())
    expect(html).toMatch(/<h1[^>]*>소속된 워크스페이스가 없습니다<\/h1>/)
    expect(html).toContain('초대 링크')
    expect(html).toContain('로그아웃')
    expect(html).not.toContain('/admin/llm-config')
    h.getActorViewState.mockResolvedValue({ actor: makeSuperuser({ workspaceRoles: new Map() }), degraded: false })
    expect(renderToString(await Root())).toContain('href="/admin/llm-config"')
  })
  it('조회 오류는 소속 없음으로 위장하지 않는다 — 화면 전체 부분 실패', async () => {
    h.readCurrentWorkspace.mockResolvedValue({ ok: false, error: 'down' })
    const html = renderToString(await Root())
    expect(html).toContain('role="alert"'); expect(html).not.toContain('소속된 워크스페이스가 없습니다')
    expect(html).toMatch(/<h1[^>]*>/)
    expect(h.redirect).not.toHaveBeenCalled()
  })
})
