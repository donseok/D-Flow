// 즉시 저장(SP3b UI-3 과제 8) — 홈의 위젯 숨기기·다시 보기는 저장이 끝난 뒤 새로 그려야 한다(디바운스·keepalive 와 달리 결과를 돌려준다)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { postPrefsNow } from '@/lib/prefs/debouncedSave'

const W = '00000000-0000-0000-7e57-000000001845'
let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => { fetchMock = vi.fn(async () => ({ ok: true, status: 200 })); vi.stubGlobal('fetch', fetchMock) })
afterEach(() => { vi.unstubAllGlobals() })

describe('postPrefsNow', () => {
  it('곧바로 /api/prefs 에 JSON 으로 보내고 응답을 돌려준다', async () => {
    const res = await postPrefsNow({ prefs: { portalHiddenWidgets: ['announcements'] }, workspaceId: W })
    expect(res.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, { method: string; headers: Record<string, string>; body: string }]
    expect(url).toBe('/api/prefs'); expect(init.method).toBe('POST'); expect(init.headers['content-type']).toBe('application/json')
    expect(JSON.parse(init.body)).toEqual({ prefs: { portalHiddenWidgets: ['announcements'] }, workspaceId: W })
  })
  it('거부(403)도 그대로 돌려준다 — 호출부가 실패를 성공처럼 보이지 않게', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403 })
    expect((await postPrefsNow({ prefs: { portalHiddenWidgets: [] }, workspaceId: W })).ok).toBe(false)
  })
})
