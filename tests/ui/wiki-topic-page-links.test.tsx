// 위키 주제 페이지의 회의록 기준 경로 배선(과제 35, U2b-5 리뷰 수정 CC6) — 서버 컴포넌트라 useScope 를 못 읽어 페이지가 그 프로젝트의 워크스페이스
// 슬러그로 '/w/<s>/minutes' 를 만들어 WikiTopicDetail 에 넘긴다. 워크스페이스 조회가 실패하거나 행위자가 열화면 넘기지 않는다(컴포넌트가 영구 링크
// 형식으로 그린다 — 스텁이 행의 워크스페이스로, D6). 이 배선은 라이브 시드에 근거가 없어 HTML 로는 볼 수 없었다(u2b-5 보고).
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  detailProps: vi.fn(), workspaceRefById: vi.fn(), getActorForView: vi.fn(),
}))
vi.mock('@/app/actions/project', () => ({ listProjects: vi.fn(async () => [{ id: 'p1', name: '프로젝트' }]) }))
vi.mock('@/lib/authz', () => ({ getActorForView: h.getActorForView }))
vi.mock('@/lib/data/wiki', () => ({ getWikiTopicDetail: vi.fn(async () => ({ available: true, topic: null })) }))
vi.mock('@/lib/modules/pageGate', () => ({ requireModulePage: vi.fn(async () => undefined) }))
vi.mock('@/lib/workspace/resolve', () => ({ workspaceRefById: h.workspaceRefById }))
// 시각의 tz = 프로젝트 달력(SP5) — 이 파일은 tz 를 보지 않는다
vi.mock('@/lib/settings/pageConfig', async () => ({ loadProjectConfigForPage: vi.fn(async () => ({ ok: true, cfg: (await import('../helpers/calendarFixture')).CAL_FIELDS_UTC_SUN })) }))
vi.mock('@/components/app/ProjectPageShell', () => ({ ProjectPageShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }))
vi.mock('@/components/app/PageHeader', () => ({ PageHeader: () => null }))
vi.mock('@/components/wiki/WikiTopicDetail', () => ({ WikiTopicDetail: (p: unknown) => { h.detailProps(p); return null } }))

import WikiTopicPage from '@/app/(app)/p/[projectId]/wiki/topics/[topicId]/page'
import { makeActor } from '../fixtures/actor'

const W = '00000000-0000-0000-7e57-00000000c601'
const render = async () => renderToStaticMarkup(await WikiTopicPage({ params: Promise.resolve({ projectId: 'p1', topicId: 't1' }) }))
const passedBase = () => (h.detailProps.mock.calls.at(-1)?.[0] as { minutesBase?: string }).minutesBase

beforeEach(() => {
  vi.clearAllMocks()
  h.getActorForView.mockResolvedValue(makeActor({ workspaceRoles: new Map([[W, 'member']]), projectWorkspace: new Map([['p1', W]]), projectRoles: new Map([['p1', 'member']]) }))
  h.workspaceRefById.mockResolvedValue({ ok: true, ws: { id: W, slug: 'acme', name: 'Acme' } })
})

describe('위키 주제 페이지 — 회의록 기준 경로', () => {
  it('그 프로젝트의 워크스페이스 슬러그로 /w/<s>/minutes 를 넘긴다', async () => {
    await render()
    expect(h.workspaceRefById).toHaveBeenCalledWith(W)
    expect(passedBase()).toBe('/w/acme/minutes')
  })
  it('워크스페이스 조회가 실패하면 넘기지 않는다 — 컴포넌트가 영구 링크 형식으로 그린다', async () => {
    h.workspaceRefById.mockResolvedValue({ ok: false, kind: 'error', error: 'down' })
    await render()
    expect(passedBase()).toBeUndefined()
  })
  it('행위자가 열화(null)면 워크스페이스를 묻지 않고 넘기지 않는다', async () => {
    h.getActorForView.mockResolvedValue(null)
    await render()
    expect(h.workspaceRefById).not.toHaveBeenCalled()
    expect(passedBase()).toBeUndefined()
  })
})
