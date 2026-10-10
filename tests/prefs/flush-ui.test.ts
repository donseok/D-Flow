import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { queueUiPref, flushUiPrefs } from '@/lib/prefs/debouncedSave'
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200 }))) })
afterEach(async () => { await flushUiPrefs(); vi.useRealTimers(); vi.unstubAllGlobals() })
describe('보기 전환 전 계정 저장 완료', () => {
  it('보기와 대기 중인 다른 계정 키를 한번에 보내고 타이머 중복 저장을 막는다', async () => {
    queueUiPref({ wbsHideDone: true }); queueUiPref({ projectsView: 'cards' })
    expect(fetch).not.toHaveBeenCalled()
    expect(await flushUiPrefs()).toBe(true)
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string)).toEqual({ prefs: { wbsHideDone: true, projectsView: 'cards' } })
    await vi.runAllTimersAsync(); expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('서버 거부는 실패로 돌려주어 호출부가 갱신하지 않게 한다', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 403 } as Response)
    queueUiPref({ projectsView: 'cards' }); expect(await flushUiPrefs()).toBe(false)
  })
})
