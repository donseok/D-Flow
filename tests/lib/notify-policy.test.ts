// 알림 정책의 서버 읽기(src/lib/notify/policy.ts — 개정 §4.10). 발행 쪽 동작은 tests/lib/notify-emit.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ config: vi.fn(), memo: { map: null as Map<string, Promise<unknown>> | null } }))
vi.mock('@/lib/settings/workspaceConfig', () => ({ getWorkspaceConfig: h.config }))
// react cache 는 요청 밖에서 메모하지 않는다 — "한 요청" 을 흉내 내려고 인자 없는 cache 호출(요청 메모)만 테스트가 쥔 Map 으로 바꾼다
vi.mock('react', async (orig) => ({
  ...(await orig<typeof import('react')>()),
  cache: (fn: (...a: unknown[]) => unknown) => (...a: unknown[]) => (a.length === 0 && h.memo.map ? h.memo.map : fn(...a)),
}))

import { notifyPolicyAllows } from '@/lib/notify/policy'

const cfg = (value: unknown) => ({ keys: { 'notify.policy': { status: 'set', value } } })
function client(workspaceOf: Record<string, string>) {
  const from = vi.fn((table: string) => {
    let id = ''
    const b = {
      select: () => b, eq: (_c: string, v: string) => { id = v; return b },
      maybeSingle: async () => ({ data: table === 'projects' && workspaceOf[id] ? { workspace_id: workspaceOf[id] } : null, error: null }),
    }
    return b
  })
  // 관문이 쓰는 것은 from 하나다 — 가짜 빌더를 해석기의 클라이언트 형으로 본다
  return { from } as unknown as { from: typeof from } & Parameters<typeof notifyPolicyAllows>[0]
}

beforeEach(() => { h.config.mockReset(); h.memo.map = null })

describe('notifyPolicyAllows', () => {
  it('한 요청에서 여러 건을 발행해도 프로젝트의 워크스페이스와 정책을 한 번씩만 읽는다', async () => {
    h.memo.map = new Map()
    h.config.mockResolvedValue(cfg({ 'issue.update': { enabled: false } }))
    const c = client({ p1: 'ws-1' })
    const out = await Promise.all([
      notifyPolicyAllows(c, { type: 'issue.assigned', projectId: 'p1' }),
      notifyPolicyAllows(c, { type: 'issue.update', projectId: 'p1' }),
      notifyPolicyAllows(c, { type: 'issue.mention', projectId: 'p1' }),
    ])
    expect(out).toEqual([true, false, true])
    expect(c.from).toHaveBeenCalledTimes(1)
    expect(h.config).toHaveBeenCalledTimes(1)
  })
  it('요청이 다르면 다시 읽는다 — 프로세스 전역 캐시가 없어 바꾼 정책이 다음 요청부터 먹는다', async () => {
    const c = client({ p1: 'ws-1' })
    h.memo.map = new Map()
    h.config.mockResolvedValue(cfg({}))
    expect(await notifyPolicyAllows(c, { type: 'issue.update', projectId: 'p1' })).toBe(true)
    h.memo.map = new Map()
    h.config.mockResolvedValue(cfg({ 'issue.update': { enabled: false } }))
    expect(await notifyPolicyAllows(c, { type: 'issue.update', projectId: 'p1' })).toBe(false)
    expect(h.config).toHaveBeenCalledTimes(2)
  })
  it('같은 요청 안에서도 워크스페이스마다 따로 읽는다', async () => {
    h.memo.map = new Map()
    h.config.mockImplementation(async (wid: string) => cfg(wid === 'ws-r' ? { 'issue.update': { enabled: false } } : {}))
    const c = client({ pr: 'ws-r', pc: 'ws-c' })
    expect(await notifyPolicyAllows(c, { type: 'issue.update', projectId: 'pr' })).toBe(false)
    expect(await notifyPolicyAllows(c, { type: 'issue.update', projectId: 'pc' })).toBe(true)
    expect(await notifyPolicyAllows(c, { type: 'issue.update', projectId: null, workspaceId: 'ws-r' })).toBe(false)
    expect(h.config.mock.calls.map((x) => x[0])).toEqual(['ws-r', 'ws-c'])
  })
  it('프로젝트가 있으면 넘겨받은 workspaceId 보다 프로젝트의 워크스페이스가 정본이다', async () => {
    h.config.mockResolvedValue(cfg({}))
    const c = client({ p1: 'ws-1' })
    await notifyPolicyAllows(c, { type: 'issue.update', projectId: 'p1', workspaceId: 'ws-other' })
    expect(h.config).toHaveBeenCalledWith('ws-1', { client: c })
  })
})
