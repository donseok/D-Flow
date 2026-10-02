// 좌석표 재조회의 agents 관문(스펙 §4.2·판정 P13) — 프로젝트 층이면 그 프로젝트, 전체 좌석표면 인자 워크스페이스로 판정한다(SP3b D26).
// 프로젝트 층은 멤버 판정(가드)을 지난 뒤에 관문이다 — 남의 프로젝트는 설정을 읽기 전에 기존 문구로 끝난다. 꺼지면 좌석표를 읽지 않는다.
// deny 하네스(tests/gates)는 표본이 전체 좌석표('all') 하나라 프로젝트 층의 판정 인자를 못 본다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getActorForView: vi.fn(), getSeatmap: vi.fn() }))
vi.mock('@/lib/authz', () => ({ getActorForView: mocks.getActorForView }))
vi.mock('@/lib/data/agentSeatmap', () => ({ getSeatmap: mocks.getSeatmap }))
import { refreshSeatmap } from '@/app/actions/agentSeatmap'
import { ERR_MODULE_DISABLED } from '@/lib/authz/errors'
import { moduleState, projectsWithModule, requireModule, requireSessionModule, workspacesWithModule } from '@/lib/modules/gate'
import { makeMemberActor, WS } from '../fixtures/actor'

const P1 = '00000000-0000-0000-7e57-000000001701'
const P2 = '00000000-0000-0000-7e57-000000001702'
const OFF = { ok: false as const, error: ERR_MODULE_DISABLED }

beforeEach(() => { vi.clearAllMocks(); mocks.getActorForView.mockResolvedValue(makeMemberActor(P1)); mocks.getSeatmap.mockResolvedValue({ floors: [] }) })
// 관문 mock 값을 바꾸는 파일 — 통과 구현으로 되돌린다(공통 규칙)
afterEach(() => { for (const f of [requireModule, requireSessionModule, moduleState, projectsWithModule, workspacesWithModule]) vi.mocked(f).mockReset() })

describe('refreshSeatmap — agents 관문', () => {
  it('프로젝트 층은 그 프로젝트로 판정하고, 꺼지면 좌석표를 읽지 않는다', async () => {
    vi.mocked(requireModule).mockResolvedValue(OFF)
    expect(await refreshSeatmap('mine', P1)).toEqual(OFF)
    expect(requireModule).toHaveBeenCalledWith({ projectId: P1 }, 'agents')
    expect(requireSessionModule).not.toHaveBeenCalled()
    expect(mocks.getSeatmap).not.toHaveBeenCalled()
  })
  it('전체 좌석표는 인자 워크스페이스로 판정하고, 꺼지면 좌석표를 읽지 않는다', async () => {
    vi.mocked(requireModule).mockResolvedValue(OFF)
    expect(await refreshSeatmap('all', undefined, WS)).toEqual(OFF)
    expect(requireModule).toHaveBeenCalledWith({ workspaceId: WS }, 'agents')
    expect(requireSessionModule).not.toHaveBeenCalled()
    expect(mocks.getSeatmap).not.toHaveBeenCalled()
  })
  it('역할 없는 워크스페이스는 관문 전에 권한 없음(설정을 읽지 않는다)', async () => {
    expect(await refreshSeatmap('all', undefined, 'ws-other')).toEqual({ ok: false, error: '권한이 없습니다.' })
    expect(requireModule).not.toHaveBeenCalled()
  })
  it('남의 프로젝트·형식이 틀린 id 는 관문 전에 기존 문구로 끝난다(가드 → 관문)', async () => {
    expect(await refreshSeatmap('mine', P2)).toEqual({ ok: false, error: '권한이 없습니다.' })
    expect(await refreshSeatmap('mine', 'p1')).toEqual({ ok: false, error: '프로젝트 값이 잘못됐습니다.' })
    expect(requireModule).not.toHaveBeenCalled()
    expect(requireSessionModule).not.toHaveBeenCalled()
  })
})
