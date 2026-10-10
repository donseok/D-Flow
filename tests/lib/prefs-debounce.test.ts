import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// 2026-08-18 부터 디바운스 저장은 서버 액션이 아니라 /api/prefs POST 다 — 액션은 성공마다
// 클라이언트 라우터 캐시를 비워 staleTimes 재방문 캐시를 무효화했기 때문(라우트는 무관).
const fetchMock = vi.fn(async () => ({ ok: true }) as Response)

import { queueUiPref, queueWbsCollapse, queueWorkspacePref } from '@/lib/prefs/debouncedSave'

function sentBodies(): unknown[] {
  return fetchMock.mock.calls.map(c => JSON.parse((c as unknown as [string, RequestInit])[1].body as string))
}

beforeEach(() => {
  vi.useFakeTimers()
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('queueUiPref', () => {
  it('연속 호출을 병합해 delay 후 /api/prefs 1회만 저장한다', () => {
    queueUiPref({ theme: 'dark' })
    queueUiPref({ sidebarCollapsed: true })
    expect(fetchMock).not.toHaveBeenCalled()
    vi.advanceTimersByTime(600)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/prefs')
    expect(init.method).toBe('POST')
    // keepalive: 페이지 이탈 직전의 저장도 유실되지 않는 계약
    expect((init as { keepalive?: boolean }).keepalive).toBe(true)
    expect(JSON.parse(init.body as string)).toEqual({ prefs: { theme: 'dark', sidebarCollapsed: true } })
  })
})

describe('queueWorkspacePref — 워크스페이스 키는 그 화면의 워크스페이스 id 와 함께(SP3b D9)', () => {
  it('워크스페이스마다 따로 병합·디바운스 — 본문에 workspaceId, 계정 키 큐와 섞이지 않는다', () => {
    queueWorkspacePref('w1', { startPage: 'home' })
    queueWorkspacePref('w1', { favoriteProjectIds: ['p'] })
    queueWorkspacePref('w2', { startPage: 'my_work' })
    queueUiPref({ theme: 'dark' })
    vi.advanceTimersByTime(600)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(sentBodies()).toEqual(expect.arrayContaining([
      { prefs: { startPage: 'home', favoriteProjectIds: ['p'] }, workspaceId: 'w1' },
      { prefs: { startPage: 'my_work' }, workspaceId: 'w2' },
      { prefs: { theme: 'dark' } },
    ]))
  })
})

describe('queueWbsCollapse', () => {
  it('프로젝트별로 최신값만 저장하고 서로 격리된다', () => {
    queueWbsCollapse('p1', ['a'])
    queueWbsCollapse('p1', ['a', 'b']) // 최신값이 이김
    queueWbsCollapse('p2', ['x'])
    vi.advanceTimersByTime(600)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(sentBodies()).toEqual(expect.arrayContaining([
      { wbsCollapse: { projectId: 'p1', ids: ['a', 'b'] } },
      { wbsCollapse: { projectId: 'p2', ids: ['x'] } },
    ]))
  })
})

// 저장 실패는 로컬 적용을 되돌리지 않고 경고 한 줄을 남긴다(SP3b 스펙 §4.8 "로컬 적용 유지 + 로그", U1c 리뷰 R1 P2) —
// 401(세션 만료)·500 이나 네트워크 실패가 조용히 사라지면 "테마가 저절로 돌아갔다"의 원인 기록이 없다.
describe('postPrefs 실패 기록', () => {
  const flush = async () => { await vi.advanceTimersByTimeAsync(600); for (let i = 0; i < 5; i++) await Promise.resolve() }
  it('응답이 ok 가 아니면 상태 코드를 경고한다', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    fetchMock.mockImplementationOnce(async () => ({ ok: false, status: 401 }) as Response)
    queueUiPref({ theme: 'dark' })
    await flush()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0].join(' ')).toMatch(/\[prefs\].*저장 실패.*401/)
    warn.mockRestore()
  })
  it('네트워크 실패(reject)도 경고한다 — 던지지 않는다', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    fetchMock.mockImplementationOnce(async () => { throw new TypeError('Failed to fetch') })
    queueWbsCollapse('p1', ['a'])
    await flush()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0].join(' ')).toMatch(/\[prefs\].*저장 실패.*Failed to fetch/)
    warn.mockRestore()
  })
  it('성공은 조용하다', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    queueUiPref({ theme: 'light' })
    await flush()
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })
})
