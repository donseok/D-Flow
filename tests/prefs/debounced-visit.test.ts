// 방문 기록 큐(U2b-2 권한 리뷰 Y1) — 디바운스 창 안의 연속 방문을 모두 실어(순서 유지) 그 워크스페이스의 대기 패치와 한 요청으로 보낸다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { queueProjectVisit, queueWorkspacePref } from '@/lib/prefs/debouncedSave'

const W1 = '00000000-0000-0000-7e57-000000001795', W2 = '00000000-0000-0000-7e57-000000001796'
let fetchMock: ReturnType<typeof vi.fn>
const bodies = () => fetchMock.mock.calls.map((c) => JSON.parse((c[1] as { body: string }).body))
beforeEach(() => { vi.useFakeTimers(); fetchMock = vi.fn(async () => ({ ok: true })); vi.stubGlobal('fetch', fetchMock) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('queueProjectVisit', () => {
  it('600ms 안의 A → B 방문이 둘 다 실린다(앞 방문이 뒤 방문에 덮이지 않는다)', async () => {
    queueProjectVisit(W1, 'pa'); queueProjectVisit(W1, 'pb')
    await vi.advanceTimersByTimeAsync(700)
    expect(bodies()).toEqual([{ workspaceId: W1, visits: ['pa', 'pb'] }])
  })
  it('같은 워크스페이스의 대기 패치와 한 요청으로', async () => {
    queueWorkspacePref(W1, { favoriteProjectIds: ['pa'] }); queueProjectVisit(W1, 'pb')
    await vi.advanceTimersByTimeAsync(700)
    expect(bodies()).toEqual([{ prefs: { favoriteProjectIds: ['pa'] }, workspaceId: W1, visits: ['pb'] }])
  })
  it('워크스페이스마다 따로', async () => {
    queueProjectVisit(W1, 'pa'); queueProjectVisit(W2, 'pz')
    await vi.advanceTimersByTimeAsync(700)
    expect(bodies()).toEqual(expect.arrayContaining([{ workspaceId: W1, visits: ['pa'] }, { workspaceId: W2, visits: ['pz'] }]))
  })
  it('패치만 있으면 visits 를 싣지 않는다(옛 모양 그대로)', async () => {
    queueWorkspacePref(W1, { startPage: 'home' })
    await vi.advanceTimersByTimeAsync(700)
    expect(bodies()).toEqual([{ prefs: { startPage: 'home' }, workspaceId: W1 }])
  })
})
