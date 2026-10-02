// @vitest-environment jsdom
// 사용 기록·봇 문맥의 범위(과제 34, D26) — 프로젝트 밖 화면은 셸 범위의 워크스페이스를 싣고, 범위가 없으면 사용 기록을 보내지 않는다
// (서버는 400 — 전환마다 쌓지 않는다). 프로젝트 화면은 워크스페이스를 싣지 않는다(프로젝트가 판정).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
const nav = vi.hoisted(() => ({ pathname: '/w/acme' }))
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname, useSearchParams: () => new URLSearchParams('') }))
vi.mock('@/lib/prefs/debouncedSave', () => ({ queueProjectVisit: vi.fn() }))

import { ShellScope, ShellScopeProvider } from '@/components/app/ShellScope'
import { UsageTracker } from '@/components/app/UsageTracker'
import { BotPageContextProvider, useBotPageContext, useCurrentBotPageContext } from '@/components/chat/BotPageContextProvider'

const A = { id: '00000000-0000-0000-7e57-000000001797', slug: 'acme', name: 'Acme' }
const PID = '00000000-0000-0000-7e57-000000001798'
const fetchMock = vi.fn(async () => Response.json({ ok: true }))
let container: HTMLDivElement
let root: Root
const settle = () => new Promise((r) => setTimeout(r, 0))
const bodies = () => fetchMock.mock.calls.map((c) => JSON.parse(String((c as unknown as [string, RequestInit])[1].body)) as Record<string, unknown>)
let ctx: Record<string, unknown> | null = null
function Ctx({ register }: { register?: { projectId: string } }) {
  useBotPageContext(register ?? null)
  ctx = useCurrentBotPageContext() as unknown as Record<string, unknown>
  return null
}
const tree = (workspace: typeof A | null, register?: { projectId: string }) => (
  <ShellScopeProvider>{workspace && <ShellScope workspace={workspace} projectId={null} projects={[]} persist={false} />}
    <BotPageContextProvider><UsageTracker /><Ctx register={register} /></BotPageContextProvider></ShellScopeProvider>
)

beforeEach(() => {
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
  fetchMock.mockClear(); vi.stubGlobal('fetch', fetchMock); ctx = null
})
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals() })

describe('UsageTracker — 요청의 워크스페이스', () => {
  it('워크스페이스 화면은 게시 범위의 워크스페이스를 싣는다', async () => {
    nav.pathname = '/w/acme/minutes'
    await act(async () => { root.render(tree(A)); await settle() })
    expect(bodies()).toEqual([{ path: '/w/acme/minutes', workspaceId: A.id }])
  })
  it('범위가 없으면 보내지 않는다 — 첫 게시를 기다린다', async () => {
    nav.pathname = '/w/acme'
    await act(async () => { root.render(tree(null)); await settle() })
    expect(fetchMock).not.toHaveBeenCalled()
    await act(async () => { root.render(tree(A)); await settle() })
    expect(bodies()).toEqual([{ path: '/w/acme', workspaceId: A.id }])
  })
  it('경로 슬러그와 다른 게시 범위(한 커밋 늦음)는 보내지 않는다', async () => {
    nav.pathname = '/w/beta'
    await act(async () => { root.render(tree(A)); await settle() })
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('프로젝트 화면은 워크스페이스 없이 경로만(서버가 경로에서 프로젝트를 뽑는다)', async () => {
    nav.pathname = `/p/${PID}/wbs`
    await act(async () => { root.render(tree(A)); await settle() })
    expect(bodies()).toEqual([{ path: `/p/${PID}/wbs` }])
  })
  it('범위가 없는 (global) 화면은 보내지 않는다', async () => {
    nav.pathname = '/account'
    await act(async () => { root.render(tree(null)); await settle() })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('BotPageContextProvider — 문맥의 워크스페이스', () => {
  it('워크스페이스 화면이면 게시 범위의 id, 프로젝트 화면이면 null', async () => {
    nav.pathname = '/w/acme/meetings'
    await act(async () => { root.render(tree(A)); await settle() })
    expect(ctx).toMatchObject({ projectId: null, workspaceId: A.id })
    nav.pathname = `/p/${PID}/wbs`
    await act(async () => { root.render(tree(A)); await settle() })
    expect(ctx).toMatchObject({ projectId: PID, workspaceId: null })
  })
  it('화면이 프로젝트를 등록하면 워크스페이스를 비운다 — 섞이면 서버가 404 로 닫는다', async () => {
    nav.pathname = '/w/acme/meetings'
    await act(async () => { root.render(tree(A, { projectId: PID })); await settle() })
    expect(ctx).toMatchObject({ projectId: PID, workspaceId: null })
  })
})
