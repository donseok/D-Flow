// tests/actions/agent-seatmap-refresh.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getActorForView: vi.fn(), getSeatmap: vi.fn() }))
vi.mock('@/lib/authz', () => ({ getActorForView: mocks.getActorForView }))
vi.mock('@/lib/data/agentSeatmap', () => ({ getSeatmap: mocks.getSeatmap }))
import { refreshSeatmap } from '@/app/actions/agentSeatmap'
import { makeMemberActor, makeSuperuser, WS } from '../fixtures/actor'

const P1 = '11111111-1111-4111-8111-111111111111'
const P2 = '22222222-2222-4222-8222-222222222222'
const MEMBER_P1 = makeMemberActor(P1)

beforeEach(() => { vi.clearAllMocks(); mocks.getActorForView.mockResolvedValue(MEMBER_P1); mocks.getSeatmap.mockResolvedValue({ floors: [] }) })

describe('refreshSeatmap — projectId', () => {
  it('내 프로젝트면 getSeatmap 에 { projectId } 옵션으로 넘긴다', async () => {
    const r = await refreshSeatmap('mine', P1)
    expect(r).toEqual({ ok: true, seatmap: { floors: [] } })
    expect(mocks.getSeatmap).toHaveBeenCalledWith(MEMBER_P1, expect.any(Number), 'mine', { projectId: P1, t: expect.any(Function) })
  })
  it('projectId 없으면 인자 워크스페이스로 좁힌다({ workspaceId }, D26)', async () => {
    await refreshSeatmap('all', undefined, WS)
    expect(mocks.getSeatmap).toHaveBeenCalledWith(MEMBER_P1, expect.any(Number), 'all', { workspaceId: WS, t: expect.any(Function) })
  })
  it('플랫폼 관리자가 형식 밖 워크스페이스 값을 보내면 같은 문구로 거절 — 설정 조회(22P02 로그)까지 가지 않는다(U2a-4 T5)', async () => {
    mocks.getActorForView.mockResolvedValue(makeSuperuser())
    for (const bad of ['ws-1', "x' or 1=1", '00000000-0000-0000-7e57-00000000000g']) {
      expect(await refreshSeatmap('all', undefined, bad)).toEqual({ ok: false, error: '권한이 없습니다.' })
    }
    expect(mocks.getSeatmap).not.toHaveBeenCalled()
  })
  it('워크스페이스 인자가 없으면 권한 없음 — 전 워크스페이스로 넓히지 않는다(W9)', async () => {
    expect(await refreshSeatmap('all')).toEqual({ ok: false, error: '권한이 없습니다.' })
    expect(await refreshSeatmap('all', undefined, 42 as unknown as string)).toEqual({ ok: false, error: '권한이 없습니다.' })
    expect(mocks.getSeatmap).not.toHaveBeenCalled()
  })
  it('소속이 둘이면 인자 워크스페이스가 판정 축 — 역할 없는 쪽·모르는 쪽은 같은 문구, 프로젝트 층은 그대로 열린다', async () => {
    const duo = makeMemberActor(P1, [], { workspaceRoles: new Map([[WS, 'member' as const], ['ws-2', 'member' as const]]) })
    mocks.getActorForView.mockResolvedValue(duo)
    expect(await refreshSeatmap('all', undefined, 'ws-2')).toEqual({ ok: false, error: '권한이 없습니다.' })
    expect(await refreshSeatmap('all', undefined, 'ws-unknown')).toEqual({ ok: false, error: '권한이 없습니다.' })
    expect(mocks.getSeatmap).not.toHaveBeenCalled()
    expect(await refreshSeatmap('all', undefined, WS)).toEqual({ ok: true, seatmap: { floors: [] } })
    expect(mocks.getSeatmap).toHaveBeenCalledWith(duo, expect.any(Number), 'all', { workspaceId: WS, t: expect.any(Function) })
    expect(await refreshSeatmap('mine', P1)).toEqual({ ok: true, seatmap: { floors: [] } })
    expect(mocks.getSeatmap).toHaveBeenCalledWith(duo, expect.any(Number), 'mine', { projectId: P1, t: expect.any(Function) })
  })
  it('그 워크스페이스에 역할이 없으면(조회 전용) 전체 좌석표는 권한 없음', async () => {
    mocks.getActorForView.mockResolvedValue(makeMemberActor(P1, [], { projectRoles: new Map() }))
    expect(await refreshSeatmap('all', undefined, WS)).toEqual({ ok: false, error: '권한이 없습니다.' })
    expect(mocks.getSeatmap).not.toHaveBeenCalled()
  })
  it('멤버가 아닌 프로젝트는 권한 없음 — 조회하지 않는다', async () => {
    expect(await refreshSeatmap('mine', P2)).toEqual({ ok: false, error: '권한이 없습니다.' })
    expect(mocks.getSeatmap).not.toHaveBeenCalled()
  })
  it('UUID 형식이 아니면 프로젝트 값 오류 — 조회하지 않는다', async () => {
    expect(await refreshSeatmap('mine', 'p1')).toEqual({ ok: false, error: '프로젝트 값이 잘못됐습니다.' })
    expect(await refreshSeatmap('mine', "' or 1=1" as string)).toEqual({ ok: false, error: '프로젝트 값이 잘못됐습니다.' })
    expect(mocks.getSeatmap).not.toHaveBeenCalled()
  })
  it('actor 없으면 권한 없음', async () => {
    mocks.getActorForView.mockResolvedValue(null)
    expect(await refreshSeatmap('mine', P1)).toEqual({ ok: false, error: '권한이 없습니다.' })
  })
  it('조회가 throw 하면 고정 문구로 실패', async () => {
    mocks.getSeatmap.mockRejectedValue(new Error('boom'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await refreshSeatmap('mine', P1)).toEqual({ ok: false, error: '좌석표 재조회에 실패했습니다.' })
    spy.mockRestore()
  })
})
