// requireModulePage(스펙 §4.2 1·2행, D11) — 꺼지면 notFound(). scope null 은 세션 유일 워크스페이스(requireSessionModule).
import { beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({
  requireModule: vi.fn(), requireSessionModule: vi.fn(), notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }),
  getActorViewState: vi.fn(), getHiddenProjectIds: vi.fn(),
}))
vi.mock('@/lib/modules/gate', () => ({ requireModule: m.requireModule, requireSessionModule: m.requireSessionModule }))
vi.mock('next/navigation', () => ({ notFound: m.notFound }))
vi.mock('@/lib/authz', () => ({ getActorViewState: m.getActorViewState }))
vi.mock('@/lib/authz/visibility', () => ({ getHiddenProjectIds: m.getHiddenProjectIds }))
import { requireModulePage } from '@/lib/modules/pageGate'
import { ERR_MODULE_DISABLED } from '@/lib/authz/errors'
import { makeActor, makeMemberActor, WS } from '../fixtures/actor'

beforeEach(() => {
  vi.clearAllMocks(); m.requireModule.mockResolvedValue({ ok: true }); m.requireSessionModule.mockResolvedValue({ ok: true })
  m.getActorViewState.mockResolvedValue({ actor: makeMemberActor('p'), degraded: false }); m.getHiddenProjectIds.mockResolvedValue(new Set())
})
describe('requireModulePage', () => {
  it('켜지면 아무 일도 하지 않는다', async () => {
    await expect(requireModulePage({ projectId: 'p' }, 'issues')).resolves.toBeUndefined()
    expect(m.requireModule).toHaveBeenCalledWith({ projectId: 'p' }, 'issues')
  })
  it('꺼지면 notFound()', async () => {
    m.requireModule.mockResolvedValue({ ok: false, error: ERR_MODULE_DISABLED })
    await expect(requireModulePage({ projectId: 'p' }, 'issues')).rejects.toThrow('NEXT_NOT_FOUND')
  })
  it('scope null 은 requireSessionModule(null) 로 간다 — 범위가 없으니 core 가 아니면 닫힌다(SP7 — 소속 워크스페이스로 짐작하지 않는다)', async () => {
    m.requireSessionModule.mockResolvedValue({ ok: false, error: ERR_MODULE_DISABLED })
    await expect(requireModulePage(null, 'meetings')).rejects.toThrow('NEXT_NOT_FOUND')
    expect(m.requireSessionModule).toHaveBeenCalledWith(null, 'meetings')
    expect(m.requireModule).not.toHaveBeenCalled()
  })
})

// GG1 — 프로젝트 화면 숨김 재판정. 레이아웃의 notFound 는 병렬 렌더되는 페이지 로더를 멈추지 못해 404 응답의 RSC 페이로드에 본문이 실린다
// (라이브: 명단 밖 멤버의 /p/<비공개>/wbs 404 HTML 에 WBS 행 센티널). 모든 프로젝트 페이지가 첫머리에서 부르는 이 관문이 로더 전에 끊는다.
describe('requireModulePage — 프로젝트 화면 숨김 재판정(GG1)', () => {
  it('명단 밖 비공개(숨김 집합)면 notFound — 모듈이 켜져 있어도', async () => {
    m.getActorViewState.mockResolvedValue({ actor: makeActor({ projectWorkspace: new Map([['p', WS]]) }), degraded: false })
    m.getHiddenProjectIds.mockResolvedValue(new Set(['p']))
    await expect(requireModulePage({ projectId: 'p' }, 'wbs')).rejects.toThrow('NEXT_NOT_FOUND')
  })
  it('타 워크스페이스·미존재 프로젝트도 notFound(레이아웃과 같은 판정자)', async () => {
    m.getActorViewState.mockResolvedValue({ actor: makeActor(), degraded: false })
    await expect(requireModulePage({ projectId: 'p' }, 'wbs')).rejects.toThrow('NEXT_NOT_FOUND')
  })
  it('비공개 판정이 실패하면 404 로 위장하지 않고 던진다', async () => {
    m.getHiddenProjectIds.mockRejectedValue(new Error('hidden-boom'))
    await expect(requireModulePage({ projectId: 'p' }, 'wbs')).rejects.toThrow('hidden-boom')
    expect(m.notFound).not.toHaveBeenCalled()
  })
  it('열화(degraded)는 공개 프로젝트면 통과(레이아웃의 최소 셸), 비공개면 명단을 모르므로 던진다', async () => {
    m.getActorViewState.mockResolvedValue({ actor: null, degraded: true })
    await expect(requireModulePage({ projectId: 'p' }, 'wbs')).resolves.toBeUndefined()
    m.getHiddenProjectIds.mockResolvedValue(new Set(['p']))
    await expect(requireModulePage({ projectId: 'p' }, 'wbs')).rejects.toThrow()
    expect(m.notFound).not.toHaveBeenCalled()
  })
  it('워크스페이스 범위 페이지는 프로젝트 숨김을 보지 않는다', async () => {
    await expect(requireModulePage({ workspaceId: WS }, 'minutes')).resolves.toBeUndefined()
    expect(m.getHiddenProjectIds).not.toHaveBeenCalled()
  })
})
